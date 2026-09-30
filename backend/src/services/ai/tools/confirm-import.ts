import type { ToolDef, ToolContext } from './types.js'
import { prisma } from '../../../app.js'
import { assertIsMember, checkEnumList, checkEnums } from '../security.js'
import { createAccountsInTx, saveCategoryMappingsInTx, saveAccountMappingsInTx, AccountResolver, batchCreateRecordsInTx, refreshBalances } from '../../import/execute.js'
import { CATEGORY_DICT_GROUPS, findGenericUnconditionalResolutions, findSelfMappedCategoryResolutions, findUnknownCategoryCodes, formatDictOptions } from '../../import/blocking.js'
import { remapImportRows } from '../../import/remap.js'
import { consumeImportOverrides, peekImportOverrides } from './index.js'
import { IMPORT_FILE_MISSING, loadImportFile, parseImportFile } from '../../import/attachment-file.js'
import { ACCOUNT_TYPES, ACCOUNT_TYPE_LABELS, IMPORT_AI_SOURCES, RECORD_TYPES } from '@homibook/core'

export const confirmImportTool: ToolDef = {
  name: 'confirm_import',
  displayName: '确认导入',
  promptHint: '传入账单附件的 attachmentId 和映射规则，一次性完成导入',
  description: '确认导入账单数据。传入账单附件的 attachmentId 和经过用户确认的映射规则，展示导入预览后可执行导入。',
  // 工具自身已返回 confirm_preview 供前端展示富预览（ImportConfirmCard），无需通用确认卡片（避免双重确认）
  requireConfirm: false,
  parameters: {
    type: 'object',
    properties: {
      attachmentId: { type: 'string', description: '账单**附件**的 id，取自本轮消息附件清单里的「attachmentId: xxx」(与 preview_import 传的是同一个)。不要传文件名或其它 id' },
      source: { type: 'string', enum: [...IMPORT_AI_SOURCES], description: '账单来源类型；不传则服务端按文件内容自动识别(推荐不传)' },
      ownerId: { type: 'string', description: '记录归属人ID，不填默认本人' },
      accountResolutions: {
        type: 'array',
        description: 'AI 提供的账户匹配规则',
        items: {
          type: 'object',
          properties: {
            sourceAccountName: { type: 'string' },
            action: { type: 'string', enum: ['existing', 'create'] },
            targetAccountId: { type: 'string' },
            targetAccountName: { type: 'string' },
            accountType: { type: 'string', enum: [...ACCOUNT_TYPES], description: '新建账户的类型' },
          },
          required: ['sourceAccountName', 'action'],
        },
      },
      categoryResolutions: {
        type: 'array',
        description: 'AI 提供的分类映射规则',
        items: {
          type: 'object',
          properties: {
            sourceCategory: { type: 'string' },
            targetCategoryCode: { type: 'string' },
            recordType: { type: 'string', enum: [...RECORD_TYPES] },
            payerContains: { type: 'string', description: '交易方名称正则过滤条件（可选），如 燃气|电力|汇通 匹配任一关键词' },
            descriptionContains: { type: 'string', description: '说明字段正则过滤条件（可选），如 燃气|电力|汇通 匹配任一关键词' },
          },
          required: ['sourceCategory', 'targetCategoryCode'],
        },
      },
    },
    required: ['attachmentId'],
  },

  async execute(args: any, ctx: ToolContext) {
    // 入参枚举校验:来源/账户处理动作/账户类型/记录类型,非法值直接回报给模型
    const badEnum =
      checkEnums({ source: [args.source, IMPORT_AI_SOURCES] })
      ?? checkEnumList('accountResolutions[].action', (args.accountResolutions ?? []).map((r: any) => r.action), ['existing', 'create'] as const)
      ?? checkEnumList('accountResolutions[].accountType', (args.accountResolutions ?? []).map((r: any) => r.accountType), ACCOUNT_TYPES)
      ?? checkEnumList('categoryResolutions[].recordType', (args.categoryResolutions ?? []).map((r: any) => r.recordType), RECORD_TYPES)
    if (badEnum) return badEnum

    await assertIsMember(ctx.accountBookId, ctx.userId)
    const { attachmentId, source: sourceArg, ownerId, accountResolutions, categoryResolutions, _execute } = args as {
      attachmentId: string
      source?: 'alipay' | 'wechat' | 'jd'
      ownerId?: string
      accountResolutions?: { sourceAccountName: string; action: 'existing' | 'create'; targetAccountId?: string; targetAccountName?: string; accountType?: string }[]
      categoryResolutions?: { sourceCategory: string; targetCategoryCode: string; recordType?: string; payerContains?: string; descriptionContains?: string }[]
      _execute?: boolean
    }

    // 分类编码必须在字典里(与 preview_import 同一道校验):不满足直接回报模型重填,避免脏规则落库
    if (categoryResolutions?.length) {
      const dictItems = await prisma.dictionary.findMany({
        where: { group: { in: [...CATEGORY_DICT_GROUPS] } },
        select: { code: true, label: true },
      })
      const unknown = findUnknownCategoryCodes(categoryResolutions.map((c: any) => c.targetCategoryCode), new Set(dictItems.map(d => d.code)))
      if (unknown.length > 0) {
        return {
          success: false,
          retryable: false,
          error: `分类编码不存在：${unknown.join('、')}。targetCategoryCode 必须是系统字典里的编码，可选值：${formatDictOptions(dictItems)}`,
        }
      }
    }

    // 兜底类源分类(其他/未知/转账…)不能用无条件规则映射到具体分类(同 preview_import)
    const genericBad = findGenericUnconditionalResolutions(categoryResolutions ?? [])
    if (genericBad.length > 0) {
      const detail = genericBad.map(r => `「${r.sourceCategory}」→「${r.targetCategoryCode}」`).join('、')
      return {
        success: false,
        retryable: false,
        error: `兜底分类不能用无条件规则映射到具体分类：${detail}。这类分类下的记录互不相关，一条无条件规则会把它们全部误映射。请依据 categorySamples 按交易方/说明分簇，为每条规则补充 payerContains 或 descriptionContains；分不出簇就不要为该分类生成规则。`,
      }
    }

    // 源分类与目标分类同名 = 没映射(同 preview_import)
    const selfMapped = findSelfMappedCategoryResolutions(categoryResolutions ?? [])
    if (selfMapped.length > 0) {
      const detail = selfMapped.map(r => `「${r.sourceCategory}」→「${r.targetCategoryCode}」`).join('、')
      return {
        success: false,
        retryable: false,
        error: `源分类与目标分类同名：${detail}。这条规则等于没有映射，请去掉它，或改为真正要映射到的系统分类。`,
      }
    }

    const effectiveOwnerId = ownerId || ctx.userId

    // 校验归属人必须是账本成员（防越权指定他人）
    if (effectiveOwnerId !== ctx.userId) {
      const [isMember, book] = await Promise.all([
        prisma.accountBookMember.findFirst({ where: { accountBookId: ctx.accountBookId, userId: effectiveOwnerId } }),
        prisma.accountBook.findUnique({ where: { id: ctx.accountBookId }, select: { ownerId: true } }),
      ])
      if (!isMember && book?.ownerId !== effectiveOwnerId) {
        return { success: false, error: '归属人不是账本成员', retryable: false }
      }
    }

    // 账单文件 = 一个附件:按 attachmentId 取行、经 path 读盘
    const file = await loadImportFile(attachmentId)
    if (!file) return { success: false, error: IMPORT_FILE_MISSING, retryable: false }

    // 解析:与 preview_import 同一份逻辑(source 缺省/猜错时按文件内容识别)
    const parsed = parseImportFile(file, sourceArg)
    if (!parsed.ok) return { success: false, error: parsed.error, retryable: false }
    const source = parsed.source
    const parseResult = { rows: parsed.rows, errors: parsed.errors }

    // ---- 合并映射规则：用户覆盖 > LLM 参数 ----
    // Phase 1 (preview): peek 不删除，Phase 2 (execute) 才 consume 删除
    const userOverrides = _execute ? consumeImportOverrides(attachmentId) : peekImportOverrides(attachmentId)
    const effectiveAccountResolutions = userOverrides?.accountResolutions ?? accountResolutions
    const effectiveCategoryResolutions = userOverrides?.categoryResolutions ?? categoryResolutions

    // ---- 统一走 remapImportRows(与手动向导 /preview、/import/check 同一份实现) ----
    // 这里不再自己拼「账户匹配 / 分类映射 / 未决判定」:此前那套手写逻辑与手动向导口径漂移,
    // 是「同一份账单两种入口结论不同」的反复来源。未处置的未识别行不算阻断 ——
    // 用户在预览卡上点「确认导入」即视为同意跳过(confirmSkipUnrecognized)。
    const remapped = await remapImportRows({
      source,
      rows: parseResult.rows,
      accountBookId: ctx.accountBookId,
      ownerId: effectiveOwnerId,
      accountResolutions: effectiveAccountResolutions,
      categoryResolutions: effectiveCategoryResolutions,
      unrecognizedResolutions: userOverrides?.unrecognizedResolutions,
      confirmSkipUnrecognized: true,
    })

    // 实际会写入的流水(UNKNOWN 已处置的也在内)
    const finalRows = remapped.finalRows

    // 将新建的账户(remap 已按目标名合并同组源账户名)
    const accountCreations = remapped.toCreate.map(c => ({
      csvName: c.sourceAccountNames.join(', '),
      name: c.name,
      type: c.type,
    }))

    const newAccountMappings = remapped.toCreate.flatMap(c =>
      c.sourceAccountNames.map(sn => ({ sourceAccountName: sn, targetAccountName: c.name })),
    )

    // ---- 服务端唯一裁决(remapImportRows 下发,与手动向导 /preview 同口径) ----
    // 账户未解析 / 分类未映射 / 无可导入流水 → 不执行,原因回传用户与模型。
    // 未处置的未识别行不作为阻断:点「确认导入」即同意跳过,数量在预览数据里回报。
    const blockReasons = remapped.blockReasons

    // 构建 newMappings
    const newMappings: { sourceCategory: string; targetCategoryCode: string; payerContains?: string; descriptionContains?: string; recordType?: string }[] = []
    if (effectiveCategoryResolutions) {
      for (const cr of effectiveCategoryResolutions) {
        newMappings.push({
          sourceCategory: cr.sourceCategory,
          targetCategoryCode: cr.targetCategoryCode,
          payerContains: cr.payerContains,
          descriptionContains: cr.descriptionContains,
          recordType: cr.recordType,
        })
      }
    }

    // 实际会写入的流水(UNKNOWN 已处置的也在内;未处置的已被 remap 剔除)
    // accountId / toAccountId 已经 remap 的账户解析填好,这里不再补。
    const normalRecords = finalRows

    // ---- 获取账本成员（供归属人选择） ----
    const members = await prisma.accountBookMember.findMany({
      where: { accountBookId: ctx.accountBookId },
      select: { user: { select: { id: true, nickname: true, email: true } } },
    })
    const bookOwner = await prisma.accountBook.findUnique({
      where: { id: ctx.accountBookId },
      select: { owner: { select: { id: true, nickname: true, email: true } } },
    })
    const bookOwnerId = bookOwner?.owner.id

    const formatDate = (d: string) => {
      try {
        const dt = new Date(d)
        if (isNaN(dt.getTime())) return d
        return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')} ${String(dt.getHours()).padStart(2, '0')}:${String(dt.getMinutes()).padStart(2, '0')}:${String(dt.getSeconds()).padStart(2, '0')}`
      } catch { return d }
    }

    // 记录列表要展示「映射后账户名」:remap 已给出 源账户名 → 目标名 的映射,直接下发(前端只做兜底)
    const accountDisplayName = (csvName?: string | null) =>
      csvName ? (remapped.nameMatched[csvName] ?? csvName) : null

    // ---- 阶段1：返回预览数据 ----
    if (!_execute) {
      // 查询分类标签
      const categoryCodes = new Set<string>()
      for (const r of normalRecords) {
        if (r.categoryCode) categoryCodes.add(r.categoryCode)
        if (r.mappedCategoryCode) categoryCodes.add(r.mappedCategoryCode)
      }
      const dictEntries = categoryCodes.size > 0
        ? await prisma.dictionary.findMany({ where: { code: { in: [...categoryCodes] } }, select: { code: true, label: true } })
        : []
      const labelMap = new Map(dictEntries.map(d => [d.code, d.label]))

      const accountTypeLabels = ACCOUNT_TYPE_LABELS as Record<string, string>

      return {
        success: true,
        retryable: false,
        data: {
          mode: 'confirm_preview',
          source,
          attachmentId,
          accountsToCreate: accountCreations.map(a => ({
            name: a.name,
            type: a.type,
            typeLabel: accountTypeLabels[a.type] || a.type,
          })),
          records: normalRecords.map(r => ({
            rowIndex: r.rowIndex,
            date: formatDate(r.date),
            type: r.type,
            amount: r.amount,
            accountName: r.accountName,
            mappedAccountName: accountDisplayName(r.accountName),
            accountId: r.accountId,
            toAccountName: r.toAccountName,
            mappedToAccountName: accountDisplayName(r.toAccountName),
            toAccountId: r.toAccountId,
            categoryCode: r.categoryCode,
            categoryLabel: r.categoryCode ? (labelMap.get(r.categoryCode) || r.categoryCode) : null,
            mappedCategoryCode: r.mappedCategoryCode,
            mappedCategoryLabel: r.mappedCategoryCode ? (labelMap.get(r.mappedCategoryCode) || r.mappedCategoryCode) : null,
            payer: r.payer,
            remark: r.remark,
            tags: r.tags,
          })),
          stats: {
            totalRecords: normalRecords.length,
            incomeCount: normalRecords.filter(r => r.type === 'INCOME').length,
            expenseCount: normalRecords.filter(r => r.type === 'EXPENSE').length,
            transferCount: normalRecords.filter(r => r.type === 'TRANSFER').length,
            accountsToCreate: accountCreations.length,
          },
          ownerId: effectiveOwnerId,
          // 服务端裁决:未决原因(空数组 = 可以执行)
          canProceed: blockReasons.length === 0,
          blockReasons,
          // 未处置的未识别行会被跳过(用户点确认即视为同意),只回报数量
          skippedUnrecognized: remapped.unresolved.unrecognized.length,
          owners: [
            ...(bookOwner ? [{ id: bookOwner.owner.id, name: bookOwner.owner.nickname || bookOwner.owner.email, isOwner: true }] : []),
            ...members.filter(m => m.user.id !== bookOwnerId).map(m => ({ id: m.user.id, name: m.user.nickname || m.user.email, isOwner: false })),
          ],
          accountBookId: ctx.accountBookId,
        },
      }
    }

    // ---- 阶段2：执行导入 ----
    // 服务端唯一裁决:有未决项就不执行(避免静默建账户 / 写入未映射分类),原因回传
    if (blockReasons.length > 0) {
      return { success: false, error: blockReasons.join('；'), retryable: false }
    }

    // 源账户名 → 目标账户名(remap 已给出:名称匹配到的账户名 / 本次将新建的账户名)
    const accountNameMap = remapped.nameMatched

    const records = normalRecords.map(r => ({
      date: r.date,
      type: r.type as 'INCOME' | 'EXPENSE' | 'TRANSFER',
      amount: r.amount,
      accountId: r.accountId || accountNameMap[r.accountName] || r.accountName,
      toAccountId: r.toAccountId || undefined,
      categoryCode: r.mappedCategoryCode || r.categoryCode,
      payer: r.payer,
      remark: r.remark,
      tags: r.tags,
    }))

    const { accountMap, accountsCreated, affectedAccounts } = await prisma.$transaction(async (tx) => {
      const { accountMap, accountsCreated } = await createAccountsInTx(tx, ctx.accountBookId, effectiveOwnerId, accountCreations)
      await saveCategoryMappingsInTx(tx, source, newMappings)
      await saveAccountMappingsInTx(tx, source, newAccountMappings)
      const resolver = new AccountResolver(tx, accountMap, ctx.accountBookId)
      const { affectedAccounts } = await batchCreateRecordsInTx(tx, ctx.accountBookId, effectiveOwnerId, records, idOrName => resolver.resolve(idOrName))
      return { accountMap, accountsCreated, affectedAccounts }
    })

    await refreshBalances(affectedAccounts)

    // 注意:**不删文件** —— 账单文件现在就是一个聊天附件(消息里还挂着它的 chip),
    // 删掉磁盘文件会让该附件变成坏链接。它已被 ChatMessageAttachment 引用,clean-orphans 也不会清它。

    return {
      success: true,
      data: {
        imported: records.length,
        accountsCreated,
      },
      retryable: false,
    }
  },
}

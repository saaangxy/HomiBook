import type { ToolDef, ToolContext } from './types.js'
import { prisma } from '../../../app.js'
import { assertIsMember, checkEnumList, checkEnums } from '../security.js'
import { createAccountsInTx, saveCategoryMappingsInTx, saveAccountMappingsInTx, AccountResolver, batchCreateRecordsInTx, refreshBalances } from '../../import/execute.js'
import { applyAccountMappings, applyCategoryMappings, matchAccountByName, inferAccount } from '../../import/shared.js'
import { consumeImportOverrides, peekImportOverrides } from './index.js'
import { IMPORT_FILE_MISSING, loadImportFile, parseImportFile } from '../../import/attachment-file.js'
import { ACCOUNT_TYPES, ACCOUNT_TYPE_LABELS, IMPORT_AI_SOURCES, RECORD_TYPES, normalizeRecordType } from '@homibook/core'

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

    // 应用用户指定的未识别记录处理
    if (userOverrides?.unrecognizedResolutions && userOverrides.unrecognizedResolutions.length > 0) {
      const unresMap = new Map(userOverrides.unrecognizedResolutions.map(u => [u.rowIndex, u]))
      for (const r of parseResult.rows) {
        const unres = unresMap.get(r.rowIndex)
        if (unres && r.type === 'UNKNOWN') {
          // 归一化:该类型来自客户端提交的人工指定,非法值直接落库会让各端渲染崩溃
          r.type = normalizeRecordType(unres.type)
          r.accountId = unres.accountId || null
          // 转账必须带转入账户:execute 里 toAccountId 为 null 会落成没有收款方的转账
          if (r.type === 'TRANSFER') r.toAccountId = unres.toAccountId || null
          if (unres.categoryCode) r.mappedCategoryCode = unres.categoryCode
        }
      }
    }

    // DB + AI 分类映射合并应用（AI 按唯一键覆盖/补充 DB，统一走评分匹配）
    await applyCategoryMappings(source, parseResult.rows, effectiveCategoryResolutions)

    // 应用 DB 账户映射 + AI 覆盖（只匹配本人/指定归属人的账户）
    const { idMap: accountMappings, newAccountCreations } = await applyAccountMappings(source, parseResult.rows, ctx.accountBookId, effectiveAccountResolutions, effectiveOwnerId)

    // 匹配账户（只匹配本人/指定归属人的账户）
    const allAccounts = await prisma.account.findMany({
      where: { accountBookId: ctx.accountBookId, status: 'ACTIVE', ownerId: effectiveOwnerId },
      select: { id: true, name: true },
    })

    const nameToId = new Map<string, string>()
    for (const row of parseResult.rows) {
      const names = [row.accountName]
      if (row.toAccountName) names.push(row.toAccountName)
      for (const name of names) {
        if (accountMappings.has(name) || nameToId.has(name)) continue
        const result = matchAccountByName(name, allAccounts, effectiveOwnerId)
        if (result.matched) {
          nameToId.set(name, result.id)
        }
      }
    }

    // 构建 accountCreations（按 targetName 合并，避免多个源账户映射到同一目标时重复创建）
    const creationByName = new Map<string, { csvNames: Set<string>; name: string; type: string; bankName?: string; accountNo?: string }>()
    for (const nac of newAccountCreations) {
      const existing = creationByName.get(nac.name)
      if (existing) {
        existing.csvNames.add(nac.sourceAccountName)
      } else {
        creationByName.set(nac.name, { csvNames: new Set([nac.sourceAccountName]), name: nac.name, type: nac.type })
      }
    }

    // 自动推断未匹配账户（跳过已被 AI 映射覆盖的源账户名）
    const mappedSourceNames = new Set([...creationByName.values()].flatMap(c => [...c.csvNames]))
    const seenAccounts = new Set<string>()
    for (const row of parseResult.rows) {
      if (seenAccounts.has(row.accountName)) continue
      seenAccounts.add(row.accountName)
      if (accountMappings.has(row.accountName)) continue
      if (nameToId.has(row.accountName)) continue
      if (mappedSourceNames.has(row.accountName)) continue
      const inferred = inferAccount(row.accountName)
      if (inferred) {
        const existing = creationByName.get(inferred.defaultName)
        if (existing) {
          existing.csvNames.add(row.accountName)
          if (inferred.bankName) existing.bankName = inferred.bankName
          if (inferred.accountNo) existing.accountNo = inferred.accountNo
        } else {
          creationByName.set(inferred.defaultName, {
            csvNames: new Set([row.accountName]),
            name: inferred.defaultName,
            type: inferred.type,
            bankName: inferred.bankName,
            accountNo: inferred.accountNo,
          })
        }
      }
    }

    const accountCreations = [...creationByName.values()].map(c => ({
      csvName: [...c.csvNames].join(', '),
      name: c.name,
      type: c.type,
      bankName: c.bankName,
      accountNo: c.accountNo,
    }))

    const newAccountMappings = [...creationByName.values()].flatMap(c =>
      [...c.csvNames].map(sn => ({ sourceAccountName: sn, targetAccountName: c.name })),
    )

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

    // 构建记录列表（只包含正常记录）
    const normalRecords = parseResult.rows.filter(r => r.type !== 'UNKNOWN')

    // 填充 accountId / toAccountId
    for (const r of normalRecords) {
      if (!r.accountId) {
        r.accountId = accountMappings.get(r.accountName) || nameToId.get(r.accountName) || null
      }
      if (r.toAccountName && !r.toAccountId) {
        r.toAccountId = accountMappings.get(r.toAccountName) || nameToId.get(r.toAccountName) || null
      }
    }

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
            accountId: r.accountId,
            toAccountName: r.toAccountName,
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
          owners: [
            ...(bookOwner ? [{ id: bookOwner.owner.id, name: bookOwner.owner.nickname || bookOwner.owner.email, isOwner: true }] : []),
            ...members.filter(m => m.user.id !== bookOwnerId).map(m => ({ id: m.user.id, name: m.user.nickname || m.user.email, isOwner: false })),
          ],
          accountBookId: ctx.accountBookId,
        },
      }
    }

    // ---- 阶段2：执行导入 ----

    // 构建源账户名 → 新建账户名映射（csvName 已合并为逗号分隔）
    const csvNameToNewName = new Map<string, string>()
    for (const c of creationByName.values()) {
      for (const sn of c.csvNames) {
        csvNameToNewName.set(sn, c.name)
      }
    }

    const records = normalRecords.map(r => ({
      date: r.date,
      type: r.type as 'INCOME' | 'EXPENSE' | 'TRANSFER',
      amount: r.amount,
      accountId: r.accountId || csvNameToNewName.get(r.accountName) || r.accountName,
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

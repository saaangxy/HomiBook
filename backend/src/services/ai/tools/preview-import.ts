import type { ToolDef, ToolContext } from './types.js'
import { prisma } from '../../../app.js'
import { assertIsMember, checkEnumList, checkEnums } from '../security.js'
import { type ParsedRow } from '../../import/shared.js'
import { IMPORT_FILE_MISSING, loadImportFile, parseImportFile } from '../../import/attachment-file.js'
import { CATEGORY_DICT_GROUPS, findGenericUnconditionalResolutions, findSelfMappedCategoryResolutions, findUnknownCategoryCodes, formatDictOptions } from '../../import/blocking.js'
import { remapImportRows } from '../../import/remap.js'
import { ACCOUNT_TYPES, IMPORT_AI_SOURCES, RECORD_TYPES } from '@homibook/core'
import {
  ACCOUNT_UNMATCHED_LIMIT,
  CATEGORY_SAMPLE_LIMIT,
  buildAccountUnmatchedRecords,
  buildCategorySamples,
} from '../../import/analyze-samples.js'

export const previewImportTool: ToolDef = {
  name: 'preview_import',
  displayName: '预览导入',
  promptHint: 'mode=analyze 仅返回未匹配数据供分析；mode=preview 传入映射规则展示交互卡片供确认',
  description: '解析已上传的账单文件并预览导入数据(mode 说明见参数)。导入的三步流程(analyze→preview→confirm)由系统提示词中的「导入流水数据」技能给出。',
  requireConfirm: false,
  parameters: {
    type: 'object',
    properties: {
      attachmentId: { type: 'string', description: '账单**附件**的 id，取自本轮消息附件清单里的「attachmentId: xxx」(账单文件本身就是一个附件)。不要传文件名或其它 id' },
      source: { type: 'string', enum: [...IMPORT_AI_SOURCES], description: '账单来源类型；不传则服务端按文件内容自动识别(推荐不传)' },
      mode: { type: 'string', enum: ['analyze', 'preview'], description: '模式：analyze=分析模式（默认），返回未匹配数据供 AI 分析，不展示交互卡片；preview=预览模式，展示交互卡片供用户确认' },
      accountResolutions: {
        type: 'array',
        description: 'AI 提供的账户匹配规则。每个未匹配的源账户名对应一条规则。设为相同名称即可合并为一个账户',
        items: {
          type: 'object',
          properties: {
            sourceAccountName: { type: 'string', description: '流水中的源账户名称' },
            action: { type: 'string', enum: ['existing', 'create'], description: 'existing=匹配已有账户, create=导入时新建账户' },
            targetAccountId: { type: 'string', description: 'action=existing 时必填：目标已有账户的 ID' },
            targetAccountName: { type: 'string', description: 'action=create 时必填：新建账户的名称' },
            accountType: { type: 'string', enum: [...ACCOUNT_TYPES], description: 'action=create 时必填：新建账户的类型' },
          },
          required: ['sourceAccountName', 'action'],
        },
      },
      categoryResolutions: {
        type: 'array',
        description: 'AI 提供的分类映射规则。用于将源分类名映射到系统分类编码。通过交易方名称和说明字段可细分明确具体类型',
        items: {
          type: 'object',
          properties: {
            sourceCategory: { type: 'string', description: '流水中的源分类名称' },
            targetCategoryCode: { type: 'string', description: '目标系统分类编码（必须在 allDictItems 中存在）' },
            recordType: { type: 'string', enum: [...RECORD_TYPES], description: '限定记录类型（可选,不填则匹配所有类型,除确定不限类型全部映射的分类外,该字段应该填写对应类型）' },
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
    // 入参枚举校验:来源/模式/账户处理动作/账户类型/记录类型,非法值直接回报给模型
    const badEnum =
      checkEnums({
        source: [args.source, IMPORT_AI_SOURCES],
        mode: [args.mode, ['analyze', 'preview'] as const],
      })
      ?? checkEnumList('accountResolutions[].action', (args.accountResolutions ?? []).map((r: any) => r.action), ['existing', 'create'] as const)
      ?? checkEnumList('accountResolutions[].accountType', (args.accountResolutions ?? []).map((r: any) => r.accountType), ACCOUNT_TYPES)
      ?? checkEnumList('categoryResolutions[].recordType', (args.categoryResolutions ?? []).map((r: any) => r.recordType), RECORD_TYPES)
    if (badEnum) return badEnum

    await assertIsMember(ctx.accountBookId, ctx.userId)
    const { attachmentId, source: sourceArg, mode, accountResolutions, categoryResolutions } = args as {
      attachmentId: string
      source?: 'alipay' | 'wechat' | 'jd'
      mode?: 'analyze' | 'preview'
      accountResolutions?: { sourceAccountName: string; action: 'existing' | 'create'; targetAccountId?: string; targetAccountName?: string; accountType?: string }[]
      categoryResolutions?: { sourceCategory: string; targetCategoryCode: string; recordType?: string; payerContains?: string; descriptionContains?: string }[]
    }

    // 分类编码必须落在字典里:模型常把源分类名直接当编码填(它无从知道字典里的 code 长什么样)。
    // 在 preview 阶段就回报错误让它重填,既不落脏规则,也不会拖到最后导入才 400。
    if (categoryResolutions?.length) {
      const dictItems = await prisma.dictionary.findMany({
        where: { group: { in: [...CATEGORY_DICT_GROUPS] } },
        select: { code: true, label: true },
      })
      const unknown = findUnknownCategoryCodes(categoryResolutions.map(c => c.targetCategoryCode), new Set(dictItems.map(d => d.code)))
      if (unknown.length > 0) {
        return {
          success: false,
          retryable: false,
          error: `分类编码不存在：${unknown.join('、')}。targetCategoryCode 必须是系统字典里的编码，可选值：${formatDictOptions(dictItems)}`,
        }
      }
    }

    // 兜底类源分类(其他/未知/转账…)不能用无条件规则映射到具体分类:
    // 一条无条件规则会把该源分类下所有记录都改掉(如整个「其他」→「育儿母婴」)
    const genericBad = findGenericUnconditionalResolutions(categoryResolutions ?? [])
    if (genericBad.length > 0) {
      const detail = genericBad.map(r => `「${r.sourceCategory}」→「${r.targetCategoryCode}」`).join('、')
      return {
        success: false,
        retryable: false,
        error: `兜底分类不能用无条件规则映射到具体分类：${detail}。这类分类下的记录互不相关，一条无条件规则会把它们全部误映射。请依据 categorySamples 按交易方/说明分簇，为每条规则补充 payerContains 或 descriptionContains；分不出簇就不要为该分类生成规则。`,
      }
    }

    // 源分类与目标分类同名 = 没映射,存成规则只会污染规则表
    const selfMapped = findSelfMappedCategoryResolutions(categoryResolutions ?? [])
    if (selfMapped.length > 0) {
      const detail = selfMapped.map(r => `「${r.sourceCategory}」→「${r.targetCategoryCode}」`).join('、')
      return {
        success: false,
        retryable: false,
        error: `源分类与目标分类同名：${detail}。这条规则等于没有映射，请去掉它，或改为真正要映射到的系统分类。`,
      }
    }

    const isAnalyzeMode = mode !== 'preview'

    // 账单文件 = 一个附件:按 attachmentId 取行、经 path 读盘(attachmentId 与磁盘名是两个 uuid)
    const file = await loadImportFile(attachmentId)
    if (!file) return { success: false, error: IMPORT_FILE_MISSING, retryable: false }

    // 解析:source 缺省、或按文件名猜错时,回退到按文件内容识别(见 parseImportFile)
    const parsed = parseImportFile(file, sourceArg)
    if (!parsed.ok) return { success: false, error: parsed.error, retryable: false }
    const source = parsed.source
    const parseResult = { rows: parsed.rows, errors: parsed.errors }

    // ---- 统一走 remapImportRows(与手动向导 /preview、confirm_import 同一份实现) ----
    // 账户匹配 / 分类映射 / 未匹配清单 / 进度计数都从这里出,不再自己组合 shared.ts 的函数
    // (两套组合是「同一份账单不同入口结论不同」的来源)。
    const remapped = await remapImportRows({
      source,
      rows: parseResult.rows,
      accountBookId: ctx.accountBookId,
      ownerId: ctx.userId,
      accountResolutions,
      categoryResolutions,
    })

    // 未匹配账户(含建议新建名/候选)与未匹配分类(含类型与建议编码)
    const unmatchedAccounts = remapped.unmatchedAccounts
    const dbUnmatchedCategories = remapped.unmatchedCategories
    const allDictItems = remapped.allDictItems

    // 本次将新建的账户:remap 按目标名合并,这里展开回「源账户名 → 目标名」逐条(前端沿用旧形状)
    const newAccountCreations = remapped.toCreate.flatMap(c =>
      c.sourceAccountNames.map(sn => ({ sourceAccountName: sn, name: c.name, type: c.type })),
    )

    // 账本全量账户(带归属人)供前端切换归属人时列候选
    const accounts = await loadAccountsForTool(ctx.accountBookId)

    // AI 账户映射规则直接展示，供前端预填充（跳过已在 DB 未匹配列表中的同名项）
    if (accountResolutions?.length) {
      const existingNames = new Set(unmatchedAccounts.map(ua => ua.csvName))
      unmatchedAccounts.push(
        ...accountResolutions
          .filter(ar => !existingNames.has(ar.sourceAccountName))
          .map(ar => ({
            csvName: ar.sourceAccountName,
            suggestedType: ar.accountType || '',
            suggestedName: ar.targetAccountName || ar.sourceAccountName,
            aiResolution: ar,
          }))
      )
    }

    // AI 分类映射规则直接展示
    const unmatchedCategories = categoryResolutions?.length
      ? categoryResolutions.map(cr => ({
          sourceCategory: cr.sourceCategory,
          suggestedCode: cr.targetCategoryCode,
          types: [...new Set(parseResult.rows.filter(r => r.categoryCode === cr.sourceCategory).map(r => r.type))],
          aiTargetCode: cr.targetCategoryCode,
          aiRecordType: cr.recordType,
          payerContains: cr.payerContains || '',
          descriptionContains: cr.descriptionContains || '',
        }))
      : dbUnmatchedCategories

    // 实际会写入的流水(remap 已排除「未处置的未识别行」)与原始未识别行(供「需处理」区块)
    const allNormalRecords = remapped.finalRows
    const allUnrecognizedRecords = parseResult.rows.filter(r => r.type === 'UNKNOWN')

    // 分析模式：返回全部未匹配分类的记录供 AI 分析，不展示交互卡片
    if (isAnalyzeMode) {
      const unmatchedCategoryRecords = allNormalRecords.filter(r => r.categoryCode && !r.mappedCategoryCode)

      // 账户待定行(含 toAccountName 未匹配)+ 分类样本:纯函数,见 services/import/analyze-samples.ts
      const unmatchedAccountNames = new Set(unmatchedAccounts.map(ua => ua.csvName))
      const accountUnmatchedRecords = buildAccountUnmatchedRecords(allNormalRecords, unmatchedAccountNames, ACCOUNT_UNMATCHED_LIMIT)
      const categorySamples = buildCategorySamples(
        allNormalRecords,
        unmatchedCategories.map(uc => uc.sourceCategory),
        CATEGORY_SAMPLE_LIMIT,
      )

      // 该来源下已存在的规则:AI 据此避免重复造规则(与 H 项的归一化口径一致)
      const [existingRules, existingAccountRules] = await Promise.all([
        prisma.importCategoryMapping.findMany({
          where: { source },
          select: { sourceCategory: true, targetCategoryCode: true, recordType: true, payerContains: true, descriptionContains: true },
        }),
        prisma.importAccountMapping.findMany({
          where: { source },
          select: { sourceAccountName: true, targetAccountName: true, payerContains: true, descriptionContains: true },
        }),
      ])

      // 进度计数:直接采用 remapImportRows 的结果(与手动向导 /preview、confirm_import 同一口径)
      const counts = remapped.counts

      return {
        success: true,
        retryable: false,
        data: {
          source,
          mode: 'analyze',
          records: unmatchedCategoryRecords.map(r => ({
            type: r.type, categoryCode: r.categoryCode, payer: r.payer, remark: r.remark,
          })),
          unrecognizedRecords: allUnrecognizedRecords.map(r => ({
            amount: r.amount, accountName: r.accountName, payer: r.payer, remark: r.remark,
          })),
          accountUnmatchedRecords,
          categorySamples,
          existingRules,
          existingAccountRules,
          counts,
          unmatchedAccounts,
          unmatchedCategories,
          allDictItems,
          accounts,
          accountBookId: ctx.accountBookId,
          stats: {
            totalLines: parseResult.rows.length + parseResult.errors.length,
            parsedRows: allNormalRecords.length,
            skippedRows: parseResult.errors.length,
            unrecognizedCount: allUnrecognizedRecords.length,
            unmatchedCategoryCount: unmatchedCategoryRecords.length,
            errors: parseResult.errors,
          },
        },
      }
    }

    // === 预览模式：返回全部记录 ===

    // 查询分类标签映射
    const allCategoryCodes = new Set<string>()
    for (const r of allNormalRecords) {
      if (r.categoryCode) allCategoryCodes.add(r.categoryCode)
      if (r.mappedCategoryCode) allCategoryCodes.add(r.mappedCategoryCode)
    }
    for (const r of allUnrecognizedRecords) {
      if (r.categoryCode) allCategoryCodes.add(r.categoryCode)
      if (r.mappedCategoryCode) allCategoryCodes.add(r.mappedCategoryCode)
    }
    const dictEntries = allCategoryCodes.size > 0
      ? await prisma.dictionary.findMany({ where: { code: { in: [...allCategoryCodes] } }, select: { code: true, label: true } })
      : []
    const categoryLabelMap = new Map(dictEntries.map(d => [d.code, d.label]))

    // 账户列要展示「映射后账户名」(与手动向导确认页同口径):
    // remap 已给出 源账户名 → 目标名 的完整映射(名称匹配 + DB 规则 + 本次将新建),直接下发。
    const accountNameMap: Record<string, string> = { ...remapped.nameMatched }
    for (const c of newAccountCreations) {
      if (!(c.sourceAccountName in accountNameMap)) accountNameMap[c.sourceAccountName] = c.name
    }
    // 兜底:AI 决议本身就是「源账户名 → 目标名」,最可靠的一份
    for (const ar of accountResolutions ?? []) {
      if (!ar.sourceAccountName || ar.sourceAccountName in accountNameMap) continue
      const name = ar.action === 'create'
        ? ar.targetAccountName
        : accounts.find(a => a.id === ar.targetAccountId)?.name
      if (name) accountNameMap[ar.sourceAccountName] = name
    }
    const accountDisplayName = (csvName?: string | null) => (csvName ? (accountNameMap[csvName] ?? csvName) : null)

    const mapRow = (r: ParsedRow) => ({
      rowIndex: r.rowIndex,
      date: r.date,
      type: r.type,
      amount: r.amount,
      accountName: r.accountName,
      mappedAccountName: accountDisplayName(r.accountName),
      accountId: r.accountId,
      toAccountName: r.toAccountName,
      mappedToAccountName: accountDisplayName(r.toAccountName),
      toAccountId: r.toAccountId,
      categoryCode: r.categoryCode,
      categoryLabel: r.categoryCode ? (categoryLabelMap.get(r.categoryCode) || r.categoryCode) : null,
      mappedCategoryCode: r.mappedCategoryCode || null,
      mappedCategoryLabel: r.mappedCategoryCode ? (categoryLabelMap.get(r.mappedCategoryCode) || r.mappedCategoryCode) : null,
      payer: r.payer,
      remark: r.remark,
      tags: r.tags,
    })

    // 构建映射摘要
    const mappedCategories = !categoryResolutions ? undefined : (() => {
      const seen = new Set<string>()
      return allNormalRecords
        .filter(r => r.mappedCategoryCode && r.categoryCode)
        .filter(r => {
          const key = `${r.categoryCode}::${r.mappedCategoryCode}`
          if (seen.has(key)) return false
          seen.add(key)
          return true
        })
        .map(r => ({
          sourceCategory: r.categoryCode!,
          sourceLabel: categoryLabelMap.get(r.categoryCode!) || r.categoryCode!,
          targetCode: r.mappedCategoryCode!,
          targetLabel: categoryLabelMap.get(r.mappedCategoryCode!) || r.mappedCategoryCode!,
        }))
    })()

    return {
      success: true,
      retryable: false,
      data: {
        source,
        mode: 'preview',
        records: allNormalRecords.map(mapRow),
        unrecognizedRecords: allUnrecognizedRecords.map(mapRow),
        unmatchedAccounts,
        unmatchedCategories,
        allDictItems,
        accounts,
        accountBookId: ctx.accountBookId,
        accountMappingNames: { ...remapped.nameMatched },
        newAccountCreations: newAccountCreations.length > 0 ? newAccountCreations : undefined,
        mappedCategories,
        stats: {
          totalLines: parseResult.rows.length + parseResult.errors.length,
          parsedRows: allNormalRecords.length,
          skippedRows: parseResult.errors.length,
          unrecognizedCount: allUnrecognizedRecords.length,
          errors: parseResult.errors,
        },
      },
    }
  },
}

/** 账本全量活跃账户(带归属人),供前端切换归属人时列候选 */
async function loadAccountsForTool(bookId: string) {
  const allAccountsRaw = await prisma.account.findMany({
    where: { accountBookId: bookId, status: 'ACTIVE' },
    select: { id: true, name: true, type: true, ownerId: true, owner: { select: { nickname: true, email: true } } },
  })
  return allAccountsRaw.map(a => ({
    id: a.id,
    name: a.name,
    type: a.type,
    ownerId: a.ownerId,
    ownerName: a.owner.nickname || a.owner.email,
  }))
}

import type { ToolDef, ToolContext } from './types.js'
import { prisma } from '../../../app.js'
import { assertIsMember } from '../security.js'
import { parseAlipayCSV, parseWechatXlsx, parseJdCSV } from '../../import/parsers.js'
import { applyAccountMappings, applyCategoryMappings, matchAccountByName, inferAccount, type ParsedRow } from '../../import/shared.js'
import fs from 'fs'
import path from 'path'

export const previewImportTool: ToolDef = {
  name: 'preview_import',
  description: '解析上传的账单文件并预览导入数据。有两种模式：(1) 分析模式(mode=analyze)：获取解析结果供 AI 分析，只返回未匹配分类的记录，不展示交互卡片；(2) 预览模式(mode=preview)：传入 accountResolutions 和 categoryResolutions 映射规则，展示交互卡片供用户确认调整，返回全部记录及映射后的分类名称。应先用分析模式获取数据，AI 生成映射规则后，再用预览模式验证，最后调用 confirm_import 确认导入。',
  requireConfirm: false,
  parameters: {
    type: 'object',
    properties: {
      fileId: { type: 'string', description: '上传文件后获得的 fileId' },
      source: { type: 'string', enum: ['alipay', 'wechat', 'jd'], description: '账单来源类型' },
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
            accountType: { type: 'string', description: 'action=create 时必填：新建账户的类型(BANK_DEBIT/CREDIT_CARD/ALIPAY/WECHAT/INVESTMENT/OTHER)' },
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
            recordType: { type: 'string', enum: ['INCOME', 'EXPENSE', 'TRANSFER'], description: '限定记录类型（可选,不填则匹配所有类型,除确定不限类型全部映射的分类外,该字段应该填写对应类型）' },
            payerContains: { type: 'string', description: '交易方名称正则过滤条件（可选），如 燃气|电力|汇通 匹配任一关键词' },
            descriptionContains: { type: 'string', description: '说明字段正则过滤条件（可选），如 燃气|电力|汇通 匹配任一关键词' },
          },
          required: ['sourceCategory', 'targetCategoryCode'],
        },
      },
    },
    required: ['fileId', 'source'],
  },

  async execute(args: any, ctx: ToolContext) {
    await assertIsMember(ctx.accountBookId, ctx.userId)
    const { fileId, source, mode, accountResolutions, categoryResolutions } = args as {
      fileId: string
      source: 'alipay' | 'wechat' | 'jd'
      mode?: 'analyze' | 'preview'
      accountResolutions?: { sourceAccountName: string; action: 'existing' | 'create'; targetAccountId?: string; targetAccountName?: string; accountType?: string }[]
      categoryResolutions?: { sourceCategory: string; targetCategoryCode: string; recordType?: string; payerContains?: string; descriptionContains?: string }[]
    }

    const isAnalyzeMode = mode !== 'preview'

    // 查找临时文件
    const uploadDir = path.resolve('uploads')
    const files = fs.readdirSync(uploadDir)
    const targetFile = files.find(f => f.startsWith(fileId))
    if (!targetFile) {
      return { success: false, error: '文件不存在或已过期，请重新上传', retryable: false }
    }

    const filePath = path.join(uploadDir, targetFile)
    const buffer = fs.readFileSync(filePath)

    // 解析
    let parseResult: { rows: ParsedRow[]; errors: string[] }
    if (source === 'alipay') {
      parseResult = parseAlipayCSV(buffer)
    } else if (source === 'wechat') {
      parseResult = parseWechatXlsx(buffer)
    } else if (source === 'jd') {
      parseResult = parseJdCSV(buffer)
    } else {
      return { success: false, error: `不支持的账单来源: ${source}`, retryable: false }
    }

    if (parseResult.rows.length === 0 && parseResult.errors.length > 0) {
      return { success: false, error: parseResult.errors[0], retryable: false }
    }

    // ---- 合并 DB 映射规则 + AI 映射规则（内存合并，不写 DB）----
    const { idMap: accountMappings, nameRecord: accountMappingNames, newAccountCreations } = await applyAccountMappings(source, parseResult.rows, ctx.accountBookId, accountResolutions)

    // 匹配账户
    const { unmatched: unmatchedAccounts, nameMatched, accounts } = await resolveAccountsForTool(ctx.accountBookId, parseResult.rows, accountMappings)

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

    // DB + AI 分类映射合并应用（AI 按唯一键覆盖/补充 DB，统一走评分匹配）
    const { unmatched: dbUnmatchedCategories, allDictItems } = await applyCategoryMappings(source, parseResult.rows, categoryResolutions)

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

    // 分离正常记录和未识别记录
    const allNormalRecords = parseResult.rows.filter(r => r.type !== 'UNKNOWN')
    const allUnrecognizedRecords = parseResult.rows.filter(r => r.type === 'UNKNOWN')

    // 分析模式：返回全部未匹配分类的记录供 AI 分析，不展示交互卡片
    if (isAnalyzeMode) {
      const unmatchedCategoryRecords = allNormalRecords.filter(r => r.categoryCode && !r.mappedCategoryCode)

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

    const mapRow = (r: ParsedRow) => ({
      rowIndex: r.rowIndex,
      date: r.date,
      type: r.type,
      amount: r.amount,
      accountName: r.accountName,
      accountId: r.accountId,
      toAccountName: r.toAccountName,
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
        accountMappingNames: { ...nameMatched, ...accountMappingNames },
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

/** 账户匹配（与 import-export.ts 中 resolveAccounts 逻辑一致） */
async function resolveAccountsForTool(bookId: string, rows: ParsedRow[], idMap?: Map<string, string | null>) {
  const accountNames = new Set(rows.flatMap(r => [r.accountName, r.toAccountName].filter((x): x is string => x != null)))

  const mappedCsvNameToId = new Map<string, string>()
  if (idMap) {
    for (const [csvName, id] of idMap) {
      if (id) mappedCsvNameToId.set(csvName, id)
    }
  }

  const namesToLookup = [...accountNames].filter(n => !mappedCsvNameToId.has(n))
  const allAccounts = await prisma.account.findMany({
    where: { accountBookId: bookId, status: 'ACTIVE' },
    select: { id: true, name: true, type: true },
  })

  const nameToId = new Map<string, string>()
  const nameMatched: Record<string, string> = {}
  const candidatesMap = new Map<string, { id: string; name: string }[]>()
  for (const name of namesToLookup) {
    const result = matchAccountByName(name, allAccounts)
    if (result.matched) {
      nameToId.set(name, result.id)
      nameMatched[name] = result.name
    } else if (result.ambiguous) {
      candidatesMap.set(name, result.candidates)
    }
  }

  const unmatched = [...new Set(
    [...accountNames].filter(name => !mappedCsvNameToId.has(name) && !nameToId.has(name))
  )]
    .map(name => ({ name, amb: candidatesMap.get(name), inf: inferAccount(name) }))
    .filter(({ amb, inf }) => inf || amb)
    .map(({ name, inf, amb }) => ({
      csvName: name,
      suggestedType: inf?.type || '',
      suggestedName: inf?.defaultName || name,
      ...(inf?.bankName != null ? { bankName: inf.bankName } : {}),
      ...(inf?.accountNo != null ? { accountNo: inf.accountNo } : {}),
      ...(amb ? { candidates: amb } : {}),
    }))

  // 填充 accountId / toAccountId
  rows.forEach(r => {
    r.accountId = mappedCsvNameToId.get(r.accountName) || nameToId.get(r.accountName) || null
    if (r.toAccountName) {
      r.toAccountId = mappedCsvNameToId.get(r.toAccountName) || nameToId.get(r.toAccountName) || null
    }
  })

  return { unmatched, nameMatched, accounts: allAccounts }
}

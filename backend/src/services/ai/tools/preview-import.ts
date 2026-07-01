import type { ToolDef, ToolContext } from './types.js'
import { prisma } from '../../../app.js'
import { parseAlipayCSV, parseWechatXlsx, parseJdCSV, parseCsvWithMapping } from '../../../routes/import-export.js'
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
      source: { type: 'string', enum: ['alipay', 'wechat', 'csv', 'jd'], description: '账单来源类型' },
      mode: { type: 'string', enum: ['analyze', 'preview'], description: '模式：analyze=分析模式（默认），返回未匹配数据供 AI 分析，不展示交互卡片；preview=预览模式，展示交互卡片供用户确认' },
      columnMapping: {
        type: 'object',
        description: 'CSV 来源时的列映射 (date/amount/type/accountName/toAccountName/categoryCode/payer/remark/tags 等 → CSV 列名)',
      },
      typeMapping: {
        type: 'object',
        description: 'CSV 来源时的类型值映射 (CSV中的值 → INCOME/EXPENSE/TRANSFER)',
      },
      headerRow: { type: 'number', description: 'CSV 来源时的表头行号（从1开始），不填自动检测' },
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
            payerContains: { type: 'string', description: '交易方名称过滤条件（可选）' },
            descriptionContains: { type: 'string', description: '说明字段过滤条件（可选）' },
          },
          required: ['sourceCategory', 'targetCategoryCode'],
        },
      },
    },
    required: ['fileId', 'source'],
  },

  async execute(args: any, ctx: ToolContext) {
    const { fileId, source, mode, columnMapping, typeMapping, headerRow, accountResolutions, categoryResolutions } = args as {
      fileId: string
      source: 'alipay' | 'wechat' | 'csv' | 'jd'
      mode?: 'analyze' | 'preview'
      columnMapping?: Record<string, string>
      typeMapping?: Record<string, string>
      headerRow?: number
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
      if (!columnMapping || !typeMapping) {
        return { success: false, error: 'CSV 来源需要 columnMapping 和 typeMapping 参数', retryable: false }
      }
      parseResult = parseCsvWithMapping(buffer, columnMapping, typeMapping, headerRow)
    }

    if (parseResult.rows.length === 0 && parseResult.errors.length > 0) {
      return { success: false, error: parseResult.errors[0], retryable: false }
    }

    // ---- 合并 DB 映射规则 + AI 映射规则（内存合并，不写 DB）----
    const newAccountCreations: { sourceAccountName: string; name: string; type: string }[] = []

    // 从 DB 加载映射
    const { idMap: dbAccountMappings, nameRecord: accountMappingNames } = await applyAccountMappings(source, parseResult.rows, ctx.accountBookId)

    // AI 账户映射覆盖 DB 映射（现有账户 → 直接用 ID；新建账户 → 记录供前端展示）
    const accountMappings = new Map(dbAccountMappings)
    if (accountResolutions) {
      for (const ar of accountResolutions) {
        if (ar.action === 'existing' && ar.targetAccountId) {
          accountMappings.set(ar.sourceAccountName, ar.targetAccountId)
        } else if (ar.action === 'create' && ar.targetAccountName && ar.accountType) {
          accountMappings.set(ar.sourceAccountName, `__new__${ar.targetAccountName}`)
          newAccountCreations.push({ sourceAccountName: ar.sourceAccountName, name: ar.targetAccountName, type: ar.accountType })
        }
      }
    }

    // 匹配账户
    const { unmatched: unmatchedAccounts, nameMatched, accounts } = await resolveAccountsForTool(ctx.accountBookId, parseResult.rows, accountMappings)

    // AI 已解析的账户加回 unmatchedAccounts，供前端展示预填充状态
    if (accountResolutions && accountResolutions.length > 0) {
      const existingUnmatchedNames = new Set(unmatchedAccounts.map(ua => ua.csvName))
      for (const ar of accountResolutions) {
        if (!existingUnmatchedNames.has(ar.sourceAccountName)) {
          unmatchedAccounts.push({
            csvName: ar.sourceAccountName,
            suggestedType: ar.accountType || '',
            suggestedName: ar.targetAccountName || ar.sourceAccountName,
            aiResolution: ar,
          })
        }
      }
    }

    // DB 分类映射先应用
    const { unmatched: dbUnmatchedCategories, allDictItems } = await applyCategoryMappings(source, parseResult.rows)

    // AI 分类映射覆盖（AI 优先于 DB，按 sourceCategory + recordType 匹配）
    if (categoryResolutions && categoryResolutions.length > 0) {
      const aiCategoryMap = new Map<string, typeof categoryResolutions[number]>()
      for (const cr of categoryResolutions) {
        const key = cr.recordType ? `${cr.sourceCategory}::${cr.recordType}` : cr.sourceCategory
        aiCategoryMap.set(key, cr)
      }
      for (const r of parseResult.rows) {
        const keyWithType = `${r.categoryCode}::${r.type}`
        const cr = aiCategoryMap.get(keyWithType) || aiCategoryMap.get(r.categoryCode || '')
        if (cr) {
          if (cr.payerContains && r.payer && !r.payer.includes(cr.payerContains)) continue
          if (cr.descriptionContains && r.remark && !r.remark.includes(cr.descriptionContains)) continue
          r.mappedCategoryCode = cr.targetCategoryCode
        }
      }
    }

    // 重新计算 unmatchedCategories：AI 覆盖后可能减少了未匹配项
    const unmatchedCategories: typeof dbUnmatchedCategories = []
    const mappedSourceCategories = new Set<string>()
    for (const r of parseResult.rows) {
      if (r.categoryCode && r.mappedCategoryCode) {
        mappedSourceCategories.add(r.categoryCode)
      }
    }
    // 收集每个分类出现的记录类型（用于未匹配展示）
    const categoryTypes = new Map<string, Set<string>>()
    for (const r of parseResult.rows) {
      if (!r.categoryCode) continue
      if (mappedSourceCategories.has(r.categoryCode)) continue
      const types = categoryTypes.get(r.categoryCode) || new Set()
      types.add(r.type)
      categoryTypes.set(r.categoryCode, types)
    }
    for (const uc of dbUnmatchedCategories) {
      if (!mappedSourceCategories.has(uc.sourceCategory)) {
        unmatchedCategories.push(uc)
      }
    }
    // AI 已映射的分类加回 unmatchedCategories，供前端展示预填充状态
    if (categoryResolutions && categoryResolutions.length > 0) {
      const existingUnmatchedSources = new Set(unmatchedCategories.map(uc => uc.sourceCategory))
      for (const cr of categoryResolutions) {
        if (!existingUnmatchedSources.has(cr.sourceCategory)) {
          const types = new Set<string>()
          for (const r of parseResult.rows) {
            if (r.categoryCode === cr.sourceCategory) types.add(r.type)
          }
          unmatchedCategories.push({
            sourceCategory: cr.sourceCategory,
            suggestedCode: cr.targetCategoryCode,
            types: [...types],
            aiTargetCode: cr.targetCategoryCode,
            aiRecordType: cr.recordType,
          })
        }
      }
    }

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
    let mappedCategories: { sourceCategory: string; sourceLabel: string; targetCode: string; targetLabel: string; recordType?: string }[] = []
    if (categoryResolutions) {
      const seen = new Set<string>()
      for (const r of allNormalRecords) {
        if (!r.mappedCategoryCode || !r.categoryCode) continue
        const key = `${r.categoryCode}::${r.mappedCategoryCode}`
        if (seen.has(key)) continue
        seen.add(key)
        mappedCategories.push({
          sourceCategory: r.categoryCode,
          sourceLabel: categoryLabelMap.get(r.categoryCode) || r.categoryCode,
          targetCode: r.mappedCategoryCode,
          targetLabel: categoryLabelMap.get(r.mappedCategoryCode) || r.mappedCategoryCode,
        })
      }
    }

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
        mappedCategories: mappedCategories.length > 0 ? mappedCategories : undefined,
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
  const accountNames = new Set<string>()
  for (const r of rows) {
    accountNames.add(r.accountName)
    if (r.toAccountName) accountNames.add(r.toAccountName)
  }

  const mappedCsvNameToId = new Map<string, string>()
  if (idMap) {
    for (const [csvName, id] of idMap) {
      if (id) mappedCsvNameToId.set(csvName, id)
    }
  }

  const namesToLookup = Array.from(accountNames).filter(n => !mappedCsvNameToId.has(n))
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

  const unmatched: { csvName: string; suggestedType: string; suggestedName: string; bankName?: string; accountNo?: string; candidates?: { id: string; name: string }[]; aiResolution?: { sourceAccountName: string; action: 'existing' | 'create'; targetAccountId?: string; targetAccountName?: string; accountType?: string } }[] = []
  const seen = new Set<string>()

  for (const name of accountNames) {
    if (mappedCsvNameToId.has(name)) continue
    if (nameToId.has(name)) continue
    if (seen.has(name)) continue
    seen.add(name)
    const ambCandidates = candidatesMap.get(name)
    const inferred = inferAccount(name)
    if (inferred || ambCandidates) {
      unmatched.push({
        csvName: name,
        suggestedType: inferred?.type || '',
        suggestedName: inferred?.defaultName || name,
        bankName: inferred?.bankName,
        accountNo: inferred?.accountNo,
        ...(ambCandidates ? { candidates: ambCandidates } : {}),
      })
    }
  }

  // 填充 accountId / toAccountId
  for (const r of rows) {
    r.accountId = mappedCsvNameToId.get(r.accountName) || nameToId.get(r.accountName) || null
    if (r.toAccountName) {
      r.toAccountId = mappedCsvNameToId.get(r.toAccountName) || nameToId.get(r.toAccountName) || null
    }
  }

  return { unmatched, nameMatched, accounts: allAccounts }
}

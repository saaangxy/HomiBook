import { prisma } from '../../app.js'
import { parseAlipayCSV, parseWechatXlsx, parseJdCSV, parseCsvWithMapping } from '../../routes/import-export.js'
import { applyAccountMappings, matchAccountByName, testMatch, type ParsedRow } from '../import/shared.js'
import fs from 'fs'
import path from 'path'

// ---- 类型定义 ----

export type ConfirmPreviewType = 'records-table' | 'record-changes' | 'budget-card' | 'generic'

export interface ConfirmPreview {
  type: ConfirmPreviewType
  title: string
  description?: string
  columns?: string[]
  rows?: PreviewCell[][]
  changes?: {
    id: string
    date: string
    fields: { label: string; before: string; after: string }[]
  }[]
  budgetFields?: { label: string; value: string }[]
  text?: string // generic 回退
}

export interface PreviewCell {
  text: string
  highlight?: boolean
  color?: 'green' | 'red'
}

// ---- 辅助函数 ----

const TYPE_LABELS: Record<string, string> = {
  INCOME: '收入',
  EXPENSE: '支出',
  TRANSFER: '转账',
}

/** 将 Record 行转为表格行 */
function recordToRow(r: {
  id: string
  type: string
  amount: number
  date: string | Date
  accountName?: string
  fromAccountName?: string
  toAccountName?: string
  categoryLabel?: string
  remark?: string | null
}): PreviewCell[][] {
  const date = typeof r.date === 'string' ? r.date : r.date.toISOString().slice(0, 10)
  const typeLabel = TYPE_LABELS[r.type] || r.type

  let accountText = r.accountName || '-'
  if (r.type === 'TRANSFER') {
    accountText = `${r.fromAccountName || '-'} → ${r.toAccountName || '-'}`
  }

  return [[
    { text: r.id },
    { text: date },
    { text: typeLabel, color: r.type === 'INCOME' ? 'green' : r.type === 'EXPENSE' ? 'red' : undefined },
    { text: accountText },
    { text: r.categoryLabel || '-' },
    { text: r.amount.toFixed(2), color: r.type === 'INCOME' ? 'green' : r.type === 'EXPENSE' ? 'red' : undefined },
    { text: r.remark || '-' },
  ]]
}

/** 查询分类名称映射 */
async function getCategoryLabelMap(codes: string[]): Promise<Map<string, string>> {
  const unique = [...new Set(codes.filter(Boolean))]
  if (unique.length === 0) return new Map()
  const dicts = await prisma.dictionary.findMany({
    where: { group: 'category', code: { in: unique } },
    select: { code: true, label: true },
  })
  return new Map(dicts.map((d) => [d.code, d.label]))
}

/** 查询账户名称映射（优先按 id 查，其次按 accountNo 查） */
async function getAccountNameMap(ids: string[], accountBookId?: string): Promise<Map<string, string>> {
  const unique = [...new Set(ids.filter(Boolean))]
  if (unique.length === 0) return new Map()
  const accounts = await prisma.account.findMany({
    where: {
      ...(accountBookId ? { accountBookId } : {}),
      OR: [{ id: { in: unique } }, { accountNo: { in: unique } }],
    },
    select: { id: true, name: true, accountNo: true },
  })
  const map = new Map<string, string>()
  for (const a of accounts) {
    map.set(a.id, a.name)
    if (a.accountNo) map.set(a.accountNo, a.name)
  }
  return map
}

// ---- 主函数 ----

export async function buildConfirmPreview(
  toolName: string,
  args: any,
  accountBookId: string,
): Promise<string> {
  switch (toolName) {
    case 'delete_record':
      return buildDeletePreview(args, accountBookId)
    case 'create_record':
      return buildCreatePreview(args, accountBookId)
    case 'update_record':
      return buildUpdatePreview(args, accountBookId)
    case 'batch_create_records':
      return buildBatchCreatePreview(args, accountBookId)
    case 'batch_update_records':
      return buildBatchUpdatePreview(args, accountBookId)
    case 'set_budget':
      return buildBudgetPreview(args)
    case 'save_import_mapping':
      return buildSaveImportMappingPreview(args)
    case 'confirm_import':
      return buildConfirmImportPreview(args, accountBookId)
    default:
      return buildGenericPreview(toolName, args)
  }
}

// ---- 各工具预览构建 ----

async function buildDeletePreview(args: any, accountBookId: string): Promise<string> {
  const record = await prisma.record.findUnique({
    where: { id: args.recordId },
    include: {
      account: { select: { name: true } },
      fromAccount: { select: { name: true } },
      toAccount: { select: { name: true } },
    },
  })

  if (!record) {
    return JSON.stringify({
      type: 'generic',
      title: '删除流水记录',
      description: `无法找到记录 ${args.recordId}`,
      text: `记录 ID: ${args.recordId}\n状态: 未找到`,
    } satisfies ConfirmPreview)
  }

  const categoryMap = await getCategoryLabelMap([record.categoryCode || ''].filter(Boolean))

  const preview: ConfirmPreview = {
    type: 'records-table',
    title: '确认删除以下流水记录',
    description: '此操作不可撤销，账户余额将相应调整',
    columns: ['ID', '日期', '类型', '账户', '分类', '金额', '备注'],
    rows: recordToRow({
      id: record.id,
      type: record.type,
      amount: record.amount,
      date: record.date,
      accountName: record.account.name,
      fromAccountName: record.fromAccount?.name,
      toAccountName: record.toAccount?.name,
      categoryLabel: categoryMap.get(record.categoryCode || ''),
      remark: record.remark,
    }),
  }
  return JSON.stringify(preview)
}

async function buildCreatePreview(args: any, accountBookId: string): Promise<string> {
  const codes: string[] = [args.categoryCode].filter(Boolean)
  const accountIds: string[] = [args.accountId, args.fromAccountId, args.toAccountId].filter(Boolean)
  const [categoryMap, accountMap] = await Promise.all([
    getCategoryLabelMap(codes),
    getAccountNameMap(accountIds, accountBookId),
  ])

  let accountText = accountMap.get(args.accountId) || args.accountId || '-'
  if (args.type === 'TRANSFER') {
    accountText = `${accountMap.get(args.fromAccountId) || args.fromAccountId || '-'} → ${accountMap.get(args.toAccountId) || args.toAccountId || '-'}`
  }

  const preview: ConfirmPreview = {
    type: 'records-table',
    title: '确认创建以下流水记录',
    columns: ['日期', '类型', '账户', '分类', '金额', '备注'],
    rows: [[
      { text: args.date || '-' },
      { text: TYPE_LABELS[args.type] || args.type, color: args.type === 'INCOME' ? 'green' : args.type === 'EXPENSE' ? 'red' : undefined },
      { text: accountText },
      { text: categoryMap.get(args.categoryCode) || args.categoryCode || '-' },
      { text: Number(args.amount).toFixed(2), color: args.type === 'INCOME' ? 'green' : args.type === 'EXPENSE' ? 'red' : undefined },
      { text: args.remark || '-' },
    ]],
  }
  return JSON.stringify(preview)
}

async function buildUpdatePreview(args: any, accountBookId: string): Promise<string> {
  const record = await prisma.record.findUnique({
    where: { id: args.recordId },
    include: {
      account: { select: { name: true } },
      fromAccount: { select: { name: true } },
      toAccount: { select: { name: true } },
    },
  })

  if (!record) {
    return JSON.stringify({
      type: 'generic',
      title: '修改流水记录',
      description: `无法找到记录 ${args.recordId}`,
      text: `记录 ID: ${args.recordId}\n状态: 未找到`,
    } satisfies ConfirmPreview)
  }

  // 查询新值对应的名称
  const newCodes: string[] = [args.categoryCode].filter(Boolean)
  const newAccountIds: string[] = [args.accountId, args.fromAccountId, args.toAccountId].filter(Boolean)
  const [categoryMap, accountMap] = await Promise.all([
    getCategoryLabelMap([...newCodes, record.categoryCode || ''].filter(Boolean)),
    getAccountNameMap([...newAccountIds, record.accountId, record.fromAccountId || '', record.toAccountId || ''].filter(Boolean), accountBookId),
  ])

  const dateStr = (d: Date | string) => typeof d === 'string' ? d : d.toISOString().slice(0, 10)

  const fieldDefs: { key: string; label: string; format: (v: any) => string }[] = [
    { key: 'type', label: '类型', format: (v) => TYPE_LABELS[v] || v },
    { key: 'amount', label: '金额', format: (v) => Number(v).toFixed(2) },
    { key: 'date', label: '日期', format: (v) => dateStr(v) },
    { key: 'accountId', label: '账户', format: (v) => accountMap.get(v) || v },
    { key: 'categoryCode', label: '分类', format: (v) => categoryMap.get(v) || v },
    { key: 'remark', label: '备注', format: (v) => v || '-' },
    { key: 'payer', label: '交易方', format: (v) => v || '-' },
  ]

  const fields: { label: string; before: string; after: string }[] = []
  for (const f of fieldDefs) {
    const newVal = args[f.key]
    if (newVal === undefined || newVal === null) continue
    const oldVal = (record as any)[f.key]
    const before = f.format(oldVal)
    const after = f.format(newVal)
    if (before !== after) {
      fields.push({ label: f.label, before, after })
    }
  }

  if (fields.length === 0) {
    return JSON.stringify({
      type: 'generic',
      title: '修改流水记录',
      description: '未检测到任何字段变更',
      text: `记录 ID: ${record.id}`,
    } satisfies ConfirmPreview)
  }

  const preview: ConfirmPreview = {
    type: 'record-changes',
    title: '确认修改流水记录',
    description: `记录 ID: ${record.id}，日期: ${dateStr(record.date)}`,
    changes: [{
      id: record.id,
      date: dateStr(record.date),
      fields,
    }],
  }
  return JSON.stringify(preview)
}

async function buildBatchCreatePreview(args: any, accountBookId: string): Promise<string> {
  const records: any[] = args.records || []
  const codes = records.map((r) => r.categoryCode).filter(Boolean)
  const accountIds = records.flatMap((r) => [r.accountId, r.fromAccountId, r.toAccountId]).filter(Boolean)
  const [categoryMap, accountMap] = await Promise.all([
    getCategoryLabelMap(codes),
    getAccountNameMap(accountIds, accountBookId),
  ])

  const rows: PreviewCell[][][] = records.map((r) => {
    let accountText = accountMap.get(r.accountId) || r.accountId || '-'
    if (r.type === 'TRANSFER') {
      accountText = `${accountMap.get(r.fromAccountId) || r.fromAccountId || '-'} → ${accountMap.get(r.toAccountId) || r.toAccountId || '-'}`
    }
    return [[
      { text: r.date || '-' },
      { text: TYPE_LABELS[r.type] || r.type, color: r.type === 'INCOME' ? 'green' : r.type === 'EXPENSE' ? 'red' : undefined },
      { text: accountText },
      { text: categoryMap.get(r.categoryCode) || r.categoryCode || '-' },
      { text: Number(r.amount).toFixed(2), color: r.type === 'INCOME' ? 'green' : r.type === 'EXPENSE' ? 'red' : undefined },
      { text: r.remark || '-' },
    ]]
  })

  const preview: ConfirmPreview = {
    type: 'records-table',
    title: `确认批量创建 ${records.length} 条流水记录`,
    columns: ['日期', '类型', '账户', '分类', '金额', '备注'],
    rows: rows.flat(),
  }
  return JSON.stringify(preview)
}

async function buildBatchUpdatePreview(args: any, accountBookId: string): Promise<string> {
  const updates: any[] = args.updates || []
  const ids = updates.map((u) => u.recordId)
  const records = await prisma.record.findMany({
    where: { id: { in: ids } },
    include: {
      account: { select: { name: true } },
      fromAccount: { select: { name: true } },
      toAccount: { select: { name: true } },
    },
  })
  const recordMap = new Map(records.map((r) => [r.id, r]))

  // 收集所有需要的名称
  const allCodes = new Set<string>()
  const allAccountIds = new Set<string>()
  for (const r of records) {
    if (r.categoryCode) allCodes.add(r.categoryCode)
    allAccountIds.add(r.accountId)
    if (r.fromAccountId) allAccountIds.add(r.fromAccountId)
    if (r.toAccountId) allAccountIds.add(r.toAccountId)
  }
  for (const u of updates) {
    if (u.categoryCode) allCodes.add(u.categoryCode)
    if (u.accountId) allAccountIds.add(u.accountId)
    if (u.fromAccountId) allAccountIds.add(u.fromAccountId)
    if (u.toAccountId) allAccountIds.add(u.toAccountId)
  }
  const [categoryMap, accountMap] = await Promise.all([
    getCategoryLabelMap([...allCodes]),
    getAccountNameMap([...allAccountIds], accountBookId),
  ])

  const dateStr = (d: Date | string) => typeof d === 'string' ? d : d.toISOString().slice(0, 10)

  const fieldDefs: { key: string; label: string; format: (v: any) => string }[] = [
    { key: 'type', label: '类型', format: (v) => TYPE_LABELS[v] || v },
    { key: 'amount', label: '金额', format: (v) => Number(v).toFixed(2) },
    { key: 'date', label: '日期', format: (v) => dateStr(v) },
    { key: 'accountId', label: '账户', format: (v) => accountMap.get(v) || v },
    { key: 'categoryCode', label: '分类', format: (v) => categoryMap.get(v) || v },
    { key: 'remark', label: '备注', format: (v) => v || '-' },
    { key: 'payer', label: '交易方', format: (v) => v || '-' },
  ]

  const changes: ConfirmPreview['changes'] = []
  for (const u of updates) {
    const record = recordMap.get(u.recordId)
    if (!record) {
      changes!.push({
        id: u.recordId,
        date: '-',
        fields: [{ label: '错误', before: '', after: '记录不存在' }],
      })
      continue
    }
    const fields: { label: string; before: string; after: string }[] = []
    for (const f of fieldDefs) {
      const newVal = u[f.key]
      if (newVal === undefined || newVal === null) continue
      const oldVal = (record as any)[f.key]
      const before = f.format(oldVal)
      const after = f.format(newVal)
      if (before !== after) {
        fields.push({ label: f.label, before, after })
      }
    }
    if (fields.length > 0) {
      changes!.push({ id: record.id, date: dateStr(record.date), fields })
    }
  }

  if (!changes || changes.length === 0) {
    return JSON.stringify({
      type: 'generic',
      title: '批量修改流水记录',
      description: '未检测到任何字段变更',
      text: `共 ${updates.length} 条记录`,
    } satisfies ConfirmPreview)
  }

  const preview: ConfirmPreview = {
    type: 'record-changes',
    title: `确认批量修改 ${changes.length} 条流水记录`,
    changes,
  }
  return JSON.stringify(preview)
}

async function buildBudgetPreview(args: any): Promise<string> {
  let categoryLabel = ''
  if (args.categoryCode) {
    const map = await getCategoryLabelMap([args.categoryCode])
    categoryLabel = map.get(args.categoryCode) || args.categoryCode
  }

  const typeLabel = args.type === 'FIXED' ? '月度固定预算' : '自由预算'
  const period = args.type === 'FREE'
    ? `${args.startDate || '?'} ~ ${args.endDate || '?'}`
    : `${args.year}年${String(args.month).padStart(2, '0')}月`

  const budgetFields: { label: string; value: string }[] = [
    { label: '名称', value: args.name || '-' },
    { label: '类型', value: typeLabel },
    { label: '周期', value: period },
    { label: '金额', value: Number(args.amount).toFixed(2) },
  ]
  if (categoryLabel) budgetFields.push({ label: '关联分类', value: categoryLabel })
  if (args.remark) budgetFields.push({ label: '备注', value: args.remark })

  const preview: ConfirmPreview = {
    type: 'budget-card',
    title: '确认设定预算',
    budgetFields,
  }
  return JSON.stringify(preview)
}

async function buildSaveImportMappingPreview(args: any): Promise<string> {
  const { mappingType, source, mappings } = args as {
    mappingType: 'account' | 'category'
    source: string
    mappings: any[]
  }

  if (!mappings || mappings.length === 0) {
    return JSON.stringify({
      type: 'generic',
      title: '保存导入映射',
      description: '映射列表为空',
    } satisfies ConfirmPreview)
  }

  const sourceLabel: Record<string, string> = { alipay: '支付宝', wechat: '微信', csv: 'CSV', jd: '京东' }
  const title = mappingType === 'account'
    ? `确认保存 ${mappings.length} 条账户映射规则（来源: ${sourceLabel[source] || source}）`
    : `确认保存 ${mappings.length} 条分类映射规则（来源: ${sourceLabel[source] || source}）`

  if (mappingType === 'account') {
    const preview: ConfirmPreview = {
      type: 'records-table',
      title,
      description: '保存后，后续导入时相同的源账户名将自动匹配到目标账户',
      columns: ['源账户名', '目标账户', '交易方正则', '说明正则'],
      rows: mappings.map((m) => [
        { text: m.sourceAccountName },
        { text: `${m.targetAccountName}` },
        { text: m.payerContains || '-' },
        { text: m.descriptionContains || '-' },
      ]),
    }
    return JSON.stringify(preview)
  } else {
    // 查询分类编码对应的标签
    const codes = [...new Set(mappings.map((m) => m.targetCategoryCode))]
    const dictEntries = await prisma.dictionary.findMany({
      where: { code: { in: codes } },
      select: { code: true, label: true },
    })
    const labelMap = new Map(dictEntries.map(d => [d.code, d.label]))

    const preview: ConfirmPreview = {
      type: 'records-table',
      title,
      description: '保存后，后续导入时相同的源分类名将自动映射到目标系统分类',
      columns: ['源分类名', '目标分类', '交易方正则', '说明正则', '记录类型'],
      rows: mappings.map((m) => [
        { text: m.sourceCategory },
        { text: `${labelMap.get(m.targetCategoryCode) || m.targetCategoryCode}` },
        { text: m.payerContains || '-' },
        { text: m.descriptionContains || '-' },
        { text: m.recordType || '-' },
      ]),
    }
    return JSON.stringify(preview)
  }
}

async function buildConfirmImportPreview(args: any, accountBookId: string): Promise<string> {
  const { fileId, source, columnMapping, typeMapping, headerRow, accountResolutions, categoryResolutions } = args as {
    fileId: string
    source: 'alipay' | 'wechat' | 'csv' | 'jd'
    columnMapping?: Record<string, string>
    typeMapping?: Record<string, string>
    headerRow?: number
    accountResolutions?: { sourceAccountName: string; action: 'existing' | 'create'; targetAccountId?: string; targetAccountName?: string; accountType?: string }[]
    categoryResolutions?: { sourceCategory: string; targetCategoryCode: string; recordType?: string; payerContains?: string; descriptionContains?: string }[]
  }

  const uploadDir = path.resolve('uploads')
  let targetFile: string | undefined
  try {
    const files = fs.readdirSync(uploadDir)
    targetFile = files.find(f => f.startsWith(fileId))
  } catch {
    targetFile = undefined
  }
  if (!targetFile) {
    return JSON.stringify({
      type: 'generic',
      title: '确认导入 - 文件不存在',
      description: '文件可能已过期，请重新上传',
      text: `fileId: ${fileId}`,
    } satisfies ConfirmPreview)
  }

  const filePath = path.join(uploadDir, targetFile)
  const buffer = fs.readFileSync(filePath)

  let parseResult: { rows: ParsedRow[]; errors: string[] }
  if (source === 'alipay') {
    parseResult = parseAlipayCSV(buffer)
  } else if (source === 'wechat') {
    parseResult = parseWechatXlsx(buffer)
  } else if (source === 'jd') {
    parseResult = parseJdCSV(buffer)
  } else {
    if (!columnMapping || !typeMapping) {
      return JSON.stringify({
        type: 'generic',
        title: '确认导入 - 参数不足',
        description: 'CSV 来源需要 columnMapping 和 typeMapping',
      } satisfies ConfirmPreview)
    }
    parseResult = parseCsvWithMapping(buffer, columnMapping, typeMapping, headerRow)
  }

  if (parseResult.rows.length === 0) {
    return JSON.stringify({
      type: 'generic',
      title: '确认导入 - 无有效数据',
      description: parseResult.errors[0] || '未解析到任何记录',
    } satisfies ConfirmPreview)
  }

  // 应用 AI 分类映射
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
        if (cr.payerContains && r.payer && !testMatch(cr.payerContains, r.payer)) continue
        if (cr.descriptionContains && r.remark && !testMatch(cr.descriptionContains, r.remark)) continue
        r.mappedCategoryCode = cr.targetCategoryCode
      }
    }
  }

  // AI 账户预映射
  const aiPreMappings = new Map<string, string | null>()
  const newAccountCreations: { sourceAccountName: string; name: string; type: string }[] = []
  if (accountResolutions) {
    for (const ar of accountResolutions) {
      if (ar.action === 'existing' && ar.targetAccountId) {
        aiPreMappings.set(ar.sourceAccountName, ar.targetAccountId)
      } else if (ar.action === 'create' && ar.targetAccountName && ar.accountType) {
        aiPreMappings.set(ar.sourceAccountName, `__new__${ar.targetAccountName}`)
        newAccountCreations.push({ sourceAccountName: ar.sourceAccountName, name: ar.targetAccountName, type: ar.accountType })
      }
    }
  }

  // 应用 DB 映射
  const { idMap: accountMappings } = await applyAccountMappings(source, parseResult.rows, accountBookId)
  for (const [csvName, id] of aiPreMappings) {
    accountMappings.set(csvName, id)
  }

  const allAccounts = await prisma.account.findMany({
    where: { accountBookId, status: 'ACTIVE' },
    select: { id: true, name: true },
  })

  const nameToId = new Map<string, string>()
  for (const row of parseResult.rows) {
    for (const name of [row.accountName, row.toAccountName].filter(Boolean) as string[]) {
      if (accountMappings.has(name) || nameToId.has(name)) continue
      const result = matchAccountByName(name, allAccounts)
      if (result.matched) nameToId.set(name, result.id)
    }
  }

  // 构建 id→name 映射（显示账户名称而非 ID）
  const idToNameMap = new Map<string, string>()
  for (const a of allAccounts) {
    idToNameMap.set(a.id, a.name)
  }

  // 查询分类标签
  const allCategoryCodes = [...new Set(parseResult.rows.map(r => r.mappedCategoryCode || r.categoryCode).filter(Boolean))] as string[]
  const dictEntries = await prisma.dictionary.findMany({
    where: { code: { in: allCategoryCodes } },
    select: { code: true, label: true },
  })
  const categoryLabelMap = new Map(dictEntries.map(d => [d.code, d.label]))

  const normalRecords = parseResult.rows.filter(r => r.type !== 'UNKNOWN')

  const TYPE_LABELS: Record<string, string> = { INCOME: '收入', EXPENSE: '支出', TRANSFER: '转账' }
  const TYPE_NAME: Record<string, string> = {
    BANK_DEBIT: '储蓄卡', CREDIT_CARD: '信用卡', ALIPAY: '支付宝', WECHAT: '微信',
    INVESTMENT: '投资', CASH: '现金', RECHARGE_CARD: '储值卡', OTHER: '其他',
  }

  // 解析账户显示名称（映射 ID → 名称，或新建占位符 → 新名称）
  function resolveAccountName(csvName: string, mappedId: string | null | undefined): string {
    if (mappedId) {
      if (mappedId.startsWith('__new__')) return mappedId.slice(7)
      const name = idToNameMap.get(mappedId)
      if (name) return name
    }
    const id = nameToId.get(csvName)
    if (id) {
      const name = idToNameMap.get(id)
      if (name) return name
    }
    return csvName
  }

  // 构建表格（全部记录，最多200行防撑爆）
  const maxTableRows = 200
  const columns = ['日期', '类型', '账户', '目标账户', '分类', '金额', '备注']
  const allRows: PreviewCell[][] = normalRecords.map(r => {
    const dateStr = r.date.slice(0, 10)
    const accountDisplay = resolveAccountName(r.accountName, accountMappings.get(r.accountName))
    const toAccountDisplay = r.toAccountName
      ? resolveAccountName(r.toAccountName, accountMappings.get(r.toAccountName))
      : '-'
    const catCode = r.mappedCategoryCode || r.categoryCode
    const catLabel = catCode ? (categoryLabelMap.get(catCode) || catCode) : '-'

    return [
      { text: dateStr },
      { text: TYPE_LABELS[r.type] || r.type, color: r.type === 'INCOME' ? 'green' : r.type === 'EXPENSE' ? 'red' : undefined },
      { text: accountDisplay },
      { text: toAccountDisplay !== accountDisplay ? toAccountDisplay : '-' },
      { text: catLabel },
      { text: r.amount.toFixed(2), color: r.type === 'INCOME' ? 'green' : r.type === 'EXPENSE' ? 'red' : undefined },
      { text: (r.remark || '-').slice(0, 40) },
    ]
  })
  const displayRows = allRows.length > maxTableRows ? allRows.slice(0, maxTableRows) : allRows

  // 描述信息
  const descriptionParts: string[] = [`共 ${normalRecords.length} 条记录`]

  // 账户创建列表
  if (newAccountCreations.length > 0) {
    descriptionParts.push(`将创建 ${newAccountCreations.length} 个新账户`)
    const creationLines = newAccountCreations.map(c =>
      `  • ${c.name} (${TYPE_NAME[c.type] || c.type}) ← ${c.sourceAccountName}`
    )
    descriptionParts.push(creationLines.join('\n'))
  }

  if (allRows.length > maxTableRows) {
    descriptionParts.push(`表格仅展示前 ${maxTableRows} 条，其余 ${allRows.length - maxTableRows} 条将在导入时一并处理`)
  }

  // 解析归属人名称
  if (args.ownerId) {
    const member = await prisma.accountBookMember.findFirst({
      where: { accountBookId, userId: args.ownerId },
      select: { user: { select: { nickname: true } } },
    })
    const ownerName = member?.user?.nickname || args.ownerId
    descriptionParts.push(`归属人：${ownerName}`)
  } else {
    descriptionParts.push('归属人：本人（默认）')
  }

  const preview: ConfirmPreview = {
    type: 'records-table',
    title: '确认导入账单数据',
    description: descriptionParts.join('\n'),
    columns,
    rows: displayRows,
  }

  return JSON.stringify(preview)
}

function buildGenericPreview(toolName: string, args: any): string {
  const preview: ConfirmPreview = {
    type: 'generic',
    title: `确认执行: ${toolName}`,
    text: JSON.stringify(args, null, 2),
  }
  return JSON.stringify(preview)
}

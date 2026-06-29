import { prisma } from '../../app.js'

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

function buildGenericPreview(toolName: string, args: any): string {
  const preview: ConfirmPreview = {
    type: 'generic',
    title: `确认执行: ${toolName}`,
    text: JSON.stringify(args, null, 2),
  }
  return JSON.stringify(preview)
}

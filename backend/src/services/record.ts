import { prisma } from '../app.js'

// ---- 过滤器参数 ----

export interface RecordFilter {
  type?: string
  accountId?: string
  categoryCode?: string
  ownerId?: string
  dateFrom?: string
  dateTo?: string
  payer?: string
  amountFrom?: number
  amountTo?: number
  remark?: string
  tags?: string
}

// ---- Prisma 查询 ----

const RECORD_INCLUDE = {
  account: { select: { id: true, name: true, type: true } },
  fromAccount: { select: { id: true, name: true } },
  toAccount: { select: { id: true, name: true } },
  owner: { select: { id: true, nickname: true, username: true, email: true } },
  recordAttachments: { select: { id: true, path: true, originalFilename: true } },
} as const

function parseMultiSelect(value: string): string[] {
  return value.split(',').map((s) => s.trim()).filter(Boolean)
}

function applyMultiSelect(where: Record<string, unknown>, field: string, value: string) {
  const ids = parseMultiSelect(value)
  if (ids.length === 1) where[field] = ids[0]
  else if (ids.length > 1) where[field] = { in: ids }
}

export function buildRecordWhere(bookId: string, filter: RecordFilter) {
  const where: Record<string, unknown> = { accountBookId: bookId }

  if (filter.type) applyMultiSelect(where, 'type', filter.type)
  if (filter.accountId) applyMultiSelect(where, 'accountId', filter.accountId)
  if (filter.categoryCode) applyMultiSelect(where, 'categoryCode', filter.categoryCode)
  if (filter.ownerId) applyMultiSelect(where, 'ownerId', filter.ownerId)

  if (filter.dateFrom || filter.dateTo) {
    where.date = {} as Record<string, unknown>
    if (filter.dateFrom) (where.date as Record<string, unknown>).gte = new Date(filter.dateFrom)
    if (filter.dateTo) (where.date as Record<string, unknown>).lte = new Date(filter.dateTo + 'T23:59:59.999Z')
  }

  if (filter.payer) where.payer = { contains: filter.payer }
  if (filter.amountFrom !== undefined || filter.amountTo !== undefined) {
    where.amount = {} as Record<string, unknown>
    if (filter.amountFrom !== undefined) (where.amount as Record<string, unknown>).gte = filter.amountFrom
    if (filter.amountTo !== undefined) (where.amount as Record<string, unknown>).lte = filter.amountTo
  }
  if (filter.remark) where.remark = { contains: filter.remark }

  if (filter.tags) {
    const tagList = parseMultiSelect(filter.tags)
    if (tagList.length > 0) {
      where.AND = tagList.map((tag) => ({
        tags: { contains: tag.replace(/\\/g, '\\\\').replace(/%/g, '\\%').replace(/_/g, '\\_') },
      }))
    }
  }

  return where
}

export function buildRecordQuery(bookId: string, filter: RecordFilter) {
  return {
    where: buildRecordWhere(bookId, filter),
    include: RECORD_INCLUDE,
    orderBy: [{ date: 'desc' }, { createdAt: 'desc' }] as const,
  }
}

// ---- 记录格式化 ----

export function formatRecord(record: any) {
  return {
    ...record,
    tags: JSON.parse(record.tags),
    attachments: record.recordAttachments?.map((a: any) => ({ id: a.id, url: a.path, originalFilename: a.originalFilename })) ?? [],
    ownerName: record.owner?.nickname || record.owner?.username || record.owner?.email,
  }
}

// ---- 账户余额 ----

export async function computeBalance(accountId: string): Promise<{ balance: number; balanceAt: Date | null }> {
  const account = await prisma.account.findUnique({ where: { id: accountId } })
  if (!account) throw Object.assign(new Error('账户不存在'), { statusCode: 404 })

  const latestAdjustment = await prisma.balanceAdjustment.findFirst({
    where: { accountId },
    orderBy: { date: 'desc' },
  })

  const baseBalance = latestAdjustment?.balanceAfter ?? account.initialBalance ?? 0
  const baseDate = latestAdjustment?.date ?? null

  const dateFilter = baseDate ? { gt: baseDate } : undefined

  const [incomeResult, expenseResult, transferOutResult, transferInResult] = await Promise.all([
    prisma.record.aggregate({ where: { accountId, type: 'INCOME', ...(dateFilter ? { date: dateFilter } : {}) }, _sum: { amount: true } }),
    prisma.record.aggregate({ where: { accountId, type: 'EXPENSE', ...(dateFilter ? { date: dateFilter } : {}) }, _sum: { amount: true } }),
    prisma.record.aggregate({ where: { fromAccountId: accountId, type: 'TRANSFER', ...(dateFilter ? { date: dateFilter } : {}) }, _sum: { amount: true } }),
    prisma.record.aggregate({ where: { toAccountId: accountId, type: 'TRANSFER', ...(dateFilter ? { date: dateFilter } : {}) }, _sum: { amount: true } }),
  ])

  const income = incomeResult._sum.amount ?? 0
  const expense = expenseResult._sum.amount ?? 0
  const transferOut = transferOutResult._sum.amount ?? 0
  const transferIn = transferInResult._sum.amount ?? 0

  return { balance: baseBalance + income - expense + transferIn - transferOut, balanceAt: baseDate }
}

export async function refreshAccountBalance(accountId: string) {
  const { balance, balanceAt } = await computeBalance(accountId)
  await prisma.account.update({ where: { id: accountId }, data: { balance, balanceAt } })
}

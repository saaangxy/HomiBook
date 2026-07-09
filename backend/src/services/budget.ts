import { prisma } from '../app.js'

// ---- 格式化 ----

export function parseTags(tags: string): string[] {
  try {
    const parsed = JSON.parse(tags)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

export function mapBudget(b: any) {
  return {
    ...b,
    tags: parseTags(b.tags),
    startDate: b.startDate ? (b.startDate instanceof Date ? b.startDate.toISOString() : b.startDate) : null,
    endDate: b.endDate ? (b.endDate instanceof Date ? b.endDate.toISOString() : b.endDate) : null,
  }
}

// ---- 自由预算日期筛选 ----

export function buildFreeBudgetDateFilter(startDate?: string, endDate?: string) {
  if (!startDate && !endDate) return undefined

  const sd = startDate ? new Date(startDate) : null
  const ed = endDate ? new Date(endDate) : null
  const conditions: any[] = [{ startDate: null, endDate: null }]

  if (sd && ed) {
    conditions.push(
      { startDate: { lte: ed }, endDate: { gte: sd } },
      { startDate: { lte: ed }, endDate: null },
      { startDate: null, endDate: { gte: sd } },
    )
  } else if (sd) {
    conditions.push({ endDate: { gte: sd } }, { endDate: null })
  } else if (ed) {
    conditions.push({ startDate: { lte: ed } }, { startDate: null })
  }

  return conditions
}

// ---- 实际金额计算 ----

export async function computeActualAmount(budget: any, bookId: string): Promise<number> {
  if (budget.type === 'FIXED') {
    return computeFixedActual(budget, bookId)
  }
  return computeFreeActual(budget, bookId)
}

async function computeFixedActual(budget: any, bookId: string): Promise<number> {
  if (!budget.categoryCode) return 0

  const budgetStart = new Date(Date.UTC(budget.year, budget.month - 1, 1))
  const budgetEnd = new Date(Date.UTC(budget.year, budget.month, 0, 23, 59, 59, 999))

  const [expenseDicts, incomeDicts] = await Promise.all([
    prisma.dictionary.findMany({ where: { group: 'transaction_category_expense' }, select: { code: true } }),
    prisma.dictionary.findMany({ where: { group: 'transaction_category_income' }, select: { code: true } }),
  ])
  const expenseCodes = new Set(expenseDicts.map(d => d.code))
  const incomeCodes = new Set(incomeDicts.map(d => d.code))

  let recordType: string | undefined
  if (expenseCodes.has(budget.categoryCode)) recordType = 'EXPENSE'
  else if (incomeCodes.has(budget.categoryCode)) recordType = 'INCOME'

  const where: any = {
    accountBookId: bookId,
    date: { gte: budgetStart, lte: budgetEnd },
    categoryCode: budget.categoryCode,
  }
  if (recordType) where.type = recordType

  const agg = await prisma.record.aggregate({ where, _sum: { amount: true } })
  return agg._sum.amount ?? 0
}

async function computeFreeActual(budget: any, bookId: string): Promise<number> {
  const budgetTags: string[] = parseTags(budget.tags).filter(t => t.trim())
  if (budgetTags.length === 0) return 0

  const recordWhere: any = {
    accountBookId: bookId,
    type: 'EXPENSE',
    OR: budgetTags.map(tag => ({ tags: { contains: tag } })),
  }

  if (budget.startDate || budget.endDate) {
    recordWhere.date = {}
    if (budget.startDate) recordWhere.date.gte = new Date(budget.startDate)
    if (budget.endDate) {
      const e = new Date(budget.endDate)
      e.setHours(23, 59, 59, 999)
      recordWhere.date.lte = e
    }
  }

  const agg = await prisma.record.aggregate({ where: recordWhere, _sum: { amount: true } })
  return agg._sum.amount ?? 0
}

import { prisma } from '../app.js'

// 标签去重：检查账本内是否已有同名标签（来自其他自由预算）
async function tagExists(tag: string, accountBookId: string, excludeId?: string): Promise<boolean> {
  const where: any = { accountBookId, type: 'FREE', tag }
  if (excludeId) where.id = { not: excludeId }
  const existing = await prisma.budget.findFirst({ where })
  return !!existing
}

// 为自由预算自动生成唯一标签名
export async function generateUniqueTag(
  baseName: string,
  accountBookId: string,
  year: number,
  month: number,
  excludeId?: string,
): Promise<string> {
  // 第一步：尝试原名
  let candidate = baseName
  if (!(await tagExists(candidate, accountBookId, excludeId))) return candidate

  // 第二步：追加年月后缀 YYMM
  const ym = `${String(year).slice(2)}${String(month).padStart(2, '0')}`
  candidate = `${baseName}${ym}`
  if (!(await tagExists(candidate, accountBookId, excludeId))) return candidate

  // 第三步：追加数字序号
  let seq = 2
  while (seq <= 100) {
    candidate = `${baseName}${ym}-${seq}`
    if (!(await tagExists(candidate, accountBookId, excludeId))) return candidate
    seq++
  }
  throw new Error('无法生成唯一标签名称')
}

// 预算汇总计算
export async function computeBudgetSummary(
  accountBookId: string,
  year: number,
  month?: number,
) {
  const budgetWhere: any = { accountBookId, year }
  if (month !== undefined) budgetWhere.month = month

  const budgets = await prisma.budget.findMany({
    where: budgetWhere,
    orderBy: [{ type: 'asc' }, { month: 'asc' }, { name: 'asc' }],
  })

  // 日期范围
  const startDate = month !== undefined
    ? new Date(Date.UTC(year, month - 1, 1))
    : new Date(Date.UTC(year, 0, 1))
  const endDate = month !== undefined
    ? new Date(Date.UTC(year, month, 0, 23, 59, 59, 999))
    : new Date(Date.UTC(year, 11, 31, 23, 59, 59, 999))

  // 获取分类字典，区分支出/收入
  const expenseDicts = await prisma.dictionary.findMany({
    where: { group: 'transaction_category_expense' },
    select: { code: true },
  })
  const expenseCodes = new Set(expenseDicts.map(d => d.code))
  const incomeDicts = await prisma.dictionary.findMany({
    where: { group: 'transaction_category_income' },
    select: { code: true },
  })
  const incomeCodes = new Set(incomeDicts.map(d => d.code))

  const details = await Promise.all(budgets.map(async (budget) => {
    let actualAmount = 0

    if (budget.type === 'FIXED' && budget.categoryCode) {
      let recordType: string | undefined
      if (expenseCodes.has(budget.categoryCode)) recordType = 'EXPENSE'
      else if (incomeCodes.has(budget.categoryCode)) recordType = 'INCOME'

      const where: any = {
        accountBookId,
        date: { gte: startDate, lte: endDate },
        categoryCode: budget.categoryCode,
      }
      if (recordType) where.type = recordType

      const agg = await prisma.record.aggregate({
        where,
        _sum: { amount: true },
      })
      actualAmount = agg._sum.amount ?? 0
    } else if (budget.type === 'FREE' && budget.tag) {
      // JSON字符串包含匹配：tags 存储为 ["tag1","tag2"]，用 contains 匹配
      const agg = await prisma.record.aggregate({
        where: {
          accountBookId,
          date: { gte: startDate, lte: endDate },
          type: 'EXPENSE',
          tags: { contains: budget.tag },
        },
        _sum: { amount: true },
      })
      actualAmount = agg._sum.amount ?? 0
    }

    return {
      id: budget.id,
      name: budget.name,
      type: budget.type,
      year: budget.year,
      month: budget.month,
      amount: budget.amount,
      categoryCode: budget.categoryCode,
      tag: budget.tag,
      remark: budget.remark,
      actualAmount: Math.round(actualAmount * 100) / 100,
      usagePercent: budget.amount > 0 ? Math.round((actualAmount / budget.amount) * 10000) / 100 : 0,
      remaining: Math.round((budget.amount - actualAmount) * 100) / 100,
    }
  }))

  const totalBudget = Math.round(details.reduce((s, d) => s + d.amount, 0) * 100) / 100
  const totalActual = Math.round(details.reduce((s, d) => s + d.actualAmount, 0) * 100) / 100

  return {
    totalBudget,
    totalActual,
    totalRemaining: Math.round((totalBudget - totalActual) * 100) / 100,
    totalUsagePercent: totalBudget > 0 ? Math.round((totalActual / totalBudget) * 10000) / 100 : 0,
    details,
  }
}

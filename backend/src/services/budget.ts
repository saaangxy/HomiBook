import { prisma } from '../app.js'

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
      // 固定预算使用自己的年月计算日期范围
      const budgetStartDate = new Date(Date.UTC(budget.year, budget.month - 1, 1))
      const budgetEndDate = new Date(Date.UTC(budget.year, budget.month, 0, 23, 59, 59, 999))

      let recordType: string | undefined
      if (expenseCodes.has(budget.categoryCode)) recordType = 'EXPENSE'
      else if (incomeCodes.has(budget.categoryCode)) recordType = 'INCOME'

      const where: any = {
        accountBookId,
        date: { gte: budgetStartDate, lte: budgetEndDate },
        categoryCode: budget.categoryCode,
      }
      if (recordType) where.type = recordType

      const agg = await prisma.record.aggregate({
        where,
        _sum: { amount: true },
      })
      actualAmount = agg._sum.amount ?? 0
    } else if (budget.type === 'FREE') {
      // 自由预算不限日期，只按标签匹配
      let budgetTags: string[] = []
      try {
        const parsed = JSON.parse(budget.tags)
        if (Array.isArray(parsed)) budgetTags = parsed.filter((t: any) => typeof t === 'string' && t.trim())
      } catch { /* ignore */ }

      if (budgetTags.length > 0) {
        // 多标签 OR 关系：记录 tags 字段包含任一 budget 标签即匹配
        const tagConditions = budgetTags.map((tag) => ({
          tags: { contains: tag },
        }))

        const agg = await prisma.record.aggregate({
          where: {
            accountBookId,
            type: 'EXPENSE',
            OR: tagConditions,
          },
          _sum: { amount: true },
        })
        actualAmount = agg._sum.amount ?? 0
      }
    }

    const roundedAmount = Math.round(budget.amount * 100) / 100
    return {
      id: budget.id,
      name: budget.name,
      type: budget.type,
      year: budget.year,
      month: budget.month,
      amount: roundedAmount,
      categoryCode: budget.categoryCode,
      tags: (() => {
        try { const p = JSON.parse(budget.tags); return Array.isArray(p) ? p : []; } catch { return []; }
      })(),
      remark: budget.remark,
      actualAmount: Math.round(actualAmount * 100) / 100,
      usagePercent: roundedAmount > 0 ? Math.round((actualAmount / roundedAmount) * 10000) / 100 : 0,
      remaining: Math.round((roundedAmount - actualAmount) * 100) / 100,
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

import { prisma } from '../../../app.js'
import { assertIsMember, retryable, type ToolResult } from '../security.js'
import type { ToolDef, ToolContext } from './types.js'

interface GetStatsArgs {
  startDate?: string
  endDate?: string
  year?: number
  month?: number
  type?: string
  categoryCode?: string
  groupBy?: 'month' | 'category' | 'type' | 'account'
}

export const getStatsTool: ToolDef = {
  name: 'get_stats',
  description: '获取统计分析数据。支持按月/分类/类型汇总。时间范围可用 startDate+endDate(YYYY-MM-DD) 或 year(+month)；type 筛选 INCOME/EXPENSE/TRANSFER；groupBy 指定汇总维度。',
  parameters: {
    type: 'object',
    properties: {
      startDate: { type: 'string', description: '开始日期 YYYY-MM-DD，与 endDate 配合使用' },
      endDate: { type: 'string', description: '结束日期 YYYY-MM-DD，与 startDate 配合使用' },
      year: { type: 'number', description: '年份，默认当前年份' },
      month: { type: 'number', description: '月份 (1-12)，仅与 year 配合使用' },
      type: { type: 'string', enum: ['INCOME', 'EXPENSE', 'TRANSFER'], description: '收支类型筛选' },
      categoryCode: { type: 'string', description: '分类编码筛选' },
      groupBy: { type: 'string', enum: ['month', 'category', 'type', 'account'], description: '汇总维度，默认 month' },
    },
  },

  async execute(args: GetStatsArgs, ctx: ToolContext): Promise<ToolResult> {
    await assertIsMember(ctx.accountBookId, ctx.userId)

    return retryable(async () => {
      const now = new Date()
      const year = args.year ? Number(args.year) : now.getFullYear()
      const month = args.month ? Number(args.month) : undefined

      // 日期范围：优先使用 startDate/endDate，其次 year/month
      let dateFilter: Record<string, unknown>
      let period: string
      if (args.startDate || args.endDate) {
        dateFilter = {}
        if (args.startDate) dateFilter.gte = new Date(args.startDate)
        if (args.endDate) dateFilter.lte = new Date(args.endDate)
        period = args.startDate && args.endDate
          ? `${args.startDate} ~ ${args.endDate}`
          : args.startDate ? `${args.startDate} 起` : `至 ${args.endDate}`
      } else if (month) {
        dateFilter = {
          gte: new Date(`${year}-${String(month).padStart(2, '0')}-01`),
          lte: new Date(`${year}-${String(month).padStart(2, '0')}-${new Date(year, month, 0).getDate()}`),
        }
        period = `${year}年${month}月`
      } else {
        dateFilter = {
          gte: new Date(`${year}-01-01`),
          lte: new Date(`${year}-12-31`),
        }
        period = `${year}年`
      }

      const where: Record<string, unknown> = {
        accountBookId: ctx.accountBookId,
        date: dateFilter,
      }
      if (args.type) where.type = args.type
      if (args.categoryCode) where.categoryCode = args.categoryCode

      // 按类型汇总
      const [incomeAgg, expenseAgg] = await Promise.all([
        prisma.record.aggregate({ where: { ...where, type: 'INCOME' }, _sum: { amount: true } }),
        prisma.record.aggregate({ where: { ...where, type: 'EXPENSE' }, _sum: { amount: true } }),
      ])

      const totalIncome = incomeAgg._sum.amount ?? 0
      const totalExpense = expenseAgg._sum.amount ?? 0

      // 按 groupBy 维度汇总
      let breakdown: unknown[] = []

      if (args.groupBy === 'month' || !args.groupBy) {
        const records = await prisma.record.findMany({
          where,
          select: { date: true, amount: true, type: true },
        })

        const monthlyMap = new Map<string, { income: number; expense: number }>()
        for (const r of records) {
          const key = r.date.toISOString().slice(0, 7) // YYYY-MM
          if (!monthlyMap.has(key)) monthlyMap.set(key, { income: 0, expense: 0 })
          const m = monthlyMap.get(key)!
          if (r.type === 'INCOME') m.income += r.amount
          else if (r.type === 'EXPENSE') m.expense += r.amount
        }

        breakdown = Array.from(monthlyMap.entries())
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([month, data]) => ({
            month,
            income: Math.round(data.income * 100) / 100,
            expense: Math.round(data.expense * 100) / 100,
            net: Math.round((data.income - data.expense) * 100) / 100,
          }))
      }

      if (args.groupBy === 'category') {
        const records = await prisma.record.findMany({
          where,
          select: { amount: true, type: true, categoryCode: true },
        })

        const categoryMap = new Map<string, { income: number; expense: number }>()
        for (const r of records) {
          const key = r.categoryCode || '未分类'
          if (!categoryMap.has(key)) categoryMap.set(key, { income: 0, expense: 0 })
          const c = categoryMap.get(key)!
          if (r.type === 'INCOME') c.income += r.amount
          else if (r.type === 'EXPENSE') c.expense += r.amount
        }

        breakdown = Array.from(categoryMap.entries())
          .sort(([, a], [, b]) => b.expense - a.expense)
          .map(([category, data]) => ({
            category,
            income: Math.round(data.income * 100) / 100,
            expense: Math.round(data.expense * 100) / 100,
            net: Math.round((data.income - data.expense) * 100) / 100,
          }))
      }

      if (args.groupBy === 'type') {
        const records = await prisma.record.findMany({
          where,
          select: { amount: true, type: true },
        })

        const typeMap = new Map<string, { count: number; total: number }>()
        for (const r of records) {
          if (!typeMap.has(r.type)) typeMap.set(r.type, { count: 0, total: 0 })
          const t = typeMap.get(r.type)!
          t.count += 1
          t.total += r.amount
        }

        breakdown = Array.from(typeMap.entries()).map(([type, data]) => ({
          type,
          count: data.count,
          total: Math.round(data.total * 100) / 100,
        }))
      }

      if (args.groupBy === 'account') {
        const records = await prisma.record.findMany({
          where,
          select: { amount: true, type: true, account: { select: { id: true, name: true } } },
        })

        const accountMap = new Map<string, { accountName: string; income: number; expense: number }>()
        for (const r of records) {
          const { id, name } = r.account
          if (!accountMap.has(id)) accountMap.set(id, { accountName: name, income: 0, expense: 0 })
          const a = accountMap.get(id)!
          if (r.type === 'INCOME') a.income += r.amount
          else if (r.type === 'EXPENSE') a.expense += r.amount
        }

        breakdown = Array.from(accountMap.entries())
          .sort(([, a], [, b]) => (b.income + b.expense) - (a.income + a.expense))
          .map(([accountId, data]) => ({
            accountId,
            accountName: data.accountName,
            income: Math.round(data.income * 100) / 100,
            expense: Math.round(data.expense * 100) / 100,
            net: Math.round((data.income - data.expense) * 100) / 100,
          }))
      }

      return {
        period,
        totalIncome: Math.round(totalIncome * 100) / 100,
        totalExpense: Math.round(totalExpense * 100) / 100,
        netBalance: Math.round((totalIncome - totalExpense) * 100) / 100,
        breakdown,
      }
    }, 'get_stats')
  },
}

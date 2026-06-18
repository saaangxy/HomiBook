import { prisma } from '../../../app.js'
import { assertIsMember, retryable, type ToolResult } from '../security.js'
import type { ToolDef, ToolContext } from './types.js'

interface GetStatsArgs {
  year?: number
  month?: number
  categoryCode?: string
  groupBy?: 'month' | 'category' | 'type'
}

export const getStatsTool: ToolDef = {
  name: 'get_stats',
  description: '获取统计分析数据。支持按月/分类/类型汇总，可指定时间范围和分类筛选。',
  parameters: {
    type: 'object',
    properties: {
      year: { type: 'number', description: '年份，默认当前年份' },
      month: { type: 'number', description: '月份 (1-12)' },
      categoryCode: { type: 'string', description: '分类编码筛选' },
      groupBy: { type: 'string', enum: ['month', 'category', 'type'], description: '汇总维度，默认 category' },
    },
  },

  async execute(args: GetStatsArgs, ctx: ToolContext): Promise<ToolResult> {
    await assertIsMember(ctx.accountBookId, ctx.userId)

    return retryable(async () => {
      const now = new Date()
      const year = args.year ?? now.getFullYear()

      const dateFilter: Record<string, unknown> = {}
      if (args.month) {
        dateFilter.gte = new Date(`${year}-${String(args.month).padStart(2, '0')}-01`)
        dateFilter.lte = new Date(`${year}-${String(args.month).padStart(2, '0')}-${new Date(year, args.month, 0).getDate()}`)
      } else {
        dateFilter.gte = new Date(`${year}-01-01`)
        dateFilter.lte = new Date(`${year}-12-31`)
      }

      const where: Record<string, unknown> = {
        accountBookId: ctx.accountBookId,
        date: dateFilter,
      }
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

      return {
        period: args.month ? `${year}年${args.month}月` : `${year}年`,
        totalIncome: Math.round(totalIncome * 100) / 100,
        totalExpense: Math.round(totalExpense * 100) / 100,
        netBalance: Math.round((totalIncome - totalExpense) * 100) / 100,
        breakdown,
      }
    }, 'get_stats')
  },
}

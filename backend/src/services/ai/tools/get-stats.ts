import { prisma } from '../../../app.js'
import { assertIsMember, checkEnums, retryable, type ToolResult } from '../security.js'
import type { ToolDef, ToolContext } from './types.js'
import { parseDayStart, parseDayEnd, dayStart, dayEnd, dateKey, monthKey } from '../../../lib/date-time.js'
import { RECORD_TYPES } from '@homibook/core'

interface GetStatsArgs {
  startDate?: string
  endDate?: string
  year?: number
  month?: number
  type?: string
  categoryCode?: string
  groupBy?: 'month' | 'category' | 'type' | 'account'
}

/** 汇总维度(本工具专属的对话粗粒度维度,与 /api/records/analysis 的 STAT_GROUP_BYS 不是同一集合) */
const GROUP_BYS = ['month', 'category', 'type', 'account'] as const

export const getStatsTool: ToolDef = {
  name: 'get_stats',
  displayName: '统计概览',
  promptHint: '生成统计分析报表',
  description: '获取统计分析数据。时间范围可用 startDate+endDate(YYYY-MM-DD) 或 year(+month)。',
  parameters: {
    type: 'object',
    properties: {
      startDate: { type: 'string', description: '开始日期 YYYY-MM-DD，与 endDate 配合使用' },
      endDate: { type: 'string', description: '结束日期 YYYY-MM-DD，与 startDate 配合使用' },
      year: { type: 'number', description: '年份，默认当前年份' },
      month: { type: 'number', description: '月份 (1-12)，仅与 year 配合使用' },
      type: { type: 'string', enum: [...RECORD_TYPES], description: '收支类型筛选' },
      categoryCode: { type: 'string', description: '分类编码筛选' },
      groupBy: { type: 'string', enum: [...GROUP_BYS], description: '汇总维度，默认 month' },
    },
  },

  async execute(args: GetStatsArgs, ctx: ToolContext): Promise<ToolResult> {
    // 入参枚举校验:收支类型/汇总维度非法值直接回报给模型
    const badEnum = checkEnums({
      type: [args.type, RECORD_TYPES],
      groupBy: [args.groupBy, GROUP_BYS],
    })
    if (badEnum) return badEnum

    await assertIsMember(ctx.accountBookId, ctx.userId)

    return retryable(async () => {
      const now = new Date()
      // 默认年份按本地日取(服务器若跑 UTC,跨年窗口内 getFullYear 会差一年)
      const year = args.year ? Number(args.year) : Number(dateKey(now).slice(0, 4))
      const month = args.month ? Number(args.month) : undefined

      // 日期范围：优先使用 startDate/endDate，其次 year/month;'YYYY-MM-DD' 锚定本地当日起止(整日含入)
      let dateFilter: Record<string, unknown>
      let period: string
      if (args.startDate || args.endDate) {
        dateFilter = {}
        if (args.startDate) dateFilter.gte = parseDayStart(args.startDate)
        if (args.endDate) dateFilter.lte = parseDayEnd(args.endDate)
        period = args.startDate && args.endDate
          ? `${args.startDate} ~ ${args.endDate}`
          : args.startDate ? `${args.startDate} 起` : `至 ${args.endDate}`
      } else if (month) {
        const mm = String(month).padStart(2, '0')
        const lastDay = new Date(year, month, 0).getDate()
        dateFilter = {
          gte: dayStart(`${year}-${mm}-01`),
          lte: dayEnd(`${year}-${mm}-${String(lastDay).padStart(2, '0')}`),
        }
        period = `${year}年${month}月`
      } else {
        dateFilter = {
          gte: dayStart(`${year}-01-01`),
          lte: dayEnd(`${year}-12-31`),
        }
        period = `${year}年`
      }

      const where: Record<string, unknown> = {
        accountBookId: ctx.accountBookId,
        date: dateFilter,
        // 已平账不计入统计(与 /records/summary 同口径)
        offsetAt: null,
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
          const key = monthKey(r.date) // YYYY-MM(本地月)
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
        // 转账要落到两个账户上:源账户记转出、目标账户记转入。
        // 此前这里只取 accountId 且只累加收入/支出,转账在任何账户下都是 0,
        // 单账户分析会失真(总账因内部对冲看不出问题)。
        const [records, accounts] = await Promise.all([
          prisma.record.findMany({
            where,
            select: { amount: true, type: true, accountId: true, toAccountId: true },
          }),
          prisma.account.findMany({
            where: { accountBookId: ctx.accountBookId },
            select: { id: true, name: true },
          }),
        ])
        const nameOf = new Map(accounts.map(a => [a.id, a.name]))

        type Bucket = { accountName: string; income: number; expense: number; transferIn: number; transferOut: number }
        const accountMap = new Map<string, Bucket>()
        const bucketOf = (id: string): Bucket => {
          let b = accountMap.get(id)
          if (!b) {
            b = { accountName: nameOf.get(id) ?? id, income: 0, expense: 0, transferIn: 0, transferOut: 0 }
            accountMap.set(id, b)
          }
          return b
        }

        for (const r of records) {
          if (!r.accountId) continue
          const b = bucketOf(r.accountId)
          if (r.type === 'INCOME') b.income += r.amount
          else if (r.type === 'EXPENSE') b.expense += r.amount
          else if (r.type === 'TRANSFER') {
            b.transferOut += r.amount
            if (r.toAccountId) bucketOf(r.toAccountId).transferIn += r.amount
          }
        }

        const r2 = (v: number) => Math.round(v * 100) / 100
        breakdown = Array.from(accountMap.entries())
          .sort(([, a], [, b]) =>
            (Math.abs(b.income) + Math.abs(b.expense) + b.transferIn + b.transferOut)
            - (Math.abs(a.income) + Math.abs(a.expense) + a.transferIn + a.transferOut))
          .map(([accountId, d]) => ({
            accountId,
            accountName: d.accountName,
            income: r2(d.income),
            expense: r2(d.expense),
            transferIn: r2(d.transferIn),
            transferOut: r2(d.transferOut),
            // 单账户净变动 = 收入 − 支出 + 转入 − 转出(与余额变化同口径)
            net: r2(d.income - d.expense + d.transferIn - d.transferOut),
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

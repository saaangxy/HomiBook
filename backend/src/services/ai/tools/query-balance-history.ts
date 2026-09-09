import { prisma } from '../../../app.js'
import { assertIsMember, retryable, desensitize, type ToolResult } from '../security.js'
import type { ToolDef, ToolContext } from './types.js'
import { beijingDayStartOf, parseBeijingDay, parseBeijingDayEnd, toBeijingDateKey, toBeijingMonthKey } from '../../../lib/date-time.js'

interface BalanceHistoryArgs {
  accountIds?: string
  granularity: 'daily' | 'monthly'
  dateFrom: string
  dateTo: string
}

export const queryBalanceHistoryTool: ToolDef = {
  name: 'query_balance_history',
  displayName: '查询余额历史',
  promptHint: '查看账户余额变动历史',
  description: '查询账户余额历史变化，支持按日或按月聚合。',
  parameters: {
    type: 'object',
    properties: {
      accountIds: { type: 'string', description: '账户 ID 列表，逗号分隔，不填则查询所有账户' },
      granularity: { type: 'string', enum: ['daily', 'monthly'], description: '粒度：daily按日，monthly按月' },
      dateFrom: { type: 'string', description: '开始日期 YYYY-MM-DD' },
      dateTo: { type: 'string', description: '结束日期 YYYY-MM-DD' },
    },
    required: ['granularity', 'dateFrom', 'dateTo'],
  },

  async execute(args: BalanceHistoryArgs, ctx: ToolContext): Promise<ToolResult> {
    await assertIsMember(ctx.accountBookId, ctx.userId)

    return retryable(async () => {
      const accountFilter = args.accountIds
        ? args.accountIds.split(',').map((s: string) => s.trim()).filter(Boolean)
        : null

      const accounts = await prisma.account.findMany({
        where: {
          accountBookId: ctx.accountBookId,
          ...(accountFilter ? { id: { in: accountFilter } } : {}),
        },
        orderBy: { createdAt: 'asc' },
      })

      // 查询范围锚定北京日(与分桶口径一致)
      const startDate = parseBeijingDay(args.dateFrom)
      const endDate = parseBeijingDayEnd(args.dateTo)

      const result = []

      for (const account of accounts) {
        const latestAdjustment = await prisma.balanceAdjustment.findFirst({
          where: { accountId: account.id, date: { lt: startDate } },
          orderBy: { date: 'desc' },
        })

        const baseBalance = latestAdjustment?.balanceAfter ?? account.initialBalance ?? 0
        const baseDate = latestAdjustment?.date ?? null

        const preRecords = await prisma.record.findMany({
          where: {
            OR: [
              { accountId: account.id },
              { fromAccountId: account.id },
              { toAccountId: account.id },
            ],
            date: {
              ...(baseDate ? { gt: beijingDayStartOf(baseDate) } : {}),
              lt: startDate,
            },
          },
          select: { type: true, amount: true, accountId: true, fromAccountId: true, toAccountId: true },
        })

        let runningBalance = baseBalance
        for (const r of preRecords) {
          if (r.accountId === account.id && r.type === 'INCOME') runningBalance += r.amount
          else if (r.accountId === account.id && r.type === 'EXPENSE') runningBalance -= r.amount
          else if (r.fromAccountId === account.id && r.type === 'TRANSFER') runningBalance -= r.amount
          else if (r.toAccountId === account.id && r.type === 'TRANSFER') runningBalance += r.amount
        }

        const rangeRecords = await prisma.record.findMany({
          where: {
            OR: [
              { accountId: account.id },
              { fromAccountId: account.id },
              { toAccountId: account.id },
            ],
            date: { gte: startDate, lte: endDate },
          },
          select: { type: true, amount: true, date: true, accountId: true, fromAccountId: true, toAccountId: true },
          orderBy: { date: 'asc' },
        })

        const periodMap: Record<string, number> = {}
        for (const r of rangeRecords) {
          const key = args.granularity === 'monthly'
            ? toBeijingMonthKey(r.date)
            : toBeijingDateKey(r.date)
          if (!periodMap[key]) periodMap[key] = 0
          if (r.accountId === account.id && r.type === 'INCOME') periodMap[key] += r.amount
          else if (r.accountId === account.id && r.type === 'EXPENSE') periodMap[key] -= r.amount
          else if (r.fromAccountId === account.id && r.type === 'TRANSFER') periodMap[key] -= r.amount
          else if (r.toAccountId === account.id && r.type === 'TRANSFER') periodMap[key] += r.amount
        }

        const rangeAdjustments = await prisma.balanceAdjustment.findMany({
          where: { accountId: account.id, date: { gte: startDate, lte: endDate } },
          orderBy: { date: 'asc' },
        })
        const adjustmentMap: Record<string, number> = {}
        for (const adj of rangeAdjustments) {
          const key = args.granularity === 'monthly'
            ? toBeijingMonthKey(adj.date)
            : toBeijingDateKey(adj.date)
          adjustmentMap[key] = adj.balanceAfter
        }

        // 生成北京日期/月份键序列
        const keys: string[] = []
        if (args.granularity === 'monthly') {
          let [y, m] = toBeijingMonthKey(startDate).split('-').map(Number)
          const [ey, em] = toBeijingMonthKey(endDate).split('-').map(Number)
          while (y < ey || (y === ey && m <= em)) {
            keys.push(`${y}-${String(m).padStart(2, '0')}`)
            m += 1
            if (m > 12) { m = 1; y += 1 }
          }
        } else {
          for (let t = startDate.getTime(); t <= endDate.getTime(); t += 86_400_000) {
            keys.push(toBeijingDateKey(new Date(t)))
          }
        }

        const balances: { date: string; balance: number }[] = keys.map((key) => {
          if (adjustmentMap[key] !== undefined) runningBalance = adjustmentMap[key]
          if (periodMap[key] !== undefined) runningBalance += periodMap[key]
          return { date: key, balance: Math.round(runningBalance * 100) / 100 }
        })

        result.push({ accountId: account.id, accountName: account.name, balances })
      }

      return desensitize({ accounts: result })
    }, 'query_balance_history')
  },
}

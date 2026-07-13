import { prisma } from '../../../app.js'
import { assertIsMember, retryable, desensitize, type ToolResult } from '../security.js'
import type { ToolDef, ToolContext } from './types.js'

interface BalanceHistoryArgs {
  accountIds?: string
  granularity: 'daily' | 'monthly'
  dateFrom: string
  dateTo: string
}

export const queryBalanceHistoryTool: ToolDef = {
  name: 'query_balance_history',
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

      const startDate = new Date(args.dateFrom)
      startDate.setUTCHours(0, 0, 0, 0)
      const endDate = new Date(args.dateTo)
      endDate.setUTCHours(23, 59, 59, 999)

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
              ...(baseDate ? { gt: baseDate } : {}),
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
            ? r.date.toISOString().slice(0, 7)
            : r.date.toISOString().slice(0, 10)
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
            ? adj.date.toISOString().slice(0, 7)
            : adj.date.toISOString().slice(0, 10)
          adjustmentMap[key] = adj.balanceAfter
        }

        const balances: { date: string; balance: number }[] = []
        const cursor = new Date(startDate)
        while (cursor <= endDate) {
          const key = args.granularity === 'monthly'
            ? `${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, '0')}`
            : cursor.toISOString().slice(0, 10)

          if (adjustmentMap[key] !== undefined) runningBalance = adjustmentMap[key]
          if (periodMap[key] !== undefined) runningBalance += periodMap[key]
          balances.push({ date: key, balance: Math.round(runningBalance * 100) / 100 })

          if (args.granularity === 'monthly') {
            cursor.setMonth(cursor.getMonth() + 1)
          } else {
            cursor.setDate(cursor.getDate() + 1)
          }
        }

        result.push({ accountId: account.id, accountName: account.name, balances })
      }

      return desensitize({ accounts: result })
    }, 'query_balance_history')
  },
}

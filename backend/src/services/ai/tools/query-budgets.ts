import { prisma } from '../../../app.js'
import { assertIsMember, retryable, desensitize, type ToolResult } from '../security.js'
import type { ToolDef, ToolContext } from './types.js'

interface QueryBudgetsArgs {
  year?: number
  month?: number
}

export const queryBudgetsTool: ToolDef = {
  name: 'query_budgets',
  description: '查询预算信息。可指定年份和月份筛选。',
  parameters: {
    type: 'object',
    properties: {
      year: { type: 'number', description: '年份，默认当前年份' },
      month: { type: 'number', description: '月份 (1-12)，不填则返回全年所有预算' },
    },
  },

  async execute(args: QueryBudgetsArgs, ctx: ToolContext): Promise<ToolResult> {
    await assertIsMember(ctx.accountBookId, ctx.userId)

    return retryable(async () => {
      const now = new Date()
      const year = args.year ? Number(args.year) : now.getFullYear()
      const month = args.month ? Number(args.month) : undefined

      const budgets = await prisma.budget.findMany({
        where: {
          accountBookId: ctx.accountBookId,
          year,
          ...(month ? { month } : {}),
        },
        orderBy: [{ month: 'asc' }, { type: 'asc' }],
      })

      // 计算每个预算的已用金额
      const enriched = await Promise.all(
        budgets.map(async (b) => {
          const expenseWhere: Record<string, unknown> = {
            accountBookId: ctx.accountBookId,
            type: 'EXPENSE',
            date: {},
          }

          // 时间范围
          if (b.type === 'FIXED' && b.month > 0) {
            expenseWhere.date = {
              gte: new Date(`${year}-${String(b.month).padStart(2, '0')}-01`),
              lte: new Date(`${year}-${String(b.month).padStart(2, '0')}-${new Date(year, b.month, 0).getDate()}`),
            }
          } else if (b.type === 'FREE') {
            if (b.startDate) Object.assign(expenseWhere.date as object, { gte: b.startDate })
            if (b.endDate) Object.assign(expenseWhere.date as object, { lte: b.endDate })
          }

          // 分类条件
          if (b.categoryCode) expenseWhere.categoryCode = b.categoryCode

          // 标签条件 (OR 关系)
          if (b.tags && b.tags !== '[]') {
            const tags: string[] = JSON.parse(b.tags)
            if (tags.length > 0) {
              // 标签存储在 Record.tags JSON 数组中，用 contains 匹配
              expenseWhere.AND = tags.map((t) => ({ tags: { contains: t } }))
            }
          }

          const aggregate = await prisma.record.aggregate({
            where: expenseWhere,
            _sum: { amount: true },
          })

          const used = aggregate._sum.amount ?? 0

          return {
            id: b.id,
            name: b.name,
            type: b.type,
            year: b.year,
            month: b.month,
            amount: b.amount,
            used: Math.round(used * 100) / 100,
            remaining: Math.round((b.amount - used) * 100) / 100,
            percentage: Math.round((used / b.amount) * 10000) / 100,
            categoryCode: b.categoryCode,
          }
        }),
      )

      return desensitize({ budgets: enriched })
    }, 'query_budgets')
  },
}

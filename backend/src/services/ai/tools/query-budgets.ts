import { prisma } from '../../../app.js'
import { desensitize } from '../security.js'
import { buildBudgetRecordWhere, loadBudgetCategorySets, parseTags } from '../../budget.js'
import type { ToolDef, ToolContext } from './types.js'

interface QueryBudgetsArgs {
  year?: number
  month?: number
  ownerId?: string
  categoryCode?: string
  tag?: string
}

export const queryBudgetsTool: ToolDef = {
  name: 'query_budgets',
  displayName: '查询预算',
  promptHint: '查看各维度预算执行情况',
  description:
    '查询预算信息与执行情况。可指定年份、月份，以及按成员、分类、标签筛选。',
  parameters: {
    type: 'object',
    properties: {
      year: { type: 'number', description: '年份，默认当前年份' },
      month: { type: 'number', description: '月份 (1-12)，不填则返回全年所有预算' },
      ownerId: { type: 'string', description: '按家庭成员（流水归属人 User.id）筛选' },
      categoryCode: { type: 'string', description: '按分类编码筛选' },
      tag: { type: 'string', description: '按标签筛选' },
    },
  },

  async execute(args: QueryBudgetsArgs, ctx: ToolContext) {
    const now = new Date()
    const year = args.year ? Number(args.year) : now.getFullYear()
    const month = args.month ? Number(args.month) : undefined

    const budgets = await prisma.budget.findMany({
      where: {
        accountBookId: ctx.accountBookId,
        year,
        ...(month ? { month } : {}),
        ...(args.ownerId ? { ownerId: args.ownerId } : {}),
        ...(args.categoryCode ? { categoryCode: args.categoryCode } : {}),
        ...(args.tag ? { tags: { contains: args.tag } } : {}),
      },
      include: { owner: { select: { id: true, nickname: true, email: true } } },
      orderBy: [{ month: 'asc' }, { type: 'asc' }],
    })

    // 收支分类与流水匹配条件统一走 services/budget.ts，避免与页面口径漂移
    const categorySets = await loadBudgetCategorySets()

    const enriched = await Promise.all(
      budgets.map(async (b) => {
        const aggregate = await prisma.record.aggregate({
          where: buildBudgetRecordWhere(b, ctx.accountBookId, categorySets),
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
          percentage: b.amount > 0 ? Math.round((used / b.amount) * 10000) / 100 : 0,
          categoryCode: b.categoryCode,
          tags: parseTags(b.tags),
          ownerId: b.ownerId,
          ownerName: b.owner ? (b.owner.nickname || b.owner.email) : null,
          period: b.type === 'FIXED'
            ? `${b.year}-${String(b.month).padStart(2, '0')}`
            : `${b.startDate ? b.startDate.toISOString().slice(0, 10) : '...'} ~ ${b.endDate ? b.endDate.toISOString().slice(0, 10) : '...'}`,
        }
      }),
    )

    return desensitize({ budgets: enriched })
  },
}

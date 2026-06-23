import { prisma } from '../../../app.js'
import { assertIsMember, retryable, desensitize, type ToolResult } from '../security.js'
import type { ToolDef, ToolContext } from './types.js'

export const setBudgetTool: ToolDef = {
  name: 'set_budget',
  description: '创建或更新预算。敏感操作，需要用户确认。type 为 FIXED(月度固定预算) 或 FREE(自由预算)。',
  parameters: {
    type: 'object',
    properties: {
      name: { type: 'string', description: '预算名称' },
      type: { type: 'string', enum: ['FIXED', 'FREE'], description: '预算类型' },
      year: { type: 'number', description: '年份' },
      month: { type: 'number', description: '月份(1-12)，FREE 类型为 0' },
      amount: { type: 'number', description: '预算金额' },
      categoryCode: { type: 'string', description: '关联分类编码（可选）' },
      tags: { type: 'array', items: { type: 'string' }, description: '关联标签（可选）' },
      startDate: { type: 'string', description: '自由预算起始日期 YYYY-MM-DD' },
      endDate: { type: 'string', description: '自由预算结束日期 YYYY-MM-DD' },
      remark: { type: 'string', description: '备注' },
    },
    required: ['name', 'type', 'year', 'month', 'amount'],
  },
  requireConfirm: true,

  async execute(args: any, ctx: ToolContext): Promise<ToolResult> {
    await assertIsMember(ctx.accountBookId, ctx.userId)

    return retryable(async () => {
      // upsert: 如果已存在则更新金额
      const year = Number(args.year)
      const month = Number(args.month)
      const amount = Number(args.amount)

      const existing = await prisma.budget.findUnique({
        where: {
          accountBookId_type_year_month_name: {
            accountBookId: ctx.accountBookId,
            type: args.type,
            year,
            month,
            name: args.name,
          },
        },
      })

      let budget
      if (existing) {
        budget = await prisma.budget.update({
          where: { id: existing.id },
          data: {
            amount,
            categoryCode: args.categoryCode,
            tags: args.tags ? JSON.stringify(args.tags) : undefined,
            startDate: args.startDate ? new Date(args.startDate) : undefined,
            endDate: args.endDate ? new Date(args.endDate) : undefined,
            remark: args.remark,
          },
        })
      } else {
        budget = await prisma.budget.create({
          data: {
            accountBookId: ctx.accountBookId,
            name: args.name,
            type: args.type,
            year,
            month,
            amount,
            categoryCode: args.categoryCode,
            tags: args.tags ? JSON.stringify(args.tags) : '[]',
            startDate: args.startDate ? new Date(args.startDate) : undefined,
            endDate: args.endDate ? new Date(args.endDate) : undefined,
            remark: args.remark,
          },
        })
      }

      return desensitize({
        id: budget.id,
        name: budget.name,
        type: budget.type,
        year: budget.year,
        month: budget.month,
        amount: budget.amount,
      })
    }, 'set_budget')
  },
}

import { prisma } from '../../../app.js'
import { assertIsMember, retryable, desensitize, type ToolResult } from '../security.js'
import type { ToolDef, ToolContext } from './types.js'

interface BatchCreateBudgetsArgs {
  name: string
  type: 'FIXED' | 'FREE'
  amount: number
  months: number[]
  year: number
  categoryCode?: string
  tags?: string[]
  startDate?: string
  endDate?: string
  remark?: string
}

export const batchCreateBudgetsTool: ToolDef = {
  name: 'batch_create_budgets',
  displayName: '批量创建预算',
  promptHint: '需要用户确认',
  description: '批量创建多月预算。在同一年内为多个月份创建相同配置的预算。',
  parameters: {
    type: 'object',
    properties: {
      name: { type: 'string', description: '预算名称' },
      type: { type: 'string', enum: ['FIXED', 'FREE'], description: '预算类型' },
      amount: { type: 'number', description: '预算金额' },
      months: { type: 'array', items: { type: 'number' }, description: '目标月份列表 (1-12)' },
      year: { type: 'number', description: '年份' },
      categoryCode: { type: 'string', description: '关联分类编码' },
      tags: { type: 'array', items: { type: 'string' }, description: '标签' },
      startDate: { type: 'string', description: '开始日期（FREE类型）' },
      endDate: { type: 'string', description: '结束日期（FREE类型）' },
      remark: { type: 'string', description: '备注' },
    },
    required: ['name', 'type', 'amount', 'months', 'year'],
  },
  requireConfirm: true,

  async execute(args: BatchCreateBudgetsArgs, ctx: ToolContext): Promise<ToolResult> {
    await assertIsMember(ctx.accountBookId, ctx.userId)

    return retryable(async () => {
      const tagsJson = JSON.stringify(args.tags || [])
      const created: { month: number; id: string }[] = []

      await prisma.$transaction(async (tx) => {
        for (const month of args.months) {
          const existing = await tx.budget.findUnique({
            where: {
              accountBookId_type_year_month_name: {
                accountBookId: ctx.accountBookId,
                type: args.type,
                year: args.year,
                month,
                name: args.name,
              },
            },
          })
          if (existing) continue

          const budget = await tx.budget.create({
            data: {
              accountBookId: ctx.accountBookId,
              name: args.name,
              type: args.type,
              year: args.year,
              month,
              amount: args.amount,
              categoryCode: args.categoryCode,
              tags: tagsJson,
              startDate: args.startDate ? new Date(args.startDate) : undefined,
              endDate: args.endDate ? new Date(args.endDate) : undefined,
              remark: args.remark,
            },
          })
          created.push({ month, id: budget.id })
        }
      })

      return desensitize({ created: created.length, months: created })
    }, 'batch_create_budgets')
  },
}

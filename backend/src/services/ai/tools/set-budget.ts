import { prisma } from '../../../app.js'
import { assertIsMember, checkEnums, retryable, desensitize, type ToolResult } from '../security.js'
import { BUDGET_TYPES, normalizeBudgetType } from '@homibook/core'
import type { ToolDef, ToolContext } from './types.js'

/** 入参枚举校验:非法预算类型直接回报给模型(否则会被归一化悄悄记成 FREE)。弹确认卡前与执行时共用 */
const validateArgs = (args: any) => checkEnums({ type: [args.type, BUDGET_TYPES] })

export const setBudgetTool: ToolDef = {
  name: 'set_budget',
  displayName: '设置预算',
  promptHint: '需要用户确认',
  description: '创建或更新预算。敏感操作，需要用户确认。type 为 FIXED(月度固定预算) 或 FREE(自由预算)。',
  parameters: {
    type: 'object',
    properties: {
      name: { type: 'string', description: '预算名称' },
      type: { type: 'string', enum: [...BUDGET_TYPES], description: '预算类型' },
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
  validateArgs,

  async execute(args: any, ctx: ToolContext): Promise<ToolResult> {
    // 入参枚举校验(与弹确认卡前同一份规则)
    const badEnum = validateArgs(args)
    if (badEnum) return badEnum

    await assertIsMember(ctx.accountBookId, ctx.userId)

    return retryable(async () => {
      // upsert: 如果已存在则更新金额
      const year = Number(args.year)
      const month = Number(args.month)
      const amount = Number(args.amount)
      // 归一化:模型可能不遵守 schema 枚举,非法预算类型会让该预算在所有列表里查不到
      const budgetType = normalizeBudgetType(args.type)

      const existing = await prisma.budget.findUnique({
        where: {
          accountBookId_type_year_month_name: {
            accountBookId: ctx.accountBookId,
            type: budgetType,
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
            type: budgetType,
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

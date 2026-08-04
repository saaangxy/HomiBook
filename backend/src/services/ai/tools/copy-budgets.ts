import { prisma } from '../../../app.js'
import { assertIsMember, retryable, desensitize, type ToolResult } from '../security.js'
import type { ToolDef, ToolContext } from './types.js'

interface CopyBudgetsArgs {
  sourceYear: number
  sourceMonth: number
  targetMonths: { year: number; month: number }[]
}

export const copyBudgetsTool: ToolDef = {
  name: 'copy_budgets',
  displayName: '复制预算',
  promptHint: '将预算复制到其他月份',
  description: '将源月份的预算复制到目标月份（跳过已存在的同名预算）。',
  parameters: {
    type: 'object',
    properties: {
      sourceYear: { type: 'number', description: '源年份' },
      sourceMonth: { type: 'number', description: '源月份 (1-12)' },
      targetMonths: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            year: { type: 'number', description: '目标年份' },
            month: { type: 'number', description: '目标月份 (1-12)' },
          },
          required: ['year', 'month'],
        },
        description: '目标月份列表',
      },
    },
    required: ['sourceYear', 'sourceMonth', 'targetMonths'],
  },
  requireConfirm: true,

  async execute(args: CopyBudgetsArgs, ctx: ToolContext): Promise<ToolResult> {
    await assertIsMember(ctx.accountBookId, ctx.userId)

    return retryable(async () => {
      const { sourceYear, sourceMonth, targetMonths } = args

      const sourceBudgets = await prisma.budget.findMany({
        where: { accountBookId: ctx.accountBookId, year: sourceYear, month: sourceMonth },
      })

      let count = 0
      await prisma.$transaction(async (tx) => {
        for (const target of targetMonths) {
          for (const budget of sourceBudgets) {
            const existing = await tx.budget.findUnique({
              where: {
                accountBookId_type_year_month_name: {
                  accountBookId: ctx.accountBookId,
                  type: budget.type,
                  year: target.year,
                  month: target.month,
                  name: budget.name,
                },
              },
            })
            if (existing) continue

            await tx.budget.create({
              data: {
                accountBookId: ctx.accountBookId,
                name: budget.name,
                type: budget.type,
                year: target.year,
                month: target.month,
                amount: budget.amount,
                categoryCode: budget.categoryCode,
                tags: budget.tags,
                startDate: budget.startDate,
                endDate: budget.endDate,
                remark: budget.remark,
              },
            })
            count++
          }
        }
      })

      return desensitize({ copied: count })
    }, 'copy_budgets')
  },
}

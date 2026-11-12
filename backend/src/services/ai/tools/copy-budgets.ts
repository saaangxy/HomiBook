import { prisma } from '../../../app.js'
import { desensitize } from '../security.js'
import { BUDGET_TYPE_LABELS, normalizeBudgetType } from '@homibook/core'
import type { ConfirmPreview } from '../runtime/preview-format.js'
import type { PreviewScope } from '../runtime/preview-scope.js'
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

  /** 确认卡：列出源月份将被复制的预算，目标月份写在标题里 */
  async confirmation(args: any, _ctx: ToolContext, scope: PreviewScope): Promise<string> {
    const sourceBudgets = await scope.budgetsByMonth(args?.sourceYear, args?.sourceMonth)
    if (sourceBudgets.length === 0) {
      return JSON.stringify({
        type: 'generic',
        title: '复制预算',
        description: `${args?.sourceYear}年${args?.sourceMonth}月没有预算可复制`,
      } satisfies ConfirmPreview)
    }

    const targetText = (args.targetMonths || [])
      .map((m: { year: number; month: number }) => `${m.year}年${m.month}月`)
      .join('、')

    const preview: ConfirmPreview = {
      type: 'records-table',
      title: `确认复制预算到 ${targetText}`,
      description: `源月份：${args.sourceYear}年${args.sourceMonth}月（跳过已存在的同名预算）`,
      columns: ['预算名称', '类型', '金额'],
      rows: sourceBudgets.map((b) => [
        { text: b.name || b.categoryLabel || b.categoryCode || '-' },
        { text: b.type === 'FIXED' ? BUDGET_TYPE_LABELS.FIXED : BUDGET_TYPE_LABELS.FREE },
        { text: b.amount.toFixed(2) },
      ]),
    }
    return JSON.stringify(preview)
  },

  async execute(args: CopyBudgetsArgs, ctx: ToolContext) {

    const { sourceYear, sourceMonth, targetMonths } = args

    const sourceBudgets = await prisma.budget.findMany({
      where: { accountBookId: ctx.accountBookId, year: sourceYear, month: sourceMonth },
    })

    let count = 0
    await prisma.$transaction(async (tx) => {
      for (const target of targetMonths) {
        for (const budget of sourceBudgets) {
          // 归一化:源数据若为历史脏类型,复制出来的预算也不应继承
          const budgetType = normalizeBudgetType(budget.type)
          const existing = await tx.budget.findUnique({
            where: {
              accountBookId_type_year_month_name: {
                accountBookId: ctx.accountBookId,
                type: budgetType,
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
              type: budgetType,
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
  },
}

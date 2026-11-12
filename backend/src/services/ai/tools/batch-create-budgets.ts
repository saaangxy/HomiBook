import { prisma } from '../../../app.js'
import { checkEnums, desensitize, ToolError } from '../security.js'
import { BUDGET_TYPE_LABELS, BUDGET_TYPES, normalizeBudgetType, type BudgetType } from '@homibook/core'
import type { ConfirmPreview } from '../runtime/preview-format.js'
import type { PreviewScope } from '../runtime/preview-scope.js'
import type { ToolDef, ToolContext } from './types.js'

interface BatchCreateBudgetsArgs {
  name: string
  type: BudgetType
  amount: number
  months: number[]
  year: number
  categoryCode?: string
  tags?: string[]
  startDate?: string
  endDate?: string
  remark?: string
}

/** 入参枚举校验:非法预算类型直接回报给模型。弹确认卡前与执行时共用 */
const validateArgs = (args: BatchCreateBudgetsArgs) => checkEnums({ type: [args.type, BUDGET_TYPES] })

export const batchCreateBudgetsTool: ToolDef = {
  name: 'batch_create_budgets',
  displayName: '批量创建预算',
  promptHint: '需要用户确认',
  description: '批量创建多月预算。在同一年内为多个月份创建相同配置的预算。',
  parameters: {
    type: 'object',
    properties: {
      name: { type: 'string', description: '预算名称' },
      type: { type: 'string', enum: [...BUDGET_TYPES], description: '预算类型' },
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
  validateArgs,

  /** 确认卡：同一配置铺到多个月份，月份列表写在一行 */
  async confirmation(args: any, _ctx: ToolContext, scope: PreviewScope): Promise<string> {
    const categoryMap = args.categoryCode ? await scope.categoryLabels([args.categoryCode]) : new Map<string, string>()
    const monthsText = (args.months || []).map((m: number) => `${args.year}年${m}月`).join('、')

    const preview: ConfirmPreview = {
      type: 'budget-card',
      title: `确认批量创建 ${(args.months || []).length} 个月份的预算`,
      budgetFields: [
        { label: '名称', value: args.name || '-' },
        { label: '类型', value: args.type === 'FIXED' ? BUDGET_TYPE_LABELS.FIXED : BUDGET_TYPE_LABELS.FREE },
        { label: '金额', value: `每月 ${(args.amount ?? 0).toFixed(2)}` },
        { label: '月份', value: monthsText || '-' },
        ...(args.categoryCode ? [{ label: '关联分类', value: categoryMap.get(args.categoryCode) || args.categoryCode }] : []),
        ...(args.remark ? [{ label: '备注', value: args.remark }] : []),
      ],
    }
    return JSON.stringify(preview)
  },

  async execute(args: BatchCreateBudgetsArgs, ctx: ToolContext) {
    // 入参枚举校验(与弹确认卡前同一份规则)
    const badEnum = validateArgs(args)
    if (badEnum) throw new ToolError(badEnum.error ?? '参数非法', badEnum.retryable)

    const tagsJson = JSON.stringify(args.tags || [])
    const created: { month: number; id: string }[] = []
    // 归一化:模型可能不遵守 schema 枚举,非法预算类型会让该预算在所有列表里查不到
    const budgetType = normalizeBudgetType(args.type)

    await prisma.$transaction(async (tx) => {
      for (const month of args.months) {
        const existing = await tx.budget.findUnique({
          where: {
            accountBookId_type_year_month_name: {
              accountBookId: ctx.accountBookId,
              type: budgetType,
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
            type: budgetType,
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
  },
}

import { prisma } from '../../../app.js'
import { checkEnums, desensitize, ToolError } from '../security.js'
import { BUDGET_TYPES, BUDGET_TYPE_LABELS, normalizeBudgetType } from '@homibook/core'
import { listBudgetOwners, normalizeTags, resolveBudgetOwner } from '../../budget.js'
import type { ConfirmPreview } from '../runtime/preview-format.js'
import type { PreviewScope } from '../runtime/preview-scope.js'
import type { ToolDef, ToolContext } from './types.js'

/** 入参枚举校验:非法预算类型直接回报给模型(否则会被归一化悄悄记成 FREE)。弹确认卡前与执行时共用 */
const validateArgs = (args: any) => checkEnums({ type: [args.type, BUDGET_TYPES] })

export const setBudgetTool: ToolDef = {
  name: 'set_budget',
  displayName: '设置预算',
  promptHint: '需要用户确认',
  description:
    '创建或更新预算。敏感操作，需要用户确认。type 为 FIXED(月度预算) 或 FREE(项目预算)；分类、标签、家庭成员可组合限定。',
  parameters: {
    type: 'object',
    properties: {
      name: { type: 'string', description: '预算名称' },
      type: { type: 'string', enum: [...BUDGET_TYPES], description: '预算类型' },
      year: { type: 'number', description: '年份' },
      month: { type: 'number', description: '月份(1-12)，FREE 类型为 0' },
      amount: { type: 'number', description: '预算金额' },
      categoryCode: { type: 'string', description: '分类维度：关联分类编码（可选）' },
      tags: { type: 'array', items: { type: 'string' }, description: '标签维度：标签（可选，多标签或关系）' },
      ownerId: { type: 'string', description: '家庭成员维度：归属人 User.id（可选）' },
      ownerName: { type: 'string', description: '家庭成员维度：归属人昵称/邮箱（可选，优先用 ownerId）' },
      startDate: { type: 'string', description: '项目预算起始日期 YYYY-MM-DD' },
      endDate: { type: 'string', description: '项目预算结束日期 YYYY-MM-DD' },
      remark: { type: 'string', description: '备注' },
    },
    required: ['name', 'type', 'year', 'month', 'amount'],
  },
  requireConfirm: true,
  validateArgs,

  /** 确认卡：预算金额/周期这类关键字段平铺成卡片，不查预算表（新建或整体覆盖） */
  async confirmation(args: any, ctx: ToolContext, scope: PreviewScope): Promise<string> {
    let categoryLabel = ''
    if (args.categoryCode) {
      const map = await scope.categoryLabels([args.categoryCode])
      categoryLabel = map.get(args.categoryCode) || args.categoryCode
    }

    let ownerLabel = args.ownerName || ''
    if (!ownerLabel && args.ownerId) {
      const owners = await listBudgetOwners(ctx.accountBookId)
      ownerLabel = owners.find((o) => o.userId === args.ownerId)?.name || args.ownerId
    }

    const typeLabel = args.type === 'FIXED' ? BUDGET_TYPE_LABELS.FIXED : BUDGET_TYPE_LABELS.FREE
    const period = args.type === 'FREE'
      ? `${args.startDate || '?'} ~ ${args.endDate || '?'}`
      : `${args.year}年${String(args.month).padStart(2, '0')}月`

    const budgetFields: { label: string; value: string }[] = [
      { label: '名称', value: args.name || '-' },
      { label: '类型', value: typeLabel },
      { label: '周期', value: period },
      { label: '金额', value: Number(args.amount).toFixed(2) },
    ]
    if (categoryLabel) budgetFields.push({ label: '分类', value: categoryLabel })
    if (Array.isArray(args.tags) && args.tags.length > 0) budgetFields.push({ label: '标签', value: args.tags.join('、') })
    if (ownerLabel) budgetFields.push({ label: '成员', value: ownerLabel })
    if (args.remark) budgetFields.push({ label: '备注', value: args.remark })

    const preview: ConfirmPreview = {
      type: 'budget-card',
      title: '确认设定预算',
      budgetFields,
    }
    return JSON.stringify(preview)
  },

  async execute(args: any, ctx: ToolContext) {
    // 入参枚举校验(与弹确认卡前同一份规则)
    const badEnum = validateArgs(args)
    if (badEnum) throw new ToolError(badEnum.error ?? '参数非法', badEnum.retryable)

    // upsert: 如果已存在则更新金额
    const year = Number(args.year)
    const month = Number(args.month)
    const amount = Number(args.amount)
    // 归一化:模型可能不遵守 schema 枚举,非法预算类型会让该预算在所有列表里查不到
    const budgetType = normalizeBudgetType(args.type)

    let owner: string | null
    try {
      owner = await resolveBudgetOwner(ctx.accountBookId, args.ownerId, args.ownerName)
    } catch (e: any) {
      throw new ToolError(e?.message || '归属人无效', false)
    }
    const tagsJson = normalizeTags(args.tags)

    const existing = await prisma.budget.findFirst({
      where: {
        accountBookId: ctx.accountBookId,
        type: budgetType,
        year,
        month,
        name: args.name,
        categoryCode: args.categoryCode ?? null,
        ownerId: owner,
        tags: tagsJson,
      },
    })

    let budget
    if (existing) {
      budget = await prisma.budget.update({
        where: { id: existing.id },
        data: {
          amount,
          categoryCode: args.categoryCode,
          tags: tagsJson,
          ownerId: owner ?? undefined,
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
          tags: tagsJson,
          ownerId: owner,
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
      ownerId: budget.ownerId,
    })
  },
}

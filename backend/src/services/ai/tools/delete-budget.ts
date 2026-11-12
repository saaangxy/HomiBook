import { prisma } from '../../../app.js'
import { BUDGET_TYPE_LABELS } from '@homibook/core'
import { desensitize, ToolError } from '../security.js'
import { genericPreview, type ConfirmPreview } from '../runtime/preview-format.js'
import type { PreviewScope } from '../runtime/preview-scope.js'
import type { ToolDef, ToolContext } from './types.js'

export const deleteBudgetTool: ToolDef = {
  name: 'delete_budget',
  displayName: '删除预算',
  promptHint: '需要用户确认',
  description: '删除预算。',
  parameters: {
    type: 'object',
    properties: {
      id: { type: 'string', description: '预算 ID' },
    },
    required: ['id'],
  },
  requireConfirm: true,

  /** 确认卡：把要删的预算原配置展示出来，避免误删同名预算 */
  async confirmation(args: { id?: string }, _ctx: ToolContext, scope: PreviewScope): Promise<string> {
    const budget = await scope.budget(args?.id || '')
    if (!budget) return genericPreview('删除预算', { error: `预算不存在: ${args?.id}` })

    const typeLabel = budget.type === 'FIXED' ? BUDGET_TYPE_LABELS.FIXED : BUDGET_TYPE_LABELS.FREE
    const period = budget.type === 'FREE'
      ? `${budget.startDate?.toISOString().slice(0, 10) || '?'} ~ ${budget.endDate?.toISOString().slice(0, 10) || '?'}`
      : `${budget.year}年${String(budget.month).padStart(2, '0')}月`

    const fields: { label: string; value: string }[] = [
      { label: '名称', value: budget.name },
      { label: '类型', value: typeLabel },
      { label: '周期', value: period },
      { label: '金额', value: budget.amount.toFixed(2) },
    ]
    if (budget.categoryLabel) fields.push({ label: '关联分类', value: budget.categoryLabel })
    if (budget.remark) fields.push({ label: '备注', value: budget.remark })

    const preview: ConfirmPreview = {
      type: 'budget-card',
      title: '确认删除预算',
      budgetFields: fields,
    }
    return JSON.stringify(preview)
  },

  async execute(args: { id: string }, ctx: ToolContext) {

    const existing = await prisma.budget.findUnique({ where: { id: args.id } })
    if (!existing) throw new ToolError('预算不存在', false)
    if (existing.accountBookId !== ctx.accountBookId) {
      throw new ToolError('无权删除该预算', false)
    }

    await prisma.budget.delete({ where: { id: args.id } })
    return desensitize({ deleted: true })
  },
}

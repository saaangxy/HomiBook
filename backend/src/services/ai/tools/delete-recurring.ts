import { prisma } from '../../../app.js'
import { LOAN_INTEREST_METHOD_LABELS, RECURRING_TYPE_LABELS } from '@homibook/core'
import { desensitize, ToolError } from '../security.js'
import { genericPreview, type ConfirmPreview } from '../runtime/preview-format.js'
import type { PreviewScope } from '../runtime/preview-scope.js'
import type { ToolDef, ToolContext } from './types.js'

export const deleteRecurringTool: ToolDef = {
  name: 'delete_recurring',
  displayName: '删除固定收支',
  promptHint: '需要用户确认',
  description: '删除固定收支/贷款及关联的还款计划。',
  parameters: {
    type: 'object',
    properties: {
      id: { type: 'string', description: '固定收支 ID' },
    },
    required: ['id'],
  },
  requireConfirm: true,

  /** 确认卡：贷款类要额外展示总额与剩余本金，删除会连带还款计划 */
  async confirmation(args: { id?: string }, _ctx: ToolContext, scope: PreviewScope): Promise<string> {
    const rt = await scope.recurring(args?.id || '')
    if (!rt) return genericPreview('删除固定收支', { error: `记录不存在: ${args?.id}` })

    const typeLabel = rt.type === 'INCOME' ? '收入' : rt.type === 'EXPENSE' ? '支出' : '转账'
    const fields: { label: string; value: string }[] = [
      { label: '名称', value: rt.name },
      { label: '类型', value: typeLabel },
      { label: '金额', value: rt.amount.toFixed(2) },
      { label: '账户', value: rt.accountName || rt.accountId },
      { label: '触发规则', value: rt.cron },
      { label: '周期类型', value: (RECURRING_TYPE_LABELS as Record<string, string>)[rt.recurringType] || rt.recurringType },
      { label: '状态', value: rt.active ? '启用' : '停用' },
    ]
    if (rt.toAccountName) fields.push({ label: '目标账户', value: rt.toAccountName })
    if (rt.categoryLabel) fields.push({ label: '分类', value: rt.categoryLabel })
    if (rt.remark) fields.push({ label: '备注', value: rt.remark })
    if (rt.recurringType === 'LOAN') {
      fields.push({ label: '贷款总额', value: (rt.loanTotalAmount || 0).toFixed(2) })
      fields.push({ label: '剩余本金', value: (rt.loanRemainingAmount || 0).toFixed(2) })
      fields.push({
        label: '还款方式',
        value: rt.loanInterestMethod === 'EQUAL_PRINCIPAL'
          ? LOAN_INTEREST_METHOD_LABELS.EQUAL_PRINCIPAL
          : LOAN_INTEREST_METHOD_LABELS.EQUAL_INSTALLMENT,
      })
    }

    const preview: ConfirmPreview = {
      type: 'budget-card',
      title: '确认删除固定收支',
      description: rt.recurringType === 'LOAN' ? '将同时删除关联的还款计划' : undefined,
      budgetFields: fields,
    }
    return JSON.stringify(preview)
  },

  async execute(args: { id: string }, ctx: ToolContext) {

    const existing = await prisma.recurringTransaction.findUnique({ where: { id: args.id } })
    if (!existing) throw new ToolError('固定收支记录不存在', false)
    if (existing.accountBookId !== ctx.accountBookId) {
      throw new ToolError('无权删除该记录', false)
    }

    await prisma.repaymentPlan.deleteMany({ where: { recurringTransactionId: args.id } })
    await prisma.recurringTransaction.delete({ where: { id: args.id } })

    return desensitize({ deleted: true })
  },
}

import { prisma } from '../../../app.js'
import { desensitize, ToolError } from '../security.js'
import { getNextTriggerTime } from '../../recurring.js'
import { genericPreview, type ConfirmPreview } from '../runtime/preview-format.js'
import type { PreviewScope } from '../runtime/preview-scope.js'
import type { ToolDef, ToolContext } from './types.js'

export const toggleRecurringTool: ToolDef = {
  name: 'toggle_recurring',
  displayName: '启停固定收支',
  promptHint: '启用或停用定期收支',
  description: '切换固定收支的启用/停用状态。',
  parameters: {
    type: 'object',
    properties: {
      id: { type: 'string', description: '固定收支 ID' },
    },
    required: ['id'],
  },
  requireConfirm: true,

  /** 确认卡：展示当前状态与变更后的状态，用户一眼能看出是启还是停 */
  async confirmation(args: { id?: string }, _ctx: ToolContext, scope: PreviewScope): Promise<string> {
    const rt = await scope.recurring(args?.id || '')
    if (!rt) return genericPreview('启停固定收支', { error: `记录不存在: ${args?.id}` })

    const newStatus = !rt.active
    const preview: ConfirmPreview = {
      type: 'budget-card',
      title: `确认${newStatus ? '启用' : '停用'}固定收支`,
      budgetFields: [
        { label: '名称', value: rt.name },
        { label: '金额', value: rt.amount.toFixed(2) },
        { label: '账户', value: rt.accountName || rt.accountId },
        { label: '当前状态', value: rt.active ? '已启用' : '已停用' },
        { label: '变更后', value: newStatus ? '启用' : '停用' },
      ],
    }
    return JSON.stringify(preview)
  },

  async execute(args: { id: string }, ctx: ToolContext) {

    const existing = await prisma.recurringTransaction.findUnique({ where: { id: args.id } })
    if (!existing) throw new ToolError('固定收支记录不存在', false)
    if (existing.accountBookId !== ctx.accountBookId) {
      throw new ToolError('无权操作该记录', false)
    }

    const updated = await prisma.recurringTransaction.update({
      where: { id: args.id },
      data: {
        active: !existing.active,
        nextGenerateAt: existing.active ? null : getNextTriggerTime(existing.cron),
      },
    })

    return desensitize({ id: updated.id, active: updated.active })
  },
}

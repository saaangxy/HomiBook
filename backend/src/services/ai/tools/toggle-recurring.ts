import { prisma } from '../../../app.js'
import { assertIsMember, retryable, desensitize, type ToolResult } from '../security.js'
import { getNextTriggerTime } from '../../recurring.js'
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

  async execute(args: { id: string }, ctx: ToolContext): Promise<ToolResult> {
    await assertIsMember(ctx.accountBookId, ctx.userId)

    return retryable(async () => {
      const existing = await prisma.recurringTransaction.findUnique({ where: { id: args.id } })
      if (!existing) return { success: false, error: '固定收支记录不存在', retryable: false }
      if (existing.accountBookId !== ctx.accountBookId) {
        return { success: false, error: '无权操作该记录', retryable: false }
      }

      const updated = await prisma.recurringTransaction.update({
        where: { id: args.id },
        data: {
          active: !existing.active,
          nextGenerateAt: existing.active ? null : getNextTriggerTime(existing.cron),
        },
      })

      return desensitize({ id: updated.id, active: updated.active })
    }, 'toggle_recurring')
  },
}

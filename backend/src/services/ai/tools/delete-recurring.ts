import { prisma } from '../../../app.js'
import { assertIsMember, retryable, desensitize, type ToolResult } from '../security.js'
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

  async execute(args: { id: string }, ctx: ToolContext): Promise<ToolResult> {
    await assertIsMember(ctx.accountBookId, ctx.userId)

    return retryable(async () => {
      const existing = await prisma.recurringTransaction.findUnique({ where: { id: args.id } })
      if (!existing) return { success: false, error: '固定收支记录不存在', retryable: false }
      if (existing.accountBookId !== ctx.accountBookId) {
        return { success: false, error: '无权删除该记录', retryable: false }
      }

      await prisma.repaymentPlan.deleteMany({ where: { recurringTransactionId: args.id } })
      await prisma.recurringTransaction.delete({ where: { id: args.id } })

      return desensitize({ deleted: true })
    }, 'delete_recurring')
  },
}

import { prisma } from '../../../app.js'
import { assertIsMember, retryable, desensitize, type ToolResult } from '../security.js'
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

  async execute(args: { id: string }, ctx: ToolContext): Promise<ToolResult> {
    await assertIsMember(ctx.accountBookId, ctx.userId)

    return retryable(async () => {
      const existing = await prisma.budget.findUnique({ where: { id: args.id } })
      if (!existing) return { success: false, error: '预算不存在', retryable: false }
      if (existing.accountBookId !== ctx.accountBookId) {
        return { success: false, error: '无权删除该预算', retryable: false }
      }

      await prisma.budget.delete({ where: { id: args.id } })
      return desensitize({ deleted: true })
    }, 'delete_budget')
  },
}

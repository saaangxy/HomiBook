import { prisma } from '../../../app.js'
import { assertIsMember, retryable, desensitize, type ToolResult } from '../security.js'
import type { ToolDef, ToolContext } from './types.js'

export const deleteAccountTool: ToolDef = {
  name: 'delete_account',
  description: '删除账户及其余额调整记录。',
  parameters: {
    type: 'object',
    properties: {
      id: { type: 'string', description: '账户 ID' },
    },
    required: ['id'],
  },
  requireConfirm: true,

  async execute(args: { id: string }, ctx: ToolContext): Promise<ToolResult> {
    await assertIsMember(ctx.accountBookId, ctx.userId)

    return retryable(async () => {
      const account = await prisma.account.findUnique({ where: { id: args.id } })
      if (!account) return { success: false, error: '账户不存在', retryable: false }
      if (account.accountBookId !== ctx.accountBookId) {
        return { success: false, error: '无权删除该账户', retryable: false }
      }

      await prisma.account.update({
        where: { id: args.id },
        data: { status: 'ARCHIVED', deletedAt: new Date() },
      })

      return desensitize({ deleted: true })
    }, 'delete_account')
  },
}

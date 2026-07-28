import { prisma } from '../../../app.js'
import { retryable, desensitize, type ToolResult } from '../security.js'
import type { ToolDef, ToolContext } from './types.js'
import { assertCanManageAccount } from '../../account.js'

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
    return retryable(async () => {
      const account = await assertCanManageAccount(args.id, ctx.userId)
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

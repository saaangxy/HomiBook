import { prisma } from '../../../app.js'
import { refreshAccountBalance } from '../../account.js'
import { assertIsMember, retryable, type ToolResult } from '../security.js'
import type { ToolDef, ToolContext } from './types.js'

export const deleteRecordTool: ToolDef = {
  name: 'delete_record',
  displayName: '删除流水',
  promptHint: '需要用户确认',
  description: '删除一条流水记录。敏感操作，需要用户确认。',
  parameters: {
    type: 'object',
    properties: {
      recordId: { type: 'string', description: '要删除的记录 ID' },
    },
    required: ['recordId'],
  },
  requireConfirm: true,

  async execute(args: any, ctx: ToolContext): Promise<ToolResult> {
    const existing = await prisma.record.findUnique({ where: { id: args.recordId } })
    if (!existing) return { success: false, error: '记录不存在', retryable: false }

    await assertIsMember(existing.accountBookId, ctx.userId)
    if (existing.accountBookId !== ctx.accountBookId) {
      return { success: false, error: '禁止跨账本操作记录，先切换账本', retryable: false }
    }

    return retryable(async () => {
      // 先取账户信息:删除后就查不到这条记录属于谁了,余额缓存也就没法刷新
      const existing = await prisma.record.findUnique({
        where: { id: args.recordId },
        select: { accountId: true, fromAccountId: true, toAccountId: true },
      })
      await prisma.record.delete({ where: { id: args.recordId } })

      if (existing) {
        const touched = new Set(
          [existing.accountId, existing.fromAccountId, existing.toAccountId].filter(Boolean) as string[],
        )
        for (const accId of touched) await refreshAccountBalance(accId)
      }

      return { deleted: true, id: args.recordId }
    }, 'delete_record')
  },
}

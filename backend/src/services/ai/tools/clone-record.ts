import { prisma } from '../../../app.js'
import { assertIsMember, retryable, desensitize, type ToolResult } from '../security.js'
import type { ToolDef, ToolContext } from './types.js'
import { refreshAccountBalance } from '../../account.js'

export const cloneRecordTool: ToolDef = {
  name: 'clone_record',
  displayName: '复制流水',
  promptHint: '复制已有流水创建新记录',
  description: '克隆一条流水记录，复制其所有字段但归属人设为当前用户。',
  parameters: {
    type: 'object',
    properties: {
      id: { type: 'string', description: '要克隆的记录 ID' },
    },
    required: ['id'],
  },
  requireConfirm: true,

  async execute(args: { id: string }, ctx: ToolContext): Promise<ToolResult> {
    await assertIsMember(ctx.accountBookId, ctx.userId)

    return retryable(async () => {
      const existing = await prisma.record.findUnique({ where: { id: args.id } })
      if (!existing) return { success: false, error: '记录不存在', retryable: false }
      if (existing.accountBookId !== ctx.accountBookId) {
        return { success: false, error: '无权访问该记录', retryable: false }
      }

      const cloned = await prisma.record.create({
        data: {
          accountBookId: existing.accountBookId,
          type: existing.type,
          amount: existing.amount,
          date: existing.date,
          remark: existing.remark,
          tags: existing.tags,
          accountId: existing.accountId,
          fromAccountId: existing.fromAccountId,
          toAccountId: existing.toAccountId,
          categoryCode: existing.categoryCode,
          payer: existing.payer,
          ownerId: ctx.userId,
        },
        include: { account: { select: { name: true } } },
      })

      const affectedAccounts = [existing.accountId, existing.fromAccountId, existing.toAccountId].filter(Boolean) as string[]
      for (const accId of [...new Set(affectedAccounts)]) {
        await refreshAccountBalance(accId)
      }

      return desensitize({
        id: cloned.id,
        type: cloned.type,
        amount: cloned.amount,
        date: cloned.date.toISOString().slice(0, 10),
        accountName: cloned.account.name,
        categoryCode: cloned.categoryCode,
        remark: cloned.remark,
        cloned: true,
      })
    }, 'clone_record')
  },
}

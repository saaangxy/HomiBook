import { prisma } from '../../../app.js'
import { assertIsMember, retryable, type ToolResult } from '../security.js'
import type { ToolDef, ToolContext } from './types.js'

export const deleteRecordTool: ToolDef = {
  name: 'delete_record',
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
      await prisma.record.delete({ where: { id: args.recordId } })
      return { deleted: true, id: args.recordId }
    }, 'delete_record')
  },
}

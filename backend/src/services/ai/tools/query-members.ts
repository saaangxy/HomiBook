import { prisma } from '../../../app.js'
import { assertIsMember, retryable, desensitize, type ToolResult } from '../security.js'
import type { ToolDef, ToolContext } from './types.js'

export const queryMembersTool: ToolDef = {
  name: 'query_members',
  description: '查询当前账本的成员列表。',
  parameters: {
    type: 'object',
    properties: {},
  },

  async execute(_args: unknown, ctx: ToolContext): Promise<ToolResult> {
    await assertIsMember(ctx.accountBookId, ctx.userId)

    return retryable(async () => {
      const members = await prisma.accountBookMember.findMany({
        where: { accountBookId: ctx.accountBookId },
        include: { user: { select: { id: true, nickname: true, email: true } } },
        orderBy: { joinedAt: 'asc' },
      })

      const book = await prisma.accountBook.findUnique({
        where: { id: ctx.accountBookId },
        select: { ownerId: true, name: true },
      })

      return desensitize({
        bookName: book?.name,
        memberCount: members.length,
        members: members.map((m) => ({
          id: m.id,
          userId: m.userId,
          role: m.role,
          joinedAt: m.joinedAt,
          nickname: m.user.nickname,
          email: m.user.email,
          isOwner: m.userId === book?.ownerId,
        })),
      })
    }, 'query_members')
  },
}

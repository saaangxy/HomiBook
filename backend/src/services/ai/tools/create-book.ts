import { prisma } from '../../../app.js'
import { retryable, desensitize, type ToolResult } from '../security.js'
import type { ToolDef, ToolContext } from './types.js'

export const createBookTool: ToolDef = {
  name: 'create_book',
  displayName: '创建账本',
  promptHint: '需要用户确认',
  description: '创建一个新账本。',
  parameters: {
    type: 'object',
    properties: {
      name: { type: 'string', description: '账本名称' },
    },
    required: ['name'],
  },
  requireConfirm: true,

  async execute(args: { name: string }, ctx: ToolContext): Promise<ToolResult> {
    return retryable(async () => {
      const book = await prisma.accountBook.create({
        data: {
          name: args.name,
          ownerId: ctx.userId,
          members: {
            create: { userId: ctx.userId },
          },
        },
        include: {
          _count: { select: { members: true } },
        },
      })

      return desensitize({
        id: book.id,
        name: book.name,
        ownerId: book.ownerId,
        role: 'owner',
        memberCount: book._count.members,
        created: true,
      })
    }, 'create_book')
  },
}

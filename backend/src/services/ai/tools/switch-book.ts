import { prisma } from '../../../app.js'
import { retryable, desensitize, type ToolResult } from '../security.js'
import type { ToolDef, ToolContext } from './types.js'

export const switchBookTool: ToolDef = {
  name: 'switch_book',
  description: '查看当前用户的所有可用账本。如需切换账本，请告诉用户选择目标账本，由用户在前端切换。',
  parameters: {
    type: 'object',
    properties: {},
  },

  async execute(_args: unknown, ctx: ToolContext): Promise<ToolResult> {
    return retryable(async () => {
      const books = await prisma.accountBook.findMany({
        where: {
          OR: [
            { ownerId: ctx.userId },
            { members: { some: { userId: ctx.userId } } },
          ],
        },
        include: {
          _count: { select: { members: true } },
          members: {
            where: { userId: ctx.userId },
            select: { role: true },
          },
        },
        orderBy: { createdAt: 'desc' },
      })

      const currentBook = books.find((b) => b.id === ctx.accountBookId)

      return desensitize({
        currentBookId: ctx.accountBookId,
        currentBookName: currentBook?.name,
        totalBooks: books.length,
        books: books.map((book) => ({
          id: book.id,
          name: book.name,
          role: book.ownerId === ctx.userId ? 'owner' : (book.members[0]?.role || 'member'),
          memberCount: book._count.members,
          isCurrent: book.id === ctx.accountBookId,
        })),
      })
    }, 'switch_book')
  },
}

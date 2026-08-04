import { prisma } from '../../../app.js'
import { retryable, desensitize, type ToolResult } from '../security.js'
import type { ToolDef, ToolContext } from './types.js'

export const switchBookTool: ToolDef = {
  name: 'switch_book',
  displayName: '切换账本',
  promptHint: '查看并切换到其他账本',
  description: '切换当前操作的账本。会列出用户所有可用账本供选择。调用后将暂停等待用户选择目标账本，切换后后续操作都在新账本中执行。当用户提到切换账本、换一个账本、查看其他账本时调用。',
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

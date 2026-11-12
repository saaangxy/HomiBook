import { prisma } from '../../../app.js'
import { desensitize } from '../security.js'
import type { ConfirmPreview } from '../runtime/preview-format.js'
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

  /** 确认卡：只有名称一个字段，平铺即可 */
  async confirmation(args: { name?: string }): Promise<string> {
    const preview: ConfirmPreview = {
      type: 'budget-card',
      title: '确认创建账本',
      budgetFields: [{ label: '名称', value: args?.name || '-' }],
    }
    return JSON.stringify(preview)
  },

  async execute(args: { name: string }, ctx: ToolContext) {
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
  },
}

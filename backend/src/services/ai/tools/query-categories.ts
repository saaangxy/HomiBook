import { prisma } from '../../../app.js'
import { retryable, type ToolResult } from '../security.js'
import type { ToolDef, ToolContext } from './types.js'

export const queryCategoriesTool: ToolDef = {
  name: 'query_categories',
  description: '查询系统中可用的收支分类字典，以及当前账本的自定义分类映射。',
  parameters: {
    type: 'object',
    properties: {
      type: { type: 'string', enum: ['INCOME', 'EXPENSE'], description: '分类类型筛选' },
    },
  },

  async execute(args: { type?: string }, ctx: ToolContext): Promise<ToolResult> {
    return retryable(async () => {
      const where: Record<string, unknown> = {}
      if (args.type) where.type = args.type

      const [categories, mappings] = await Promise.all([
        prisma.category.findMany({
          where,
          select: { name: true, icon: true, type: true },
          orderBy: [{ type: 'asc' }, { order: 'asc' }],
        }),
        prisma.categoryMapping.findMany({
          where: { accountBookId: ctx.accountBookId },
          select: { userCategory: true, systemCategoryId: true },
        }),
      ])

      const mappingMap = new Map<string, string>()
      for (const m of mappings) {
        mappingMap.set(m.userCategory, m.systemCategoryId)
      }

      return {
        categories: categories.map((c) => ({
          name: c.name,
          type: c.type,
          icon: c.icon ?? '📦',
        })),
        customMappings: mappings.map((m) => ({
          userCategory: m.userCategory,
          systemCategory: m.systemCategoryId,
        })),
      }
    }, 'query_categories')
  },
}

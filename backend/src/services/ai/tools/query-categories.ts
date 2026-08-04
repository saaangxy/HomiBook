import { prisma } from '../../../app.js'
import { assertIsMember, retryable, type ToolResult } from '../security.js'
import type { ToolDef, ToolContext } from './types.js'

export const queryCategoriesTool: ToolDef = {
  name: 'query_categories',
  displayName: '查询分类',
  promptHint: '查看收支分类字典',
  description: '查询系统中可用的收支分类字典。可用于确认分类编码后调用 create_record 或 query_records。',
  parameters: {
    type: 'object',
    properties: {
      type: { type: 'string', enum: ['INCOME', 'EXPENSE', 'TRANSFER'], description: '分类类型筛选，不填返回全部' },
    },
  },

  async execute(args: { type?: string }, ctx: ToolContext): Promise<ToolResult> {
    await assertIsMember(ctx.accountBookId, ctx.userId)

    return retryable(async () => {
      const groups = args.type
        ? [`transaction_category_${args.type.toLowerCase()}`]
        : ['transaction_category_income', 'transaction_category_expense', 'transaction_category_transfer']

      const categories = await prisma.dictionary.findMany({
        where: { group: { in: groups } },
        select: { code: true, label: true, group: true },
        orderBy: [{ group: 'asc' }, { order: 'asc' }],
      })

      const typeMap: Record<string, string> = {
        transaction_category_income: 'INCOME',
        transaction_category_expense: 'EXPENSE',
        transaction_category_transfer: 'TRANSFER',
      }

      return {
        categories: categories.map((c) => ({
          code: c.code,
          name: c.label,
          type: typeMap[c.group] || c.group,
        })),
      }
    }, 'query_categories')
  },
}

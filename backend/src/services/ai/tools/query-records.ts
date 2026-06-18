import { prisma } from '../../../app.js'
import { assertIsMember, retryable, desensitize, type ToolResult } from '../security.js'
import type { ToolDef, ToolContext } from './types.js'

interface QueryRecordsArgs {
  keyword?: string
  type?: 'INCOME' | 'EXPENSE' | 'TRANSFER'
  categoryCode?: string
  accountId?: string
  startDate?: string
  endDate?: string
  minAmount?: number
  maxAmount?: number
  limit?: number
}

export const queryRecordsTool: ToolDef = {
  name: 'query_records',
  description: '查询流水记录。支持按关键词、类型、分类、账户、日期范围、金额范围筛选。',
  parameters: {
    type: 'object',
    properties: {
      keyword: { type: 'string', description: '搜索关键词，匹配备注和交易方' },
      type: { type: 'string', enum: ['INCOME', 'EXPENSE', 'TRANSFER'], description: '流水类型' },
      categoryCode: { type: 'string', description: '分类编码，如 餐饮、交通' },
      accountId: { type: 'string', description: '账户 ID' },
      startDate: { type: 'string', description: '开始日期，格式 YYYY-MM-DD' },
      endDate: { type: 'string', description: '结束日期，格式 YYYY-MM-DD' },
      minAmount: { type: 'number', description: '最小金额' },
      maxAmount: { type: 'number', description: '最大金额' },
      limit: { type: 'number', description: '返回条数，默认 50' },
    },
  },

  async execute(args: QueryRecordsArgs, ctx: ToolContext): Promise<ToolResult> {
    await assertIsMember(ctx.accountBookId, ctx.userId)

    return retryable(async () => {
      const where: Record<string, unknown> = { accountBookId: ctx.accountBookId }

      if (args.type) where.type = args.type
      if (args.categoryCode) where.categoryCode = args.categoryCode
      if (args.accountId) where.accountId = args.accountId
      if (args.minAmount !== undefined || args.maxAmount !== undefined) {
        where.amount = {
          ...(args.minAmount !== undefined ? { gte: args.minAmount } : {}),
          ...(args.maxAmount !== undefined ? { lte: args.maxAmount } : {}),
        }
      }
      if (args.startDate || args.endDate) {
        where.date = {
          ...(args.startDate ? { gte: new Date(args.startDate) } : {}),
          ...(args.endDate ? { lte: new Date(args.endDate) } : {}),
        }
      }
      if (args.keyword) {
        where.OR = [
          { remark: { contains: args.keyword } },
          { payer: { contains: args.keyword } },
        ]
      }

      const records = await prisma.record.findMany({
        where,
        include: {
          account: { select: { name: true } },
        },
        orderBy: { date: 'desc' },
        take: Math.min(args.limit ?? 50, 200),
      })

      const totalCount = await prisma.record.count({ where })

      const totalAmount = records.reduce((sum, r) => {
        if (r.type === 'INCOME') return sum + r.amount
        if (r.type === 'EXPENSE') return sum - r.amount
        return sum // TRANSFER 不计入
      }, 0)

      return desensitize({
        totalCount,
        totalAmount: Math.round(totalAmount * 100) / 100,
        records: records.map((r) => ({
          id: r.id,
          type: r.type,
          amount: r.amount,
          date: r.date.toISOString().slice(0, 10),
          remark: r.remark,
          categoryCode: r.categoryCode,
          payer: r.payer,
          accountName: r.account.name,
        })),
      })
    }, 'query_records')
  },
}

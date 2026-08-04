import { prisma } from '../../../app.js'
import { assertIsMember, retryable, desensitize, type ToolResult } from '../security.js'
import type { ToolDef, ToolContext } from './types.js'

interface DetectDuplicatesArgs {
  matchFields: {
    date: 'exact' | 'date' | null
    type: boolean
    accountId: boolean
    payer: boolean
    amount: boolean
  }
}

export const detectDuplicatesTool: ToolDef = {
  name: 'detect_duplicates',
  displayName: '检测重复流水',
  promptHint: '查找可能的重复记录',
  description: '按指定字段分组检测重复流水记录。',
  parameters: {
    type: 'object',
    properties: {
      matchFields: {
        type: 'object',
        description: '匹配规则',
        properties: {
          date: { type: 'string', enum: ['exact', 'date', null], description: '日期匹配：exact=精确到秒，date=按天，null=忽略' },
          type: { type: 'boolean', description: '是否匹配交易类型' },
          accountId: { type: 'boolean', description: '是否匹配账户' },
          payer: { type: 'boolean', description: '是否匹配交易方' },
          amount: { type: 'boolean', description: '是否匹配金额' },
        },
        required: ['date', 'type', 'accountId', 'payer', 'amount'],
      },
    },
    required: ['matchFields'],
  },

  async execute(args: DetectDuplicatesArgs, ctx: ToolContext): Promise<ToolResult> {
    await assertIsMember(ctx.accountBookId, ctx.userId)

    return retryable(async () => {
      const records = await prisma.record.findMany({
        where: { accountBookId: ctx.accountBookId },
        include: { account: { select: { name: true } } },
        orderBy: { date: 'asc' },
      })

      const { matchFields } = args
      const groups = new Map<string, typeof records>()

      for (const r of records) {
        const parts: string[] = []

        if (matchFields.date === 'exact') {
          parts.push(r.date.toISOString())
        } else if (matchFields.date === 'date') {
          parts.push(r.date.toISOString().slice(0, 10))
        }

        if (matchFields.type) parts.push(r.type)
        if (matchFields.accountId) parts.push(r.accountId)
        if (matchFields.payer) parts.push(r.payer || '__empty__')
        if (matchFields.amount) parts.push(r.amount.toFixed(2))

        const key = parts.join('||')
        if (!groups.has(key)) groups.set(key, [])
        groups.get(key)!.push(r)
      }

      const duplicateGroups = Array.from(groups.entries())
        .filter(([, recs]) => recs.length > 1)
        .map(([key, recs]) => ({
          key,
          count: recs.length,
          records: recs.slice(0, 5).map((r) => ({
            id: r.id,
            type: r.type,
            amount: r.amount,
            date: r.date.toISOString().slice(0, 10),
            remark: r.remark,
            accountName: r.account.name,
            payer: r.payer,
          })),
          totalInGroup: recs.length,
        }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 10)

      const totalDuplicates = duplicateGroups.reduce((sum, g) => sum + g.totalInGroup - 1, 0)

      return desensitize({ totalDuplicates, groups: duplicateGroups })
    }, 'detect_duplicates')
  },
}

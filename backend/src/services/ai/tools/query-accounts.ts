import { prisma } from '../../../app.js'
import { assertIsMember, retryable, desensitize, type ToolResult } from '../security.js'
import type { ToolDef, ToolContext } from './types.js'

export const queryAccountsTool: ToolDef = {
  name: 'query_accounts',
  displayName: '查询账户',
  promptHint: '查看账户余额和变动',
  description: '查询账户列表及其余额。',
  parameters: {
    type: 'object',
    properties: {},
  },

  async execute(_args: unknown, ctx: ToolContext): Promise<ToolResult> {
    await assertIsMember(ctx.accountBookId, ctx.userId)

    return retryable(async () => {
      const accounts = await prisma.account.findMany({
        where: { accountBookId: ctx.accountBookId, status: 'ACTIVE' },
        select: {
          id: true,
          name: true,
          type: true,
          currency: true,
          balance: true,
          accountNo: true,
          bankName: true,
        },
        orderBy: { name: 'asc' },
      })

      const totalBalance = accounts.reduce((sum, a) => sum + a.balance, 0)

      return desensitize({
        totalBalance: Math.round(totalBalance * 100) / 100,
        count: accounts.length,
        accounts,
      })
    }, 'query_accounts')
  },
}

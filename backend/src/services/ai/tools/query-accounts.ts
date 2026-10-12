import { prisma } from '../../../app.js'
import { assertIsMember, retryable, desensitize, type ToolResult } from '../security.js'
import type { ToolDef, ToolContext } from './types.js'

export const queryAccountsTool: ToolDef = {
  name: 'query_accounts',
  displayName: '查询账户',
  promptHint: '查看账户余额和变动',
  description:
    '查询账户列表及其余额。多成员账本下同一名称可能有多个账户（如各人的「微信」），' +
    '用返回的 ownerName 区分，向用户确认/展示账户时必须带上归属人。',
  parameters: {
    type: 'object',
    properties: {},
  },

  async execute(_args: unknown, ctx: ToolContext): Promise<ToolResult> {
    await assertIsMember(ctx.accountBookId, ctx.userId)

    return retryable(async () => {
      const rows = await prisma.account.findMany({
        where: { accountBookId: ctx.accountBookId, status: 'ACTIVE' },
        select: {
          id: true,
          name: true,
          type: true,
          currency: true,
          balance: true,
          accountNo: true,
          bankName: true,
          ownerId: true,
          owner: { select: { nickname: true, email: true } },
        },
        orderBy: { name: 'asc' },
      })
      // 归属人展示名:多成员账本下同一名称可能有多个账户(如各人的「微信」),没有它模型无法区分,
      // 生成的「请选择账户」选项就会撞名(与 REST /api/accounts 的 ownerName 同口径)
      const accounts = rows.map(({ owner, ...a }) => ({
        ...a,
        ownerName: owner?.nickname || owner?.email || null,
      }))

      const totalBalance = accounts.reduce((sum, a) => sum + a.balance, 0)

      return desensitize({
        totalBalance: Math.round(totalBalance * 100) / 100,
        count: accounts.length,
        accounts,
      })
    }, 'query_accounts')
  },
}

import { prisma } from '../../../app.js'
import { assertIsMember, retryable, desensitize, type ToolResult } from '../security.js'
import type { ToolDef, ToolContext } from './types.js'

export const createAccountTool: ToolDef = {
  name: 'create_account',
  description: '创建新账户。参数：name(名称)、type(账户类型，如CASH/BANK/CREDIT_CARD/ALIPAY/WECHAT/INVESTMENT/EBANK/OTHER)、currency(货币代码，默认CNY)、initialBalance(初始余额)、accountNo(账号)、bankName(银行名称)、visibility(PUBLIC|PRIVATE)。',
  parameters: {
    type: 'object',
    properties: {
      name: { type: 'string', description: '账户名称' },
      type: { type: 'string', enum: ['CASH', 'BANK', 'CREDIT_CARD', 'ALIPAY', 'WECHAT', 'INVESTMENT', 'EBANK', 'OTHER'], description: '账户类型' },
      currency: { type: 'string', description: '货币代码，默认 CNY' },
      initialBalance: { type: 'number', description: '初始余额' },
      accountNo: { type: 'string', description: '账号' },
      bankName: { type: 'string', description: '银行名称' },
      visibility: { type: 'string', enum: ['PUBLIC', 'PRIVATE'], description: '可见性' },
    },
    required: ['name', 'type'],
  },
  requireConfirm: true,

  async execute(args: any, ctx: ToolContext): Promise<ToolResult> {
    await assertIsMember(ctx.accountBookId, ctx.userId)

    const initialBalance = args.initialBalance ?? 0
    if (args.type === 'CREDIT_CARD' && initialBalance > 0) {
      return { success: false, error: '信用卡初始余额不能大于0', retryable: false }
    }

    return retryable(async () => {
      const account = await prisma.account.create({
        data: {
          accountBookId: ctx.accountBookId,
          ownerId: ctx.userId,
          name: args.name,
          type: args.type,
          currency: args.currency ?? 'CNY',
          initialBalance,
          balance: initialBalance,
          balanceAt: initialBalance !== 0 ? new Date() : null,
          accountNo: args.accountNo,
          bankName: args.bankName,
          visibility: args.visibility ?? 'PUBLIC',
        },
      })

      return desensitize({
        id: account.id,
        name: account.name,
        type: account.type,
        currency: account.currency,
        balance: account.balance,
        created: true,
      })
    }, 'create_account')
  },
}

import { prisma } from '../../../app.js'
import { assertIsMember, checkEnums, retryable, desensitize, type ToolResult } from '../security.js'
import { ACCOUNT_TYPES, ACCOUNT_VISIBILITIES, normalizeAccountType } from '@homibook/core'
import type { ToolDef, ToolContext } from './types.js'

/** 入参枚举校验:非法类型直接回报给模型(否则会被归一化悄悄记成 OTHER)。弹确认卡前与执行时共用 */
const validateArgs = (args: any) =>
  checkEnums({
    type: [args.type, ACCOUNT_TYPES],
    visibility: [args.visibility, ACCOUNT_VISIBILITIES],
  })

export const createAccountTool: ToolDef = {
  name: 'create_account',
  displayName: '创建账户',
  promptHint: '需要用户确认',
  description: '创建新账户。参数：name(名称)、type(账户类型)、currency(货币代码，默认CNY)、initialBalance(初始余额)、accountNo(账号)、bankName(银行名称)、visibility(PUBLIC|PRIVATE)。',
    parameters: {
      type: 'object',
      properties: {
        name: { type: 'string', description: '账户名称' },
        type: { type: 'string', enum: [...ACCOUNT_TYPES], description: '账户类型：BANK_DEBIT(借记卡)/CREDIT_CARD(信用卡)/ALIPAY/WECHAT/CASH(现金)/RECHARGE_CARD(充值卡)/INVESTMENT(投资)/OTHER' },
        currency: { type: 'string', description: '货币代码，默认 CNY' },
      initialBalance: { type: 'number', description: '初始余额' },
      accountNo: { type: 'string', description: '账号' },
      bankName: { type: 'string', description: '银行名称' },
      visibility: { type: 'string', enum: [...ACCOUNT_VISIBILITIES], description: '可见性' },
    },
    required: ['name', 'type'],
  },
  requireConfirm: true,
  validateArgs,

  async execute(args: any, ctx: ToolContext): Promise<ToolResult> {
    // 入参枚举校验(与弹确认卡前同一份规则)
    const badEnum = validateArgs(args)
    if (badEnum) return badEnum

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
          // 归一化:模型可能不遵守 schema 枚举(如输出 "BANK"),非法类型会让客户端渲染崩溃
          type: normalizeAccountType(args.type),
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

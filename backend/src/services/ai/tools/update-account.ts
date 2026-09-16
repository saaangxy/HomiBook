import { prisma } from '../../../app.js'
import type { Prisma } from '../../../generated/sqlite/client.js'
import { checkEnums, retryable, desensitize, type ToolResult } from '../security.js'
import type { ToolDef, ToolContext } from './types.js'
import { computeAccountBalance, assertCanManageAccount } from '../../account.js'
import { ACCOUNT_STATUSES, ACCOUNT_TYPES, ACCOUNT_VISIBILITIES, normalizeAccountType } from '@homibook/core'

/** 入参枚举校验:非法类型/可见性/状态直接回报给模型。弹确认卡前与执行时共用 */
const validateArgs = (args: any) =>
  checkEnums({
    type: [args.type, ACCOUNT_TYPES],
    visibility: [args.visibility, ACCOUNT_VISIBILITIES],
    status: [args.status, ACCOUNT_STATUSES],
  })

export const updateAccountTool: ToolDef = {
  name: 'update_account',
  displayName: '修改账户',
  promptHint: '需要用户确认',
  description: '更新账户元数据（名称、类型、可见性等）。',
  parameters: {
    type: 'object',
    properties: {
      id: { type: 'string', description: '账户 ID' },
      name: { type: 'string', description: '账户名称' },
      type: { type: 'string', enum: [...ACCOUNT_TYPES], description: '账户类型：BANK_DEBIT(借记卡)/CREDIT_CARD(信用卡)/ALIPAY/WECHAT/CASH(现金)/RECHARGE_CARD(充值卡)/INVESTMENT(投资)/OTHER' },
      currency: { type: 'string', description: '货币代码' },
      accountNo: { type: 'string', description: '账号' },
      bankName: { type: 'string', description: '银行名称' },
      visibility: { type: 'string', enum: [...ACCOUNT_VISIBILITIES], description: '可见性' },
      status: { type: 'string', enum: [...ACCOUNT_STATUSES], description: '状态' },
    },
    required: ['id'],
  },
  requireConfirm: true,
  validateArgs,

  async execute(args: any, ctx: ToolContext): Promise<ToolResult> {
    // 入参枚举校验(与弹确认卡前同一份规则)
    const badEnum = validateArgs(args)
    if (badEnum) return badEnum

    return retryable(async () => {
      const account = await assertCanManageAccount(args.id, ctx.userId)
      if (account.accountBookId !== ctx.accountBookId) {
        return { success: false, error: '无权操作该账户', retryable: false }
      }

      if (args.type === 'CREDIT_CARD') {
        const computedBalance = await computeAccountBalance(args.id)
        if (computedBalance > 0) {
          return { success: false, error: '信用卡余额不能大于0', retryable: false }
        }
      }

      const data: Prisma.AccountUpdateInput = {}
      if (args.name !== undefined) data.name = args.name
      if (args.type !== undefined) data.type = normalizeAccountType(args.type)
      if (args.currency !== undefined) data.currency = args.currency
      if (args.accountNo !== undefined) data.accountNo = args.accountNo
      if (args.bankName !== undefined) data.bankName = args.bankName
      if (args.visibility !== undefined) data.visibility = args.visibility
      if (args.status !== undefined) data.status = args.status

      await prisma.account.update({ where: { id: args.id }, data })

      return desensitize({ updated: true })
    }, 'update_account')
  },
}

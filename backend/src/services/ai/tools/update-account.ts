import { prisma } from '../../../app.js'
import type { Prisma } from '../../../generated/prisma/client.js'
import { retryable, desensitize, type ToolResult } from '../security.js'
import type { ToolDef, ToolContext } from './types.js'
import { computeAccountBalance, assertCanManageAccount } from '../../account.js'

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
      type: { type: 'string', enum: ['CASH', 'BANK', 'CREDIT_CARD', 'ALIPAY', 'WECHAT', 'INVESTMENT', 'EBANK', 'OTHER'], description: '账户类型' },
      currency: { type: 'string', description: '货币代码' },
      accountNo: { type: 'string', description: '账号' },
      bankName: { type: 'string', description: '银行名称' },
      visibility: { type: 'string', enum: ['PUBLIC', 'PRIVATE'], description: '可见性' },
      status: { type: 'string', enum: ['ACTIVE', 'ARCHIVED'], description: '状态' },
    },
    required: ['id'],
  },
  requireConfirm: true,

  async execute(args: any, ctx: ToolContext): Promise<ToolResult> {
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
      if (args.type !== undefined) data.type = args.type
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

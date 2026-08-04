import { prisma } from '../../../app.js'
import { retryable, desensitize, type ToolResult } from '../security.js'
import type { ToolDef, ToolContext } from './types.js'
import { assertCanManageAccount } from '../../account.js'

export const adjustBalanceTool: ToolDef = {
  name: 'adjust_balance',
  displayName: '调整余额',
  promptHint: '需要用户确认',
  description: '手动调整账户余额。记录调整历史，并以调整后的余额为新基准。',
  parameters: {
    type: 'object',
    properties: {
      accountId: { type: 'string', description: '账户 ID' },
      date: { type: 'string', description: '调整日期 YYYY-MM-DD' },
      balanceAfter: { type: 'number', description: '调整后的目标余额' },
      remark: { type: 'string', description: '调整原因' },
    },
    required: ['accountId', 'date', 'balanceAfter'],
  },
  requireConfirm: true,

  async execute(args: { accountId: string; date: string; balanceAfter: number; remark?: string }, ctx: ToolContext): Promise<ToolResult> {
    return retryable(async () => {
      const account = await assertCanManageAccount(args.accountId, ctx.userId)
      if (account.accountBookId !== ctx.accountBookId) {
        return { success: false, error: '无权操作该账户', retryable: false }
      }

      if (account.type === 'CREDIT_CARD' && args.balanceAfter > 0) {
        return { success: false, error: '信用卡余额不能大于0', retryable: false }
      }

      const balanceBefore = account.balance
      const amount = args.balanceAfter - balanceBefore

      await prisma.$transaction([
        prisma.balanceAdjustment.create({
          data: {
            accountId: args.accountId,
            date: new Date(args.date),
            amount,
            balanceBefore,
            balanceAfter: args.balanceAfter,
            remark: args.remark,
          },
        }),
        prisma.account.update({
          where: { id: args.accountId },
          data: { balance: args.balanceAfter, balanceAt: new Date(args.date) },
        }),
      ])

      return desensitize({ accountId: args.accountId, balanceBefore, balanceAfter: args.balanceAfter, adjusted: true })
    }, 'adjust_balance')
  },
}

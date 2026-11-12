import { prisma } from '../../../app.js'
import { desensitize, ToolError } from '../security.js'
import type { ToolDef, ToolContext } from './types.js'
import { assertCanManageAccount } from '../../account.js'
import { parseDayStart } from '../../../lib/date-time.js'
import { genericPreview, type ConfirmPreview } from '../runtime/preview-format.js'
import type { PreviewScope } from '../runtime/preview-scope.js'

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

  /** 确认卡：当前余额 → 调整后余额，顺带算出变动金额 */
  async confirmation(
    args: { accountId?: string; balanceAfter?: number; date?: string; remark?: string },
    _ctx: ToolContext,
    scope: PreviewScope,
  ): Promise<string> {
    const account = await scope.account(args?.accountId || '')
    if (!account) return genericPreview('调整余额', { error: `账户不存在: ${args?.accountId}` })

    const diff = (args.balanceAfter ?? 0) - account.balance
    const preview: ConfirmPreview = {
      type: 'budget-card',
      title: '确认调整账户余额',
      budgetFields: [
        { label: '账户', value: account.name },
        { label: '当前余额', value: account.balance.toFixed(2) },
        { label: '调整后余额', value: (args.balanceAfter ?? 0).toFixed(2) },
        { label: '变动金额', value: `${diff >= 0 ? '+' : ''}${diff.toFixed(2)}` },
        ...(args.date ? [{ label: '计算起始', value: args.date }] : []),
        ...(args.remark ? [{ label: '备注', value: args.remark }] : []),
      ],
    }
    return JSON.stringify(preview)
  },

  async execute(args: { accountId: string; date: string; balanceAfter: number; remark?: string }, ctx: ToolContext) {
    const account = await assertCanManageAccount(args.accountId, ctx.userId)
    if (account.accountBookId !== ctx.accountBookId) {
      throw new ToolError('无权操作该账户', false)
    }

    if (account.type === 'CREDIT_CARD' && args.balanceAfter > 0) {
      throw new ToolError('信用卡余额不能大于0', false)
    }

    const balanceBefore = account.balance
    const amount = args.balanceAfter - balanceBefore

    await prisma.$transaction([
      prisma.balanceAdjustment.create({
        data: {
          accountId: args.accountId,
          // 锚定本地日 00:00,与 computeBalance/余额走势的"调整日交易计入调整之后"口径一致
          date: parseDayStart(args.date),
          amount,
          balanceBefore,
          balanceAfter: args.balanceAfter,
          remark: args.remark,
        },
      }),
      prisma.account.update({
        where: { id: args.accountId },
        data: { balance: args.balanceAfter, balanceAt: parseDayStart(args.date) },
      }),
    ])

    return desensitize({ accountId: args.accountId, balanceBefore, balanceAfter: args.balanceAfter, adjusted: true })
  },
}

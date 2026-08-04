import { prisma } from '../../../app.js'
import { assertIsMember, retryable, desensitize, type ToolResult } from '../security.js'
import { getNextTriggerTime } from '../../recurring.js'
import type { ToolDef, ToolContext } from './types.js'

interface QueryRecurringArgs {
  type?: 'PERIODIC' | 'LOAN'
  active?: boolean
}

export const queryRecurringTool: ToolDef = {
  name: 'query_recurring',
  displayName: '查询固定收支',
  promptHint: '查看定期收支和贷款',
  description: '查询固定收支/贷款列表。支持按类型(PERIODIC/LOAN)和启用状态筛选。',
  parameters: {
    type: 'object',
    properties: {
      type: { type: 'string', enum: ['PERIODIC', 'LOAN'], description: '类型筛选' },
      active: { type: 'boolean', description: '是否启用' },
    },
  },

  async execute(args: QueryRecurringArgs, ctx: ToolContext): Promise<ToolResult> {
    await assertIsMember(ctx.accountBookId, ctx.userId)

    return retryable(async () => {
      const where: Record<string, unknown> = { accountBookId: ctx.accountBookId }
      if (args.type) where.recurringType = args.type
      if (args.active !== undefined) where.active = args.active

      const list = await prisma.recurringTransaction.findMany({
        where,
        orderBy: [{ active: 'desc' }, { createdAt: 'desc' }],
        include: {
          account: { select: { id: true, name: true, type: true } },
          toAccount: { select: { id: true, name: true, type: true } },
          repaymentPlans: { orderBy: { period: 'asc' }, select: { period: true, dueDate: true, totalPayment: true, principal: true, interest: true, remainingPrincipal: true, status: true } },
        },
      })

      return desensitize({
        count: list.length,
        items: list.map((r) => ({
          id: r.id,
          name: r.name,
          type: r.type,
          amount: r.amount,
          recurringType: r.recurringType,
          cron: r.cron,
          active: r.active,
          categoryCode: r.categoryCode,
          remark: r.remark,
          tags: JSON.parse(r.tags),
          account: r.account,
          toAccount: r.toAccount,
          nextGenerateAt: r.nextGenerateAt || (r.active ? getNextTriggerTime(r.cron) : null),
          loanTotalAmount: r.loanTotalAmount,
          loanRemainingAmount: r.loanRemainingAmount,
          loanInterestRate: r.loanInterestRate,
          loanInterestMethod: r.loanInterestMethod,
          loanStartDate: r.loanStartDate?.toISOString().slice(0, 10),
          loanTermMonths: r.loanTermMonths,
          loanMonthlyPayment: r.loanMonthlyPayment,
        })),
      })
    }, 'query_recurring')
  },
}

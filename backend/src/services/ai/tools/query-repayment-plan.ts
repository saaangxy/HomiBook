import { prisma } from '../../../app.js'
import { assertIsMember, retryable, desensitize, type ToolResult } from '../security.js'
import type { ToolDef, ToolContext } from './types.js'

export const queryRepaymentPlanTool: ToolDef = {
  name: 'query_repayment_plan',
  description: '查询贷款的还款计划明细。',
  parameters: {
    type: 'object',
    properties: {
      recurringId: { type: 'string', description: '固定收支/贷款 ID' },
    },
    required: ['recurringId'],
  },

  async execute(args: { recurringId: string }, ctx: ToolContext): Promise<ToolResult> {
    await assertIsMember(ctx.accountBookId, ctx.userId)

    return retryable(async () => {
      const rt = await prisma.recurringTransaction.findUnique({ where: { id: args.recurringId } })
      if (!rt) return { success: false, error: '记录不存在', retryable: false }
      if (rt.accountBookId !== ctx.accountBookId) {
        return { success: false, error: '无权访问该记录', retryable: false }
      }

      const plans = await prisma.repaymentPlan.findMany({
        where: { recurringTransactionId: args.recurringId },
        orderBy: { period: 'asc' },
      })

      const generated = plans.filter((p) => p.status === 'GENERATED').length
      const pending = plans.filter((p) => p.status === 'PENDING').length
      const totalPaid = plans
        .filter((p) => p.status === 'GENERATED')
        .reduce((sum, p) => sum + p.totalPayment, 0)

      return desensitize({
        recurringId: rt.id,
        recurringName: rt.name,
        totalPeriods: plans.length,
        generated,
        pending,
        totalPaid: Math.round(totalPaid * 100) / 100,
        plans: plans.map((p) => ({
          period: p.period,
          dueDate: p.dueDate.toISOString().slice(0, 10),
          totalPayment: p.totalPayment,
          principal: p.principal,
          interest: p.interest,
          remainingPrincipal: p.remainingPrincipal,
          status: p.status,
        })),
      })
    }, 'query_repayment_plan')
  },
}

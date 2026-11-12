import { prisma } from '../../../app.js'
import { desensitize, ToolError } from '../security.js'
import type { ToolDef, ToolContext } from './types.js'
import { dateKey } from '../../../lib/date-time.js'

export const queryRepaymentPlanTool: ToolDef = {
  name: 'query_repayment_plan',
  displayName: '查询还款计划',
  promptHint: '查看贷款还款计划明细',
  description: '查询贷款的还款计划明细。',
  parameters: {
    type: 'object',
    properties: {
      recurringId: { type: 'string', description: '固定收支/贷款 ID' },
    },
    required: ['recurringId'],
  },

  async execute(args: { recurringId: string }, ctx: ToolContext) {

    const rt = await prisma.recurringTransaction.findUnique({ where: { id: args.recurringId } })
    if (!rt) throw new ToolError('记录不存在', false)
    if (rt.accountBookId !== ctx.accountBookId) {
      throw new ToolError('无权访问该记录', false)
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
        dueDate: dateKey(p.dueDate),
        totalPayment: p.totalPayment,
        principal: p.principal,
        interest: p.interest,
        remainingPrincipal: p.remainingPrincipal,
        status: p.status,
      })),
    })
  },
}

import { assertIsMember, retryable, desensitize, type ToolResult } from '../security.js'
import type { ToolDef, ToolContext } from './types.js'
import {
  calcEqualInstallment,
  generateEqualInstallmentPlan,
  generateEqualPrincipalPlan,
} from '../../recurring.js'

interface LoanPreviewArgs {
  total: number
  annualRate: number
  months: number
  startDate: string
  method: 'EQUAL_INSTALLMENT' | 'EQUAL_PRINCIPAL'
}

export const loanPreviewTool: ToolDef = {
  name: 'loan_preview',
  description: '贷款计算预览。输入贷款总额、年利率、期数、开始日期、还款方式，返回月供和还款计划。',
  parameters: {
    type: 'object',
    properties: {
      total: { type: 'number', description: '贷款总额' },
      annualRate: { type: 'number', description: '年利率（小数，如0.05表示5%）' },
      months: { type: 'number', description: '贷款期数（月）' },
      startDate: { type: 'string', description: '开始日期 YYYY-MM-DD' },
      method: { type: 'string', enum: ['EQUAL_INSTALLMENT', 'EQUAL_PRINCIPAL'], description: '还款方式' },
    },
    required: ['total', 'annualRate', 'months', 'startDate', 'method'],
  },

  async execute(args: LoanPreviewArgs, ctx: ToolContext): Promise<ToolResult> {
    await assertIsMember(ctx.accountBookId, ctx.userId)

    return retryable(async () => {
      const { total, annualRate, months, startDate, method } = args
      const start = new Date(startDate)
      const calc = calcEqualInstallment(total, annualRate, months)
      const plan = method === 'EQUAL_PRINCIPAL'
        ? generateEqualPrincipalPlan(total, annualRate, months, start)
        : generateEqualInstallmentPlan(total, annualRate, months, start)

      return desensitize({
        monthlyPayment: calc.monthlyPayment,
        totalPayment: calc.totalPayment,
        totalInterest: calc.totalInterest,
        plan: plan.map((p) => ({
          period: p.period,
          dueDate: p.dueDate.toISOString().slice(0, 10),
          totalPayment: p.totalPayment,
          principal: p.principal,
          interest: p.interest,
          remainingPrincipal: p.remainingPrincipal,
        })),
      })
    }, 'loan_preview')
  },
}

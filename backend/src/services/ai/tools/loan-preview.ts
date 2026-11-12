import { checkEnums, desensitize, ToolError } from '../security.js'
import type { ToolDef, ToolContext } from './types.js'
import {
  calcEqualInstallment,
  generateEqualInstallmentPlan,
  generateEqualPrincipalPlan,
} from '../../recurring.js'
import { dateKey, parseStrictDay } from '../../../lib/date-time.js'
import { LOAN_INTEREST_METHODS } from '@homibook/core'

interface LoanPreviewArgs {
  total: number
  annualRate: number
  months: number
  startDate: string
  method: 'EQUAL_INSTALLMENT' | 'EQUAL_PRINCIPAL'
}

export const loanPreviewTool: ToolDef = {
  name: 'loan_preview',
  displayName: '贷款预览',
  promptHint: '预览贷款还款计划',
  description: '贷款计算预览。输入贷款总额、年利率、期数、开始日期、还款方式，返回月供和还款计划。',
  parameters: {
    type: 'object',
    properties: {
      total: { type: 'number', description: '贷款总额（元，必须大于 0）' },
      annualRate: { type: 'number', description: '年利率百分数：4.2 表示 4.2%，0.042 表示 0.042%（注意别把 4.2% 写成 0.042）' },
      months: { type: 'number', description: '贷款期数（月，正整数）' },
      startDate: { type: 'string', description: '开始日期 YYYY-MM-DD（必须是真实存在的日期）' },
      method: { type: 'string', enum: [...LOAN_INTEREST_METHODS], description: '还款方式' },
    },
    required: ['total', 'annualRate', 'months', 'startDate', 'method'],
  },

  async execute(args: LoanPreviewArgs, ctx: ToolContext) {
    // 入参枚举校验:非法还款方式直接回报给模型
    const badEnum = checkEnums({ method: [args.method, LOAN_INTEREST_METHODS] })
    if (badEnum) throw new ToolError(badEnum.error ?? '参数非法', badEnum.retryable)

    const { total, annualRate, months, startDate, method } = args

    // 数值闸门：0 / 负数会算出「全 0 计划」「负月供」——看着像正常数据，比报错更危险
    if (!Number.isFinite(total) || total <= 0) {
      throw new ToolError('贷款总额必须大于 0')
    }
    if (!Number.isFinite(annualRate) || annualRate < 0) {
      throw new ToolError('年利率不能为负数（0 表示无息贷款）')
    }

    if (!Number.isInteger(months) || months <= 0) {
      throw new ToolError('期数必须是正整数（单位：月）')
    }
    // 非法日期不静默进位，也不让 NaN 流进还款计划
    const start = parseStrictDay(startDate)
    if (!start) {
      throw new ToolError(`开始日期不存在或格式错误：${startDate}（应为 YYYY-MM-DD）`)
    }

    const calc = calcEqualInstallment(total, annualRate, months)
    const plan = method === 'EQUAL_PRINCIPAL'
      ? generateEqualPrincipalPlan(total, annualRate, months, start)
      : generateEqualInstallmentPlan(total, annualRate, months, start)

    return desensitize({
      // 回显输入的年利率：模型/用户能据此发现「把 4.2% 写成了 0.042」
      annualRate,
      monthlyPayment: calc.monthlyPayment,
      totalPayment: calc.totalPayment,
      totalInterest: calc.totalInterest,
      plan: plan.map((p) => ({
        period: p.period,
        dueDate: dateKey(p.dueDate),
        totalPayment: p.totalPayment,
        principal: p.principal,
        interest: p.interest,
        remainingPrincipal: p.remainingPrincipal,
      })),
    })
  },
}

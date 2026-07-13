import { prisma } from '../../../app.js'
import { assertIsMember, retryable, desensitize, type ToolResult } from '../security.js'
import type { ToolDef, ToolContext } from './types.js'
import {
  calcEqualInstallment,
  ensureFixedTag,
  generateEqualInstallmentPlan,
  generateEqualPrincipalPlan,
  getNextTriggerTime,
} from '../../recurring.js'
import { resolveAccountId } from './helpers.js'

export const createRecurringTool: ToolDef = {
  name: 'create_recurring',
  description: '创建固定收支或贷款。参数：name(名称)、type(INCOME|EXPENSE|TRANSFER)、amount(金额)、cron(触发表达式)、accountId(账户ID)、categoryCode(分类)、recurringType(PERIODIC|LOAN)、remark(备注)。贷款需额外填loanTotalAmount(贷款总额)、loanInterestRate(年利率)、loanInterestMethod(EQUAL_INSTALLMENT|EQUAL_PRINCIPAL)、loanStartDate(开始日期)、loanTermMonths(期数)。',
  parameters: {
    type: 'object',
    properties: {
      name: { type: 'string', description: '名称' },
      type: { type: 'string', enum: ['INCOME', 'EXPENSE', 'TRANSFER'], description: '交易类型' },
      amount: { type: 'number', description: '金额（贷款类型可省略，自动计算）' },
      cron: { type: 'string', description: 'Cron 表达式，如 "0 9 1 * *" 表示每月1号9点' },
      accountId: { type: 'string', description: '账户 ID 或账号' },
      toAccountId: { type: 'string', description: '目标账户 ID（转账必填）' },
      categoryCode: { type: 'string', description: '分类编码' },
      payer: { type: 'string', description: '交易对方' },
      remark: { type: 'string', description: '备注' },
      tags: { type: 'array', items: { type: 'string' }, description: '标签' },
      recurringType: { type: 'string', enum: ['PERIODIC', 'LOAN'], description: '周期类型' },
      active: { type: 'boolean', description: '是否启用' },
      loanTotalAmount: { type: 'number', description: '贷款总额' },
      loanInterestRate: { type: 'number', description: '贷款年利率（小数，如0.05表示5%）' },
      loanInterestMethod: { type: 'string', enum: ['EQUAL_INSTALLMENT', 'EQUAL_PRINCIPAL'], description: '还款方式' },
      loanStartDate: { type: 'string', description: '贷款开始日期 YYYY-MM-DD' },
      loanTermMonths: { type: 'number', description: '贷款期数（月）' },
      generateAll: { type: 'boolean', description: '是否一次性生成所有已到期还款计划' },
    },
    required: ['name', 'type', 'cron', 'accountId', 'recurringType'],
  },
  requireConfirm: true,

  async execute(args: any, ctx: ToolContext): Promise<ToolResult> {
    await assertIsMember(ctx.accountBookId, ctx.userId)

    if (!['INCOME', 'EXPENSE', 'TRANSFER'].includes(args.type)) {
      return { success: false, error: '无效的交易类型', retryable: false }
    }
    if (args.type === 'TRANSFER' && !args.toAccountId) {
      return { success: false, error: '转账类型需要填写目标账户', retryable: false }
    }
    if (args.recurringType === 'LOAN') {
      if (!args.loanTotalAmount || !args.loanInterestRate || !args.loanTermMonths || !args.loanStartDate) {
        return { success: false, error: '贷款类型需填写贷款总额、利率、期数、开始日期', retryable: false }
      }
    }

    const resolvedAccountId = await resolveAccountId(args.accountId, ctx.accountBookId)
    if (!resolvedAccountId) {
      return { success: false, error: `账户不存在: ${args.accountId}`, retryable: false }
    }
    let resolvedToAccountId: string | null = null
    if (args.toAccountId) {
      resolvedToAccountId = await resolveAccountId(args.toAccountId, ctx.accountBookId)
      if (!resolvedToAccountId) {
        return { success: false, error: `目标账户不存在: ${args.toAccountId}`, retryable: false }
      }
    }

    return retryable(async () => {
      const tags = ensureFixedTag(args.tags || [])
      let finalType = args.type
      let finalAmount = args.amount
      let monthlyPayment = args.amount

      if (args.recurringType === 'LOAN') {
        finalType = 'EXPENSE'
        const calc = calcEqualInstallment(args.loanTotalAmount, args.loanInterestRate, args.loanTermMonths)
        monthlyPayment = calc.monthlyPayment
        finalAmount = monthlyPayment
      }

      const nextGenerate = getNextTriggerTime(args.cron)
      const rt = await prisma.recurringTransaction.create({
        data: {
          accountBookId: ctx.accountBookId,
          name: args.name,
          type: finalType,
          amount: finalAmount,
          remark: args.remark,
          tags: JSON.stringify(tags),
          accountId: resolvedAccountId,
          toAccountId: resolvedToAccountId,
          categoryCode: args.categoryCode,
          payer: args.payer,
          ownerId: ctx.userId,
          cron: args.cron,
          active: args.active ?? true,
          recurringType: args.recurringType,
          loanTotalAmount: args.loanTotalAmount,
          loanRemainingAmount: args.loanTotalAmount,
          loanInterestRate: args.loanInterestRate,
          loanInterestMethod: args.loanInterestMethod,
          loanStartDate: args.loanStartDate ? new Date(args.loanStartDate) : null,
          loanTermMonths: args.loanTermMonths,
          loanMonthlyPayment: args.recurringType === 'LOAN' ? monthlyPayment : null,
          nextGenerateAt: nextGenerate,
        },
      })

      if (args.recurringType === 'LOAN') {
        const startDate = new Date(args.loanStartDate)
        const plan = args.loanInterestMethod === 'EQUAL_PRINCIPAL'
          ? generateEqualPrincipalPlan(args.loanTotalAmount, args.loanInterestRate, args.loanTermMonths, startDate)
          : generateEqualInstallmentPlan(args.loanTotalAmount, args.loanInterestRate, args.loanTermMonths, startDate)

        const now = new Date()
        const planData = plan.map((p) => ({
          recurringTransactionId: rt.id,
          period: p.period,
          dueDate: p.dueDate,
          totalPayment: p.totalPayment,
          principal: p.principal,
          interest: p.interest,
          remainingPrincipal: p.remainingPrincipal,
          status: 'PENDING' as const,
        }))

        await prisma.repaymentPlan.createMany({ data: planData })
      }

      return desensitize({ id: rt.id, name: rt.name, recurringType: rt.recurringType, created: true })
    }, 'create_recurring')
  },
}

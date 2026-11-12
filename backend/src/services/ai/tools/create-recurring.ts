import { prisma } from '../../../app.js'
import { checkEnums, desensitize, ToolError } from '../security.js'
import type { ToolDef, ToolContext } from './types.js'
import {
  calcEqualInstallment,
  ensureFixedTag,
  generateEqualInstallmentPlan,
  generateEqualPrincipalPlan,
  getNextTriggerTime,
} from '../../recurring.js'
import { resolveAccountId } from './helpers.js'
import { parseStrictDay } from '../../../lib/date-time.js'
import {
  LOAN_INTEREST_METHOD_LABELS,
  LOAN_INTEREST_METHODS,
  RECORD_TYPES,
  RECURRING_TYPES,
  RECURRING_TYPE_LABELS,
} from '@homibook/core'
import { TYPE_LABELS, type ConfirmPreview } from '../runtime/preview-format.js'
import type { PreviewScope } from '../runtime/preview-scope.js'

/** 入参枚举校验:流水类型/周期类型/还款方式非法值直接回报给模型。弹确认卡前与执行时共用 */
const validateArgs = (args: any) =>
  checkEnums({
    type: [args.type, RECORD_TYPES],
    recurringType: [args.recurringType, RECURRING_TYPES],
    loanInterestMethod: [args.loanInterestMethod, LOAN_INTEREST_METHODS],
  })

export const createRecurringTool: ToolDef = {
  name: 'create_recurring',
  displayName: '创建固定收支',
  promptHint: '需要用户确认',
  description: '创建固定收支或贷款。参数：name(名称)、type(INCOME|EXPENSE|TRANSFER)、amount(金额)、cron(触发表达式)、accountId(账户ID)、categoryCode(分类)、recurringType(PERIODIC|LOAN)、remark(备注)。贷款需额外填loanTotalAmount(贷款总额)、loanInterestRate(年利率)、loanInterestMethod(EQUAL_INSTALLMENT|EQUAL_PRINCIPAL)、loanStartDate(开始日期)、loanTermMonths(期数)。',
  parameters: {
    type: 'object',
    properties: {
      name: { type: 'string', description: '名称' },
      type: { type: 'string', enum: [...RECORD_TYPES], description: '交易类型' },
      amount: { type: 'number', description: '金额（贷款类型可省略，自动计算）' },
      cron: { type: 'string', description: 'Cron 表达式，如 "0 9 1 * *" 表示每月1号9点' },
      accountId: { type: 'string', description: '账户 ID 或账号' },
      toAccountId: { type: 'string', description: '目标账户 ID（转账必填）' },
      categoryCode: { type: 'string', description: '分类编码' },
      payer: { type: 'string', description: '交易对方' },
      remark: { type: 'string', description: '备注' },
      tags: { type: 'array', items: { type: 'string' }, description: '标签' },
      recurringType: { type: 'string', enum: [...RECURRING_TYPES], description: '周期类型' },
      active: { type: 'boolean', description: '是否启用' },
      loanTotalAmount: { type: 'number', description: '贷款总额' },
      loanInterestRate: { type: 'number', description: '贷款年利率百分数：4.2 表示 4.2%，0.042 表示 0.042%（注意别把 4.2% 写成 0.042）' },
      loanInterestMethod: { type: 'string', enum: [...LOAN_INTEREST_METHODS], description: '还款方式' },
      loanStartDate: { type: 'string', description: '贷款开始日期 YYYY-MM-DD' },
      loanTermMonths: { type: 'number', description: '贷款期数（月）' },
    },
    required: ['name', 'type', 'cron', 'accountId', 'recurringType'],
  },
  requireConfirm: true,
  validateArgs,

  /** 确认卡：贷款类把「月供 / 总额 / 期数」压在一行，避免与普通固定收支混淆 */
  async confirmation(args: any, _ctx: ToolContext, scope: PreviewScope): Promise<string> {
    const accountIds: string[] = [args.accountId, args.toAccountId].filter(Boolean)
    const [categoryMap, accountMap] = await Promise.all([
      args.categoryCode ? scope.categoryLabels([args.categoryCode]) : Promise.resolve(new Map<string, string>()),
      scope.accountNames(accountIds),
    ])

    const isLoan = args.recurringType === 'LOAN'
    const fields: { label: string; value: string }[] = [
      { label: '名称', value: args.name || '-' },
      { label: '类型', value: TYPE_LABELS[args.type] || args.type },
      {
        label: '金额',
        value: isLoan
          ? `月供 ${(args.amount ?? 0).toFixed(2)}（贷款总额 ${(args.loanTotalAmount ?? 0).toFixed(2)}，${args.loanTermMonths ?? '?'} 期）`
          : (args.amount ?? 0).toFixed(2),
      },
      { label: '账户', value: accountMap.get(args.accountId) || args.accountId || '-' },
    ]
    if (args.type === 'TRANSFER') {
      fields.push({ label: '目标账户', value: accountMap.get(args.toAccountId) || args.toAccountId || '-' })
    }
    if (args.categoryCode) {
      fields.push({ label: '分类', value: categoryMap.get(args.categoryCode) || args.categoryCode })
    }
    fields.push({ label: '触发规则', value: args.cron || '-' })
    fields.push({ label: '周期类型', value: isLoan ? RECURRING_TYPE_LABELS.LOAN : RECURRING_TYPE_LABELS.PERIODIC })
    if (isLoan && args.loanInterestMethod) {
      fields.push({
        label: '还款方式',
        value: args.loanInterestMethod === 'EQUAL_PRINCIPAL'
          ? LOAN_INTEREST_METHOD_LABELS.EQUAL_PRINCIPAL
          : LOAN_INTEREST_METHOD_LABELS.EQUAL_INSTALLMENT,
      })
    }
    if (args.payer) fields.push({ label: '交易方', value: args.payer })
    if (args.remark) fields.push({ label: '备注', value: args.remark })

    const preview: ConfirmPreview = {
      type: 'budget-card',
      title: '确认创建固定收支',
      budgetFields: fields,
    }
    return JSON.stringify(preview)
  },

  async execute(args: any, ctx: ToolContext) {
    // 入参枚举校验(与弹确认卡前同一份规则)
    const badEnum = validateArgs(args)
    if (badEnum) throw new ToolError(badEnum.error ?? '参数非法', badEnum.retryable)

    if (!['INCOME', 'EXPENSE', 'TRANSFER'].includes(args.type)) {
      throw new ToolError('无效的交易类型', false)
    }
    if (args.type === 'TRANSFER' && !args.toAccountId) {
      throw new ToolError('转账类型需要填写目标账户', false)
    }
    // 贷款起算日：严格校验，非法日期会让整张还款计划的 dueDate 进位或变成 NaN
    let loanStart: Date | null = null
    if (args.recurringType === 'LOAN') {
      // 用 == null 判定而不是真值：利率 0（无息）是合法输入
      if (args.loanTotalAmount == null || args.loanInterestRate == null || args.loanTermMonths == null || !args.loanStartDate) {
        throw new ToolError('贷款类型需填写贷款总额、利率、期数、开始日期', false)
      }
      if (!(args.loanTotalAmount > 0)) throw new ToolError('贷款总额必须大于 0', false)
      if (!(args.loanInterestRate >= 0)) throw new ToolError('年利率不能为负数（0 表示无息贷款）', false)

      if (!Number.isInteger(args.loanTermMonths) || args.loanTermMonths <= 0) {
        throw new ToolError('贷款期数必须是正整数（单位：月）', false)
      }
      loanStart = parseStrictDay(args.loanStartDate)
      if (!loanStart) {
        throw new ToolError(`贷款开始日期不存在或格式错误：${args.loanStartDate}（应为 YYYY-MM-DD）`, false)
      }
    }

    const resolvedAccountId = await resolveAccountId(args.accountId, ctx.accountBookId)
    if (!resolvedAccountId) {
      throw new ToolError(`账户不存在: ${args.accountId}`, false)
    }
    let resolvedToAccountId: string | null = null
    if (args.toAccountId) {
      resolvedToAccountId = await resolveAccountId(args.toAccountId, ctx.accountBookId)
      if (!resolvedToAccountId) {
        throw new ToolError(`目标账户不存在: ${args.toAccountId}`, false)
      }
    }

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
        loanStartDate: loanStart,
        loanTermMonths: args.loanTermMonths,
        loanMonthlyPayment: args.recurringType === 'LOAN' ? monthlyPayment : null,
        nextGenerateAt: nextGenerate,
      },
    })

    if (args.recurringType === 'LOAN') {
      const startDate = loanStart as Date
      const plan = args.loanInterestMethod === 'EQUAL_PRINCIPAL'
        ? generateEqualPrincipalPlan(args.loanTotalAmount, args.loanInterestRate, args.loanTermMonths, startDate)
        : generateEqualInstallmentPlan(args.loanTotalAmount, args.loanInterestRate, args.loanTermMonths, startDate)

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
  },
}

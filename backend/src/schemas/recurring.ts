import { z } from 'zod'

const RECURRING_TYPES = ['PERIODIC', 'LOAN'] as const
const INTEREST_METHODS = ['EQUAL_INSTALLMENT', 'EQUAL_PRINCIPAL'] as const

export const createRecurringSchema = z.object({
  accountBookId: z.string().min(1),
  name: z.string().min(1, '请输入名称'),
  type: z.enum(['INCOME', 'EXPENSE', 'TRANSFER']),
  amount: z.number().min(0),
  remark: z.string().optional(),
  tags: z.array(z.string()).optional(),
  accountId: z.string().min(1),
  toAccountId: z.string().optional(),
  categoryCode: z.string().optional(),
  payer: z.string().optional(),
  ownerId: z.string().optional(),

  cron: z.string().min(1, '请设置触发时间'),
  active: z.boolean().default(true),
  recurringType: z.enum(RECURRING_TYPES),

  // 贷款字段
  loanTotalAmount: z.number().positive().optional(),
  loanInterestRate: z.number().min(0).optional(),
  loanInterestMethod: z.enum(INTEREST_METHODS).optional(),
  loanStartDate: z.string().optional(),
  loanTermMonths: z.number().int().min(1).max(360).optional(),

  // 全部生成（贷款类型专用）
  generateAll: z.boolean().optional().default(true),
}).superRefine((data, ctx) => {
  if (data.type === 'TRANSFER' && !data.toAccountId) {
    ctx.addIssue({ code: 'custom', message: '转账类型需要选择目标账户', path: ['toAccountId'] })
  }
  if (data.recurringType === 'LOAN') {
    if (!data.loanTotalAmount || !data.loanInterestMethod ||
      !data.loanStartDate || !data.loanTermMonths || data.loanInterestRate === undefined) {
      ctx.addIssue({ code: 'custom', message: '贷款类型需要填写贷款详情' })
    }
  } else {
    if (data.amount <= 0) {
      ctx.addIssue({ code: 'custom', message: '金额必须大于0', path: ['amount'] })
    }
  }
})

export const updateRecurringSchema = z.object({
  name: z.string().optional(),
  type: z.enum(['INCOME', 'EXPENSE', 'TRANSFER']).optional(),
  amount: z.number().min(0).optional(),
  remark: z.string().nullable().optional(),
  tags: z.array(z.string()).optional(),
  accountId: z.string().optional(),
  toAccountId: z.string().nullable().optional(),
  categoryCode: z.string().nullable().optional(),
  payer: z.string().nullable().optional(),
  ownerId: z.string().optional(),

  cron: z.string().optional(),
  active: z.boolean().optional(),

  // 贷款字段（创建后不可改类型但可调参数）
  loanInterestRate: z.number().min(0).optional(),
  loanRemark: z.string().nullable().optional(),
})

export const listRecurringSchema = z.object({
  bookId: z.string().min(1),
})

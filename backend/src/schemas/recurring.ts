import { z } from 'zod'

const RECURRING_TYPES = ['PERIODIC', 'LOAN'] as const
const INTEREST_METHODS = ['EQUAL_INSTALLMENT', 'EQUAL_PRINCIPAL'] as const

export const createRecurringSchema = z.object({
  accountBookId: z.string().min(1).describe('所属账本ID'),
  name: z.string().min(1, '请输入名称').describe('名称'),
  type: z.enum(['INCOME', 'EXPENSE', 'TRANSFER']).describe('类型'),
  amount: z.number().min(0).describe('金额'),
  remark: z.string().optional().describe('备注'),
  tags: z.array(z.string()).optional().describe('标签'),
  accountId: z.string().min(1).describe('账户ID'),
  toAccountId: z.string().optional().describe('目标账户ID（转账时必填）'),
  categoryCode: z.string().optional().describe('分类编码'),
  payer: z.string().optional().describe('交易方'),
  ownerId: z.string().optional().describe('归属人ID'),

  cron: z.string().min(1, '请设置触发时间').describe('触发时间（cron表达式）'),
  active: z.boolean().default(true).describe('是否启用'),
  recurringType: z.enum(RECURRING_TYPES).describe('周期类型'),

  // 贷款字段
  loanTotalAmount: z.number().positive().optional().describe('贷款总额'),
  loanInterestRate: z.number().min(0).optional().describe('贷款利率'),
  loanInterestMethod: z.enum(INTEREST_METHODS).optional().describe('贷款计息方式'),
  loanStartDate: z.string().optional().describe('贷款开始日期'),
  loanTermMonths: z.number().int().min(1).max(360).optional().describe('贷款期数（月）'),

  // 全部生成（贷款类型专用）
  generateAll: z.boolean().optional().default(true).describe('是否一次性生成全部还款期数'),
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
  name: z.string().optional().describe('名称'),
  type: z.enum(['INCOME', 'EXPENSE', 'TRANSFER']).optional().describe('类型'),
  amount: z.number().min(0).optional().describe('金额'),
  remark: z.string().nullable().optional().describe('备注'),
  tags: z.array(z.string()).optional().describe('标签'),
  accountId: z.string().optional().describe('账户ID'),
  toAccountId: z.string().nullable().optional().describe('目标账户ID'),
  categoryCode: z.string().nullable().optional().describe('分类编码'),
  payer: z.string().nullable().optional().describe('交易方'),
  ownerId: z.string().optional().describe('归属人ID'),

  cron: z.string().optional().describe('触发时间（cron表达式）'),
  active: z.boolean().optional().describe('是否启用'),

  // 贷款字段（创建后不可改类型但可调参数）
  loanInterestRate: z.number().min(0).optional().describe('贷款利率'),
  loanRemark: z.string().nullable().optional().describe('贷款备注'),
})

export const listRecurringSchema = z.object({
  bookId: z.string().min(1).describe('账本ID'),
})

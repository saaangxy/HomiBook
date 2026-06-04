import { z } from 'zod'

export const ACCOUNT_TYPES = [
  'BANK_DEBIT',     // 银行卡(借记)
  'CREDIT_CARD',    // 信用卡
  'ALIPAY',         // 支付宝
  'WECHAT',         // 微信
  'CASH',           // 现金
  'RECHARGE_CARD',  // 充值卡
  'INVESTMENT',     // 投资账户
  'OTHER',          // 其他
] as const

export type AccountType = typeof ACCOUNT_TYPES[number]

export const ACCOUNT_TYPE_LABELS: Record<AccountType, string> = {
  BANK_DEBIT: '借记卡',
  CREDIT_CARD: '信用卡',
  ALIPAY: '支付宝',
  WECHAT: '微信',
  CASH: '现金',
  RECHARGE_CARD: '充值卡',
  INVESTMENT: '投资账户',
  OTHER: '其他',
}

export const createAccountSchema = z.object({
  accountBookId: z.string().min(1),
  name: z.string().min(1, '账户名称不能为空').max(30),
  type: z.string().min(1, '账户类型不能为空'),
  currency: z.string().default('CNY'),
  initialBalance: z.number().default(0),
  accountNo: z.string().optional(),
  bankName: z.string().optional(),
  visibility: z.enum(['PUBLIC', 'PRIVATE']).default('PUBLIC'),
})

export const updateAccountSchema = z.object({
  name: z.string().min(1).max(30).optional(),
  type: z.string().min(1).optional(),
  visibility: z.enum(['PUBLIC', 'PRIVATE']).optional(),
  status: z.enum(['ACTIVE', 'ARCHIVED']).optional(),
  accountNo: z.string().optional(),
  bankName: z.string().optional(),
})

export const createAdjustmentSchema = z.object({
  date: z.string().refine((v) => !isNaN(Date.parse(v)), { message: '无效的日期' }),
  balanceAfter: z.number(),
  remark: z.string().optional(),
})

export const balanceHistorySchema = z.object({
  bookId: z.string().min(1),
  accountIds: z.string().optional(),
  granularity: z.enum(['daily', 'monthly']).default('daily'),
  dateFrom: z.string(),
  dateTo: z.string(),
})

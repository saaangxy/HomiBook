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
  accountBookId: z.string().min(1).describe('所属账本ID'),
  name: z.string().min(1, '账户名称不能为空').max(30).describe('账户名称'),
  type: z.string().min(1, '账户类型不能为空').describe('账户类型'),
  currency: z.string().default('CNY').describe('货币代码'),
  initialBalance: z.number().default(0).describe('初始余额'),
  accountNo: z.string().optional().describe('账号'),
  bankName: z.string().optional().describe('银行名称'),
  visibility: z.enum(['PUBLIC', 'PRIVATE']).default('PUBLIC').describe('可见性'),
})

export const updateAccountSchema = z.object({
  name: z.string().min(1).max(30).optional().describe('账户名称'),
  type: z.string().min(1).optional().describe('账户类型'),
  visibility: z.enum(['PUBLIC', 'PRIVATE']).optional().describe('可见性'),
  status: z.enum(['ACTIVE', 'ARCHIVED']).optional().describe('状态'),
  accountNo: z.string().optional().describe('账号'),
  bankName: z.string().optional().describe('银行名称'),
})

export const createAdjustmentSchema = z.object({
  date: z.string().refine((v) => !isNaN(Date.parse(v)), { message: '无效的日期' }).describe('调整日期'),
  balanceAfter: z.number().describe('调整后余额'),
  remark: z.string().optional().describe('备注'),
})

export const balanceHistorySchema = z.object({
  bookId: z.string().min(1).describe('账本ID'),
  accountIds: z.string().optional().describe('账户ID列表，逗号分隔'),
  granularity: z.enum(['daily', 'monthly']).default('daily').describe('粒度'),
  dateFrom: z.string().describe('开始日期'),
  dateTo: z.string().describe('结束日期'),
})

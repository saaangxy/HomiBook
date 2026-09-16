import { z } from 'zod'
// 账户值域与标签单一来源 @homibook/core(此前此处各存一份 as const,与 core 漂移)
import { ACCOUNT_STATUSES, ACCOUNT_TYPES, ACCOUNT_VISIBILITIES } from '@homibook/core'

export const createAccountSchema = z.object({
  accountBookId: z.string().min(1).describe('所属账本ID'),
  name: z.string().min(1, '账户名称不能为空').max(30).describe('账户名称'),
  type: z.enum(ACCOUNT_TYPES).describe('账户类型'),
  currency: z.string().default('CNY').describe('货币代码'),
  initialBalance: z.number().default(0).describe('初始余额'),
  accountNo: z.string().optional().describe('账号'),
  bankName: z.string().optional().describe('银行名称'),
  visibility: z.enum(ACCOUNT_VISIBILITIES).default('PUBLIC').describe('可见性'),
})

export const updateAccountSchema = z.object({
  name: z.string().min(1).max(30).optional().describe('账户名称'),
  type: z.enum(ACCOUNT_TYPES).optional().describe('账户类型'),
  visibility: z.enum(ACCOUNT_VISIBILITIES).optional().describe('可见性'),
  status: z.enum(ACCOUNT_STATUSES).optional().describe('状态'),
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
  ownerId: z.string().optional().describe('按归属人过滤，不传为全部'),
  granularity: z.enum(['daily', 'monthly']).default('daily').describe('粒度'),
  dateFrom: z.string().describe('开始日期'),
  dateTo: z.string().describe('结束日期'),
})

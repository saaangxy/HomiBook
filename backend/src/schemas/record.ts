import { z } from 'zod'

export const RECORD_TYPES = ['INCOME', 'EXPENSE', 'TRANSFER'] as const
export type RecordType = typeof RECORD_TYPES[number]

export const createRecordSchema = z.object({
  accountBookId: z.string().min(1).describe('账本ID'),
  type: z.enum(RECORD_TYPES).describe('流水类型：INCOME=收入, EXPENSE=支出, TRANSFER=转账'),
  amount: z.number().positive('金额必须大于0').describe('金额'),
  date: z.string().refine((v) => !isNaN(Date.parse(v)), { message: '无效的日期' }).describe('日期，格式 YYYY-MM-DD'),
  remark: z.string().optional().describe('备注'),
  tags: z.array(z.string()).optional().describe('标签列表'),
  attachmentIds: z.array(z.string()).optional().describe('附件ID列表'),
  accountId: z.string().min(1).describe('账户ID'),
  fromAccountId: z.string().optional().describe('转账来源账户ID'),
  toAccountId: z.string().optional().describe('转账目标账户ID'),
  categoryCode: z.string().optional().describe('分类编码'),
  payer: z.string().optional().describe('交易对方'),
  ownerId: z.string().optional().describe('归属人ID，默认当前用户'),
})

export const updateRecordSchema = z.object({
  type: z.enum(RECORD_TYPES).optional().describe('流水类型'),
  amount: z.number().positive('金额必须大于0').optional().describe('金额'),
  date: z.string().refine((v) => !isNaN(Date.parse(v)), { message: '无效的日期' }).optional().describe('日期'),
  remark: z.string().nullable().optional().describe('备注'),
  tags: z.array(z.string()).optional().describe('标签列表'),
  attachmentIds: z.array(z.string()).optional().describe('替换全部附件ID（传入则删除旧附件，关联新附件）'),
  accountId: z.string().min(1).optional().describe('账户ID'),
  fromAccountId: z.string().optional().describe('转账来源账户ID'),
  toAccountId: z.string().optional().describe('转账目标账户ID'),
  categoryCode: z.string().nullable().optional().describe('分类编码'),
  payer: z.string().nullable().optional().describe('交易对方'),
  ownerId: z.string().nullable().optional().describe('归属人ID'),
})

export const listRecordsSchema = z.object({
  bookId: z.string().min(1).describe('账本ID'),
  page: z.coerce.number().int().min(1).default(1).describe('页码，从1开始'),
  pageSize: z.coerce.number().int().min(1).max(100).default(20).describe('每页条数，最大100'),
  type: z.string().optional().describe('流水类型，逗号分隔多选，如 INCOME,EXPENSE'),
  accountId: z.string().optional().describe('账户ID，逗号分隔多选'),
  categoryCode: z.string().optional().describe('分类编码，逗号分隔多选'),
  dateFrom: z.string().optional().describe('开始日期 YYYY-MM-DD'),
  dateTo: z.string().optional().describe('结束日期 YYYY-MM-DD'),
  ownerId: z.string().optional().describe('归属人ID，逗号分隔多选'),
  payer: z.string().optional().describe('交易对方，模糊匹配'),
  amountFrom: z.coerce.number().optional().describe('金额下限'),
  amountTo: z.coerce.number().optional().describe('金额上限'),
  remark: z.string().optional().describe('备注，模糊匹配'),
  tags: z.string().optional().describe('标签，逗号分隔多选'),
})

export const calendarQuerySchema = z.object({
  bookId: z.string().min(1).describe('账本ID'),
  year: z.coerce.number().int().describe('年份'),
  month: z.coerce.number().int().min(1).max(12).describe('月份 1-12'),
})

export const categorySummarySchema = z.object({
  bookId: z.string().min(1).describe('账本ID'),
  type: z.string().optional().describe('流水类型，逗号分隔多选'),
  accountId: z.string().optional().describe('账户ID，逗号分隔多选'),
  categoryCode: z.string().optional().describe('分类编码，逗号分隔多选'),
  dateFrom: z.string().optional().describe('开始日期'),
  dateTo: z.string().optional().describe('结束日期'),
  ownerId: z.string().optional().describe('归属人ID'),
  payer: z.string().optional().describe('交易对方'),
  amountFrom: z.coerce.number().optional().describe('金额下限'),
  amountTo: z.coerce.number().optional().describe('金额上限'),
  remark: z.string().optional().describe('备注'),
  tags: z.string().optional().describe('标签，逗号分隔'),
})

export const monthlyTrendSchema = z.object({
  bookId: z.string().min(1).describe('账本ID'),
  dateFrom: z.string().optional().describe('开始日期'),
  dateTo: z.string().optional().describe('结束日期'),
  accountId: z.string().optional().describe('账户ID，逗号分隔多选'),
  categoryCode: z.string().optional().describe('分类编码，逗号分隔多选'),
  ownerId: z.string().optional().describe('归属人ID'),
  tags: z.string().optional().describe('标签，逗号分隔'),
})

export const categoryTrendSchema = z.object({
  bookId: z.string().min(1).describe('账本ID'),
  type: z.string().default('EXPENSE').describe('流水类型'),
  granularity: z.enum(['monthly', 'daily']).describe('时间粒度：monthly=按月, daily=按日'),
  year: z.coerce.number().int().optional().describe('年份'),
  month: z.coerce.number().int().min(1).max(12).optional().describe('月份'),
  dateFrom: z.string().optional().describe('开始日期'),
  dateTo: z.string().optional().describe('结束日期'),
  accountId: z.string().optional().describe('账户ID'),
  ownerId: z.string().optional().describe('归属人ID'),
  tags: z.string().optional().describe('标签，逗号分隔'),
})

export const groupSummarySchema = z.object({
  bookId: z.string().min(1).describe('账本ID'),
  type: z.string().min(1).describe('流水类型'),
  groupBy: z.enum(['category', 'ownerId', 'accountId']).describe('分组维度：category=分类, ownerId=归属人, accountId=账户'),
  dateFrom: z.string().optional().describe('开始日期'),
  dateTo: z.string().optional().describe('结束日期'),
  accountId: z.string().optional().describe('账户ID'),
  ownerId: z.string().optional().describe('归属人ID'),
  categoryCode: z.string().optional().describe('分类编码'),
  tags: z.string().optional().describe('标签，逗号分隔'),
})
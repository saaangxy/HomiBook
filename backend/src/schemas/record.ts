import { z } from 'zod'

export const RECORD_TYPES = ['INCOME', 'EXPENSE', 'TRANSFER'] as const
export type RecordType = typeof RECORD_TYPES[number]

export const createRecordSchema = z.object({
  accountBookId: z.string().min(1),
  type: z.enum(RECORD_TYPES),
  amount: z.number().positive('金额必须大于0'),
  date: z.string().refine((v) => !isNaN(Date.parse(v)), { message: '无效的日期' }),
  remark: z.string().optional(),
  tags: z.array(z.string()).optional(),
  attachmentIds: z.array(z.string()).optional(),
  accountId: z.string().min(1),
  fromAccountId: z.string().optional(),
  toAccountId: z.string().optional(),
  categoryCode: z.string().optional(),
  payer: z.string().optional(),
  ownerId: z.string().optional(),
})

export const updateRecordSchema = z.object({
  type: z.enum(RECORD_TYPES).optional(),
  amount: z.number().positive('金额必须大于0').optional(),
  date: z.string().refine((v) => !isNaN(Date.parse(v)), { message: '无效的日期' }).optional(),
  remark: z.string().nullable().optional(),
  tags: z.array(z.string()).optional(),
  attachmentIds: z.array(z.string()).optional(),
  accountId: z.string().min(1).optional(),
  fromAccountId: z.string().optional(),
  toAccountId: z.string().optional(),
  categoryCode: z.string().nullable().optional(),
  payer: z.string().nullable().optional(),
  ownerId: z.string().optional(),
})

export const listRecordsSchema = z.object({
  bookId: z.string().min(1),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  type: z.string().optional(),   // 逗号分隔多选，如 "INCOME,EXPENSE"
  accountId: z.string().optional(),   // 逗号分隔多选
  categoryCode: z.string().optional(), // 逗号分隔多选
  dateFrom: z.string().optional(),
  dateTo: z.string().optional(),
  ownerId: z.string().optional(),     // 逗号分隔多选
  payer: z.string().optional(),
  amountFrom: z.coerce.number().optional(),
  amountTo: z.coerce.number().optional(),
  remark: z.string().optional(),
  tags: z.string().optional(),     // 逗号分隔多选
})

export const calendarQuerySchema = z.object({
  bookId: z.string().min(1),
  year: z.coerce.number().int(),
  month: z.coerce.number().int().min(1).max(12),
})

export const categorySummarySchema = z.object({
  bookId: z.string().min(1),
  type: z.string().optional(),
  accountId: z.string().optional(),
  categoryCode: z.string().optional(),
  dateFrom: z.string().optional(),
  dateTo: z.string().optional(),
  ownerId: z.string().optional(),
  payer: z.string().optional(),
  amountFrom: z.coerce.number().optional(),
  amountTo: z.coerce.number().optional(),
  remark: z.string().optional(),
  tags: z.string().optional(),
})

export const monthlyTrendSchema = z.object({
  bookId: z.string().min(1),
  dateFrom: z.string().optional(),
  dateTo: z.string().optional(),
  accountId: z.string().optional(),
  categoryCode: z.string().optional(),
  ownerId: z.string().optional(),
  tags: z.string().optional(),
})

export const categoryTrendSchema = z.object({
  bookId: z.string().min(1),
  type: z.string().default('EXPENSE'),
  granularity: z.enum(['monthly', 'daily']),
  year: z.coerce.number().int().optional(),
  month: z.coerce.number().int().min(1).max(12).optional(),
  dateFrom: z.string().optional(),
  dateTo: z.string().optional(),
  accountId: z.string().optional(),
  ownerId: z.string().optional(),
  tags: z.string().optional(),
})

export const groupSummarySchema = z.object({
  bookId: z.string().min(1),
  type: z.string().min(1),
  groupBy: z.enum(['category', 'ownerId', 'accountId']),
  dateFrom: z.string().optional(),
  dateTo: z.string().optional(),
  accountId: z.string().optional(),
  ownerId: z.string().optional(),
  categoryCode: z.string().optional(),
  tags: z.string().optional(),
})
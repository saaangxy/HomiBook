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
  attachments: z.array(z.string()).optional(),
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
  remark: z.string().optional(),
  tags: z.array(z.string()).optional(),
  attachments: z.array(z.string()).optional(),
  accountId: z.string().min(1).optional(),
  fromAccountId: z.string().optional(),
  toAccountId: z.string().optional(),
  categoryCode: z.string().optional(),
  payer: z.string().optional(),
  ownerId: z.string().optional(),
})

export const listRecordsSchema = z.object({
  bookId: z.string().min(1),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  type: z.enum(RECORD_TYPES).optional(),
  accountId: z.string().optional(),
  categoryCode: z.string().optional(),
  dateFrom: z.string().optional(),
  dateTo: z.string().optional(),
  ownerId: z.string().optional(),
  keyword: z.string().optional(),
  payer: z.string().optional(),
})
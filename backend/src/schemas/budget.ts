import { z } from 'zod'

export const BUDGET_TYPES = ['FIXED', 'FREE'] as const
export type BudgetType = typeof BUDGET_TYPES[number]

export const createBudgetSchema = z.object({
  accountBookId: z.string().min(1),
  name: z.string().min(1, '预算名称不能为空').max(30),
  type: z.enum(BUDGET_TYPES),
  year: z.number().int().min(2000).max(2100),
  month: z.number().int().min(0).max(12),
  amount: z.number().positive('金额必须大于0'),
  categoryCode: z.string().optional(),
  tags: z.array(z.string()).optional(),
  startDate: z.string().optional(),
  endDate: z.string().optional(),
  remark: z.string().optional(),
})

export const updateBudgetSchema = z.object({
  name: z.string().min(1).max(30).optional(),
  amount: z.number().positive('金额必须大于0').optional(),
  categoryCode: z.string().nullable().optional(),
  tags: z.array(z.string()).optional(),
  startDate: z.string().nullable().optional(),
  endDate: z.string().nullable().optional(),
  remark: z.string().nullable().optional(),
})

export const batchCreateSchema = z.object({
  accountBookId: z.string().min(1),
  name: z.string().min(1).max(30),
  type: z.enum(BUDGET_TYPES),
  amount: z.number().positive('金额必须大于0'),
  categoryCode: z.string().optional(),
  tags: z.array(z.string()).optional(),
  months: z.array(z.number().int().min(0).max(12)).min(1),
  year: z.number().int().min(2000).max(2100),
  startDate: z.string().optional(),
  endDate: z.string().optional(),
  remark: z.string().optional(),
})

export const copyBudgetsSchema = z.object({
  accountBookId: z.string().min(1),
  sourceYear: z.number().int(),
  sourceMonth: z.number().int().min(1).max(12),
  targetMonths: z.array(z.object({
    year: z.number().int(),
    month: z.number().int().min(0).max(12),
  })).min(1),
})

export const batchUpdateBudgetSchema = z.object({
  ids: z.array(z.string().min(1)).min(1, '请选择要更新的预算'),
  data: z.object({
    amount: z.number().positive('金额必须大于0').optional(),
    categoryCode: z.string().nullable().optional(),
    tags: z.array(z.string()).optional(),
    startDate: z.string().nullable().optional(),
    endDate: z.string().nullable().optional(),
    remark: z.string().nullable().optional(),
  }),
})

export const listBudgetsQuerySchema = z.object({
  bookId: z.string().min(1),
  year: z.coerce.number().int().optional(),
  month: z.coerce.number().int().min(1).max(12).optional(),
  type: z.enum(BUDGET_TYPES).optional(),
})

// 固定预算列表查询
export const fixedBudgetsQuerySchema = z.object({
  bookId: z.string().min(1),
  year: z.coerce.number().int().optional(),
  month: z.coerce.number().int().min(1).max(12).optional(),
  name: z.string().optional(),
})

// 自由预算列表查询
export const freeBudgetsQuerySchema = z.object({
  bookId: z.string().min(1),
  startDate: z.string().optional(),
  endDate: z.string().optional(),
  name: z.string().optional(),
})


import { z } from 'zod'

export const BUDGET_TYPES = ['FIXED', 'FREE'] as const
export type BudgetType = typeof BUDGET_TYPES[number]

export const createBudgetSchema = z.object({
  accountBookId: z.string().min(1).describe('账本ID'),
  name: z.string().min(1, '预算名称不能为空').max(30).describe('预算名称'),
  type: z.enum(BUDGET_TYPES).describe('预算类型：FIXED=月度固定预算, FREE=自由预算'),
  year: z.number().int().min(2000).max(2100).describe('年份'),
  month: z.number().int().min(0).max(12).describe('月份，0=全年'),
  amount: z.number().positive('金额必须大于0').describe('预算金额'),
  categoryCode: z.string().optional().describe('关联分类编码'),
  tags: z.array(z.string()).optional().describe('标签列表（用于自由预算匹配记录）'),
  startDate: z.string().optional().describe('开始日期（自由预算）'),
  endDate: z.string().optional().describe('结束日期（自由预算）'),
  remark: z.string().optional().describe('备注'),
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
  bookId: z.string().min(1).describe('账本ID'),
  year: z.coerce.number().int().optional().describe('年份'),
  month: z.coerce.number().int().min(1).max(12).optional().describe('月份'),
  type: z.enum(BUDGET_TYPES).optional().describe('预算类型'),
})

// 固定预算列表查询
export const fixedBudgetsQuerySchema = z.object({
  bookId: z.string().min(1).describe('账本ID'),
  year: z.coerce.number().int().optional().describe('年份'),
  month: z.coerce.number().int().min(1).max(12).optional().describe('月份'),
  name: z.string().optional().describe('预算名称，模糊匹配'),
})

// 自由预算列表查询
export const freeBudgetsQuerySchema = z.object({
  bookId: z.string().min(1).describe('账本ID'),
  startDate: z.string().optional().describe('查询开始日期'),
  endDate: z.string().optional().describe('查询结束日期'),
  name: z.string().optional().describe('预算名称，模糊匹配'),
})


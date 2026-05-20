import { z } from 'zod'

export const updateConfigSchema = z.object({
  registrationOpen: z.boolean().optional(),
  defaultCurrency: z.string().optional(),
})

export const createDictionarySchema = z.object({
  group: z.string().min(1, '分组不能为空'),
  code: z.string().min(1, '编码不能为空'),
  label: z.string().min(1, '名称不能为空'),
  order: z.number().int().optional().default(0),
})

export const updateDictionarySchema = z.object({
  code: z.string().min(1).optional(),
  label: z.string().min(1).optional(),
  order: z.number().int().optional(),
})
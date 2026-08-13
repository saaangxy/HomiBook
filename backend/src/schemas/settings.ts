import { z } from 'zod'

export const updateConfigSchema = z.object({
  registrationOpen: z.boolean().optional().describe('是否开放注册'),
  defaultCurrency: z.string().optional().describe('默认货币'),
  amountHighlightThreshold: z.number().optional().describe('金额高亮阈值'),
  holidayApiUrl: z.string().optional().describe('节假日API地址'),
  defaultTheme: z.string().optional().describe('默认主题'),
  jwtExpiresIn: z.enum(['1d', '7d', '30d']).optional().describe('JWT过期时间'),
})

export const createDictionarySchema = z.object({
  group: z.string().min(1, '分组不能为空').describe('字典分组'),
  code: z.string().min(1, '编码不能为空').describe('字典编码'),
  label: z.string().min(1, '名称不能为空').describe('字典名称'),
  order: z.number().int().optional().default(0).describe('排序'),
})

export const updateDictionarySchema = z.object({
  code: z.string().min(1).optional().describe('字典编码'),
  label: z.string().min(1).optional().describe('字典名称'),
  order: z.number().int().optional().describe('排序'),
})
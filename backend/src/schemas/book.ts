import { z } from 'zod'

export const createBookSchema = z.object({
  name: z.string().min(1, '账本名称不能为空').max(50, '账本名称不能超过50个字符').describe('账本名称'),
})

export const updateBookSchema = z.object({
  name: z.string().min(1).max(50).optional().describe('账本名称'),
})

export const generateShareCodeSchema = z.object({
  expiresInHours: z.number().int().min(1).max(720).optional().describe('过期时间（小时）'),
})

export const joinByCodeSchema = z.object({
  code: z.string().min(1, '请输入分享码').describe('分享码'),
})

export const addMemberSchema = z.object({
  email: z.string().email('请输入有效的邮箱地址').describe('成员邮箱'),
})

export const updateMemberRoleSchema = z.object({
  role: z.enum(['member', 'admin']).describe('成员角色'),
})

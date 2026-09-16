import { z } from 'zod'
// 角色值域单一来源 @homibook/core(owner 不可指派,故只用可授予集合)
import { ASSIGNABLE_BOOK_ROLES } from '@homibook/core'

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
  role: z.enum(ASSIGNABLE_BOOK_ROLES).describe('成员角色'),
})

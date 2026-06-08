import { z } from 'zod'

// 注册
export const registerSchema = z.object({
  email: z.string().email(),
  password: z
    .string()
    .min(8, '密码至少8位')
    .regex(/[a-z]/, '密码需包含小写字母')
    .regex(/[A-Z]/, '密码需包含大写字母')
    .regex(/[0-9]/, '密码需包含数字'),
  name: z.string().optional(),
})

// 登录
export const loginSchema = z.object({
  email: z.string().email(),
  password: z.string(),
})
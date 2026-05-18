import { z } from 'zod'

// 注册
export const registerSchema = z.object({
  email: z.string().email(),
  password: z.string().min(6),
  name: z.string().optional(),
})

// 登录
export const loginSchema = z.object({
  email: z.string().email(),
  password: z.string(),
})
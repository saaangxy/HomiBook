import { z } from 'zod'
import { zodToJsonSchema } from 'zod-to-json-schema'

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

// 响应
export const authResponseSchema = z.object({
  token: z.string(),
  user: z.object({
    id: z.string(),
    email: z.string(),
    name: z.string().nullable(),
  }),
})

export const registerJsonSchema = zodToJsonSchema(registerSchema)
export const loginJsonSchema = zodToJsonSchema(loginSchema)
export const authResponseJsonSchema = zodToJsonSchema(authResponseSchema)
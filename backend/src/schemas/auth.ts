import { z } from 'zod'

// 注册
export const registerSchema = z.object({
  username: z.string().min(3, '账号至少3位').max(30, '账号最多30位').regex(/^[a-zA-Z0-9_]+$/, '账号只能包含字母、数字和下划线'),
  email: z.string().email(),
  password: z
    .string()
    .min(8, '密码至少8位')
    .regex(/[a-z]/, '密码需包含小写字母')
    .regex(/[A-Z]/, '密码需包含大写字母')
    .regex(/[0-9]/, '密码需包含数字'),
  nickname: z.string().optional(),
})

// 登录（account 支持用户名或邮箱）
export const loginSchema = z.object({
  account: z.string().min(1, '请输入账号或邮箱'),
  password: z.string(),
})
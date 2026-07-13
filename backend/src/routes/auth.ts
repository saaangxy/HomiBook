import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import bcrypt from 'bcryptjs'
import { authService } from '../services/auth.js'
import { registerSchema, loginSchema } from '../schemas/auth.js'
import { zSchema } from '../lib/schema-helpers.js'
import { authenticate } from '../middleware/auth.js'

const updateProfileSchema = z.object({
  nickname: z.string().min(1).max(30).optional(),
  theme: z.string().optional(),
})

const changePasswordSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: z
    .string()
    .min(8, '密码至少8位')
    .regex(/[a-z]/, '密码需包含小写字母')
    .regex(/[A-Z]/, '密码需包含大写字母')
    .regex(/[0-9]/, '密码需包含数字'),
})

export async function authRoutes(app: FastifyInstance) {
  // 用户注册
  app.post('/register', {
    schema: {
      description: '注册新用户账号',
      tags: ['认证'],
      body: zSchema(registerSchema),
    },
  }, async (req, reply) => {
    const parsed = registerSchema.safeParse(req.body)
    if (!parsed.success) {
      return reply.status(400).send({ message: '请求参数无效' })
    }

    const { username, email, password, nickname } = parsed.data
    const user = await authService.register(username, email, password, nickname)

    return {
      id: user.id,
      username: user.username,
      email: user.email,
      nickname: user.nickname,
      role: user.role,
    }
  })

  // 用户登录
  app.post('/login', {
    schema: {
      description: '用户登录，返回 JWT token',
      tags: ['认证'],
      body: zSchema(loginSchema),
    },
  }, async (req, reply) => {
    const parsed = loginSchema.safeParse(req.body)
    if (!parsed.success) {
      return reply.status(400).send({ message: '请求参数无效' })
    }

    const { account, password } = parsed.data

    // 支持账号或邮箱登录
    const user = await prisma.user.findFirst({
      where: { OR: [{ email: account }, { username: account }] },
    })
    if (!user) {
      return reply.status(401).send({ message: '账号或密码错误' })
    }

    // 检查账户状态
    if (user.status === 'DISABLED') {
      return reply.status(403).send({ message: '账户已被禁用' })
    }

    const valid = await authService.validatePassword(password, user.password)
    if (!valid) {
      return reply.status(401).send({ message: '账号或密码错误' })
    }

    const token = app.jwt.sign({ id: user.id, email: user.email, role: user.role })

    return {
      token,
      user: {
        id: user.id,
        username: user.username,
        email: user.email,
        nickname: user.nickname,
        role: user.role,
        theme: user.theme,
      },
    }
  })

  // 获取当前用户信息
  app.get('/me', {
    schema: {
      description: '获取当前登录用户的详细信息',
      tags: ['认证'],
    },
    config: {
      swaggerResponse: {
        200: {
          type: 'object',
          description: '当前用户信息',
          properties: {
            id: { type: 'string', description: '用户ID' },
            username: { type: 'string', description: '账号' },
            email: { type: 'string', description: '邮箱' },
            nickname: { type: 'string', description: '昵称' },
            role: { type: 'string', description: '角色' },
            theme: { type: 'string', description: '主题' },
            status: { type: 'string', description: '状态' },
            createdAt: { type: 'string', description: '创建时间' },
            updatedAt: { type: 'string', description: '更新时间' },
          },
        },
      },
    },
    onRequest: [authenticate],
  }, async (req) => {
    const payload = req.user as { id: string }
    const fullUser = await authService.getUserById(payload.id)
    if (!fullUser) {
      throw Object.assign(new Error('用户不存在'), { statusCode: 404 })
    }
    return fullUser
  })

  // 修改个人信息
  app.patch('/me', {
    schema: {
      description: '修改当前用户个人信息（名称、主题）',
      tags: ['认证'],
      body: zSchema(updateProfileSchema),
    },
    onRequest: [authenticate],
  }, async (req) => {
    const parsed = updateProfileSchema.safeParse(req.body)
    if (!parsed.success) {
      throw Object.assign(new Error(parsed.error.issues[0].message), { statusCode: 400 })
    }

    const payload = req.user as { id: string }
    const data: Record<string, string> = {}
    if (parsed.data.nickname !== undefined) data.nickname = parsed.data.nickname
    if (parsed.data.theme !== undefined) data.theme = parsed.data.theme

    const user = await prisma.user.update({
      where: { id: payload.id },
      data,
      select: { id: true, email: true, username: true, nickname: true, role: true, theme: true },
    })

    return user
  })

  // 修改密码
  app.patch('/me/password', {
    schema: {
      description: '修改当前用户密码（需验证旧密码，新密码需包含大小写字母和数字）',
      tags: ['认证'],
      body: zSchema(changePasswordSchema),
    },
    onRequest: [authenticate],
  }, async (req) => {
    const parsed = changePasswordSchema.safeParse(req.body)
    if (!parsed.success) {
      throw Object.assign(new Error(parsed.error.issues[0].message), { statusCode: 400 })
    }

    const payload = req.user as { id: string }
    const user = await prisma.user.findUnique({ where: { id: payload.id } })
    if (!user) {
      throw Object.assign(new Error('用户不存在'), { statusCode: 404 })
    }

    // 验证当前密码
    const valid = await bcrypt.compare(parsed.data.currentPassword, user.password)
    if (!valid) {
      throw Object.assign(new Error('当前密码错误'), { statusCode: 400 })
    }

    // 更新密码
    const hashedPassword = await bcrypt.hash(parsed.data.newPassword, 10)
    await prisma.user.update({
      where: { id: payload.id },
      data: { password: hashedPassword },
    })

    return { success: true }
  })
}

// 导入 prisma 用于路由中查询用户
import { prisma } from '../app.js'

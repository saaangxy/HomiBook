import type { FastifyInstance } from 'fastify'
import { authService } from '../services/auth.js'
import { registerSchema, loginSchema } from '../schemas/auth.js'
import { zSchema } from '../lib/schema-helpers.js'

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

    const { email, password, name } = parsed.data
    const user = await authService.register(email, password, name)

    return {
      id: user.id,
      email: user.email,
      name: user.name,
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

    const { email, password } = parsed.data

    const user = await prisma.user.findUnique({ where: { email } })
    if (!user) {
      return reply.status(401).send({ message: '邮箱或密码错误' })
    }

    // 检查账户状态
    if (user.status === 'DISABLED') {
      return reply.status(403).send({ message: '账户已被禁用' })
    }

    const valid = await authService.validatePassword(password, user.password)
    if (!valid) {
      return reply.status(401).send({ message: '邮箱或密码错误' })
    }

    const token = app.jwt.sign({ id: user.id, email: user.email, role: user.role })

    return {
      token,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
      },
    }
  })

  // 获取当前用户信息
  app.get('/me', {
    schema: {
      description: '获取当前登录用户的详细信息',
      tags: ['认证'],
    },
  }, async (req, reply) => {
    const user = (req as any).user
    if (!user) {
      return reply.status(401).send({ message: '未授权' })
    }

    const fullUser = await authService.getUserById(user.id)
    if (!fullUser) {
      return reply.status(404).send({ message: '用户不存在' })
    }
    return fullUser
  })
}

// 导入 prisma 用于路由中查询用户
import { prisma } from '../app.js'
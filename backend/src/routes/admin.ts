import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import bcrypt from 'bcryptjs'
import { prisma } from '../app.js'
import { authenticate, requireAdmin } from '../middleware/auth.js'
import { zSchema } from '../lib/schema-helpers.js'

const createUserSchema = z.object({
  username: z.string().min(3, '账号至少3位').max(30, '账号最多30位').regex(/^[a-zA-Z0-9_]+$/, '账号只能包含字母、数字和下划线'),
  email: z.string().email(),
  password: z.string().min(6),
  nickname: z.string().optional(),
  role: z.enum(['ADMIN', 'USER']).default('USER'),
})

const updateUserSchema = z.object({
  nickname: z.string().optional(),
  role: z.enum(['ADMIN', 'USER']).optional(),
  status: z.enum(['ACTIVE', 'DISABLED']).optional(),
})

const changePasswordSchema = z.object({
  password: z.string().min(6),
})

export async function adminRoutes(app: FastifyInstance) {
  // 所有路由都需要认证 + 管理员权限
  app.addHook('onRequest', authenticate)
  app.addHook('onRequest', requireAdmin)

  // 获取用户列表
  app.get('/users', {
    schema: {
      description: '获取所有用户列表',
      tags: ['管理'],
    },
  }, async (req, reply) => {
    const users = await prisma.user.findMany({
      select: {
        id: true,
        email: true,
        username: true,
        nickname: true,
        role: true,
        status: true,
        createdAt: true,
      },
      orderBy: { createdAt: 'desc' },
    })
    return { users }
  })

  // 创建用户
  app.post('/users', {
    schema: {
      description: '管理员创建新用户',
      tags: ['管理'],
      body: zSchema(createUserSchema),
    },
  }, async (req, reply) => {
    const parsed = createUserSchema.safeParse(req.body)
    if (!parsed.success) {
      return reply.status(400).send({ message: '请求参数无效' })
    }

    const { username, email, password, nickname, role } = parsed.data

    const existingEmail = await prisma.user.findUnique({ where: { email } })
    if (existingEmail) {
      return reply.status(400).send({ message: '电子邮件已存在' })
    }

    const existingUsername = await prisma.user.findUnique({ where: { username } })
    if (existingUsername) {
      return reply.status(400).send({ message: '账号已存在' })
    }

    const hashedPassword = await bcrypt.hash(password, 10)

    const user = await prisma.user.create({
      data: {
        username,
        email,
        password: hashedPassword,
        nickname,
        role,
        status: 'ACTIVE',
      },
      select: {
        id: true,
        email: true,
        username: true,
        nickname: true,
        role: true,
        status: true,
        createdAt: true,
      },
    })

    return reply.status(201).send(user)
  })

  // 更新用户信息（角色、状态、名称）
  app.patch('/users/:id', {
    schema: {
      description: '更新用户信息（名称、角色、状态）',
      tags: ['管理'],
      body: zSchema(updateUserSchema),
      params: zSchema(z.object({ id: z.string() })),
    },
  }, async (req, reply) => {
    const { id } = req.params as { id: string }
    const parsed = updateUserSchema.safeParse(req.body)
    if (!parsed.success) {
      return reply.status(400).send({ message: '请求参数无效' })
    }

    const user = await prisma.user.findUnique({ where: { id } })
    if (!user) {
      return reply.status(404).send({ message: '用户不存在' })
    }

    const updated = await prisma.user.update({
      where: { id },
      data: parsed.data,
      select: {
        id: true,
        email: true,
        username: true,
        nickname: true,
        role: true,
        status: true,
        createdAt: true,
      },
    })

    return updated
  })

  // 修改用户密码
  app.patch('/users/:id/password', {
    schema: {
      description: '修改指定用户的密码',
      tags: ['管理'],
      body: zSchema(changePasswordSchema),
      params: zSchema(z.object({ id: z.string() })),
    },
  }, async (req, reply) => {
    const { id } = req.params as { id: string }
    const parsed = changePasswordSchema.safeParse(req.body)
    if (!parsed.success) {
      return reply.status(400).send({ message: '密码至少6位' })
    }

    const user = await prisma.user.findUnique({ where: { id } })
    if (!user) {
      return reply.status(404).send({ message: '用户不存在' })
    }

    const hashedPassword = await bcrypt.hash(parsed.data.password, 10)
    await prisma.user.update({
      where: { id },
      data: { password: hashedPassword },
    })

    return { success: true }
  })

  // 删除用户
  app.delete('/users/:id', {
    schema: {
      description: '删除用户（不能删除自己）',
      tags: ['管理'],
      params: zSchema(z.object({ id: z.string() })),
    },
  }, async (req, reply) => {
    const { id } = req.params as { id: string }
    const payload = req.user as { id: string }

    // 不能删除自己
    if (id === payload.id) {
      return reply.status(400).send({ message: '不能删除自己' })
    }

    const user = await prisma.user.findUnique({ where: { id } })
    if (!user) {
      return reply.status(404).send({ message: '用户不存在' })
    }

    // 不能删除最后一个管理员
    if (user.role === 'ADMIN') {
      const adminCount = await prisma.user.count({
        where: { role: 'ADMIN', status: 'ACTIVE' },
      })
      if (adminCount <= 1) {
        return reply.status(400).send({ message: '不能删除唯一的管理员' })
      }
    }

    await prisma.user.delete({ where: { id } })
    return { success: true }
  })
}

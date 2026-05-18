import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import bcrypt from 'bcryptjs'
import { prisma } from '../app.js'
import { authenticate, requireAdmin } from '../middleware/auth.js'

const createUserSchema = z.object({
  email: z.string().email(),
  password: z.string().min(6),
  name: z.string().optional(),
  role: z.enum(['ADMIN', 'USER']).default('USER'),
})

const updateUserSchema = z.object({
  name: z.string().optional(),
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
  app.get('/users', async (req, reply) => {
    const users = await prisma.user.findMany({
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        status: true,
        createdAt: true,
      },
      orderBy: { createdAt: 'desc' },
    })
    return { users }
  })

  // 创建用户
  app.post('/users', async (req, reply) => {
    const parsed = createUserSchema.safeParse(req.body)
    if (!parsed.success) {
      return reply.status(400).send({ message: '请求参数无效' })
    }

    const { email, password, name, role } = parsed.data

    const existing = await prisma.user.findUnique({ where: { email } })
    if (existing) {
      return reply.status(400).send({ message: '电子邮件已存在' })
    }

    const hashedPassword = await bcrypt.hash(password, 10)

    const user = await prisma.user.create({
      data: {
        email,
        password: hashedPassword,
        name,
        role,
        status: 'ACTIVE',
      },
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        status: true,
        createdAt: true,
      },
    })

    return reply.status(201).send(user)
  })

  // 更新用户信息（角色、状态、名称）
  app.patch('/users/:id', async (req, reply) => {
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
        name: true,
        role: true,
        status: true,
        createdAt: true,
      },
    })

    return updated
  })

  // 修改用户密码
  app.patch('/users/:id/password', async (req, reply) => {
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
  app.delete('/users/:id', async (req, reply) => {
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

    await prisma.user.delete({ where: { id } })
    return { success: true }
  })
}

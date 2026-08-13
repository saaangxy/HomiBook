import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import bcrypt from 'bcryptjs'
import { prisma } from '../app.js'
import { authenticate, requireAdmin } from '../middleware/auth.js'
import { zSchema } from '../lib/schema-helpers.js'
import { cleanupExpiredAuditLogs } from '../services/ai/audit.js'

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
    config: {
      swaggerResponse: {
        200: {
          type: 'object',
          description: '用户列表',
          properties: {
            users: {
              type: 'array',
              description: '用户列表',
              items: {
                type: 'object',
                properties: {
                  id: { type: 'string', description: '用户ID' },
                  email: { type: 'string', description: '邮箱' },
                  username: { type: 'string', description: '账号' },
                  nickname: { type: 'string', description: '昵称' },
                  role: { type: 'string', description: '角色' },
                  status: { type: 'string', description: '状态' },
                  createdAt: { type: 'string', description: '创建时间' },
                },
              },
            },
          },
        },
      },
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

    const existingEmail = await prisma.user.findFirst({ where: { email } })
    if (existingEmail) {
      return reply.status(400).send({ message: '电子邮件已存在' })
    }

    const existingUsername = await prisma.user.findFirst({ where: { username } })
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

    // 不能将最后一个管理员的角色降级
    if (user.role === 'ADMIN' && parsed.data.role && parsed.data.role !== 'ADMIN') {
      const adminCount = await prisma.user.count({
        where: { role: 'ADMIN', status: 'ACTIVE' },
      })
      if (adminCount <= 1) {
        return reply.status(400).send({ message: '不能移除唯一管理员的权限' })
      }
    }

    const updated = await prisma.user.update({
      where: { id, deletedAt: null },
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
      where: { id, deletedAt: null },
      data: { password: hashedPassword },
    })

    return { success: true }
  })

  // 删除用户（软删除）
  app.delete('/users/:id', {
    schema: {
      description: '软删除用户（不能删除自己）',
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

  // 获取 AI 审计日志（分页 + 筛选）
  app.get('/audit-logs', {
    schema: {
      description: '获取 AI 审计日志（分页+筛选，管理员）',
      tags: ['管理'],
      querystring: zSchema(z.object({
        page: z.coerce.number().int().min(1).default(1),
        pageSize: z.coerce.number().int().min(1).max(100).default(20),
        userId: z.string().optional(),
        action: z.enum(['tool_call', 'confirm', 'reject', 'model_call']).optional(),
        toolName: z.string().optional(),
        status: z.enum(['success', 'error']).optional(),
        sessionId: z.string().optional(),
        startTime: z.string().optional(),
        endTime: z.string().optional(),
      })),
    },
  }, async (req) => {
    const q = req.query as {
      page?: number; pageSize?: number; userId?: string; action?: string;
      toolName?: string; status?: string; sessionId?: string; startTime?: string; endTime?: string
    }
    const page = q.page ?? 1
    const pageSize = q.pageSize ?? 20

    // 懒清理：删除过期审计日志（定时任务每周执行一次，这里作为补充）
    await cleanupExpiredAuditLogs()

    const where: Record<string, unknown> = {}
    if (q.userId) where.userId = q.userId
    if (q.action) where.action = q.action
    if (q.toolName) where.toolName = q.toolName
    if (q.status) where.status = q.status
    if (q.sessionId) where.sessionId = q.sessionId
    if (q.startTime || q.endTime) {
      const createdAt: Record<string, Date> = {}
      if (q.startTime) createdAt.gte = new Date(q.startTime)
      if (q.endTime) createdAt.lte = new Date(q.endTime)
      where.createdAt = createdAt
    }

    const [rows, total] = await Promise.all([
      prisma.agentAuditLog.findMany({
        where,
        include: {
          user: { select: { nickname: true, username: true } },
          session: { select: { summary: true } },
        },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      prisma.agentAuditLog.count({ where }),
    ])

    return {
      items: rows.map((l) => ({
        id: l.id,
        sessionId: l.sessionId,
        sessionSummary: l.session?.summary ?? null,
        userId: l.userId,
        userNickname: l.user?.nickname ?? null,
        username: l.user?.username ?? null,
        action: l.action,
        toolName: l.toolName,
        input: l.input,
        output: l.output,
        modelProvider: l.modelProvider,
        modelName: l.modelName,
        durationMs: l.durationMs,
        status: l.status,
        errorMessage: l.errorMessage,
        ip: l.ip,
        createdAt: l.createdAt,
      })),
      total,
      page,
      pageSize,
    }
  })
}

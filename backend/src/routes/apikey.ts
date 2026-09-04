import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { randomBytes, createHash } from 'crypto'
import { prisma } from '../app.js'
import { authenticate } from '../middleware/auth.js'
import { createApiKeySchema } from '../schemas/apikey.js'
import { zSchema } from '../lib/schema-helpers.js'

export async function apiKeyRoutes(app: FastifyInstance) {
  app.addHook('onRequest', authenticate)

  // 是否管理员(查库实判,不信任 JWT 里的旧角色)
  async function isAdmin(userId: string): Promise<boolean> {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { role: true, status: true },
    })
    return !!user && user.status === 'ACTIVE' && user.role === 'ADMIN'
  }

  // 列表:管理员看全部,普通用户仅自己的
  app.get('/', {
    schema: {
      description: '获取 API Key 列表(管理员返回全部,普通用户仅返回自己的)',
      tags: ['API Key'],
    },
    config: {
      swaggerResponse: {
        200: {
          type: 'array',
          description: 'API Key列表',
          items: {
            type: 'object',
            properties: {
              id: { type: 'string', description: 'API Key ID' },
              userId: { type: 'string', description: '所属用户ID' },
              userName: { type: 'string', description: '所属用户名' },
              name: { type: 'string', description: 'API Key名称' },
              prefix: { type: 'string', description: '密钥前缀' },
              lastUsedAt: { type: 'string', description: '最后使用时间' },
              createdAt: { type: 'string', description: '创建时间' },
            },
          },
        },
      },
    },
  }, async (req) => {
    const userId = (req as any).user.id
    const keys = await prisma.apiKey.findMany({
      where: (await isAdmin(userId)) ? undefined : { userId },
      include: {
        user: { select: { id: true, email: true, nickname: true } },
      },
      orderBy: { createdAt: 'desc' },
    })

    return keys.map((k) => ({
      id: k.id,
      userId: k.userId,
      userName: k.user.nickname || k.user.email,
      name: k.name,
      prefix: k.prefix,
      lastUsedAt: k.lastUsedAt,
      createdAt: k.createdAt,
    }))
  })

  // 创建
  app.post('/', {
    schema: {
      description: '创建新的 API Key（返回完整密钥，仅此一次）',
      tags: ['API Key'],
      body: zSchema(createApiKeySchema),
    },
  }, async (req, reply) => {
    const parsed = createApiKeySchema.safeParse(req.body)
    if (!parsed.success) {
      return reply.status(400).send({ message: parsed.error.issues[0].message })
    }

    const { name } = parsed.data
    const userId = (req as any).user.id

    const rawKey = `homibook_${randomBytes(32).toString('hex')}`
    const hash = createHash('sha256').update(rawKey).digest('hex')
    const prefix = rawKey.slice(0, 19)

    const apiKey = await prisma.apiKey.create({
      data: { userId, name, prefix, hash },
    })

    return reply.status(201).send({
      id: apiKey.id,
      name: apiKey.name,
      prefix,
      key: rawKey,
      createdAt: apiKey.createdAt,
    })
  })

  // 删除:仅本人或管理员
  app.delete('/:id', {
    schema: {
      description: '删除指定 API Key(仅本人或管理员)',
      tags: ['API Key'],
      params: zSchema(z.object({ id: z.string() })),
    },
  }, async (req, reply) => {
    const { id } = req.params as { id: string }
    const userId = (req as any).user.id

    const existing = await prisma.apiKey.findUnique({ where: { id } })
    if (!existing) {
      return reply.status(404).send({ message: 'API Key 不存在' })
    }

    if (existing.userId !== userId && !(await isAdmin(userId))) {
      return reply.status(403).send({ message: '只能删除自己的 API Key' })
    }

    await prisma.apiKey.delete({ where: { id } })
    return { success: true }
  })
}

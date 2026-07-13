import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { randomBytes, createHash } from 'crypto'
import { prisma } from '../app.js'
import { authenticate, requireAdmin } from '../middleware/auth.js'
import { createApiKeySchema } from '../schemas/apikey.js'
import { zSchema } from '../lib/schema-helpers.js'

export async function apiKeyRoutes(app: FastifyInstance) {
  app.addHook('onRequest', authenticate)
  app.addHook('onRequest', requireAdmin)

  // 列表
  app.get('/', {
    schema: {
      description: '获取所有 API Key 列表',
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
  }, async () => {
    const keys = await prisma.apiKey.findMany({
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

  // 删除
  app.delete('/:id', {
    schema: {
      description: '删除指定 API Key',
      tags: ['API Key'],
      params: zSchema(z.object({ id: z.string() })),
    },
  }, async (req, reply) => {
    const { id } = req.params as { id: string }

    const existing = await prisma.apiKey.findUnique({ where: { id } })
    if (!existing) {
      return reply.status(404).send({ message: 'API Key 不存在' })
    }

    await prisma.apiKey.delete({ where: { id } })
    return { success: true }
  })
}

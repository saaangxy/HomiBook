import type { FastifyInstance } from 'fastify'
import { prisma } from '../app.js'
import { authenticate, requireAdmin } from '../middleware/auth.js'
import { updateConfigSchema, createDictionarySchema, updateDictionarySchema } from '../schemas/settings.js'

export async function settingsRoutes(app: FastifyInstance) {
  // 公开端点 — 无需认证，独立作用域避免被下方 hook 影响
  app.get('/public', async () => {
    const config = await prisma.systemConfig.findUnique({ where: { key: 'registrationOpen' } })
    const registrationOpen = config ? JSON.parse(config.value) : true
    return { registrationOpen }
  })

  // 登录用户可访问 — 独立子作用域
  app.register(async (child) => {
    child.addHook('onRequest', authenticate)

    // 字典 — 只读（所有登录用户可读）
    child.get('/dictionary/:group', async (req, reply) => {
      const { group } = req.params as { group: string }
      const items = await prisma.dictionary.findMany({
        where: { group },
        orderBy: { order: 'asc' },
      })
      return items
    })

    // 管理员 — 独立子作用域
    child.register(async (adminChild) => {
      adminChild.addHook('onRequest', requireAdmin)

      // 获取所有配置
      adminChild.get('/config', async () => {
        const configs = await prisma.systemConfig.findMany()
        const result: Record<string, unknown> = {}
        for (const c of configs) {
          try { result[c.key] = JSON.parse(c.value) }
          catch { result[c.key] = c.value }
        }
        return result
      })

      // 更新配置
      adminChild.put('/config', async (req, reply) => {
        const parsed = updateConfigSchema.safeParse(req.body)
        if (!parsed.success) {
          return reply.status(400).send({ message: parsed.error.issues[0].message })
        }

        for (const [key, value] of Object.entries(parsed.data)) {
          if (value !== undefined) {
            await prisma.systemConfig.upsert({
              where: { key },
              create: { key, value: JSON.stringify(value) },
              update: { value: JSON.stringify(value) },
            })
          }
        }
        return { success: true }
      })

      // 添加字典项
      adminChild.post('/dictionary', async (req, reply) => {
        const parsed = createDictionarySchema.safeParse(req.body)
        if (!parsed.success) {
          return reply.status(400).send({ message: parsed.error.issues[0].message })
        }
        const { group, code, label, order } = parsed.data

        try {
          const item = await prisma.dictionary.create({
            data: { group, code, label, order },
          })
          return item
        } catch (e: any) {
          if (e.code === 'P2002') {
            return reply.status(409).send({ message: '该编码已存在' })
          }
          throw e
        }
      })

      // 更新字典项
      adminChild.patch('/dictionary/:id', async (req, reply) => {
        const { id } = req.params as { id: string }
        const parsed = updateDictionarySchema.safeParse(req.body)
        if (!parsed.success) {
          return reply.status(400).send({ message: parsed.error.issues[0].message })
        }

        const existing = await prisma.dictionary.findUnique({ where: { id } })
        if (!existing) {
          return reply.status(404).send({ message: '字典项不存在' })
        }

        return prisma.dictionary.update({ where: { id }, data: parsed.data })
      })

      // 删除字典项
      adminChild.delete('/dictionary/:id', async (req, reply) => {
        const { id } = req.params as { id: string }

        const existing = await prisma.dictionary.findUnique({ where: { id } })
        if (!existing) {
          return reply.status(404).send({ message: '字典项不存在' })
        }

        await prisma.dictionary.delete({ where: { id } })
        return { success: true }
      })
    })
  })
}
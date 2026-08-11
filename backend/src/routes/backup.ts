import type { FastifyInstance } from 'fastify'
import fs from 'fs'
import os from 'os'
import path from 'path'
import crypto from 'crypto'
import { pipeline } from 'stream/promises'
import { z } from 'zod'
import { prisma } from '../app.js'
import { authenticate, requireAdmin } from '../middleware/auth.js'
import { zSchema } from '../lib/schema-helpers.js'
import { exportBackup } from '../services/backup/export.js'
import { importBackup, inspectBackup } from '../services/backup/import.js'

// 把上传的 zip 落到临时文件，返回路径（调用方负责清理）
async function saveUploadToTemp(data: { filename?: string; file: NodeJS.ReadableStream }) {
  if (!/\.zip$/i.test(data.filename || '')) {
    return { error: '请上传 zip 备份文件' }
  }
  const tmpPath = path.join(os.tmpdir(), `homibook-import-${crypto.randomUUID()}.zip`)
  const out = fs.createWriteStream(tmpPath)
  try {
    await pipeline(data.file as unknown as NodeJS.ReadableStream, out)
    return { tmpPath }
  } catch {
    await fs.promises.unlink(tmpPath).catch(() => {})
    return { error: '文件读取失败' }
  }
}

// ======================== 数据迁移（备份 / 恢复） ========================

export async function backupRoutes(app: FastifyInstance) {
  // 仅管理员可用（authenticate 先注入 request.user，requireAdmin 再校验角色）
  app.addHook('onRequest', authenticate)
  app.addHook('onRequest', requireAdmin)

  // 全部账本列表（导出时选择账本用；/api/books 是成员范围，不适用管理员视角）
  app.get('/books', {
    schema: {
      description: '获取全部账本列表（数据迁移用）',
      tags: ['数据迁移'],
    },
    config: {
      swaggerResponse: {
        200: {
          type: 'array',
          description: '全部账本',
          items: {
            type: 'object',
            properties: {
              id: { type: 'string', description: '账本ID' },
              name: { type: 'string', description: '账本名称' },
            },
          },
        },
      },
    },
  }, async () => {
    const books = await prisma.accountBook.findMany({
      select: { id: true, name: true },
      orderBy: { createdAt: 'asc' },
    })
    return books
  })

  // 导出备份（数据包 / 附件包），返回 zip 下载流
  const exportSchema = z.object({
    scope: z.enum(['full', 'attachments']).default('full'),
    bookIds: z.array(z.string()).optional(),
    modules: z.array(z.string()).optional(),
    includeAttachments: z.boolean().optional(),
  })

  app.post('/export', {
    schema: {
      description: '导出备份 zip（full=数据包，attachments=仅附件包）',
      tags: ['数据迁移'],
      body: zSchema(exportSchema),
    },
    config: {
      swaggerResponse: {
        200: { type: 'string', description: 'zip 文件流（application/zip）' },
      },
    },
  }, async (req, reply) => {
    const body = exportSchema.parse(req.body)
    const scope = body.scope ?? 'full'
    const modules = scope === 'full' ? (body.modules?.length ? body.modules : []) : []
    if (scope === 'full' && modules.length === 0) {
      return reply.status(400).send({ message: '请至少选择一个模块' })
    }
    if (body.bookIds?.length) {
      const count = await prisma.accountBook.count({ where: { id: { in: body.bookIds } } })
      if (count !== body.bookIds.length) {
        return reply.status(400).send({ message: '所选账本不存在' })
      }
    }
    await exportBackup({
      scope,
      bookIds: body.bookIds,
      modules,
      includeAttachments: !!body.includeAttachments,
      reply,
    })
  })

  // 导入备份（multipart 上传 zip）
  app.post('/import', {
    schema: {
      description: '导入备份 zip（full=覆盖恢复，attachments=附件合并导入）',
      tags: ['数据迁移'],
      consumes: ['multipart/form-data'],
    },
    config: {
      swaggerResponse: {
        200: {
          type: 'object',
          description: '导入结果',
          properties: {
            scope: { type: 'string', description: '包类型' },
            results: { type: 'object', description: '各模块导入条数' },
            attachmentsRestored: { type: 'number', description: '恢复的附件文件数' },
            skipped: { type: 'number', description: '跳过的附件行数（合并模式）' },
          },
        },
      },
    },
  }, async (req, reply) => {
    const data = await req.file()
    if (!data) return reply.status(400).send({ message: '缺少文件' })
    const saved = await saveUploadToTemp(data)
    if ('error' in saved) return reply.status(400).send({ message: saved.error })
    try {
      return await importBackup(saved.tmpPath)
    } finally {
      await fs.promises.unlink(saved.tmpPath).catch(() => {})
    }
  })

  // 导入前检查备份包（只读 manifest，不导入）
  app.post('/import/inspect', {
    schema: {
      description: '检查备份包类型与元信息（不导入数据）',
      tags: ['数据迁移'],
      consumes: ['multipart/form-data'],
    },
    config: {
      swaggerResponse: {
        200: {
          type: 'object',
          description: '备份包元信息',
          properties: {
            scope: { type: 'string', description: 'full=数据包 / attachments=附件包' },
            appVersion: { type: 'string', description: '导出方版本' },
            exportedAt: { type: 'string', description: '导出时间' },
            modules: { type: 'array', items: { type: 'string' }, description: '包含的模块' },
            includeAttachments: { type: 'boolean', description: '是否含附件' },
          },
        },
      },
    },
  }, async (req, reply) => {
    const data = await req.file()
    if (!data) return reply.status(400).send({ message: '缺少文件' })
    const saved = await saveUploadToTemp(data)
    if ('error' in saved) return reply.status(400).send({ message: saved.error })
    try {
      return await inspectBackup(saved.tmpPath)
    } finally {
      await fs.promises.unlink(saved.tmpPath).catch(() => {})
    }
  })
}

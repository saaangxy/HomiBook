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
import { createSnapshot, restoreSnapshot } from '../services/backup/snapshot.js'
import {
  computeNextRunAt,
  deleteSnapshotFiles,
  getSnapshot,
  isBackupBusy,
  listSnapshots,
  readBackupSettings,
  snapshotZipPath,
  writeBackupSettings,
} from '../services/backup/store.js'
import { backupSettingsSchema, createSnapshotSchema, restoreSnapshotSchema } from '../schemas/backup.js'
import { BACKUP_SCHEDULES } from '@homibook/core'

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
    return prisma.accountBook.findMany({
      select: { id: true, name: true },
      orderBy: { createdAt: 'asc' },
    })
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

  // ======================== 服务端快照备份 ========================

  // 自动备份配置
  app.get('/settings', {
    schema: {
      description: '获取备份设置（是否含附件、每天/每周/每月的开关与保留份数）',
      tags: ['数据迁移'],
    },
    config: {
      swaggerResponse: {
        200: { type: 'object', description: '备份设置' },
      },
    },
  }, async () => readBackupSettings())

  app.put('/settings', {
    schema: {
      description: '更新备份设置（开启频率时立即计算下次执行时间）',
      tags: ['数据迁移'],
      body: zSchema(backupSettingsSchema),
    },
    config: {
      swaggerResponse: {
        200: { type: 'object', description: '更新后的备份设置' },
      },
    },
  }, async (req, reply) => {
    const parsed = backupSettingsSchema.safeParse(req.body ?? {})
    if (!parsed.success) {
      return reply.status(400).send({ message: parsed.error.issues[0].message })
    }

    const patch = parsed.data
    const current = readBackupSettings()
    const schedules = { ...current.schedules }

    for (const preset of BACKUP_SCHEDULES) {
      const next = patch.schedules?.[preset.key]
      if (!next) continue
      const prev = current.schedules[preset.key]
      const enabled = next.enabled ?? prev.enabled
      // 关闭时清空；新开启或缺少下次时间时按固定 cron 重算
      const nextRunAt = !enabled
        ? null
        : (!prev.enabled || !prev.nextRunAt)
          ? computeNextRunAt(preset.cron)?.toISOString() ?? null
          : prev.nextRunAt
      schedules[preset.key] = { ...prev, ...next, enabled, nextRunAt }
    }

    return writeBackupSettings({
      ...(patch.includeAttachments !== undefined ? { includeAttachments: patch.includeAttachments } : {}),
      schedules,
    })
  })

  // 快照列表
  app.get('/snapshots', {
    schema: {
      description: '获取服务端快照列表（按创建时间倒序）',
      tags: ['数据迁移'],
    },
    config: {
      swaggerResponse: {
        200: { type: 'array', description: '快照元数据列表' },
      },
    },
  }, async () => listSnapshots())

  // 手动创建快照（固定全量数据，仅可选是否打包附件文件）
  app.post('/snapshots', {
    schema: {
      description: '立即创建服务端全量备份快照',
      tags: ['数据迁移'],
      body: zSchema(createSnapshotSchema),
    },
    config: {
      swaggerResponse: {
        200: { type: 'object', description: '快照元数据' },
      },
    },
  }, async (req, reply) => {
    const parsed = createSnapshotSchema.safeParse(req.body ?? {})
    if (!parsed.success) {
      return reply.status(400).send({ message: parsed.error.issues[0].message })
    }

    return createSnapshot({
      trigger: 'MANUAL',
      includeAttachments: parsed.data.includeAttachments,
    })
  })

  // 删除快照
  app.delete('/snapshots/:id', {
    schema: {
      description: '删除服务端快照（同时删除 zip 与元数据）',
      tags: ['数据迁移'],
    },
    config: {
      swaggerResponse: {
        200: {
          type: 'object',
          properties: { success: { type: 'boolean' } },
        },
      },
    },
  }, async (req, reply) => {
    const { id } = req.params as { id: string }
    if (isBackupBusy()) {
      return reply.status(409).send({ message: '备份或恢复正在进行中，请稍后重试' })
    }
    const meta = getSnapshot(id)
    if (!meta) return reply.status(404).send({ message: '快照不存在或文件已丢失' })
    deleteSnapshotFiles(id)
    return { success: true }
  })

  // 从快照恢复
  app.post('/snapshots/:id/restore', {
    schema: {
      description: '从服务端快照恢复数据（默认先创建安全备份）',
      tags: ['数据迁移'],
      body: zSchema(restoreSnapshotSchema),
    },
    config: {
      swaggerResponse: {
        200: { type: 'object', description: '恢复结果与安全备份 ID' },
      },
    },
  }, async (req, reply) => {
    const { id } = req.params as { id: string }
    const parsed = restoreSnapshotSchema.safeParse(req.body ?? {})
    if (!parsed.success) {
      return reply.status(400).send({ message: parsed.error.issues[0].message })
    }

    const result = await restoreSnapshot(id, parsed.data)
    return {
      restored: true,
      safetySnapshotId: result.safetySnapshotId,
      results: result.results,
      attachmentsRestored: result.attachmentsRestored,
      skipped: result.skipped,
      appVersion: result.appVersion,
      exportedAt: result.exportedAt,
    }
  })

  // 下载快照 zip
  app.get('/snapshots/:id/download', {
    schema: {
      description: '下载服务端快照 zip',
      tags: ['数据迁移'],
    },
    config: {
      swaggerResponse: {
        200: { type: 'string', description: 'zip 文件流（application/zip）' },
      },
    },
  }, async (req, reply) => {
    const { id } = req.params as { id: string }
    const meta = getSnapshot(id)
    if (!meta) return reply.status(404).send({ message: '快照不存在或文件已丢失' })

    const filePath = snapshotZipPath(id)
    reply.hijack()
    reply.raw.setHeader('Content-Type', 'application/zip')
    reply.raw.setHeader('Content-Disposition', `attachment; filename="${meta.filename}"`)
    reply.raw.setHeader('Cache-Control', 'no-store')
    fs.createReadStream(filePath).pipe(reply.raw)
  })
}

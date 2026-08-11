import { ZipArchive, type Archiver } from 'archiver'
import fs from 'fs'
import path from 'path'
import type { FastifyReply } from 'fastify'
import { rawPrisma } from '../../app.js'
import { APP_VERSION } from '../../version.js'
import { BACKUP_FORMAT_VERSION, MODULE_FILES, assertValidModules, sanitizeTablesData } from './modules.js'

// 附件物理存储目录（与 record.ts 上传逻辑保持一致）
const uploadsDir = path.join(process.cwd(), 'uploads')

/** 根据所选账本生成 accountBookId 过滤条件；未选账本（全量）返回空 where */
function bookWhere(bookIds?: string[]) {
  return bookIds && bookIds.length > 0 ? { accountBookId: { in: bookIds } } : {}
}

/**
 * 收集单张表的数据行。账本域表按 bookIds 过滤；全局表全量。
 * user 特殊处理：指定账本时仅导出相关用户（账本 owner / 成员 / 流水经手人）。
 */
async function collectRows(table: string, bookIds?: string[]): Promise<any[]> {
  const db = rawPrisma as any
  const hasBooks = !!bookIds && bookIds.length > 0

  switch (table) {
    case 'user': {
      if (!hasBooks) return db.user.findMany()
      return db.user.findMany({
        where: {
          OR: [
            { ownedBooks: { some: { id: { in: bookIds } } } },
            { memberships: { some: { accountBookId: { in: bookIds } } } },
            { records: { some: { accountBookId: { in: bookIds } } } },
          ],
        },
      })
    }
    case 'accountBook':
      return db.accountBook.findMany(hasBooks ? { where: { id: { in: bookIds } } } : {})
    case 'accountBookMember':
      return db.accountBookMember.findMany(bookWhere(bookIds))
    case 'shareCode':
      return db.shareCode.findMany(bookWhere(bookIds))
    case 'account':
      return db.account.findMany(bookWhere(bookIds))
    case 'balanceAdjustment': {
      if (!hasBooks) return db.balanceAdjustment.findMany()
      const accounts = await db.account.findMany({ where: { accountBookId: { in: bookIds } }, select: { id: true } })
      return db.balanceAdjustment.findMany({ where: { accountId: { in: accounts.map((a: any) => a.id) } } })
    }
    case 'record':
      return db.record.findMany(bookWhere(bookIds))
    case 'recordAttachment': {
      if (!hasBooks) return db.recordAttachment.findMany()
      const records = await db.record.findMany({ where: { accountBookId: { in: bookIds } }, select: { id: true } })
      return db.recordAttachment.findMany({ where: { recordId: { in: records.map((r: any) => r.id) } } })
    }
    case 'budget':
      return db.budget.findMany(bookWhere(bookIds))
    case 'recurringTransaction':
      return db.recurringTransaction.findMany(bookWhere(bookIds))
    case 'repaymentPlan': {
      if (!hasBooks) return db.repaymentPlan.findMany()
      const recs = await db.recurringTransaction.findMany({ where: { accountBookId: { in: bookIds } }, select: { id: true } })
      return db.repaymentPlan.findMany({ where: { recurringTransactionId: { in: recs.map((r: any) => r.id) } } })
    }
    case 'importCategoryMapping':
      return db.importCategoryMapping.findMany()
    case 'importAccountMapping':
      return db.importAccountMapping.findMany()
    case 'userAIConfig':
      return db.userAIConfig.findMany()
    case 'userProviderConfig':
      return db.userProviderConfig.findMany()
    case 'apiKey':
      return db.apiKey.findMany()
    case 'chatSession':
      return db.chatSession.findMany(hasBooks ? { where: { accountBookId: { in: bookIds } } } : {})
    case 'chatMessage': {
      if (!hasBooks) return db.chatMessage.findMany()
      const sessions = await db.chatSession.findMany({ where: { accountBookId: { in: bookIds } }, select: { id: true } })
      return db.chatMessage.findMany({ where: { sessionId: { in: sessions.map((s: any) => s.id) } } })
    }
    case 'userMemory': {
      if (!hasBooks) return db.userMemory.findMany()
      const sessions = await db.chatSession.findMany({ where: { accountBookId: { in: bookIds } }, select: { id: true } })
      return db.userMemory.findMany({ where: { sessionId: { in: sessions.map((s: any) => s.id) } } })
    }
    case 'agentAuditLog': {
      if (!hasBooks) return db.agentAuditLog.findMany()
      const sessions = await db.chatSession.findMany({ where: { accountBookId: { in: bookIds } }, select: { id: true } })
      return db.agentAuditLog.findMany({ where: { sessionId: { in: sessions.map((s: any) => s.id) } } })
    }
    default:
      return db[table].findMany()
  }
}

function tsStamp(): string {
  const d = new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`
}

export interface ExportOptions {
  scope: 'full' | 'attachments'
  bookIds?: string[]
  /** 仅 full 使用：选中的模块 key 列表（必须包含核心模块） */
  modules: string[]
  /** 仅 full 使用：是否包含附件文件 */
  includeAttachments: boolean
  reply: FastifyReply
}

/**
 * 导出备份为 zip 流。scope:
 * - 'full'：数据包（所选模块 + 可选附件）
 * - 'attachments'：仅附件包（recordAttachment 行 + 文件）
 */
export async function exportBackup({ scope, bookIds, modules, includeAttachments, reply }: ExportOptions) {
  if (scope === 'full') assertValidModules(modules)

  const manifest = {
    formatVersion: BACKUP_FORMAT_VERSION,
    appVersion: APP_VERSION,
    provider: (process.env.DATABASE_PROVIDER || 'sqlite').toLowerCase(),
    scope,
    exportedAt: new Date().toISOString(),
    exportScope: bookIds && bookIds.length > 0 ? 'books' : 'all',
    bookIds: bookIds ?? [],
    modules: scope === 'full' ? modules : ['attachments'],
    includeAttachments: scope === 'full' ? includeAttachments : true,
  }

  const stamp = tsStamp()
  const filename = scope === 'full' ? `homibook-backup-${stamp}.zip` : `homibook-attachments-${stamp}.zip`

  // 1. 先收集所有表数据到内存（在 hijack 之前，出错可正常返回 JSON 错误）
  const tablesData: Record<string, any[]> = {}
  if (scope === 'full') {
    for (const module of modules) {
      for (const table of MODULE_FILES[module] ?? []) {
        tablesData[table] = await collectRows(table, bookIds)
      }
    }
    sanitizeTablesData(tablesData)
  } else {
    tablesData['recordAttachment'] = await collectRows('recordAttachment', bookIds)
  }

  // 2. 构建各表数量（写入 response header 供前端展示）
  const counts: Record<string, number> = {}
  for (const [table, rows] of Object.entries(tablesData)) {
    counts[table] = rows.length
  }

  // 3. hijack 后手动把归档流 pipe 到 response
  reply.hijack()
  reply.raw.setHeader('Content-Type', 'application/zip')
  reply.raw.setHeader('Content-Disposition', `attachment; filename="${filename}"`)
  reply.raw.setHeader('Cache-Control', 'no-store')
  reply.raw.setHeader('X-Export-Counts', JSON.stringify(counts))

  const archive = new ZipArchive({ zlib: { level: 6 } })
  archive.on('warning', (err: any) => {
    if (err.code !== 'ENOENT') reply.log?.warn?.(err)
  })
  archive.on('error', (err: any) => {
    reply.log?.error?.(err)
    reply.raw.destroy(err as Error)
  })
  archive.pipe(reply.raw)

  try {
    archive.append(JSON.stringify(manifest), { name: 'manifest.json' })

    if (scope === 'full') {
      for (const module of modules) {
        for (const table of MODULE_FILES[module] ?? []) {
          archive.append(JSON.stringify(tablesData[table] || []), { name: `data/${table}.json` })
        }
      }
      if (includeAttachments && modules.includes('attachments')) {
        await appendAttachmentFiles(archive, bookIds)
      }
    } else {
      archive.append(JSON.stringify(tablesData['recordAttachment'] || []), { name: 'data/recordAttachment.json' })
      await appendAttachmentFiles(archive, bookIds)
    }
  } catch (err) {
    archive.abort()
    throw err
  }

  await archive.finalize()
}

/** 把所选附件文件写入 zip 的 attachments/ 目录，跳过磁盘上缺失的文件 */
async function appendAttachmentFiles(archive: Archiver, bookIds?: string[]) {
  const rows = await collectRows('recordAttachment', bookIds)
  const seen = new Set<string>()
  for (const att of rows) {
    const name = path.basename(att.path || '')
    if (!name || seen.has(name)) continue
    seen.add(name)
    const filePath = path.join(uploadsDir, name)
    if (fs.existsSync(filePath)) {
      archive.append(fs.createReadStream(filePath), { name: `attachments/${name}` })
    }
  }
}

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
            { budgetsOwned: { some: { accountBookId: { in: bookIds } } } },
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
      // 多对多：附件行额外带上引用它的流水 id 列表，导入时据此恢复关联
      if (!hasBooks) {
        const rows = await db.recordAttachment.findMany({ include: { records: { select: { id: true } } } })
        return rows.map(({ records, ...att }: any) => ({ ...att, recordIds: records.map((r: any) => r.id) }))
      }
      // 账本范围：流水附件 ∪ 该账本聊天会话引用的附件（否则聊天图片恢复后是坏链接）
      const caseSessions = await db.chatSession.findMany({
        where: { accountBookId: { in: bookIds } },
        select: { id: true },
      })
      const rows = await db.recordAttachment.findMany({
        where: {
          OR: [
            { records: { some: { accountBookId: { in: bookIds } } } },
            { chatMessages: { some: { message: { sessionId: { in: caseSessions.map((s: any) => s.id) } } } } },
          ],
        },
        include: { records: { select: { id: true }, where: { accountBookId: { in: bookIds } } } },
      })
      return rows.map(({ records, ...att }: any) => ({ ...att, recordIds: records.map((r: any) => r.id) }))
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
    case 'chatMessageAttachment': {
      if (!hasBooks) return db.chatMessageAttachment.findMany()
      const sessions = await db.chatSession.findMany({ where: { accountBookId: { in: bookIds } }, select: { id: true } })
      return db.chatMessageAttachment.findMany({
        where: { message: { sessionId: { in: sessions.map((s: any) => s.id) } } },
      })
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

export interface BackupManifest {
  formatVersion: number
  appVersion: string
  provider: string
  scope: 'full' | 'attachments'
  exportedAt: string
  exportScope: 'books' | 'all'
  bookIds: string[]
  modules: string[]
  includeAttachments: boolean
  /** 快照来源（MANUAL / SCHEDULED / SAFETY）；普通导出为空 */
  trigger?: string
}

interface BackupData {
  tablesData: Record<string, any[]>
  counts: Record<string, number>
}

/** 收集备份所需的数据（不写流），供导出与快照共用 */
export async function collectBackupData(opts: {
  scope: 'full' | 'attachments'
  bookIds?: string[]
  modules: string[]
}): Promise<BackupData> {
  const { scope, bookIds, modules } = opts
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

  const counts: Record<string, number> = {}
  for (const [table, rows] of Object.entries(tablesData)) {
    counts[table] = rows.length
  }
  return { tablesData, counts }
}

export function buildBackupManifest(opts: {
  scope: 'full' | 'attachments'
  bookIds?: string[]
  modules: string[]
  includeAttachments: boolean
  trigger?: string
}): BackupManifest {
  const { scope, bookIds, modules, includeAttachments, trigger } = opts
  return {
    formatVersion: BACKUP_FORMAT_VERSION,
    appVersion: APP_VERSION,
    provider: (process.env.DATABASE_PROVIDER || 'sqlite').toLowerCase(),
    scope,
    exportedAt: new Date().toISOString(),
    exportScope: bookIds && bookIds.length > 0 ? 'books' : 'all',
    bookIds: bookIds ?? [],
    modules: scope === 'full' ? modules : ['attachments'],
    includeAttachments: scope === 'full' ? includeAttachments : true,
    ...(trigger ? { trigger } : {}),
  }
}

/** 把已收集的数据写入 zip 流 */
async function writeArchive(
  opts: {
    manifest: BackupManifest
    scope: 'full' | 'attachments'
    tablesData: Record<string, any[]>
    bookIds?: string[]
    includeAttachments: boolean
    modules: string[]
  },
  output: NodeJS.WritableStream,
) {
  const { manifest, scope, tablesData, includeAttachments, modules } = opts
  const archive = new ZipArchive({ zlib: { level: 6 } })
  archive.on('warning', (err: any) => {
    if (err.code !== 'ENOENT') console.warn('[Backup] 归档警告:', err)
  })
  archive.on('error', (err: any) => {
    console.error('[Backup] 归档失败:', err)
    ;(output as any).destroy?.(err)
  })
  archive.pipe(output)

  try {
    archive.append(JSON.stringify(manifest), { name: 'manifest.json' })

    if (scope === 'full') {
      for (const module of modules) {
        for (const table of MODULE_FILES[module] ?? []) {
          archive.append(JSON.stringify(tablesData[table] || []), { name: `data/${table}.json` })
        }
      }
      if (includeAttachments && modules.includes('attachments')) {
        await appendAttachmentFiles(archive, tablesData['recordAttachment'] || [])
      }
    } else {
      archive.append(JSON.stringify(tablesData['recordAttachment'] || []), { name: 'data/recordAttachment.json' })
      await appendAttachmentFiles(archive, tablesData['recordAttachment'] || [])
    }
  } catch (err) {
    archive.abort()
    throw err
  }

  await archive.finalize()
}

/** 生成备份 zip 并写入任意可写流（服务端快照落盘用） */
export async function writeBackupZip(
  opts: {
    scope: 'full' | 'attachments'
    bookIds?: string[]
    modules: string[]
    includeAttachments: boolean
    trigger?: string
  },
  output: NodeJS.WritableStream,
) {
  if (opts.scope === 'full') assertValidModules(opts.modules)
  const data = await collectBackupData(opts)
  const manifest = buildBackupManifest(opts)
  await writeArchive({ ...opts, manifest, ...data }, output)
  return { counts: data.counts, manifest }
}

/**
 * 导出备份为 zip 流。scope:
 * - 'full'：数据包（所选模块 + 可选附件）
 * - 'attachments'：仅附件包（recordAttachment 行 + 文件）
 */
export async function exportBackup({ scope, bookIds, modules, includeAttachments, reply }: ExportOptions) {
  if (scope === 'full') assertValidModules(modules)

  // 先收集数据，出错还能正常返回 JSON 错误
  const data = await collectBackupData({ scope, bookIds, modules })
  const manifest = buildBackupManifest({ scope, bookIds, modules, includeAttachments })

  const stamp = tsStamp()
  const filename = scope === 'full' ? `homibook-backup-${stamp}.zip` : `homibook-attachments-${stamp}.zip`

  // hijack 后手动把归档流 pipe 到 response
  reply.hijack()
  reply.raw.setHeader('Content-Type', 'application/zip')
  reply.raw.setHeader('Content-Disposition', `attachment; filename="${filename}"`)
  reply.raw.setHeader('Cache-Control', 'no-store')
  reply.raw.setHeader('X-Export-Counts', JSON.stringify(data.counts))

  await writeArchive(
    { manifest, scope, tablesData: data.tablesData, bookIds, includeAttachments, modules },
    reply.raw,
  )
}

/** 把附件文件写入 zip 的 attachments/ 目录，跳过磁盘上缺失的文件 */
async function appendAttachmentFiles(archive: Archiver, rows: any[]) {
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

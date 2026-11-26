import unzipper from 'unzipper'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { pipeline } from 'stream/promises'
import { rawPrisma } from '../../app.js'
import { BACKUP_FORMAT_VERSION, IMPORT_TABLE_ORDER } from './modules.js'

// 附件物理存储目录（与 export.ts / record.ts 保持一致）
const uploadsDir = path.join(process.cwd(), 'uploads')

// 分批写入，避免单条 createMany 过大（MySQL max_allowed_packet 限制）
const BATCH = 500

/** recordAttachment 行的标量字段；关联字段（recordIds / 旧版 recordId）单独恢复 */
const ATTACHMENT_COLUMNS = [
  'id',
  'path',
  'originalFilename',
  'createdAt',
  'visionSummary',
  'visionText',
  'visionMeta',
  'visionAt',
] as const

/**
 * 备份行里声明的关联流水 id。
 * 兼容旧备份：多对多改造前只有单个 recordId 列。
 */
function attachmentRecordIds(row: any): string[] {
  if (Array.isArray(row.recordIds)) return row.recordIds.filter((id: unknown) => typeof id === 'string')
  return typeof row.recordId === 'string' && row.recordId ? [row.recordId] : []
}

/** 只保留可插入的标量列，避免 createMany 遇到未知字段 */
function toAttachmentRow(row: any): any {
  const clean: any = {}
  for (const key of ATTACHMENT_COLUMNS) {
    if (row[key] !== undefined) clean[key] = row[key]
  }
  return clean
}

/**
 * 按 recordIds 恢复「附件 ↔ 流水」关联，只连两边都存在的 id。
 * 返回无法恢复的关联条数（流水已不在库里）。
 */
async function restoreAttachmentLinks(
  db: any,
  rows: any[],
  recordIds: Set<string>,
  attachmentIds: Set<string>,
): Promise<number> {
  const byRecord = new Map<string, Set<string>>()
  let skipped = 0
  for (const row of rows) {
    if (!attachmentIds.has(row.id)) continue
    for (const recordId of attachmentRecordIds(row)) {
      if (!recordIds.has(recordId)) {
        skipped++
        continue
      }
      const set = byRecord.get(recordId) ?? new Set<string>()
      set.add(row.id)
      byRecord.set(recordId, set)
    }
  }
  for (const [recordId, ids] of byRecord) {
    await db.record.update({
      where: { id: recordId },
      data: { recordAttachments: { connect: [...ids].map((id) => ({ id })) } },
    })
  }
  return skipped
}

interface BackupManifest {
  formatVersion: number
  appVersion?: string
  exportedAt?: string
  scope: 'full' | 'attachments'
  modules?: string[]
  includeAttachments?: boolean
}

/**
 * 解压 zip 到 targetDir，带 zip-slip 防护：
 * 每个条目路径 resolve 后必须仍在 targetDir 内，否则拒绝。
 *
 * 注意：unzipper 的 entry 是并行写入的，parse 的 close 不代表文件已落盘。
 * 必须等待所有写入完成后才能 resolve，否则调用方紧接着读取大表文件时
 * 可能读到空/半个 JSON（readTable 会容错成空数组），进而在恢复关联表时触发外键错误。
 */
function extractZip(zipPath: string, targetDir: string): Promise<void> {
  const root = path.resolve(targetDir)
  return new Promise((resolve, reject) => {
    const src = fs.createReadStream(zipPath)
    const parse = unzipper.Parse()
    let settled = false
    const fail = (err: unknown) => {
      if (settled) return
      settled = true
      src.destroy()
      reject(err)
    }
    const pending = new Set<Promise<void>>()

    src.on('error', fail)
    parse.on('error', fail)

    src.pipe(parse)
    parse.on('entry', (entry: any) => {
      const target = path.resolve(root, entry.path)
      const inside = target === root || target.startsWith(root + path.sep)
      if (!inside) {
        entry.autodrain()
        fail(new Error(`备份包包含非法路径: ${entry.path}`))
        return
      }
      if (entry.type === 'Directory') {
        entry.autodrain()
        return
      }
      const task = (async () => {
        await fs.promises.mkdir(path.dirname(target), { recursive: true })
        await pipeline(entry, fs.createWriteStream(target))
      })()
      pending.add(task)
      task.catch(fail).finally(() => pending.delete(task))
    })
    parse.on('close', () => {
      Promise.all([...pending]).then(() => {
        if (settled) return
        settled = true
        resolve()
      }, fail)
    })
  })
}

function readManifest(extractDir: string): BackupManifest {
  const p = path.join(extractDir, 'manifest.json')
  if (!fs.existsSync(p)) {
    throw Object.assign(new Error('备份包缺少 manifest.json，无法识别'), { statusCode: 400 })
  }
  let manifest: BackupManifest
  try {
    manifest = JSON.parse(fs.readFileSync(p, 'utf8'))
  } catch {
    throw Object.assign(new Error('manifest.json 解析失败'), { statusCode: 400 })
  }
  if (manifest.formatVersion !== BACKUP_FORMAT_VERSION) {
    throw Object.assign(new Error(`不支持的备份版本: ${manifest.formatVersion}`), { statusCode: 400 })
  }
  if (manifest.scope !== 'full' && manifest.scope !== 'attachments') {
    throw Object.assign(new Error('备份包类型无效'), { statusCode: 400 })
  }
  return manifest
}

/** 读取 data/<table>.json，缺失或非法时返回空数组 */
function readTable(extractDir: string, table: string): any[] {
  const p = path.join(extractDir, 'data', `${table}.json`)
  if (!fs.existsSync(p)) return []
  try {
    const arr = JSON.parse(fs.readFileSync(p, 'utf8'))
    return Array.isArray(arr) ? arr : []
  } catch {
    return []
  }
}

/**
 * 把备份包 attachments/ 目录下的文件写入 uploads 目录（同名跳过，幂等）。
 * 返回新写入的文件数。
 */
async function restoreAttachmentFiles(extractDir: string): Promise<number> {
  const srcDir = path.join(extractDir, 'attachments')
  if (!fs.existsSync(srcDir)) return 0
  if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true })
  let count = 0
  const entries = await fs.promises.readdir(srcDir)
  for (const name of entries) {
    // 防路径穿越：必须是普通文件名
    if (path.basename(name) !== name) continue
    const target = path.join(uploadsDir, name)
    if (fs.existsSync(target)) continue
    await fs.promises.copyFile(path.join(srcDir, name), target)
    count++
  }
  return count
}

/** 覆盖恢复：清空全部表后按依赖顺序分批插入备份数据 */
async function importFull(extractDir: string): Promise<{ results: Record<string, number>; attachmentsRestored: number; skipped: number }> {
  const attachmentRows = readTable(extractDir, 'recordAttachment')

  const { counts, skipped } = await rawPrisma.$transaction(
    async (tx: any) => {
      // 逆序删除（子表先删），rawPrisma 为物理删除
      for (const table of [...IMPORT_TABLE_ORDER].reverse()) {
        await tx[table].deleteMany({})
      }
      const result: Record<string, number> = {}
      for (const table of IMPORT_TABLE_ORDER) {
        // 附件的关联字段不能进 createMany，插入后再单独恢复
        const rows = table === 'recordAttachment'
          ? attachmentRows.map(toAttachmentRow)
          : readTable(extractDir, table)
        result[table] = rows.length
        for (let i = 0; i < rows.length; i += BATCH) {
          await tx[table].createMany({ data: rows.slice(i, i + BATCH) })
        }
      }

      // 所有表插入完成后统一恢复「附件 ↔ 流水」关联（此时 record 已存在）
      const recordIds = new Set(readTable(extractDir, 'record').map((r: any) => r.id))
      const attachmentIds = new Set(attachmentRows.map((r: any) => r.id))
      const skippedLinks = await restoreAttachmentLinks(tx, attachmentRows, recordIds, attachmentIds)
      return { counts: result, skipped: skippedLinks }
    },
    { maxWait: 600000, timeout: 600000 }
  )
  // 附件文件在数据事务提交后写入（文件无法事务回滚）
  const attachmentsRestored = await restoreAttachmentFiles(extractDir)
  return { results: counts, attachmentsRestored, skipped }
}

/** 附件合并导入（非破坏）：按 ID 去重插入行，写入文件；能对上的流水关联一并恢复 */
async function importAttachments(extractDir: string): Promise<{
  results: Record<string, number>
  skipped: number
  attachmentsRestored: number
}> {
  const rows = readTable(extractDir, 'recordAttachment')
  const existing = await rawPrisma.recordAttachment.findMany({ select: { id: true } })
  const existingIds = new Set(existing.map((a) => a.id))

  // 附件本身与流水解耦：先全部插入，关联能连多少算多少（对不上的流水计入 skipped）
  const toCreate = rows.filter((r) => !existingIds.has(r.id))
  for (let i = 0; i < toCreate.length; i += BATCH) {
    await rawPrisma.recordAttachment.createMany({ data: toCreate.slice(i, i + BATCH).map(toAttachmentRow) })
  }

  const declaredRecordIds = [...new Set(rows.flatMap((r) => attachmentRecordIds(r)))]
  const recordIds = new Set<string>()
  if (declaredRecordIds.length > 0) {
    const recs = await rawPrisma.record.findMany({ where: { id: { in: declaredRecordIds } }, select: { id: true } })
    for (const r of recs) recordIds.add(r.id)
  }
  const attachmentIds = new Set([...existingIds, ...toCreate.map((r) => r.id)])
  const skipped = await restoreAttachmentLinks(rawPrisma, rows, recordIds, attachmentIds)

  const attachmentsRestored = await restoreAttachmentFiles(extractDir)
  return { results: { recordAttachment: toCreate.length }, skipped, attachmentsRestored }
}

/**
 * 导入备份 zip。返回按 manifest.scope 分派的结果：
 * - full：覆盖恢复
 * - attachments：附件合并导入
 */
export async function importBackup(zipPath: string) {
  const extractDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'homibook-restore-'))
  try {
    await extractZip(zipPath, extractDir)
    const manifest = readManifest(extractDir)
    const base = manifest.scope === 'full' ? await importFull(extractDir) : await importAttachments(extractDir)
    return {
      ...base,
      scope: manifest.scope,
      appVersion: manifest.appVersion,
      exportedAt: manifest.exportedAt,
    }
  } finally {
    await fs.promises.rm(extractDir, { recursive: true, force: true }).catch(() => {})
  }
}

/**
 * 仅读取备份包的 manifest（不导入数据），供前端区分数据包/附件包、展示警告。
 */
export async function inspectBackup(zipPath: string) {
  const extractDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'homibook-inspect-'))
  try {
    await extractZip(zipPath, extractDir)
    const manifest = readManifest(extractDir)
    return {
      scope: manifest.scope,
      appVersion: manifest.appVersion,
      exportedAt: manifest.exportedAt,
      modules: manifest.modules,
      includeAttachments: manifest.includeAttachments,
    }
  } finally {
    await fs.promises.rm(extractDir, { recursive: true, force: true }).catch(() => {})
  }
}

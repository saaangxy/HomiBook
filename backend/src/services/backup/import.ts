import unzipper from 'unzipper'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { rawPrisma } from '../../app.js'
import { BACKUP_FORMAT_VERSION, IMPORT_TABLE_ORDER } from './modules.js'

// 附件物理存储目录（与 export.ts / record.ts 保持一致）
const uploadsDir = path.join(process.cwd(), 'uploads')

// 分批写入，避免单条 createMany 过大（MySQL max_allowed_packet 限制）
const BATCH = 500

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
 */
function extractZip(zipPath: string, targetDir: string): Promise<void> {
  const root = path.resolve(targetDir)
  return new Promise((resolve, reject) => {
    const src = fs.createReadStream(zipPath)
    const parse = unzipper.Parse()
    src.on('error', reject)
    parse.on('error', reject)
    parse.on('close', resolve)

    src.pipe(parse)
    parse.on('entry', (entry: any) => {
      const target = path.resolve(root, entry.path)
      const inside = target === root || target.startsWith(root + path.sep)
      if (!inside) {
        entry.autodrain()
        reject(new Error(`备份包包含非法路径: ${entry.path}`))
        return
      }
      if (entry.type === 'Directory') {
        entry.autodrain()
        return
      }
      fs.promises
        .mkdir(path.dirname(target), { recursive: true })
        .then(() => {
          const out = fs.createWriteStream(target)
          out.on('error', (e) => {
            src.destroy()
            reject(e)
          })
          entry.on('error', (e: Error) => {
            src.destroy()
            reject(e)
          })
          entry.pipe(out)
        })
        .catch(reject)
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
async function importFull(extractDir: string): Promise<{ results: Record<string, number>; attachmentsRestored: number }> {
  const counts = await rawPrisma.$transaction(
    async (tx: any) => {
      // 逆序删除（子表先删），rawPrisma 为物理删除
      for (const table of [...IMPORT_TABLE_ORDER].reverse()) {
        await tx[table].deleteMany({})
      }
      const result: Record<string, number> = {}
      for (const table of IMPORT_TABLE_ORDER) {
        const rows = readTable(extractDir, table)
        result[table] = rows.length
        for (let i = 0; i < rows.length; i += BATCH) {
          await tx[table].createMany({ data: rows.slice(i, i + BATCH) })
        }
      }
      return result
    },
    { maxWait: 600000, timeout: 600000 }
  )
  // 附件文件在数据事务提交后写入（文件无法事务回滚）
  const attachmentsRestored = await restoreAttachmentFiles(extractDir)
  return { results: counts, attachmentsRestored }
}

/** 附件合并导入（非破坏）：按 ID 去重插入行，写入文件；recordId 不存在的行跳过 */
async function importAttachments(extractDir: string): Promise<{
  results: Record<string, number>
  skipped: number
  attachmentsRestored: number
}> {
  const rows = readTable(extractDir, 'recordAttachment')
  const existing = await rawPrisma.recordAttachment.findMany({ select: { id: true } })
  const existingIds = new Set(existing.map((a) => a.id))

  const toCreate = rows.filter((r) => !existingIds.has(r.id))
  const idsNeedingCheck = toCreate.filter((r: any) => r.recordId).map((r: any) => r.recordId)
  let valid = new Set<string>()
  if (idsNeedingCheck.length > 0) {
    const recs = await rawPrisma.record.findMany({ where: { id: { in: idsNeedingCheck } }, select: { id: true } })
    valid = new Set(recs.map((r) => r.id))
  }
  const insertable = toCreate.filter((r: any) => !r.recordId || valid.has(r.recordId))
  const skipped = toCreate.length - insertable.length

  for (let i = 0; i < insertable.length; i += BATCH) {
    await rawPrisma.recordAttachment.createMany({ data: insertable.slice(i, i + BATCH) })
  }

  const attachmentsRestored = await restoreAttachmentFiles(extractDir)
  return { results: { recordAttachment: insertable.length }, skipped, attachmentsRestored }
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

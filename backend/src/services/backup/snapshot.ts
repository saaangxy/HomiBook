import fs from 'fs'
import { finished } from 'stream/promises'
import {
  BACKUP_MODULES,
  type BackupFrequency,
  type BackupSnapshotMeta,
  type BackupTrigger,
} from '@homibook/core'
import { APP_VERSION } from '../../version.js'
import { writeBackupZip } from './export.js'
import { assertValidModules } from './modules.js'
import { importBackup } from './import.js'
import {
  commitSnapshotFile,
  ensureBackupDir,
  getSnapshot,
  newSnapshotId,
  pruneScheduledSnapshots,
  snapshotZipPath,
  tempSnapshotPath,
  withBackupLock,
  writeSnapshotMeta,
} from './store.js'

/** 全量模块（保持 BACKUP_MODULES 的顺序） */
export const ALL_BACKUP_MODULES = BACKUP_MODULES.map((m) => m.key)

export interface CreateSnapshotOptions {
  trigger: BackupTrigger
  /** 定时备份所属频率，用于按频率保留/清理；手动与安全备份不传 */
  schedule?: BackupFrequency
  /** 不传或空数组表示全部账本 */
  bookIds?: string[]
  /** 不传表示全量模块 */
  modules?: string[]
  /** 默认包含附件（仅在选择了附件模块时生效） */
  includeAttachments?: boolean
}

/** 不加锁的内部实现：供 restoreSnapshot 在已持锁时复用以创建安全备份 */
async function createSnapshotUnlocked(opts: CreateSnapshotOptions): Promise<BackupSnapshotMeta> {
  ensureBackupDir()

  const bookIds = opts.bookIds && opts.bookIds.length > 0 ? opts.bookIds : undefined
  const modules = opts.modules && opts.modules.length > 0 ? opts.modules : ALL_BACKUP_MODULES
  assertValidModules(modules)

  // 未选附件模块时，包含附件没有意义
  const includeAttachments = opts.includeAttachments !== false && modules.includes('attachments')

  const id = newSnapshotId()
  const tmpPath = tempSnapshotPath(id)
  const out = fs.createWriteStream(tmpPath)

  try {
    await writeBackupZip(
      {
        scope: 'full',
        bookIds,
        modules,
        includeAttachments,
        trigger: opts.trigger,
      },
      out,
    )
    await finished(out)
  } catch (err) {
    out.destroy()
    await fs.promises.unlink(tmpPath).catch(() => {})
    throw err
  }

  const size = commitSnapshotFile(tmpPath, id)
  const meta: BackupSnapshotMeta = {
    id,
    filename: `${id}.zip`,
    size,
    createdAt: new Date().toISOString(),
    trigger: opts.trigger,
    ...(opts.schedule ? { schedule: opts.schedule } : {}),
    status: 'SUCCESS',
    appVersion: APP_VERSION,
    scope: {
      bookIds: bookIds ?? 'all',
      modules,
      includeAttachments,
    },
  }
  writeSnapshotMeta(meta)
  return meta
}

/** 创建快照（带进程内互斥） */
export function createSnapshot(opts: CreateSnapshotOptions): Promise<BackupSnapshotMeta> {
  return withBackupLock(() => createSnapshotUnlocked(opts))
}

export interface RestoreSnapshotOptions {
  /** 是否在恢复前创建安全备份，默认 true */
  safetyBackup?: boolean
}

/** 从服务端快照恢复；默认先创建一份同范围的安全备份 */
export function restoreSnapshot(id: string, opts: RestoreSnapshotOptions = {}) {
  return withBackupLock(async () => {
    const meta = getSnapshot(id)
    if (!meta) {
      throw Object.assign(new Error('快照不存在或文件已丢失'), { statusCode: 404 })
    }
    if (meta.status !== 'SUCCESS') {
      throw Object.assign(new Error('该快照不可恢复'), { statusCode: 400 })
    }

    let safetySnapshotId: string | null = null
    if (opts.safetyBackup !== false) {
      const safety = await createSnapshotUnlocked({
        trigger: 'SAFETY',
        bookIds: meta.scope.bookIds === 'all' ? undefined : meta.scope.bookIds,
        modules: meta.scope.modules,
        includeAttachments: meta.scope.includeAttachments,
      })
      safetySnapshotId = safety.id
    }

    const zipPath = snapshotZipPath(id)
    if (!fs.existsSync(zipPath)) {
      throw Object.assign(new Error('快照文件已丢失'), { statusCode: 404 })
    }

    const result = await importBackup(zipPath)
    return { ...result, safetySnapshotId }
  })
}

/** 定时备份成功后清理该频率超额的定时快照 */
export function cleanupAfterScheduledBackup(frequency: BackupFrequency, retention: number): number {
  return pruneScheduledSnapshots(frequency, retention)
}

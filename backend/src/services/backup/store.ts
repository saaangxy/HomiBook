import fs from 'fs'
import path from 'path'
import crypto from 'crypto'
import { CronExpressionParser } from 'cron-parser'
import {
  BACKUP_SCHEDULES,
  DEFAULT_BACKUP_RETENTION,
  createDefaultBackupSettings,
  type BackupFrequency,
  type BackupLastResult,
  type BackupScheduleState,
  type BackupSettings,
  type BackupSnapshotMeta,
} from '@homibook/core'

/** 备份目录：默认 <cwd>/backups，可用 BACKUP_DIR 覆盖（Docker 需挂载持久化卷） */
export function backupDir(): string {
  return process.env.BACKUP_DIR || path.join(process.cwd(), 'backups')
}

export function ensureBackupDir(): string {
  const dir = backupDir()
  fs.mkdirSync(dir, { recursive: true })
  return dir
}

function settingsFile(): string {
  return path.join(backupDir(), 'settings.json')
}

/** 快照 ID 只允许固定格式，避免路径穿越 */
const SNAPSHOT_ID_RE = /^bk_\d{8}_\d{6}_[a-f0-9]{6}$/

function assertSnapshotId(id: string) {
  if (!SNAPSHOT_ID_RE.test(id)) {
    throw Object.assign(new Error('快照 ID 无效'), { statusCode: 400 })
  }
}

function clampRetention(value: unknown): number {
  const n = Number(value)
  if (!Number.isFinite(n)) return DEFAULT_BACKUP_RETENTION
  return Math.min(30, Math.max(1, Math.round(n)))
}

function normalizeLastResult(raw: unknown): BackupLastResult | null {
  if (!raw || typeof raw !== 'object') return null
  const input = raw as Partial<BackupLastResult>
  if (typeof input.at !== 'string') return null
  return {
    at: input.at,
    status: input.status === 'FAILED' ? 'FAILED' : 'SUCCESS',
    ...(typeof input.error === 'string' ? { error: input.error } : {}),
  }
}

function normalizeSchedule(raw: unknown): BackupScheduleState {
  const input = (raw && typeof raw === 'object' ? raw : {}) as Partial<BackupScheduleState>
  return {
    enabled: input.enabled === true,
    retention: clampRetention(input.retention),
    nextRunAt: typeof input.nextRunAt === 'string' ? input.nextRunAt : null,
    lastRunAt: typeof input.lastRunAt === 'string' ? input.lastRunAt : null,
    lastResult: normalizeLastResult(input.lastResult),
  }
}

/** 容错读取 settings.json 里的字段，保证返回完整结构；兼容旧的单频率配置 */
export function normalizeBackupSettings(raw: unknown): BackupSettings {
  const input = (raw && typeof raw === 'object' ? raw : {}) as Partial<BackupSettings> & {
    autoEnabled?: boolean
    cron?: string
    retention?: number
  }
  const defaults = createDefaultBackupSettings()
  const rawSchedules = (input.schedules && typeof input.schedules === 'object' ? input.schedules : {}) as Record<string, unknown>

  // 旧格式（autoEnabled + cron + retention）：映射到对应频率，配置读一次后即转为新结构
  const legacyFrequency: BackupFrequency | null =
    input.autoEnabled === true
      ? (BACKUP_SCHEDULES.find((s) => s.cron === input.cron)?.key ?? 'daily')
      : null

  const schedules = {} as Record<BackupFrequency, BackupScheduleState>
  for (const preset of BACKUP_SCHEDULES) {
    const state = rawSchedules[preset.key] === undefined
      ? defaults.schedules[preset.key]
      : normalizeSchedule(rawSchedules[preset.key])
    if (legacyFrequency === preset.key && rawSchedules[preset.key] === undefined) {
      state.enabled = true
      state.retention = clampRetention(input.retention)
    }
    schedules[preset.key] = state
  }

  return {
    includeAttachments: input.includeAttachments !== false,
    schedules,
  }
}

export function readBackupSettings(): BackupSettings {
  ensureBackupDir()
  try {
    const raw = fs.readFileSync(settingsFile(), 'utf8')
    return normalizeBackupSettings(JSON.parse(raw))
  } catch {
    return createDefaultBackupSettings()
  }
}

/** 合并写入（原子写，避免进程中断留下半个 JSON） */
export function writeBackupSettings(patch: Partial<BackupSettings>): BackupSettings {
  ensureBackupDir()
  const current = readBackupSettings()
  const clean = Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined))
  const next = normalizeBackupSettings({
    ...current,
    ...clean,
    schedules: patch.schedules ? { ...current.schedules, ...patch.schedules } : current.schedules,
  })
  const file = settingsFile()
  const tmp = `${file}.tmp`
  fs.writeFileSync(tmp, JSON.stringify(next, null, 2), 'utf8')
  fs.renameSync(tmp, file)
  return next
}

/** 只更新某个频率的配置/状态，其余频率保持不变 */
export function updateBackupSchedule(
  frequency: BackupFrequency,
  patch: Partial<BackupScheduleState>,
): BackupSettings {
  const current = readBackupSettings()
  return writeBackupSettings({
    schedules: {
      ...current.schedules,
      [frequency]: { ...current.schedules[frequency], ...patch },
    },
  })
}

export function newSnapshotId(now: Date = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0')
  const stamp = `${now.getFullYear()}${p(now.getMonth() + 1)}${p(now.getDate())}_${p(now.getHours())}${p(now.getMinutes())}${p(now.getSeconds())}`
  return `bk_${stamp}_${crypto.randomBytes(3).toString('hex')}`
}

export function snapshotZipPath(id: string): string {
  assertSnapshotId(id)
  return path.join(backupDir(), `${id}.zip`)
}

function snapshotMetaPath(id: string): string {
  assertSnapshotId(id)
  return path.join(backupDir(), `${id}.json`)
}

export function tempSnapshotPath(id: string): string {
  assertSnapshotId(id)
  return path.join(backupDir(), `.tmp-${id}.zip`)
}

/** 落盘：临时文件写完后重命名，避免列表里出现半成品 */
export function commitSnapshotFile(tempPath: string, id: string): number {
  const target = snapshotZipPath(id)
  fs.renameSync(tempPath, target)
  return fs.statSync(target).size
}

export function writeSnapshotMeta(meta: BackupSnapshotMeta): void {
  const file = snapshotMetaPath(meta.id)
  const tmp = `${file}.tmp`
  fs.writeFileSync(tmp, JSON.stringify(meta, null, 2), 'utf8')
  fs.renameSync(tmp, file)
}

export function readSnapshotMeta(id: string): BackupSnapshotMeta | null {
  try {
    assertSnapshotId(id)
    const raw = fs.readFileSync(snapshotMetaPath(id), 'utf8')
    const meta = JSON.parse(raw) as BackupSnapshotMeta
    return meta && meta.id === id ? meta : null
  } catch {
    return null
  }
}

/** 快照列表（仅包含 zip 仍存在的条目），按创建时间倒序 */
export function listSnapshots(): BackupSnapshotMeta[] {
  ensureBackupDir()
  let files: string[] = []
  try {
    files = fs.readdirSync(backupDir()).filter((name) => name.endsWith('.json') && name !== 'settings.json')
  } catch {
    return []
  }

  const list: BackupSnapshotMeta[] = []
  for (const file of files) {
    const id = file.slice(0, -'.json'.length)
    const meta = readSnapshotMeta(id)
    if (!meta) continue
    if (!fs.existsSync(snapshotZipPath(id))) continue
    list.push(meta)
  }
  return list.sort((a, b) => b.createdAt.localeCompare(a.createdAt))
}

/** 读取快照并确认 zip 存在 */
export function getSnapshot(id: string): BackupSnapshotMeta | null {
  const meta = readSnapshotMeta(id)
  if (!meta) return null
  if (!fs.existsSync(snapshotZipPath(id))) return null
  return meta
}

export function deleteSnapshotFiles(id: string): void {
  const zip = snapshotZipPath(id)
  const meta = snapshotMetaPath(id)
  fs.rmSync(zip, { force: true })
  fs.rmSync(meta, { force: true })
}

/** 仅清理该频率超额的定时快照；手动/安全备份永不自动删除 */
export function pruneScheduledSnapshots(frequency: BackupFrequency, retention: number): number {
  const scheduled = listSnapshots()
    .filter((m) => m.trigger === 'SCHEDULED' && m.schedule === frequency && m.status === 'SUCCESS')
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))

  const limit = clampRetention(retention)
  const expired = scheduled.slice(limit)
  for (const meta of expired) {
    try {
      deleteSnapshotFiles(meta.id)
    } catch (e) {
      console.warn(`[Backup] 清理快照失败 ${meta.id}:`, e)
    }
  }
  return expired.length
}

// ── 进程内互斥：同一时间只允许一个备份/恢复任务 ──

let running = false

export function isBackupBusy(): boolean {
  return running
}

export async function withBackupLock<T>(fn: () => Promise<T>): Promise<T> {
  if (running) {
    throw Object.assign(new Error('备份或恢复正在进行中，请稍后重试'), { statusCode: 409 })
  }
  running = true
  try {
    return await fn()
  } finally {
    running = false
  }
}

// ── 定时表达式 ──

export function computeNextRunAt(cron: string, from: Date = new Date()): Date | null {
  try {
    const interval = CronExpressionParser.parse(cron, { currentDate: from })
    return interval.next().toDate()
  } catch {
    return null
  }
}

export function isValidCron(cron: string): boolean {
  return computeNextRunAt(cron) !== null
}

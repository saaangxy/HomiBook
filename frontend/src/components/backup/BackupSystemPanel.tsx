import {
  BACKUP_FREQUENCY_LABELS,
  BACKUP_SCHEDULES,
  BACKUP_TRIGGER_LABELS,
  RETENTION_OPTIONS,
  createDefaultBackupSettings,
  errorMessage,
  formatBytes,
  type BackupSettings,
  type BackupSnapshotMeta,
} from '@homibook/core'
import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import { Badge } from '@/components/ui/badge'
import { Spinner } from '@/components/ui/spinner'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { backupApi } from '@/api/backup'
import { useAuthStore } from '@/stores/auth'
import { toast } from 'sonner'
import { Download, Loader2, RefreshCw, RotateCcw, ShieldCheck, Trash2 } from 'lucide-react'

/** 紧凑时间格式：2026/11/27 03:00 */
function formatTime(iso: string | null | undefined): string {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}/${p(d.getMonth() + 1)}/${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}

/** 服务端快照备份：全量手动备份、每天/每周/每月定期备份、随时还原 */
export function BackupSystemPanel() {
  const navigate = useNavigate()

  // ---- 备份设置 ----
  const [includeAttachments, setIncludeAttachments] = useState(true)
  const [schedules, setSchedules] = useState<BackupSettings['schedules']>(
    () => createDefaultBackupSettings().schedules,
  )
  const [savingSettings, setSavingSettings] = useState(false)

  // ---- 立即备份 ----
  const [backingUp, setBackingUp] = useState(false)

  // ---- 快照列表 ----
  const [snapshots, setSnapshots] = useState<BackupSnapshotMeta[]>([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)

  // ---- 恢复 ----
  const [restoreTarget, setRestoreTarget] = useState<BackupSnapshotMeta | null>(null)
  const [safetyBackup, setSafetyBackup] = useState(true)
  const [restoreAck, setRestoreAck] = useState(false)
  const [restoring, setRestoring] = useState(false)

  // ---- 删除 ----
  const [deleteTarget, setDeleteTarget] = useState<BackupSnapshotMeta | null>(null)

  const loadSettings = () => {
    backupApi
      .getSettings()
      .then((s) => {
        setIncludeAttachments(s.includeAttachments)
        setSchedules(s.schedules)
      })
      .catch((e) => toast.error(errorMessage(e)))
  }

  const loadSnapshots = (silent = false) => {
    if (!silent) setRefreshing(true)
    backupApi
      .listSnapshots()
      .then(setSnapshots)
      .catch((e) => toast.error(errorMessage(e)))
      .finally(() => {
        setRefreshing(false)
        setLoading(false)
      })
  }

  useEffect(() => {
    loadSettings()
    loadSnapshots(true)
  }, [])

  const patchSchedule = (key: keyof BackupSettings['schedules'], patch: { enabled?: boolean; retention?: number }) => {
    setSchedules((prev) => ({ ...prev, [key]: { ...prev[key], ...patch } }))
  }

  const saveSettings = async () => {
    setSavingSettings(true)
    try {
      const next = await backupApi.updateSettings({
        includeAttachments,
        schedules: {
          daily: { enabled: schedules.daily.enabled, retention: schedules.daily.retention },
          weekly: { enabled: schedules.weekly.enabled, retention: schedules.weekly.retention },
          monthly: { enabled: schedules.monthly.enabled, retention: schedules.monthly.retention },
        },
      })
      setIncludeAttachments(next.includeAttachments)
      setSchedules(next.schedules)
      toast.success('备份设置已保存')
    } catch (e) {
      toast.error(errorMessage(e))
    } finally {
      setSavingSettings(false)
    }
  }

  const createBackup = async () => {
    setBackingUp(true)
    try {
      const meta = await backupApi.createSnapshot({ includeAttachments })
      setSnapshots((prev) => [meta, ...prev])
      toast.success(`备份完成，共 ${formatBytes(meta.size)}`)
    } catch (e) {
      toast.error(errorMessage(e))
    } finally {
      setBackingUp(false)
    }
  }

  const confirmDelete = async () => {
    if (!deleteTarget) return
    try {
      await backupApi.deleteSnapshot(deleteTarget.id)
      setSnapshots((prev) => prev.filter((s) => s.id !== deleteTarget.id))
      toast.success('备份已删除')
    } catch (e) {
      toast.error(errorMessage(e))
    } finally {
      setDeleteTarget(null)
    }
  }

  const downloadSnapshot = async (meta: BackupSnapshotMeta) => {
    try {
      await backupApi.downloadSnapshot(meta.id)
    } catch (e) {
      toast.error(errorMessage(e))
    }
  }

  const confirmRestore = async () => {
    if (!restoreTarget) return
    setRestoring(true)
    try {
      const result = await backupApi.restoreSnapshot(restoreTarget.id, { safetyBackup })
      toast.success(
        result.safetySnapshotId
          ? '恢复完成，已创建安全备份，请重新登录'
          : '恢复完成，请重新登录',
      )
      setRestoreTarget(null)
      setRestoreAck(false)
      // 恢复后数据已整体替换，清空登录态避免旧缓存/旧用户
      useAuthStore.getState().logout()
      setTimeout(() => navigate('/login', { replace: true }), 800)
    } catch (e) {
      toast.error(errorMessage(e))
    } finally {
      setRestoring(false)
    }
  }

  return (
    <div className="space-y-3">
      {/* 备份设置 */}
      <div className="rounded-xl border overflow-hidden">
        {/* 标题 + 附件开关 */}
        <div className="flex items-center justify-between gap-4 px-4 py-2.5">
          <div className="min-w-0">
            <div className="text-sm font-medium">备份设置</div>
          </div>
          <label className="flex items-center gap-2 text-xs text-muted-foreground shrink-0">
            含附件
            <Switch checked={includeAttachments} onCheckedChange={setIncludeAttachments} />
          </label>
        </div>

        {/* 定期备份表头 */}
        <div className="flex items-baseline gap-2 border-t bg-muted/30 px-4 py-1.5">
          <span className="text-xs font-medium">定期备份</span>
        </div>

        {/* 三个频率行 */}
        {BACKUP_SCHEDULES.map((preset, i) => {
          const state = schedules[preset.key]
          return (
            <div
              key={preset.key}
              className={`flex flex-col gap-1.5 px-4 py-2 md:flex-row md:items-center md:gap-3 ${i > 0 ? 'border-t' : ''}`}
            >
              <div className="flex-1 min-w-0">
                <div className="flex items-baseline gap-2">
                  <span className="text-sm font-medium">{preset.label}</span>
                  <span className="text-[11px] text-muted-foreground">{preset.timeLabel}</span>
                </div>
                <div className="text-[11px] text-muted-foreground truncate">
                  上次 {formatTime(state.lastRunAt)}
                  {state.lastResult && (
                    <span className={state.lastResult.status === 'FAILED' ? 'text-destructive ml-1' : 'text-[#22c55e] ml-1'}>
                      {state.lastResult.status === 'FAILED' ? '失败' : '成功'}
                    </span>
                  )}
                  <span className="mx-1">·</span>
                  下次 {state.enabled ? formatTime(state.nextRunAt) : '未启用'}
                </div>
                {state.lastResult?.error && (
                  <div className="text-[11px] text-destructive truncate">{state.lastResult.error}</div>
                )}
              </div>

              <div className="flex items-center gap-2 shrink-0">
                <span className="text-[11px] text-muted-foreground">保留</span>
                <div className="flex gap-1">
                  {RETENTION_OPTIONS.map((n) => (
                    <Button
                      key={n}
                      type="button"
                      size="sm"
                      variant={state.retention === n ? 'default' : 'outline'}
                      className="h-6 px-2 text-[11px]"
                      onClick={() => patchSchedule(preset.key, { retention: n })}
                    >
                      {n} 份
                    </Button>
                  ))}
                </div>
                <Switch
                  checked={state.enabled}
                  onCheckedChange={(v) => patchSchedule(preset.key, { enabled: v })}
                />
              </div>
            </div>
          )
        })}

        {/* 底部操作 */}
        <div className="flex items-center justify-between gap-2 border-t px-4 py-2">
          <Button size="sm" variant="outline" onClick={createBackup} disabled={backingUp}>
            {backingUp ? <Loader2 size={14} className="animate-spin mr-1" /> : <ShieldCheck size={14} className="mr-1" />}
            立即备份
          </Button>
          <Button size="sm" onClick={saveSettings} disabled={savingSettings}>
            {savingSettings && <Loader2 size={14} className="animate-spin mr-1" />}
            保存设置
          </Button>
        </div>
      </div>

      {/* 快照列表 */}
      <div className="rounded-xl border overflow-hidden">
        <div className="flex items-center justify-between gap-3 px-4 py-2.5 border-b">
          <div>
            <div className="text-sm font-medium">备份记录</div>
            <p className="text-[11px] text-muted-foreground mt-0.5">
              保存在服务器 backups 目录，容器部署需持久化该目录
            </p>
          </div>
          <Button size="sm" variant="outline" className="h-7" onClick={() => loadSnapshots()} disabled={refreshing}>
            {refreshing ? <Loader2 size={13} className="animate-spin mr-1" /> : <RefreshCw size={13} className="mr-1" />}
            刷新
          </Button>
        </div>

        {loading ? (
          <Spinner className="py-6" />
        ) : snapshots.length === 0 ? (
          <div className="text-xs text-muted-foreground text-center py-6">还没有备份，先创建一个吧</div>
        ) : (
          <div className="divide-y">
            {snapshots.map((meta) => (
              <div key={meta.id} className="flex flex-col gap-1.5 px-4 py-2 md:flex-row md:items-center md:gap-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-xs font-medium">{formatTime(meta.createdAt)}</span>
                    <Badge
                      variant={meta.trigger === 'SAFETY' ? 'destructive' : 'secondary'}
                      className="text-[10px] px-1.5 py-0"
                    >
                      {meta.trigger === 'SCHEDULED' && meta.schedule
                        ? `${BACKUP_FREQUENCY_LABELS[meta.schedule]}定时`
                        : BACKUP_TRIGGER_LABELS[meta.trigger]}
                    </Badge>
                    <span className="text-[11px] text-muted-foreground">{formatBytes(meta.size)}</span>
                  </div>
                </div>
                <div className="flex gap-1.5 shrink-0">
                  <Button size="sm" variant="outline" className="h-7 px-2 text-xs" onClick={() => setRestoreTarget(meta)}>
                    <RotateCcw size={12} className="mr-1" />
                    恢复
                  </Button>
                  <Button size="sm" variant="outline" className="h-7 px-2 text-xs" onClick={() => downloadSnapshot(meta)}>
                    <Download size={12} className="mr-1" />
                    下载
                  </Button>
                  <Button size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={() => setDeleteTarget(meta)} title="删除">
                    <Trash2 size={13} className="text-destructive" />
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* 恢复确认 */}
      <AlertDialog
        open={!!restoreTarget}
        onOpenChange={(open) => {
          if (!open && !restoring) {
            setRestoreTarget(null)
            setRestoreAck(false)
          }
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>从备份恢复</AlertDialogTitle>
            <AlertDialogDescription>
              将<strong>清空当前全部数据</strong>并恢复
              {restoreTarget ? ` ${formatTime(restoreTarget.createdAt)} 的备份` : '所选备份'}，
              恢复完成后需要重新登录。此操作不可撤销，请谨慎确认。
            </AlertDialogDescription>
          </AlertDialogHeader>

          <div className="space-y-3 text-sm">
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                className="rounded"
                checked={safetyBackup}
                onChange={(e) => setSafetyBackup(e.target.checked)}
              />
              恢复前自动创建安全备份
            </label>
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                className="rounded"
                checked={restoreAck}
                onChange={(e) => setRestoreAck(e.target.checked)}
              />
              我已知晓该操作会覆盖当前全部数据
            </label>
          </div>

          <AlertDialogFooter>
            <Button variant="outline" onClick={() => setRestoreTarget(null)} disabled={restoring}>
              取消
            </Button>
            <Button variant="destructive" onClick={confirmRestore} disabled={!restoreAck || restoring}>
              {restoring && <Loader2 size={14} className="animate-spin mr-1" />}
              确认恢复
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* 删除确认 */}
      <AlertDialog open={!!deleteTarget} onOpenChange={(open) => { if (!open) setDeleteTarget(null) }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>删除备份</AlertDialogTitle>
            <AlertDialogDescription>
              确定要删除 {deleteTarget ? formatTime(deleteTarget.createdAt) : '所选'} 的备份吗？此操作不可撤销。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction className="bg-[#ef4444] hover:bg-[#dc2626]" onClick={confirmDelete}>
              确认删除
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

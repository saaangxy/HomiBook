import { useEffect, useState } from 'react'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import { Button } from '@/components/ui/button'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Spinner } from '@/components/ui/spinner'
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { toast } from 'sonner'
import { Download, Upload, Loader2, Database, FileArchive, Check } from 'lucide-react'
import {
  backupApi,
  BACKUP_MODULES,
  type BackupBook,
  type BackupInspectResult,
  type ImportResult,
} from '@/api/backup'

const TABLE_LABELS: Record<string, string> = {
  user: '用户',
  systemConfig: '系统配置',
  dictionary: '字典',
  holiday: '节假日',
  accountBook: '账本',
  accountBookMember: '账本成员',
  shareCode: '分享码',
  account: '账户',
  balanceAdjustment: '余额调整',
  record: '流水',
  recordAttachment: '附件',
  budget: '预算',
  recurringTransaction: '固定收支',
  repaymentPlan: '还款计划',
  importCategoryMapping: '导入分类映射',
  importAccountMapping: '导入账户映射',
  userAIConfig: 'AI配置',
  userProviderConfig: 'AI提供商',
  apiKey: 'API Key',
  chatSession: '聊天会话',
  chatMessage: '聊天消息',
  userMemory: '用户记忆',
  agentAuditLog: '审计日志',
}

export function DataMigrationPanel() {
  const [tab, setTab] = useState('export')

  // ---- 账本 ----
  const [books, setBooks] = useState<BackupBook[]>([])
  const [booksLoading, setBooksLoading] = useState(true)
  const [bookScope, setBookScope] = useState<'all' | 'selected'>('all')
  const [selectedBookIds, setSelectedBookIds] = useState<Set<string>>(new Set())

  // ---- 模块 ----
  // 核心数据是整体开关（不能按模块单独选），勾选即整体打包导出
  const [coreChecked, setCoreChecked] = useState(true)
  // 可选模块按需勾选，默认全部勾选
  const [modules, setModules] = useState<Set<string>>(() => {
    const optional = BACKUP_MODULES.filter((m) => !m.core).map((m) => m.key)
    return new Set(optional)
  })

  const [exporting, setExporting] = useState<'full' | 'attachments' | null>(null)
  const [exportCounts, setExportCounts] = useState<Record<string, number> | null>(null)

  // ---- 导入 ----
  const [importFile, setImportFile] = useState<File | null>(null)
  const [inspecting, setInspecting] = useState(false)
  const [inspectResult, setInspectResult] = useState<BackupInspectResult | null>(null)
  const [inspectError, setInspectError] = useState('')
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [ackChecked, setAckChecked] = useState(false)
  const [importing, setImporting] = useState(false)
  const [importResult, setImportResult] = useState<ImportResult | null>(null)

  useEffect(() => {
    backupApi
      .listBooks()
      .then((list) => {
        setBooks(list)
        setSelectedBookIds(new Set(list.map((b) => b.id)))
      })
      .catch(() => toast.error('加载账本列表失败'))
      .finally(() => setBooksLoading(false))
  }, [])

  const effectiveBookIds = bookScope === 'selected' ? Array.from(selectedBookIds) : undefined
  const selectedCount = effectiveBookIds?.length ?? books.length

  const toggleModule = (key: string) => {
    setModules((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  const toggleBook = (id: string) => {
    setSelectedBookIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const handleExport = async (scope: 'full' | 'attachments') => {
    if (bookScope === 'selected' && (!effectiveBookIds || effectiveBookIds.length === 0)) {
      toast.error('请至少选择一个账本')
      return
    }
    // 核心整体打包：勾选则带上全部核心模块；取消则只导出可选模块
    const coreKeys = BACKUP_MODULES.filter((m) => m.core).map((m) => m.key)
    const exportModules = coreChecked ? [...coreKeys, ...Array.from(modules)] : Array.from(modules)
    if (scope === 'full' && exportModules.length === 0) {
      toast.error('请至少选择一个数据模块')
      return
    }
    setExporting(scope)
    setExportCounts(null)
    try {
      const counts = await backupApi.exportBackup({
        scope,
        bookIds: effectiveBookIds,
        modules: scope === 'full' ? exportModules : undefined,
        includeAttachments: scope === 'full' ? modules.has('attachments') : undefined,
      })
      setExportCounts(counts)
      toast.success(scope === 'full' ? '数据包已导出' : '附件包已导出')
    } catch (e: any) {
      toast.error(`导出失败：${e.message}`)
    } finally {
      setExporting(null)
    }
  }

  const handleFileChange = (file: File | null) => {
    setImportFile(file)
    setInspectResult(null)
    setInspectError('')
    setImportResult(null)
    setAckChecked(false)
    if (!file) return
    setInspecting(true)
    backupApi
      .inspectBackup(file)
      .then(setInspectResult)
      .catch((e: any) => setInspectError(e.message))
      .finally(() => setInspecting(false))
  }

  const openConfirm = () => {
    if (!importFile) return
    setAckChecked(false)
    setConfirmOpen(true)
  }

  const handleImport = async () => {
    if (!importFile) return
    setConfirmOpen(false)
    setImporting(true)
    try {
      const result = await backupApi.importBackup(importFile)
      setImportResult(result)
      if (result.scope === 'full') {
        toast.success('数据导入完成，请重新登录')
      } else {
        toast.success('附件导入完成')
      }
    } catch (e: any) {
      toast.error(`导入失败：${e.message}`)
    } finally {
      setImporting(false)
    }
  }

  const coreModules = BACKUP_MODULES.filter((m) => m.core)
  const optionalModules = BACKUP_MODULES.filter((m) => !m.core)

  return (
    <div className="space-y-4">
      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="mb-4">
          <TabsTrigger value="export">
            <Download size={14} className="mr-1.5" />
            导出
          </TabsTrigger>
          <TabsTrigger value="import">
            <Upload size={14} className="mr-1.5" />
            导入
          </TabsTrigger>
        </TabsList>

        {/* ==================== 导出 ==================== */}
        <TabsContent value="export" className="space-y-4">
          <Alert>
            <AlertDescription className="text-xs">
              导出为 zip 压缩包，包含所选模块数据。备份包含敏感数据（密码哈希、API Key 等），请妥善保管。
              迁移数据库时建议导出全部数据与附件。
            </AlertDescription>
          </Alert>

          {/* 账本范围 */}
          <div className="space-y-2">
            <span className="text-xs text-muted-foreground font-medium">账本范围</span>
            <div className="flex gap-4">
              <label className="flex items-center gap-1.5 text-sm cursor-pointer">
                <input
                  type="radio"
                  checked={bookScope === 'all'}
                  onChange={() => setBookScope('all')}
                  className="rounded-full"
                />
                全部账本（{books.length}）
              </label>
              <label className="flex items-center gap-1.5 text-sm cursor-pointer">
                <input
                  type="radio"
                  checked={bookScope === 'selected'}
                  onChange={() => setBookScope('selected')}
                  className="rounded-full"
                />
                指定账本（{selectedCount}）
              </label>
            </div>
            {bookScope === 'selected' && (
              <div className="rounded border p-2 space-y-1 max-h-40 overflow-y-auto">
                {booksLoading ? (
                  <Spinner className="py-2" />
                ) : books.length === 0 ? (
                  <p className="text-xs text-muted-foreground py-1">暂无账本</p>
                ) : (
                  books.map((b) => (
                    <label key={b.id} className="flex items-center gap-1.5 text-sm cursor-pointer">
                      <input
                        type="checkbox"
                        checked={selectedBookIds.has(b.id)}
                        onChange={() => toggleBook(b.id)}
                        className="rounded"
                      />
                      {b.name}
                    </label>
                  ))
                )}
              </div>
            )}
          </div>

          {/* 模块选择 */}
          <div className="space-y-2">
            <span className="text-xs text-muted-foreground font-medium">数据模块</span>
            <div className="rounded border p-2 space-y-1.5">
              {/* 核心数据：整体开关，勾选即打包导出全部核心，不可按模块单独选 */}
              <label className="flex items-center gap-1.5 text-sm cursor-pointer">
                <input
                  type="checkbox"
                  checked={coreChecked}
                  onChange={(e) => setCoreChecked(e.target.checked)}
                  className="rounded"
                />
                <span>核心数据（{coreModules.map((m) => m.label).join(' · ')}）</span>
              </label>
              {!coreChecked && (
                <p className="text-[11px] text-amber-600 pl-5">
                  已取消核心数据，将只导出下方勾选的可选数据（部分可选数据依赖核心实体，导入需谨慎）
                </p>
              )}
              <div className="text-[11px] text-muted-foreground pt-2 pb-1 border-t">可选数据</div>
              <p className="text-[11px] text-muted-foreground pl-5 pb-1">
                字典、节假日、导入映射可独立导出；其余模块依赖核心数据（用户/账本/账户/流水），未勾选核心数据时只能存档，导入会因缺少关联数据而失败。
              </p>
              <div className="grid grid-cols-2 md:grid-cols-3 gap-x-4 gap-y-1">
                {optionalModules.map((m) => (
                  <label key={m.key} className="flex items-center gap-1.5 text-sm cursor-pointer">
                    <input
                      type="checkbox"
                      checked={modules.has(m.key)}
                      onChange={() => toggleModule(m.key)}
                      className="rounded"
                    />
                    <span>{m.label}</span>
                  </label>
                ))}
              </div>
            </div>
          </div>

          <div className="flex gap-3">
            <Button
              size="sm"
              onClick={() => handleExport('full')}
              disabled={exporting !== null || (bookScope === 'selected' && selectedCount === 0)}
            >
              {exporting === 'full' ? <Loader2 size={14} className="animate-spin mr-1" /> : <Download size={14} className="mr-1" />}
              导出数据包
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => handleExport('attachments')}
              disabled={exporting !== null || (bookScope === 'selected' && selectedCount === 0)}
            >
              {exporting === 'attachments' ? <Loader2 size={14} className="animate-spin mr-1" /> : <FileArchive size={14} className="mr-1" />}
              单独导出附件包
            </Button>
          </div>

          {exportCounts && (
            <div className="rounded-lg p-3 text-xs bg-[#22c55e]/10 border border-[#22c55e]/30">
              <div className="flex items-center gap-2 mb-2">
                <Check size={16} className="text-[#22c55e]" />
                <span className="font-medium">导出完成</span>
              </div>
              <div className="flex flex-wrap gap-x-4 gap-y-0.5">
                {Object.entries(exportCounts)
                  .filter(([, n]) => n > 0)
                  .map(([table, n]) => (
                    <span key={table} className="text-muted-foreground">
                      {TABLE_LABELS[table] || table}: <strong className="text-foreground">{n}</strong>
                    </span>
                  ))}
              </div>
            </div>
          )}
        </TabsContent>

        {/* ==================== 导入 ==================== */}
        <TabsContent value="import" className="space-y-4">
          <div className="flex items-center gap-3">
            <Button
              variant="outline"
              size="sm"
              onClick={() => document.getElementById('backup-file-input')?.click()}
            >
              <Database size={14} className="mr-1" />
              选择 zip 备份文件
            </Button>
            <input
              id="backup-file-input"
              type="file"
              accept=".zip"
              className="hidden"
              onChange={(e) => handleFileChange(e.target.files?.[0] ?? null)}
            />
            {importFile && (
              <span className="text-xs text-muted-foreground truncate max-w-64">{importFile.name}</span>
            )}
          </div>

          {inspecting && <Spinner className="py-3" />}

          {inspectError && (
            <Alert variant="destructive">
              <AlertDescription className="text-xs">{inspectError}</AlertDescription>
            </Alert>
          )}

          {inspectResult && (
            <div className="space-y-3">
              {inspectResult.scope === 'full' ? (
                <Alert variant="destructive">
                  <AlertDescription className="text-xs">
                    检测到<strong> 数据包 </strong>（导出于 {inspectResult.exportedAt ? new Date(inspectResult.exportedAt).toLocaleString('zh-CN') : '未知时间'}
                    {inspectResult.appVersion ? `，版本 ${inspectResult.appVersion}` : ''}）。
                    导入将<strong>清空当前全部数据</strong>并用备份完整恢复，此操作<strong>不可撤销</strong>，请谨慎操作。
                  </AlertDescription>
                </Alert>
              ) : (
                <Alert className="border-green-600/40 bg-green-50 dark:bg-green-950/20">
                  <AlertDescription className="text-xs">
                    检测到<strong> 附件包</strong>（导出于 {inspectResult.exportedAt ? new Date(inspectResult.exportedAt).toLocaleString('zh-CN') : '未知时间'}
                    {inspectResult.appVersion ? `，版本 ${inspectResult.appVersion}` : ''}）。
                    将<strong>合并导入附件</strong>，不会清空现有数据。
                  </AlertDescription>
                </Alert>
              )}

              <Button
                size="sm"
                onClick={openConfirm}
                disabled={!importFile || importing}
                className={inspectResult.scope === 'full' ? 'bg-[#ef4444] hover:bg-[#dc2626] text-white' : undefined}
              >
                {importing ? <Loader2 size={14} className="animate-spin mr-1" /> : <Upload size={14} className="mr-1" />}
                {inspectResult.scope === 'full' ? '开始覆盖导入' : '开始导入附件'}
              </Button>
            </div>
          )}

          {importResult && (
            <div className="rounded-lg p-3 text-xs bg-green-50 border border-green-200">
              <p className="font-medium mb-1">导入完成</p>
              {importResult.scope === 'full' && (
                <p className="mb-1 text-muted-foreground">已导入数据，请重新登录。</p>
              )}
              <div className="flex flex-wrap gap-x-4 gap-y-0.5">
                {Object.entries(importResult.results).map(([table, count]) => (
                  <span key={table} className="text-muted-foreground">
                    {table}: <strong className="text-foreground">{count}</strong>
                  </span>
                ))}
              </div>
              <p className="text-muted-foreground mt-1">
                恢复附件文件：<strong>{importResult.attachmentsRestored}</strong>
                {typeof importResult.skipped === 'number' && importResult.skipped > 0 && (
                  <>（跳过 {importResult.skipped} 条孤儿数据）</>
                )}
              </p>
            </div>
          )}
        </TabsContent>
      </Tabs>

      {/* 导入确认弹窗 */}
      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{inspectResult?.scope === 'attachments' ? '导入附件' : '确认覆盖导入'}</AlertDialogTitle>
            <AlertDialogDescription>
              {inspectResult?.scope === 'attachments' ? (
                <span>将合并导入所选附件，不会修改现有数据。</span>
              ) : (
                <span className="space-y-2 block">
                  <span className="block">
                    此操作将<strong className="text-[#ef4444]">清空当前全部数据</strong>（用户、账本、流水、配置等），
                    用备份中的数据完整恢复，<strong className="text-[#ef4444]">不可撤销</strong>。
                  </span>
                  <label className="flex items-center gap-2 text-xs cursor-pointer">
                    <input
                      type="checkbox"
                      checked={ackChecked}
                      onChange={(e) => setAckChecked(e.target.checked)}
                      className="rounded"
                    />
                    我已知晓将覆盖现有数据
                  </label>
                </span>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <Button variant="outline" size="sm" onClick={() => setConfirmOpen(false)}>
              取消
            </Button>
            <Button
              size="sm"
              onClick={handleImport}
              disabled={inspectResult?.scope === 'full' && !ackChecked}
              className={inspectResult?.scope === 'full' ? 'bg-[#ef4444] hover:bg-[#dc2626] text-white' : undefined}
            >
              {importing ? '导入中...' : '确认导入'}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

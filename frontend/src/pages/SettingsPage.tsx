import { useState, useEffect, useCallback } from 'react'
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Alert, AlertDescription } from '@/components/ui/alert'
import {
  Dialog,
  DialogTrigger,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog'
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from '@/components/ui/table'
import { Spinner } from '@/components/ui/spinner'
import { settingsApi, type DictItem } from '@/api/settings'
import { holidayApi } from '@/api/holiday'
import { Plus, Pencil, Trash2, Settings, BookOpen, Check, FolderOpen, FileSearch, RefreshCw } from 'lucide-react'

const DICT_GROUPS: { key: string; label: string }[] = [
  { key: 'account_type', label: '账户类型' },
  { key: 'bank_name', label: '开户行' },
  { key: 'transaction_category_income', label: '收入分类' },
  { key: 'transaction_category_expense', label: '支出分类' },
  { key: 'transaction_category_transfer', label: '转账分类' },
]

const CURRENCIES = ['CNY', 'USD', 'EUR', 'JPY', 'GBP', 'HKD']

const HOLIDAY_API_OPTIONS = [
  { value: 'https://timor.tech/api/holiday/year/{year}', label: 'timor.tech（免费，推荐）' },
  { value: 'https://api.jiejiariapi.com/v1/holidays/{year}', label: 'jiejiariapi.com（备选）' },
]

export function SettingsPage() {
  // 通用设置
  const [registrationOpen, setRegistrationOpen] = useState(true)
  const [defaultCurrency, setDefaultCurrency] = useState('CNY')
  const [amountHighlightThreshold, setAmountHighlightThreshold] = useState(1000)
  const [holidayApiUrl, setHolidayApiUrl] = useState('https://timor.tech/api/holiday/year/{year}')
  const [configLoading, setConfigLoading] = useState(true)
  const [configSaving, setConfigSaving] = useState(false)
  const [configError, setConfigError] = useState('')
  const [syncingHolidays, setSyncingHolidays] = useState(false)
  const [syncResult, setSyncResult] = useState('')

  // 字典管理
  const [dictTab, setDictTab] = useState('account_type')
  const [dictItems, setDictItems] = useState<DictItem[]>([])
  const [dictLoading, setDictLoading] = useState(false)
  const [dictError, setDictError] = useState('')

  // 字典弹窗
  const [addOpen, setAddOpen] = useState(false)
  const [editTarget, setEditTarget] = useState<DictItem | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<DictItem | null>(null)
  const [formLabel, setFormLabel] = useState('')
  const [formCode, setFormCode] = useState('')
  const [formOrder, setFormOrder] = useState('0')
  const [formError, setFormError] = useState('')
  const [submitting, setSubmitting] = useState(false)

  // 无效附件管理
  const [orphansLoading, setOrphansLoading] = useState(false)
  const [orphansCleaning, setOrphansCleaning] = useState(false)
  const [orphansError, setOrphansError] = useState('')
  const [orphansResult, setOrphansResult] = useState<{ count: number; files: number } | null>(null)
  const [cleanConfirmOpen, setCleanConfirmOpen] = useState(false)
  const [cleanResult, setCleanResult] = useState<{ deletedFiles: number; deletedRecords: number } | null>(null)

  // 加载通用配置
  useEffect(() => {
    setConfigLoading(true)
    settingsApi.getConfig()
      .then((config) => {
        if (typeof config.registrationOpen === 'boolean') setRegistrationOpen(config.registrationOpen)
        if (typeof config.defaultCurrency === 'string') setDefaultCurrency(config.defaultCurrency)
        if (typeof config.amountHighlightThreshold === 'number') setAmountHighlightThreshold(config.amountHighlightThreshold)
        if (typeof config.holidayApiUrl === 'string') setHolidayApiUrl(config.holidayApiUrl)
      })
      .catch(() => setConfigError('加载配置失败'))
      .finally(() => setConfigLoading(false))
  }, [])

  // 加载字典
  const loadDict = useCallback(async (group: string) => {
    setDictLoading(true)
    setDictError('')
    try {
      setDictItems(await settingsApi.getDictionary(group))
    } catch {
      setDictError('加载字典失败')
    } finally {
      setDictLoading(false)
    }
  }, [])

  useEffect(() => { loadDict(dictTab) }, [dictTab, loadDict])

  // 同步节假日
  const handleSyncHolidays = async () => {
    setSyncingHolidays(true)
    setSyncResult('')
    try {
      const result = await holidayApi.sync()
      setSyncResult(`同步完成，导入了 ${result.imported} 条节假日数据`)
    } catch (e: any) {
      setSyncResult(`同步失败：${e.message}`)
    } finally {
      setSyncingHolidays(false)
    }
  }

  // 保存配置
  const handleSaveConfig = async () => {
    setConfigSaving(true)
    setConfigError('')
    try {
      await settingsApi.updateConfig({ registrationOpen, defaultCurrency, amountHighlightThreshold, holidayApiUrl })
    } catch (e: any) {
      setConfigError(e.message)
    } finally {
      setConfigSaving(false)
    }
  }

  // 添加字典项
  const handleAdd = async () => {
    if (!formLabel.trim()) { setFormError('请输入名称'); return }
    setSubmitting(true)
    setFormError('')
    try {
      await settingsApi.createDictionaryItem({
        group: dictTab,
        code: formCode.trim() || formLabel.trim(),
        label: formLabel.trim(),
        order: parseInt(formOrder) || 0,
      })
      setAddOpen(false)
      resetForm()
      loadDict(dictTab)
    } catch (e: any) {
      setFormError(e.message)
    } finally {
      setSubmitting(false)
    }
  }

  // 编辑字典项
  const handleEdit = async () => {
    if (!editTarget) return
    if (!formLabel.trim()) { setFormError('请输入名称'); return }
    setSubmitting(true)
    setFormError('')
    try {
      await settingsApi.updateDictionaryItem(editTarget.id, {
        code: formCode.trim() || undefined,
        label: formLabel.trim(),
        order: parseInt(formOrder) || 0,
      })
      setEditTarget(null)
      resetForm()
      loadDict(dictTab)
    } catch (e: any) {
      setFormError(e.message)
    } finally {
      setSubmitting(false)
    }
  }

  // 删除字典项
  const handleDelete = async () => {
    if (!deleteTarget) return
    try {
      await settingsApi.deleteDictionaryItem(deleteTarget.id)
      setDeleteTarget(null)
      loadDict(dictTab)
    } catch (e: any) {
      setDictError(e.message)
    }
  }

  const resetForm = () => {
    setFormLabel('')
    setFormCode('')
    setFormOrder('0')
    setFormError('')
    setSubmitting(false)
  }

  const openEdit = (item: DictItem) => {
    setEditTarget(item)
    setFormLabel(item.label)
    setFormCode(item.code)
    setFormOrder(item.order.toString())
    setFormError('')
    setSubmitting(false)
  }

  // 查询无效附件
  const handleQueryOrphans = async () => {
    setOrphansLoading(true)
    setOrphansError('')
    setOrphansResult(null)
    setCleanResult(null)
    try {
      const items = await settingsApi.getOrphanAttachments()
      const files = items.filter((i) => i.fileExists).length
      setOrphansResult({ count: items.length, files })
    } catch (e: any) {
      setOrphansError(e.message)
    } finally {
      setOrphansLoading(false)
    }
  }

  // 清理无效附件
  const handleCleanOrphans = async () => {
    setCleanConfirmOpen(false)
    setOrphansCleaning(true)
    setOrphansError('')
    try {
      const result = await settingsApi.cleanOrphanAttachments()
      setCleanResult({ deletedFiles: result.deletedFiles, deletedRecords: result.deletedRecords })
      setOrphansResult(null)
    } catch (e: any) {
      setOrphansError(e.message)
    } finally {
      setOrphansCleaning(false)
    }
  }

  if (configLoading) {
    return <Spinner className="py-12" />
  }

  return (
    <div>
      <h1 className="text-xl font-bold mb-6">设置</h1>

      {configError && (
        <Alert variant="destructive" className="mb-6">
          <AlertDescription>{configError}</AlertDescription>
        </Alert>
      )}

      <Accordion type="multiple" defaultValue={['general', 'dictionary']} className="space-y-4">
        {/* 通用设置 */}
        <AccordionItem value="general" className="border rounded-xl px-5">
          <AccordionTrigger className="text-base font-semibold hover:no-underline">
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center">
                <Settings size={16} className="text-primary" />
              </div>
              通用设置
            </div>
          </AccordionTrigger>
          <AccordionContent className="pt-2 pb-5">
            <div className="space-y-5">
              {/* 开放注册 */}
              <div className="flex items-start justify-between gap-8">
                <div className="flex-1">
                  <h4 className="text-sm font-medium">开放注册</h4>
                  <p className="text-xs text-muted-foreground mt-1">
                    关闭后登录页面将隐藏注册入口，仅显示登录表单
                  </p>
                </div>
                <div className="flex items-center gap-1 bg-muted rounded-lg p-0.5">
                  <button
                    type="button"
                    onClick={() => setRegistrationOpen(true)}
                    className={`flex items-center gap-1 px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
                      registrationOpen
                        ? 'bg-background text-foreground shadow-sm'
                        : 'text-muted-foreground hover:text-foreground'
                    }`}
                  >
                    {registrationOpen && <Check size={12} />}
                    已开启
                  </button>
                  <button
                    type="button"
                    onClick={() => setRegistrationOpen(false)}
                    className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
                      !registrationOpen
                        ? 'bg-[#ef4444] text-white shadow-sm'
                        : 'text-muted-foreground hover:text-foreground'
                    }`}
                  >
                    已关闭
                  </button>
                </div>
              </div>

              {/* 分隔 */}
              <div className="border-t" />

              {/* 默认货币 */}
              <div className="flex items-start justify-between gap-8">
                <div className="flex-1">
                  <h4 className="text-sm font-medium">默认货币</h4>
                  <p className="text-xs text-muted-foreground mt-1">
                    新建账本时使用的默认货币单位
                  </p>
                </div>
                <Select value={defaultCurrency} onValueChange={setDefaultCurrency}>
                  <SelectTrigger className="w-28 bg-background border-border h-9">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="bg-card border-border">
                    {CURRENCIES.map((c) => (
                      <SelectItem key={c} value={c}>{c}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {/* 分隔 */}
              <div className="border-t" />

              {/* 支出高亮阈值 */}
              <div className="flex items-start justify-between gap-8">
                <div className="flex-1">
                  <h4 className="text-sm font-medium">支出高亮阈值</h4>
                  <p className="text-xs text-muted-foreground mt-1">
                    流水日历中当日支出超过此金额的日期将高亮显示（单位：元）
                  </p>
                </div>
                <Input
                  aria-label="支出高亮阈值"
                  type="number"
                  min="0"
                  step="100"
                  placeholder="1000"
                  value={amountHighlightThreshold}
                  onChange={(e) => setAmountHighlightThreshold(parseFloat(e.target.value) || 0)}
                  className="w-28 bg-background border-border h-9"
                />
              </div>

              {/* 分隔 */}
              <div className="border-t" />

              {/* 节假日 API */}
              <div className="space-y-3">
                <div className="flex items-start justify-between gap-8">
                  <div className="flex-1">
                    <h4 className="text-sm font-medium">节假日数据源</h4>
                    <p className="text-xs text-muted-foreground mt-1">
                      选择节假日 API 地址，用于同步和显示节假日/调休信息
                    </p>
                  </div>
                  <Select value={holidayApiUrl} onValueChange={setHolidayApiUrl}>
                    <SelectTrigger className="w-56 bg-background border-border h-9">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent className="bg-card border-border">
                      {HOLIDAY_API_OPTIONS.map((opt) => (
                        <SelectItem key={opt.value} value={opt.value}>
                          {opt.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <Input
                  aria-label="节假日 API 地址"
                  placeholder="或输入自定义 API 地址，{year} 为年份占位符"
                  value={holidayApiUrl}
                  onChange={(e) => setHolidayApiUrl(e.target.value)}
                  className="bg-background border-border h-9"
                />
                <div className="flex items-center gap-3">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleSyncHolidays}
                    disabled={syncingHolidays}
                  >
                    <RefreshCw size={14} className="mr-1" />
                    {syncingHolidays ? '同步中...' : '同步节假日'}
                  </Button>
                  {syncResult && (
                    <span className={`text-xs ${syncResult.includes('失败') ? 'text-[#ef4444]' : 'text-[#22c55e]'}`}>
                      {syncResult}
                    </span>
                  )}
                </div>
              </div>

              {/* 保存按钮 */}
              <div className="flex justify-end pt-2">
                <Button
                  onClick={handleSaveConfig}
                  disabled={configSaving}
                  size="sm"
                  className="bg-primary hover:bg-primary/90 text-primary-foreground"
                >
                  {configSaving ? '保存中...' : '保存配置'}
                </Button>
              </div>
            </div>
          </AccordionContent>
        </AccordionItem>

        {/* 字典管理 */}
        <AccordionItem value="dictionary" className="border rounded-xl px-5">
          <AccordionTrigger className="text-base font-semibold hover:no-underline">
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center">
                <BookOpen size={16} className="text-primary" />
              </div>
              字典管理
            </div>
          </AccordionTrigger>
          <AccordionContent className="pt-2 pb-5">
            {dictError && (
              <Alert variant="destructive" className="mb-4">
                <AlertDescription>{dictError}</AlertDescription>
              </Alert>
            )}

            <Tabs value={dictTab} onValueChange={setDictTab}>
              <TabsList className="mb-5 flex-wrap h-auto gap-1 bg-muted p-1 rounded-lg">
                {DICT_GROUPS.map((g) => (
                  <TabsTrigger key={g.key} value={g.key} className="text-xs data-[state=active]:bg-background data-[state=active]:shadow-sm rounded-md">
                    {g.label}
                  </TabsTrigger>
                ))}
              </TabsList>

              {/* 操作栏 */}
              <div className="flex items-center justify-between mb-3">
                <span className="text-sm font-medium">
                  {DICT_GROUPS.find((g) => g.key === dictTab)?.label}
                </span>
                <Button
                  size="sm"
                  onClick={() => { resetForm(); setAddOpen(true) }}
                  className="bg-primary hover:bg-primary/90 text-primary-foreground h-8 text-xs"
                >
                  <Plus size={14} /> 添加
                </Button>
              </div>

              {/* 表格 */}
              {dictLoading ? (
                <Spinner className="py-8" />
              ) : dictItems.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-12 text-center gap-2 border rounded-lg border-dashed">
                  <BookOpen size={28} className="opacity-25" />
                  <p className="text-sm text-muted-foreground">暂无数据</p>
                  <Button
                    variant="link"
                    size="sm"
                    className="text-primary text-xs"
                    onClick={() => { resetForm(); setAddOpen(true) }}
                  >
                    点击添加
                  </Button>
                </div>
              ) : (
                <div className="border rounded-lg overflow-hidden">
                  <Table>
                    <TableHeader>
                      <TableRow className="bg-muted/50 hover:bg-muted/50">
                        <TableHead className="text-xs w-16">序号</TableHead>
                        <TableHead className="text-xs">编码</TableHead>
                        <TableHead className="text-xs">名称</TableHead>
                        <TableHead className="text-xs w-20 text-right">操作</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {dictItems.map((item) => (
                        <TableRow key={item.id} className="hover:bg-accent/50">
                          <TableCell className="text-xs text-muted-foreground py-2.5">
                            {item.order}
                          </TableCell>
                          <TableCell className="text-xs font-mono text-muted-foreground py-2.5">
                            {item.code}
                          </TableCell>
                          <TableCell className="text-sm py-2.5">
                            {item.label}
                          </TableCell>
                          <TableCell className="text-right py-2.5">
                            <div className="flex items-center justify-end gap-0.5">
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-7 w-7 text-muted-foreground hover:text-foreground"
                                onClick={() => openEdit(item)}
                              >
                                <Pencil size={13} />
                              </Button>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-7 w-7 text-muted-foreground hover:text-[#ef4444]"
                                onClick={() => setDeleteTarget(item)}
                              >
                                <Trash2 size={13} />
                              </Button>
                            </div>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </Tabs>
          </AccordionContent>
        </AccordionItem>

        {/* 附件管理 */}
        <AccordionItem value="attachments" className="border rounded-xl px-5">
          <AccordionTrigger className="text-base font-semibold hover:no-underline">
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center">
                <FolderOpen size={16} className="text-primary" />
              </div>
              附件管理
            </div>
          </AccordionTrigger>
          <AccordionContent className="pt-2 pb-5">
            <div className="space-y-4">
              <div>
                <p className="text-sm text-muted-foreground">
                  无效附件是上传后未关联到任何流水的文件（如编辑弹窗中放弃提交的附件）。
                  清理无效附件可释放磁盘空间。
                </p>
              </div>

              {orphansError && (
                <Alert variant="destructive">
                  <AlertDescription>{orphansError}</AlertDescription>
                </Alert>
              )}

              {orphansResult !== null && (
                <div className="flex items-center gap-3 p-3 rounded-lg bg-muted">
                  <FileSearch size={18} className="text-muted-foreground" />
                  <span className="text-sm">
                    共 <strong>{orphansResult.count}</strong> 条记录（
                    <strong>{orphansResult.files}</strong> 个文件存在于磁盘）
                  </span>
                </div>
              )}

              {cleanResult !== null && (
                <div className="flex items-center gap-3 p-3 rounded-lg bg-[#22c55e]/10 border border-[#22c55e]/30">
                  <Check size={18} className="text-[#22c55e]" />
                  <span className="text-sm">
                    已清理 <strong>{cleanResult.deletedFiles}</strong> 个文件、
                    <strong>{cleanResult.deletedRecords}</strong> 条数据库记录
                  </span>
                </div>
              )}

              <div className="flex gap-3">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleQueryOrphans}
                  disabled={orphansLoading}
                >
                  {orphansLoading ? '查询中...' : '查询无效附件'}
                </Button>
                <Button
                  size="sm"
                  onClick={() => setCleanConfirmOpen(true)}
                  disabled={orphansCleaning || orphansResult === null || orphansResult.count === 0}
                  className="bg-[#ef4444] hover:bg-[#dc2626] text-white"
                >
                  <Trash2 size={14} className="mr-1" />
                  {orphansCleaning ? '清理中...' : '清理所有无效附件'}
                </Button>
              </div>
            </div>
          </AccordionContent>
        </AccordionItem>
      </Accordion>

      {/* 添加字典弹窗 */}
      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogTrigger />
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              添加{DICT_GROUPS.find((g) => g.key === dictTab)?.label}
            </DialogTitle>
          </DialogHeader>
          <div className="flex flex-col gap-3">
            {formError && (
              <Alert variant="destructive">
                <AlertDescription>{formError}</AlertDescription>
              </Alert>
            )}
            <div>
              <Label className="text-xs text-muted-foreground mb-1 block">名称</Label>
              <Input
                aria-label="名称"
                placeholder="显示名称"
                value={formLabel}
                onChange={(e) => { setFormLabel(e.target.value); setFormError('') }}
                className="bg-background border-border"
                autoFocus
              />
            </div>
            <div>
              <Label className="text-xs text-muted-foreground mb-1 block">编码</Label>
              <Input
                aria-label="编码"
                placeholder="唯一编码，留空则与名称相同"
                value={formCode}
                onChange={(e) => setFormCode(e.target.value)}
                className="bg-background border-border"
              />
            </div>
            <div>
              <Label className="text-xs text-muted-foreground mb-1 block">排序</Label>
              <Input
                aria-label="排序"
                type="number"
                value={formOrder}
                onChange={(e) => setFormOrder(e.target.value)}
                className="bg-background border-border w-24"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAddOpen(false)}>取消</Button>
            <Button
              className="bg-primary hover:bg-primary/90 text-primary-foreground"
              onClick={handleAdd}
              disabled={submitting}
            >
              {submitting ? '添加中...' : '添加'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 编辑字典弹窗 */}
      <Dialog open={!!editTarget} onOpenChange={() => setEditTarget(null)}>
        <DialogTrigger />
        <DialogContent>
          <DialogHeader>
            <DialogTitle>编辑字典项</DialogTitle>
          </DialogHeader>
          <div className="flex flex-col gap-3">
            {formError && (
              <Alert variant="destructive">
                <AlertDescription>{formError}</AlertDescription>
              </Alert>
            )}
            <div>
              <Label className="text-xs text-muted-foreground mb-1 block">名称</Label>
              <Input
                aria-label="名称"
                value={formLabel}
                onChange={(e) => { setFormLabel(e.target.value); setFormError('') }}
                className="bg-background border-border"
              />
            </div>
            <div>
              <Label className="text-xs text-muted-foreground mb-1 block">编码</Label>
              <Input
                aria-label="编码"
                value={formCode}
                onChange={(e) => setFormCode(e.target.value)}
                className="bg-background border-border"
              />
            </div>
            <div>
              <Label className="text-xs text-muted-foreground mb-1 block">排序</Label>
              <Input
                aria-label="排序"
                type="number"
                value={formOrder}
                onChange={(e) => setFormOrder(e.target.value)}
                className="bg-background border-border w-24"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditTarget(null)}>取消</Button>
            <Button
              className="bg-primary hover:bg-primary/90 text-primary-foreground"
              onClick={handleEdit}
              disabled={submitting}
            >
              {submitting ? '保存中...' : '保存'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 删除确认弹窗 */}
      <AlertDialog open={!!deleteTarget} onOpenChange={() => setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>删除字典项</AlertDialogTitle>
            <AlertDialogDescription>
              确定要删除 <strong className="text-[#ef4444]">{deleteTarget?.label}</strong> 吗？
              此操作不可撤销，已使用该值的记录将不受影响。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction
              className="bg-[#ef4444] hover:bg-[#dc2626]"
              onClick={handleDelete}
            >
              确认删除
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* 清理无效附件确认弹窗 */}
      <AlertDialog open={cleanConfirmOpen} onOpenChange={setCleanConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>清理无效附件</AlertDialogTitle>
            <AlertDialogDescription>
              确定要删除所有无效附件吗？此操作不可撤销，将永久删除
              <strong className="text-[#ef4444]"> {orphansResult?.files ?? 0} </strong>
              个磁盘文件。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction
              className="bg-[#ef4444] hover:bg-[#dc2626]"
              onClick={handleCleanOrphans}
            >
              确认清理
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

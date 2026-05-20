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
import { Plus, Pencil, Trash2, Settings, BookOpen, Check } from 'lucide-react'

const DICT_GROUPS: { key: string; label: string }[] = [
  { key: 'account_type', label: '账户类型' },
  { key: 'bank_name', label: '开户行' },
  { key: 'transaction_category_income', label: '收入分类' },
  { key: 'transaction_category_expense', label: '支出分类' },
  { key: 'transaction_category_transfer', label: '转账分类' },
]

const CURRENCIES = ['CNY', 'USD', 'EUR', 'JPY', 'GBP', 'HKD']

export function SettingsPage() {
  // 通用设置
  const [registrationOpen, setRegistrationOpen] = useState(true)
  const [defaultCurrency, setDefaultCurrency] = useState('CNY')
  const [configLoading, setConfigLoading] = useState(true)
  const [configSaving, setConfigSaving] = useState(false)
  const [configError, setConfigError] = useState('')

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

  // 加载通用配置
  useEffect(() => {
    setConfigLoading(true)
    settingsApi.getConfig()
      .then((config) => {
        if (typeof config.registrationOpen === 'boolean') setRegistrationOpen(config.registrationOpen)
        if (typeof config.defaultCurrency === 'string') setDefaultCurrency(config.defaultCurrency)
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

  // 保存配置
  const handleSaveConfig = async () => {
    setConfigSaving(true)
    setConfigError('')
    try {
      await settingsApi.updateConfig({ registrationOpen, defaultCurrency })
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
              <div className="w-8 h-8 rounded-lg bg-[#f97316]/10 flex items-center justify-center">
                <Settings size={16} className="text-[#f97316]" />
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

              {/* 保存按钮 */}
              <div className="flex justify-end pt-2">
                <Button
                  onClick={handleSaveConfig}
                  disabled={configSaving}
                  size="sm"
                  className="bg-[#f97316] hover:bg-[#ea580c] text-white"
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
              <div className="w-8 h-8 rounded-lg bg-[#f97316]/10 flex items-center justify-center">
                <BookOpen size={16} className="text-[#f97316]" />
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
                  className="bg-[#f97316] hover:bg-[#ea580c] text-white h-8 text-xs"
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
                    className="text-[#f97316] text-xs"
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
      </Accordion>

      {/* 添加字典弹窗 */}
      <Dialog open={addOpen} onOpenChange={setAddOpen}>
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
                placeholder="唯一编码，留空则与名称相同"
                value={formCode}
                onChange={(e) => setFormCode(e.target.value)}
                className="bg-background border-border"
              />
            </div>
            <div>
              <Label className="text-xs text-muted-foreground mb-1 block">排序</Label>
              <Input
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
              className="bg-[#f97316] hover:bg-[#ea580c] text-white"
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
                value={formLabel}
                onChange={(e) => { setFormLabel(e.target.value); setFormError('') }}
                className="bg-background border-border"
              />
            </div>
            <div>
              <Label className="text-xs text-muted-foreground mb-1 block">编码</Label>
              <Input
                value={formCode}
                onChange={(e) => setFormCode(e.target.value)}
                className="bg-background border-border"
              />
            </div>
            <div>
              <Label className="text-xs text-muted-foreground mb-1 block">排序</Label>
              <Input
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
              className="bg-[#f97316] hover:bg-[#ea580c] text-white"
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
    </div>
  )
}

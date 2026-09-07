import { useState, useEffect, useCallback } from 'react'
import {
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
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from '@/components/ui/table'
import { Spinner } from '@/components/ui/spinner'
import { settingsApi, type DictItem } from '@/api/settings'
import { Plus, Pencil, Trash2, BookOpen } from 'lucide-react'
import { toast } from 'sonner'

const DICT_GROUPS: { key: string; label: string }[] = [
  { key: 'account_type', label: '账户类型' },
  { key: 'bank_name', label: '开户行' },
  { key: 'transaction_category_income', label: '收入分类' },
  { key: 'transaction_category_expense', label: '支出分类' },
  { key: 'transaction_category_transfer', label: '转账分类' },
]

// 字典管理（仅管理员可见）
export function DictionaryManagement() {
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
      toast.success('字典项已添加')
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
      toast.success('字典项已更新')
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
      toast.success('字典项已删除')
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

  return (
    <>
      <AccordionItem value="dictionary" className="border rounded-xl px-5">
        <AccordionTrigger className="text-base font-semibold hover:no-underline">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-primary flex items-center justify-center">
              <BookOpen size={16} className="text-primary-foreground" />
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
    </>
  )
}

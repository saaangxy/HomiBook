import { useState, useEffect, useCallback } from 'react'
import {
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
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
import { importExportApi, type CategoryMapping } from '@/api/import-export'
import { DictCombobox } from '@/components/DictCombobox'
import { Plus, Pencil, Trash2, Link2 } from 'lucide-react'
import { toast } from 'sonner'

// 导入分类映射管理（仅管理员可见）
export function CategoryMappingSettings() {
  const [mappingSource, setMappingSource] = useState('alipay')
  const [mappings, setMappings] = useState<CategoryMapping[]>([])
  const [mappingsLoading, setMappingsLoading] = useState(false)
  const [mappingsError, setMappingsError] = useState('')
  const [mappingAddOpen, setMappingAddOpen] = useState(false)
  const [mappingEditTarget, setMappingEditTarget] = useState<CategoryMapping | null>(null)
  const [mappingNewSourceCategory, setMappingNewSourceCategory] = useState('')
  const [mappingNewPayerContains, setMappingNewPayerContains] = useState('')
  const [mappingNewDescriptionContains, setMappingNewDescriptionContains] = useState('')
  const [mappingNewTargetCode, setMappingNewTargetCode] = useState('')
  const [mappingNewRecordType, setMappingNewRecordType] = useState('__all__')
  const [mappingFormError, setMappingFormError] = useState('')
  const [mappingSubmitting, setMappingSubmitting] = useState(false)
  const [mappingDeleteTarget, setMappingDeleteTarget] = useState<CategoryMapping | null>(null)

  // 加载分类映射
  const loadMappings = useCallback(async (source: string) => {
    setMappingsLoading(true)
    setMappingsError('')
    try {
      const result = await importExportApi.getMappings(source)
      setMappings(result.mappings)
    } catch (e: any) {
      setMappingsError(e.message)
    } finally {
      setMappingsLoading(false)
    }
  }, [])

  // 面板展开挂载时加载数据，数据源变化时重新加载
  useEffect(() => { loadMappings(mappingSource) }, [mappingSource, loadMappings])

  // 新增/编辑映射
  const handleSaveMapping = async () => {
    if (!mappingNewSourceCategory.trim()) { setMappingFormError('请输入CSV分类名'); return }
    if (!mappingNewTargetCode) { setMappingFormError('请选择目标系统分类'); return }
    setMappingSubmitting(true)
    setMappingFormError('')
    try {
      if (mappingEditTarget) {
        // 编辑：先删旧，再存新
        await importExportApi.deleteMapping(mappingEditTarget.id)
      }
      await importExportApi.saveMappings([{
        source: mappingSource,
        sourceCategory: mappingNewSourceCategory.trim(),
        payerContains: mappingNewPayerContains.trim() || undefined,
        descriptionContains: mappingNewDescriptionContains.trim() || undefined,
        recordType: mappingNewRecordType === '__all__' ? undefined : mappingNewRecordType || undefined,
        targetCategoryCode: mappingNewTargetCode,
      }])
      toast.success(mappingEditTarget ? '分类映射已更新' : '分类映射已添加')
      setMappingAddOpen(false)
      setMappingEditTarget(null)
      setMappingNewSourceCategory('')
      setMappingNewPayerContains('')
      setMappingNewDescriptionContains('')
      setMappingNewRecordType('__all__')
      setMappingNewTargetCode('')
      loadMappings(mappingSource)
    } catch (e: any) {
      setMappingFormError(e.message)
    } finally {
      setMappingSubmitting(false)
    }
  }

  // 删除映射
  const handleDeleteMapping = async () => {
    if (!mappingDeleteTarget) return
    try {
      await importExportApi.deleteMapping(mappingDeleteTarget.id)
      toast.success('分类映射已删除')
      setMappingDeleteTarget(null)
      loadMappings(mappingSource)
    } catch (e: any) {
      setMappingsError(e.message)
    }
  }

  return (
    <>
      <AccordionItem value="import-mappings" className="border rounded-xl px-5">
        <AccordionTrigger className="text-base font-semibold hover:no-underline">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-primary flex items-center justify-center">
              <Link2 size={16} className="text-primary-foreground" />
            </div>
            导入分类映射
          </div>
        </AccordionTrigger>
        <AccordionContent className="pt-2 pb-5">
          <p className="text-sm text-muted-foreground mb-4">
            将 CSV 文件中的交易分类映射到系统中的分类编码，导入时自动匹配。匹配数据时匹配项目多的规则优先级高
          </p>

          {mappingsError && (
            <Alert variant="destructive" className="mb-4">
              <AlertDescription>{mappingsError}</AlertDescription>
            </Alert>
          )}

          <div className="flex items-center justify-between mb-3">
            <Select value={mappingSource} onValueChange={(v) => { setMappingSource(v); loadMappings(v) }}>
              <SelectTrigger className="w-28 h-8 text-xs bg-background">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="bg-card border-border">
                <SelectItem value="alipay" className="text-xs">支付宝</SelectItem>
                <SelectItem value="wechat" className="text-xs">微信</SelectItem>
                <SelectItem value="jd" className="text-xs">京东</SelectItem>
                <SelectItem value="csv" className="text-xs">其他CSV</SelectItem>
              </SelectContent>
            </Select>
            <Button
              size="sm"
              onClick={() => { setMappingEditTarget(null); setMappingNewSourceCategory(''); setMappingNewPayerContains(''); setMappingNewDescriptionContains(''); setMappingNewRecordType('__all__'); setMappingNewTargetCode(''); setMappingFormError(''); setMappingAddOpen(true) }}
              className="bg-primary hover:bg-primary/90 text-primary-foreground h-8 text-xs"
            >
              <Plus size={14} /> 新增映射
            </Button>
          </div>

          {mappingsLoading ? (
            <Spinner className="py-8" />
          ) : mappings.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-center gap-2 border rounded-lg border-dashed">
              <Link2 size={28} className="opacity-25" />
              <p className="text-sm text-muted-foreground">暂无映射</p>
            </div>
          ) : (
            <div className="border rounded-lg overflow-hidden">
              <Table>
                <TableHeader>
                  <TableRow className="bg-muted/50 hover:bg-muted/50">
                    <TableHead className="text-xs">CSV 原始分类</TableHead>
                    <TableHead className="text-xs">交易方正则</TableHead>
                    <TableHead className="text-xs">说明正则</TableHead>
                    <TableHead className="text-xs">类型</TableHead>
                    <TableHead className="text-xs">系统分类编码</TableHead>
                    <TableHead className="text-xs w-16 text-right">操作</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {mappings.map((m) => (
                    <TableRow key={m.id} className="hover:bg-accent/50">
                      <TableCell className="text-sm py-2.5">{m.sourceCategory}</TableCell>
                      <TableCell className="text-xs text-muted-foreground py-2.5">
                        {m.payerContains || '—'}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground py-2.5">
                        {m.descriptionContains || '—'}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground py-2.5">
                        {m.recordType === 'INCOME' ? '收入' : m.recordType === 'EXPENSE' ? '支出' : m.recordType === 'TRANSFER' ? '转账' : '通用'}
                      </TableCell>
                      <TableCell className="text-xs font-mono text-muted-foreground py-2.5">
                        {m.targetCategoryCode}
                      </TableCell>
                      <TableCell className="text-right py-2.5">
                        <div className="flex items-center justify-end gap-0.5">
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7 text-muted-foreground hover:text-primary"
                            onClick={() => {
                              setMappingEditTarget(m)
                              setMappingNewSourceCategory(m.sourceCategory)
                              setMappingNewPayerContains(m.payerContains || '')
                              setMappingNewDescriptionContains(m.descriptionContains || '')
                              setMappingNewRecordType(m.recordType || '__all__')
                              setMappingNewTargetCode(m.targetCategoryCode)
                              setMappingFormError('')
                              setMappingAddOpen(true)
                            }}
                          >
                            <Pencil size={13} />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7 text-muted-foreground hover:text-[#ef4444]"
                            onClick={() => setMappingDeleteTarget(m)}
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
        </AccordionContent>
      </AccordionItem>

      {/* 新增分类映射弹窗 */}
      <Dialog open={mappingAddOpen} onOpenChange={(open) => { setMappingAddOpen(open); if (!open) setMappingEditTarget(null) }}>
        <DialogTrigger />
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{mappingEditTarget ? '编辑分类映射' : '新增分类映射'}</DialogTitle>
          </DialogHeader>
          <div className="flex flex-col gap-3">
            {mappingFormError && (
              <Alert variant="destructive">
                <AlertDescription>{mappingFormError}</AlertDescription>
              </Alert>
            )}
            <div>
              <Label className="text-xs text-muted-foreground mb-1 block">CSV 原始分类名</Label>
              <Input
                placeholder="例如：餐饮美食"
                value={mappingNewSourceCategory}
                onChange={(e) => { setMappingNewSourceCategory(e.target.value); setMappingFormError('') }}
                className="bg-background border-border"
                autoFocus
              />
            </div>
            <div>
              <Label className="text-xs text-muted-foreground mb-1 block">交易方正则 (可选)</Label>
              <Input
                placeholder="例如：麦当劳|肯德基，留空则不限制"
                value={mappingNewPayerContains}
                onChange={(e) => setMappingNewPayerContains(e.target.value)}
                className="bg-background border-border"
              />
            </div>
            <div>
              <Label className="text-xs text-muted-foreground mb-1 block">商品说明正则 (可选)</Label>
              <Input
                placeholder="例如：早餐|午餐，留空则不限制"
                value={mappingNewDescriptionContains}
                onChange={(e) => setMappingNewDescriptionContains(e.target.value)}
                className="bg-background border-border"
              />
            </div>
            <div>
              <Label className="text-xs text-muted-foreground mb-1 block">记录类型 (可选)</Label>
              <Select value={mappingNewRecordType} onValueChange={setMappingNewRecordType}>
                <SelectTrigger className="bg-background border-border">
                  <SelectValue placeholder="不限类型..." />
                </SelectTrigger>
                <SelectContent className="bg-card border-border">
                  <SelectItem value="__all__" className="text-xs">通用（不限）</SelectItem>
                  <SelectItem value="INCOME" className="text-xs">收入</SelectItem>
                  <SelectItem value="EXPENSE" className="text-xs">支出</SelectItem>
                  <SelectItem value="TRANSFER" className="text-xs">转账</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs text-muted-foreground mb-1 block">目标系统分类编码</Label>
              <DictCombobox
                groups={
                  mappingNewRecordType === '__all__'
                    ? ['transaction_category_income', 'transaction_category_expense', 'transaction_category_transfer']
                    : mappingNewRecordType === 'INCOME'
                      ? ['transaction_category_income']
                      : mappingNewRecordType === 'EXPENSE'
                        ? ['transaction_category_expense']
                        : ['transaction_category_transfer']
                }
                value={mappingNewTargetCode}
                onChange={setMappingNewTargetCode}
                placeholder="选择系统分类..."
                valueKey="code"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setMappingAddOpen(false)}>取消</Button>
            <Button
              className="bg-primary hover:bg-primary/90 text-primary-foreground"
              onClick={handleSaveMapping}
              disabled={mappingSubmitting}
            >
              {mappingSubmitting ? '添加中...' : '添加'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 删除映射确认弹窗 */}
      <AlertDialog open={!!mappingDeleteTarget} onOpenChange={() => setMappingDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>删除分类映射</AlertDialogTitle>
            <AlertDialogDescription>
              确定要删除 <strong className="text-[#ef4444]">{mappingDeleteTarget?.sourceCategory}</strong> → {mappingDeleteTarget?.targetCategoryCode} 的映射吗？
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction
              className="bg-[#ef4444] hover:bg-[#dc2626]"
              onClick={handleDeleteMapping}
            >
              确认删除
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}

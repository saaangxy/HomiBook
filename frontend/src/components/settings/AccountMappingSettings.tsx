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
import { importExportApi, type AccountMapping } from '@/api/import-export'
import { Plus, Pencil, Trash2, Wallet } from 'lucide-react'
import { toast } from 'sonner'

// 导入账户映射管理（仅管理员可见）
export function AccountMappingSettings() {
  const [accountMappingSource, setAccountMappingSource] = useState('alipay')
  const [accountMappings, setAccountMappings] = useState<AccountMapping[]>([])
  const [accountMappingsLoading, setAccountMappingsLoading] = useState(false)
  const [accountMappingsError, setAccountMappingsError] = useState('')
  const [accountMappingAddOpen, setAccountMappingAddOpen] = useState(false)
  const [accountMappingEditTarget, setAccountMappingEditTarget] = useState<AccountMapping | null>(null)
  const [accountMappingNewSourceName, setAccountMappingNewSourceName] = useState('')
  const [accountMappingNewPayerContains, setAccountMappingNewPayerContains] = useState('')
  const [accountMappingNewDescriptionContains, setAccountMappingNewDescriptionContains] = useState('')
  const [accountMappingNewTargetName, setAccountMappingNewTargetName] = useState('')
  const [accountMappingFormError, setAccountMappingFormError] = useState('')
  const [accountMappingSubmitting, setAccountMappingSubmitting] = useState(false)
  const [accountMappingDeleteTarget, setAccountMappingDeleteTarget] = useState<AccountMapping | null>(null)

  // 账户映射数据加载
  const loadAccountMappings = useCallback(async (source: string) => {
    setAccountMappingsLoading(true)
    setAccountMappingsError('')
    try {
      const result = await importExportApi.getAccountMappings(source)
      setAccountMappings(result.mappings)
    } catch (e: any) {
      setAccountMappingsError(e.message)
    } finally {
      setAccountMappingsLoading(false)
    }
  }, [])

  // 面板展开挂载时加载数据，数据源变化时重新加载
  useEffect(() => { loadAccountMappings(accountMappingSource) }, [accountMappingSource, loadAccountMappings])

  const resetAccountMappingForm = () => {
    setAccountMappingNewSourceName('')
    setAccountMappingNewPayerContains('')
    setAccountMappingNewDescriptionContains('')
    setAccountMappingNewTargetName('')
    setAccountMappingFormError('')
  }

  const handleSaveAccountMapping = async () => {
    if (!accountMappingNewSourceName.trim()) { setAccountMappingFormError('请输入CSV原始账户名'); return }
    if (!accountMappingNewTargetName.trim()) { setAccountMappingFormError('请输入目标账户名称'); return }
    setAccountMappingSubmitting(true)
    setAccountMappingFormError('')
    try {
      if (accountMappingEditTarget) {
        await importExportApi.deleteAccountMapping(accountMappingEditTarget.id)
      }
      await importExportApi.saveAccountMappings([{
        source: accountMappingSource,
        sourceAccountName: accountMappingNewSourceName.trim(),
        payerContains: accountMappingNewPayerContains.trim() || undefined,
        descriptionContains: accountMappingNewDescriptionContains.trim() || undefined,
        targetAccountName: accountMappingNewTargetName.trim(),
      }])
      toast.success(accountMappingEditTarget ? '账户映射已更新' : '账户映射已添加')
      setAccountMappingAddOpen(false)
      setAccountMappingEditTarget(null)
      resetAccountMappingForm()
      loadAccountMappings(accountMappingSource)
    } catch (e: any) {
      setAccountMappingFormError(e.message)
    } finally {
      setAccountMappingSubmitting(false)
    }
  }

  const handleDeleteAccountMapping = async () => {
    if (!accountMappingDeleteTarget) return
    try {
      await importExportApi.deleteAccountMapping(accountMappingDeleteTarget.id)
      toast.success('账户映射已删除')
      setAccountMappingDeleteTarget(null)
      loadAccountMappings(accountMappingSource)
    } catch (e: any) {
      setAccountMappingsError(e.message)
    }
  }

  return (
    <>
      <AccordionItem value="import-account-mappings" className="border rounded-xl px-5">
        <AccordionTrigger className="text-base font-semibold hover:no-underline">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-primary flex items-center justify-center">
              <Wallet size={16} className="text-primary-foreground" />
            </div>
            导入账户映射
          </div>
        </AccordionTrigger>
        <AccordionContent className="pt-2 pb-5">
          <p className="text-sm text-muted-foreground mb-4">
            将 CSV 文件中的账户名映射到系统中的账户，导入时自动匹配。
          </p>
          <div className="flex items-center justify-between mb-3">
            <Select value={accountMappingSource} onValueChange={(v) => { setAccountMappingSource(v); loadAccountMappings(v) }}>
              <SelectTrigger className="w-[130px] h-8 text-xs bg-background border-border">
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
              variant="outline"
              className="bg-background border-border"
              onClick={() => { resetAccountMappingForm(); setAccountMappingEditTarget(null); setAccountMappingAddOpen(true) }}
            >
              <Plus size={14} /> 新增映射
            </Button>
          </div>
          {accountMappingsLoading && <Spinner className="py-4" />}
          {accountMappingsError && (
            <Alert variant="destructive">
              <AlertDescription>{accountMappingsError}</AlertDescription>
            </Alert>
          )}
          {!accountMappingsLoading && !accountMappingsError && (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="text-xs">CSV原始账户名</TableHead>
                    <TableHead className="text-xs">交易方正则</TableHead>
                    <TableHead className="text-xs">说明正则</TableHead>
                    <TableHead className="text-xs">目标账户名</TableHead>
                    <TableHead className="text-xs w-[72px]">操作</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {accountMappings.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={5} className="text-center text-xs text-muted-foreground py-6">
                        暂无账户映射，点击"新增映射"添加
                      </TableCell>
                    </TableRow>
                  )}
                  {accountMappings.map((m) => (
                    <TableRow key={m.id}>
                      <TableCell className="text-xs font-medium">{m.sourceAccountName}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">{m.payerContains || '-'}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">{m.descriptionContains || '-'}</TableCell>
                      <TableCell className="text-xs">{m.targetAccountName}</TableCell>
                      <TableCell>
                        <div className="flex items-center gap-1">
                          <Button
                            size="icon"
                            variant="ghost"
                            className="h-7 w-7"
                            onClick={() => {
                              setAccountMappingEditTarget(m)
                              setAccountMappingNewSourceName(m.sourceAccountName)
                              setAccountMappingNewPayerContains(m.payerContains)
                              setAccountMappingNewDescriptionContains(m.descriptionContains)
                              setAccountMappingNewTargetName(m.targetAccountName)
                              setAccountMappingAddOpen(true)
                            }}
                          >
                            <Pencil size={13} />
                          </Button>
                          <Button
                            size="icon"
                            variant="ghost"
                            className="h-7 w-7 text-[#ef4444] hover:text-[#ef4444]"
                            onClick={() => setAccountMappingDeleteTarget(m)}
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

      {/* 新增/编辑账户映射弹窗 */}
      <Dialog open={accountMappingAddOpen} onOpenChange={(open) => { setAccountMappingAddOpen(open); if (!open) { setAccountMappingEditTarget(null); resetAccountMappingForm() } }}>
        <DialogTrigger />
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{accountMappingEditTarget ? '编辑账户映射' : '新增账户映射'}</DialogTitle>
          </DialogHeader>
          <div className="flex flex-col gap-3">
            {accountMappingFormError && (
              <Alert variant="destructive">
                <AlertDescription>{accountMappingFormError}</AlertDescription>
              </Alert>
            )}
            <div>
              <Label className="text-xs text-muted-foreground mb-1 block">CSV 原始账户名</Label>
              <Input
                placeholder="例如：花呗、招商银行储蓄卡(8888)"
                value={accountMappingNewSourceName}
                onChange={(e) => { setAccountMappingNewSourceName(e.target.value); setAccountMappingFormError('') }}
                className="bg-background border-border"
                autoFocus
              />
            </div>
            <div>
              <Label className="text-xs text-muted-foreground mb-1 block">交易方正则 (可选)</Label>
              <Input
                placeholder="例如：麦当劳|肯德基，留空则不限制"
                value={accountMappingNewPayerContains}
                onChange={(e) => setAccountMappingNewPayerContains(e.target.value)}
                className="bg-background border-border"
              />
            </div>
            <div>
              <Label className="text-xs text-muted-foreground mb-1 block">商品说明正则 (可选)</Label>
              <Input
                placeholder="例如：还款|转账，留空则不限制"
                value={accountMappingNewDescriptionContains}
                onChange={(e) => setAccountMappingNewDescriptionContains(e.target.value)}
                className="bg-background border-border"
              />
            </div>
            <div>
              <Label className="text-xs text-muted-foreground mb-1 block">目标账户名称</Label>
              <Input
                placeholder="例如：支付宝、招商银行"
                value={accountMappingNewTargetName}
                onChange={(e) => { setAccountMappingNewTargetName(e.target.value); setAccountMappingFormError('') }}
                className="bg-background border-border"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setAccountMappingAddOpen(false); resetAccountMappingForm() }}>取消</Button>
            <Button
              className="bg-primary hover:bg-primary/90 text-primary-foreground"
              onClick={handleSaveAccountMapping}
              disabled={accountMappingSubmitting}
            >
              {accountMappingSubmitting ? '添加中...' : '添加'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 删除账户映射确认弹窗 */}
      <AlertDialog open={!!accountMappingDeleteTarget} onOpenChange={() => setAccountMappingDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>删除账户映射</AlertDialogTitle>
            <AlertDialogDescription>
              确定要删除 <strong className="text-[#ef4444]">{accountMappingDeleteTarget?.sourceAccountName}</strong> → {accountMappingDeleteTarget?.targetAccountName} 的映射吗？
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction
              className="bg-[#ef4444] hover:bg-[#dc2626]"
              onClick={handleDeleteAccountMapping}
            >
              确认删除
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}

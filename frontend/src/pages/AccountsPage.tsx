import { useState, useEffect, useCallback } from 'react'
import { Card, CardContent } from '@/components/ui/card'
import {
  Dialog,
  DialogTrigger,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Alert, AlertDescription } from '@/components/ui/alert'
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
import { Label } from '@/components/ui/label'
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from '@/components/ui/table'
import { Spinner } from '@/components/ui/spinner'
import { DateTimePicker } from '@/components/ui/datetime-picker'
import dayjs from 'dayjs'
import { DictCombobox } from '@/components/DictCombobox'
import { useBookStore } from '../stores/book'
import { useAuthStore } from '../stores/auth'
import {
  accountApi,
  type AccountItem,
  type AccountType,
  type BalanceAdjustment,
  ACCOUNT_TYPE_LABELS,
} from '../api/account'
import {
  Plus,
  Wallet,
  EyeOff,
  CreditCard,
  Pencil,
  TrendingUp,
  History,
  Archive,
  Trash2,
} from 'lucide-react'

function formatBalance(balance: number | undefined, currency = 'CNY'): string {
  if (balance === undefined || balance === null) return '****'
  const symbol = currency === 'CNY' ? '¥' : '$'
  const prefix = balance < 0 ? '-' : ''
  return `${prefix}${symbol}${Math.abs(balance).toFixed(2)}`
}

export function AccountsPage() {
  const currentBookId = useBookStore((s) => s.currentBookId)
  const currentUser = useAuthStore((s) => s.user)
  const [accounts, setAccounts] = useState<AccountItem[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [filterStatus, setFilterStatus] = useState<'ALL' | 'ACTIVE' | 'ARCHIVED'>('ALL')

  // Dialog states
  const [createOpen, setCreateOpen] = useState(false)
  const [editAccount, setEditAccount] = useState<AccountItem | null>(null)
  const [adjustAccount, setAdjustAccount] = useState<AccountItem | null>(null)
  const [historyAccount, setHistoryAccount] = useState<AccountItem | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<AccountItem | null>(null)
  const [confirmAction, setConfirmAction] = useState<{
    title: string; description: string; onConfirm: () => void
  } | null>(null)

  // Form states
  const [formName, setFormName] = useState('')
  const [formType, setFormType] = useState<AccountType>('BANK_DEBIT')
  const [formInitialBalance, setFormInitialBalance] = useState('')
  const [formAccountNo, setFormAccountNo] = useState('')
  const [formBankName, setFormBankName] = useState('')
  const [formVisibility, setFormVisibility] = useState<'PUBLIC' | 'PRIVATE'>('PUBLIC')
  const [formError, setFormError] = useState('')
  const [submitting, setSubmitting] = useState(false)

  // Adjustment form
  const [adjustDate, setAdjustDate] = useState('')
  const [adjustBalanceAfter, setAdjustBalanceAfter] = useState('')
  const [adjustRemark, setAdjustRemark] = useState('')
  const [adjustError, setAdjustError] = useState('')

  // History
  const [adjustments, setAdjustments] = useState<BalanceAdjustment[]>([])
  const [historyLoading, setHistoryLoading] = useState(false)

  const loadAccounts = useCallback(async () => {
    if (!currentBookId) { setAccounts([]); return }
    setLoading(true)
    setError('')
    try { setAccounts(await accountApi.list(currentBookId)) }
    catch { setError('获取账户列表失败') }
    finally { setLoading(false) }
  }, [currentBookId])

  useEffect(() => { loadAccounts() }, [loadAccounts])

  const resetForm = () => {
    setFormName('')
    setFormType('BANK_DEBIT')
    setFormInitialBalance('')
    setFormAccountNo('')
    setFormBankName('')
    setFormVisibility('PUBLIC')
    setFormError('')
    setSubmitting(false)
  }

  const handleCreate = async () => {
    if (!formName.trim()) { setFormError('请输入账户名称'); return }
    if (!currentBookId) { setFormError('请先选择账本'); return }
    const initialBalance = formInitialBalance ? parseFloat(formInitialBalance) : 0
    if (isNaN(initialBalance)) { setFormError('初始余额格式错误'); return }
    if (formType === 'CREDIT_CARD' && initialBalance > 0) { setFormError('信用卡余额不能大于0'); return }

    setSubmitting(true)
    try {
      await accountApi.create({
        accountBookId: currentBookId,
        name: formName.trim(),
        type: formType,
        initialBalance,
        accountNo: formAccountNo.trim() || undefined,
        bankName: formBankName.trim() || undefined,
        visibility: formVisibility,
      })
      setCreateOpen(false)
      resetForm()
      loadAccounts()
    } catch (e: any) { setFormError(e.message) }
    finally { setSubmitting(false) }
  }

  const handleUpdate = async () => {
    if (!editAccount) return
    if (!formName.trim()) { setFormError('请输入账户名称'); return }

    setSubmitting(true)
    try {
      await accountApi.update(editAccount.id, {
        name: formName.trim(),
        type: formType,
        visibility: formVisibility,
        accountNo: formAccountNo.trim() || undefined,
        bankName: formBankName.trim() || undefined,
      })
      setEditAccount(null)
      resetForm()
      loadAccounts()
    } catch (e: any) { setFormError(e.message) }
    finally { setSubmitting(false) }
  }

  const handleAdjust = async () => {
    if (!adjustAccount) return
    const balanceAfter = parseFloat(adjustBalanceAfter)
    if (isNaN(balanceAfter)) { setAdjustError('请输入有效数字'); return }
    if (adjustAccount.type === 'CREDIT_CARD' && balanceAfter > 0) {
      setAdjustError('信用卡余额不能大于0'); return
    }
    if (!adjustDate) { setAdjustError('请选择调整日期'); return }

    setSubmitting(true)
    try {
      await accountApi.createAdjustment(adjustAccount.id, {
        date: adjustDate,
        balanceAfter,
        remark: adjustRemark.trim() || undefined,
      })
      setAdjustAccount(null)
      setAdjustDate('')
      setAdjustBalanceAfter('')
      setAdjustRemark('')
      setAdjustError('')
      setSubmitting(false)
      loadAccounts()
    } catch (e: any) { setAdjustError(e.message); setSubmitting(false) }
  }

  const handleDelete = async () => {
    if (!deleteTarget) return
    try {
      await accountApi.delete(deleteTarget.id)
      setDeleteTarget(null)
      loadAccounts()
    } catch (e: any) { setError(e.message) }
  }

  const handleToggleStatus = async (account: AccountItem) => {
    const newStatus = account.status === 'ACTIVE' ? 'ARCHIVED' : 'ACTIVE'
    try {
      await accountApi.update(account.id, { status: newStatus } as any)
      loadAccounts()
    } catch (e: any) { setError(e.message) }
  }

  const openEdit = (account: AccountItem) => {
    setEditAccount(account)
    setFormName(account.name)
    setFormType(account.type)
    setFormVisibility(account.visibility)
    setFormAccountNo(account.accountNo || '')
    setFormBankName(account.bankName || '')
    setFormError('')
    setSubmitting(false)
  }

  const openAdjust = (account: AccountItem) => {
    setAdjustAccount(account)
    setAdjustDate(dayjs().format('YYYY-MM-DDTHH:mm:ss'))
    setAdjustBalanceAfter(account.computedBalance?.toString() || '0')
    setAdjustRemark('')
    setAdjustError('')
    setSubmitting(false)
  }

  const openHistory = async (account: AccountItem) => {
    setHistoryAccount(account)
    setHistoryLoading(true)
    try {
      setAdjustments(await accountApi.listAdjustments(account.id))
    } catch { /* ignore */ }
    finally { setHistoryLoading(false) }
  }

  // 过滤
  const filtered = filterStatus === 'ALL'
    ? accounts
    : accounts.filter((a) => a.status === filterStatus)

  // 空状态
  if (!currentBookId) {
    return (
      <Card className="rounded-2xl">
        <CardContent className="flex flex-col items-center justify-center py-12 text-center gap-2">
          <Wallet size={40} className="opacity-30" />
          <p className="text-base">请先选择或创建账本</p>
          <p className="text-[13px] text-muted-foreground">在上方下拉菜单中选择账本</p>
        </CardContent>
      </Card>
    )
  }

  if (loading && accounts.length === 0) {
    return <Spinner className="py-12" />
  }

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-xl font-bold">账户管理</h1>
        <Button
          onClick={() => { resetForm(); setCreateOpen(true) }}
          className="bg-[#f97316] hover:bg-[#ea580c] text-white rounded-lg"
        >
          <Plus size={16} /> 添加账户
        </Button>
      </div>

      {error && (
        <Alert variant="destructive" className="mb-6">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {/* 筛选 Tabs */}
      <div className="mb-4">
        <Tabs value={filterStatus} onValueChange={(v) => setFilterStatus(v as typeof filterStatus)}>
          <TabsList>
            <TabsTrigger value="ALL">全部</TabsTrigger>
            <TabsTrigger value="ACTIVE">活跃</TabsTrigger>
            <TabsTrigger value="ARCHIVED">已归档</TabsTrigger>
          </TabsList>
        </Tabs>
      </div>

      {/* 账户卡片列表 */}
      {filtered.length === 0 ? (
        <Card className="rounded-2xl">
          <CardContent className="flex flex-col items-center justify-center py-12 text-center gap-2">
            <Wallet size={40} className="opacity-30" />
            <p className="text-base">暂无账户</p>
            <p className="text-[13px] text-muted-foreground">点击上方按钮添加你的第一个账户</p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(300px,1fr))] gap-4">
          {filtered.map((account) => {
            const isOwner = account.ownerId === currentUser?.id

            return (
              <Card
                key={account.id}
                className={`rounded-xl hover:border-[#475569] transition-colors ${
                  account.status === 'ARCHIVED' ? 'opacity-60' : ''
                }`}
              >
                <CardContent className="flex flex-col gap-3 p-5">
                  {/* 顶部：类型图标 + 信息 */}
                  <div className="flex items-start justify-between">
                    <div className="flex items-center gap-3">
                      <div className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${
                        account.type === 'CREDIT_CARD' ? 'bg-[#ef4444]/10 text-[#ef4444]' : 'bg-[#f97316]/10 text-[#f97316]'
                      }`}>
                        <CreditCard size={20} />
                      </div>
                      <div>
                        <div className="text-[15px] font-semibold flex items-center gap-1.5">
                          {account.name}
                          {account.computedBalance === undefined && <EyeOff size={14} className="text-muted-foreground" />}
                        </div>
                        <div className="flex items-center gap-2 mt-0.5">
                          <Badge variant="secondary" className="text-[10px]">
                            {ACCOUNT_TYPE_LABELS[account.type] || account.type}
                          </Badge>
                          {account.visibility === 'PRIVATE' && (
                            <Badge variant="outline" className="text-[10px]">私密</Badge>
                          )}
                          {account.status === 'ARCHIVED' && (
                            <Badge variant="destructive" className="text-[10px]">已归档</Badge>
                          )}
                        </div>
                      </div>
                    </div>
                    <div className="text-right">
                      <div className={`text-lg font-bold tabular-nums ${
                        account.computedBalance !== undefined && account.computedBalance < 0 ? 'text-[#ef4444]' : 'text-foreground'
                      }`}>
                        {formatBalance(account.computedBalance)}
                      </div>
                      {account.accountNo && (
                        <div className="text-[11px] text-muted-foreground mt-0.5">
                          {account.accountNo}
                        </div>
                      )}
                      {account.bankName && (
                        <div className="text-[11px] text-muted-foreground mt-0.5">
                          {account.bankName}
                        </div>
                      )}
                    </div>
                  </div>

                  {/* 底部信息 */}
                  <div className="flex items-center gap-4 text-[12px] text-muted-foreground">
                    <span>{account.ownerName}</span>
                    {account.balanceAt && (
                      <span>余额更新于 {new Date(account.balanceAt).toLocaleDateString('zh-CN')}</span>
                    )}
                  </div>

                  {/* 操作按钮 */}
                  <div className="flex flex-wrap gap-1.5 pt-1 border-t border-border">
                    {isOwner && (
                      <>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => openEdit(account)}
                          className="text-xs border-border text-muted-foreground hover:bg-accent rounded-md"
                        >
                          <Pencil size={13} className="mr-1" /> 编辑
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => openAdjust(account)}
                          className="text-xs border-border text-muted-foreground hover:bg-accent rounded-md"
                        >
                          <TrendingUp size={13} className="mr-1" /> 调整
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => openHistory(account)}
                          className="text-xs border-border text-muted-foreground hover:bg-accent rounded-md"
                        >
                          <History size={13} className="mr-1" /> 记录
                        </Button>
                      </>
                    )}
                    {isOwner && (
                      <>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => handleToggleStatus(account)}
                          className="text-xs border-border text-muted-foreground hover:bg-accent rounded-md"
                        >
                          <Archive size={13} className="mr-1" />
                          {account.status === 'ACTIVE' ? '归档' : '恢复'}
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => setDeleteTarget(account)}
                          className="text-xs border-[#7f1d1d] bg-[#ef4444]/10 text-[#ef4444] rounded-md"
                        >
                          <Trash2 size={13} className="mr-1" /> 删除
                        </Button>
                      </>
                    )}
                  </div>
                </CardContent>
              </Card>
            )
          })}
        </div>
      )}

      {/* 创建账户弹窗 */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogTrigger />
        <DialogContent>
          <DialogHeader>
            <DialogTitle>添加账户</DialogTitle>
          </DialogHeader>
          <div className="flex flex-col gap-3">
            {formError && <Alert variant="destructive"><AlertDescription>{formError}</AlertDescription></Alert>}
            <div>
              <Label className="text-xs text-muted-foreground mb-1 block">账户名称</Label>
              <Input
                aria-label="账户名称"
                placeholder="账户名称"
                value={formName}
                onChange={(e) => { setFormName(e.target.value); setFormError('') }}
                autoFocus
                className="bg-background border-border"
              />
            </div>
            <div>
              <Label className="text-xs text-muted-foreground mb-1 block">账户类型</Label>
              <DictCombobox
                group="account_type"
                value={formType}
                onChange={(v) => setFormType(v as AccountType)}
                placeholder="选择账户类型"
              />
            </div>
            {formType === 'CREDIT_CARD' && (
              <p className="text-[12px] text-muted-foreground">信用卡余额为负向余额，初始余额请填写 0 或负数</p>
            )}
            <div>
              <Label className="text-xs text-muted-foreground mb-1 block">初始余额</Label>
              <Input
                aria-label="初始余额"
                type="number"
                placeholder="初始余额"
                value={formInitialBalance}
                onChange={(e) => { setFormInitialBalance(e.target.value); setFormError('') }}
                className="bg-background border-border"
              />
            </div>
            <div>
              <Label className="text-xs text-muted-foreground mb-1 block">卡号/账号（可选）</Label>
              <Input
                aria-label="卡号/账号"
                placeholder="卡号/账号（可选）"
                value={formAccountNo}
                onChange={(e) => setFormAccountNo(e.target.value)}
                className="bg-background border-border"
              />
            </div>
            {formType === 'BANK_DEBIT' && (
              <div>
                <Label className="text-xs text-muted-foreground mb-1 block">开户行</Label>
                <DictCombobox
                  group="bank_name"
                  value={formBankName}
                  onChange={setFormBankName}
                  valueKey="label"
                  placeholder="选择开户行"
                />
              </div>
            )}
            <div>
              <Label className="text-xs text-muted-foreground mb-1 block">可见性</Label>
              <Select value={formVisibility} onValueChange={(v) => setFormVisibility(v as 'PUBLIC' | 'PRIVATE')}>
                <SelectTrigger className="bg-background border-border">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="bg-card border-border">
                  <SelectItem value="PUBLIC">全员可见</SelectItem>
                  <SelectItem value="PRIVATE">仅自己可见余额</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>取消</Button>
            <Button className="bg-[#f97316] hover:bg-[#ea580c] text-white" onClick={handleCreate} disabled={submitting}>
              {submitting ? '创建中...' : '创建'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 编辑账户弹窗 */}
      <Dialog open={!!editAccount} onOpenChange={() => setEditAccount(null)}>
        <DialogTrigger />
        <DialogContent>
          <DialogHeader>
            <DialogTitle>编辑账户</DialogTitle>
          </DialogHeader>
          <div className="flex flex-col gap-3">
            {formError && <Alert variant="destructive"><AlertDescription>{formError}</AlertDescription></Alert>}
            <div>
              <Label className="text-xs text-muted-foreground mb-1 block">账户名称</Label>
              <Input
                aria-label="账户名称"
                placeholder="账户名称"
                value={formName}
                onChange={(e) => { setFormName(e.target.value); setFormError('') }}
                className="bg-background border-border"
              />
            </div>
            <div>
              <Label className="text-xs text-muted-foreground mb-1 block">账户类型</Label>
              <DictCombobox
                group="account_type"
                value={formType}
                onChange={(v) => setFormType(v as AccountType)}
                placeholder="选择账户类型"
              />
            </div>
            {formType === 'CREDIT_CARD' && (
              <p className="text-[12px] text-muted-foreground">注意：改为信用卡类型要求当前余额 ≤ 0</p>
            )}
            <div>
              <Label className="text-xs text-muted-foreground mb-1 block">卡号/账号（可选）</Label>
              <Input
                aria-label="卡号/账号"
                placeholder="卡号/账号（可选）"
                value={formAccountNo}
                onChange={(e) => setFormAccountNo(e.target.value)}
                className="bg-background border-border"
              />
            </div>
            {formType === 'BANK_DEBIT' && (
              <div>
                <Label className="text-xs text-muted-foreground mb-1 block">开户行</Label>
                <DictCombobox
                  group="bank_name"
                  value={formBankName}
                  onChange={setFormBankName}
                  valueKey="label"
                  placeholder="选择开户行"
                />
              </div>
            )}
            <div>
              <Label className="text-xs text-muted-foreground mb-1 block">可见性</Label>
              <Select value={formVisibility} onValueChange={(v) => setFormVisibility(v as 'PUBLIC' | 'PRIVATE')}>
                <SelectTrigger className="bg-background border-border">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="bg-card border-border">
                  <SelectItem value="PUBLIC">全员可见</SelectItem>
                  <SelectItem value="PRIVATE">仅自己可见余额</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditAccount(null)}>取消</Button>
            <Button className="bg-[#f97316] hover:bg-[#ea580c] text-white" onClick={handleUpdate} disabled={submitting}>
              {submitting ? '保存中...' : '保存'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 余额调整弹窗 */}
      <Dialog open={!!adjustAccount} onOpenChange={() => setAdjustAccount(null)}>
        <DialogTrigger />
        <DialogContent>
          <DialogHeader>
            <DialogTitle>调整余额 — {adjustAccount?.name}</DialogTitle>
          </DialogHeader>
          <div className="flex flex-col gap-3">
            {adjustError && <Alert variant="destructive"><AlertDescription>{adjustError}</AlertDescription></Alert>}
            <div className="p-3 bg-background border border-border rounded-lg">
              <Label className="text-xs text-muted-foreground mb-1">当前余额</Label>
              <div className={`text-lg font-bold tabular-nums ${
                adjustAccount?.computedBalance !== undefined && adjustAccount.computedBalance < 0 ? 'text-[#ef4444]' : ''
              }`}>
                {formatBalance(adjustAccount?.computedBalance)}
              </div>
            </div>
            {adjustAccount?.type === 'CREDIT_CARD' && (
              <p className="text-[12px] text-muted-foreground">信用卡余额必须为 0 或负数</p>
            )}
            <div>
              <Label className="text-xs text-muted-foreground mb-1 block">调整后余额</Label>
              <Input
                aria-label="调整后余额"
                type="number"
                placeholder="输入调整后的余额"
                value={adjustBalanceAfter}
                onChange={(e) => { setAdjustBalanceAfter(e.target.value); setAdjustError('') }}
                className="bg-background border-border"
              />
            </div>
            <div>
              <Label className="text-xs text-muted-foreground mb-1 block">调整日期</Label>
              <DateTimePicker
                value={adjustDate}
                onChange={(v) => { setAdjustDate(v); setAdjustError('') }}
              />
            </div>
            <div>
              <Label className="text-xs text-muted-foreground mb-1 block">备注（可选）</Label>
              <Input
                aria-label="备注"
                placeholder="备注（可选）"
                value={adjustRemark}
                onChange={(e) => setAdjustRemark(e.target.value)}
                className="bg-background border-border"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAdjustAccount(null)}>取消</Button>
            <Button className="bg-[#f97316] hover:bg-[#ea580c] text-white" onClick={handleAdjust} disabled={submitting}>
              {submitting ? '调整中...' : '确认调整'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 调整历史弹窗 */}
      <Dialog open={!!historyAccount} onOpenChange={() => setHistoryAccount(null)}>
        <DialogTrigger />
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>调整记录 — {historyAccount?.name}</DialogTitle>
          </DialogHeader>
          {historyLoading ? (
            <Spinner className="py-6" />
          ) : adjustments.length === 0 ? (
            <div className="text-center py-6 text-sm text-muted-foreground">暂无调整记录</div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="text-xs">日期</TableHead>
                  <TableHead className="text-xs text-right">调整前</TableHead>
                  <TableHead className="text-xs text-right">调整后</TableHead>
                  <TableHead className="text-xs">备注</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {adjustments.map((adj) => (
                  <TableRow key={adj.id}>
                    <TableCell className="text-xs">
                      {new Date(adj.date).toLocaleString('zh-CN')}
                    </TableCell>
                    <TableCell className={`text-xs text-right font-mono ${
                      adj.balanceBefore < 0 ? 'text-[#ef4444]' : ''
                    }`}>
                      {formatBalance(adj.balanceBefore)}
                    </TableCell>
                    <TableCell className={`text-xs text-right font-mono ${
                      adj.balanceAfter < 0 ? 'text-[#ef4444]' : ''
                    }`}>
                      {formatBalance(adj.balanceAfter)}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {adj.remark || '-'}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </DialogContent>
      </Dialog>

      {/* 删除确认弹窗 */}
      <AlertDialog open={!!deleteTarget} onOpenChange={() => setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>删除账户</AlertDialogTitle>
            <AlertDialogDescription>
              确定要删除账户 <strong className="text-[#ef4444]">{deleteTarget?.name}</strong> 吗？此操作不可撤销。
              相关的余额调整记录也将一并删除。
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

      {/* 通用确认弹窗 */}
      <AlertDialog open={!!confirmAction} onOpenChange={() => setConfirmAction(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{confirmAction?.title}</AlertDialogTitle>
            <AlertDialogDescription>{confirmAction?.description}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction
              className="bg-[#f97316] hover:bg-[#ea580c]"
              onClick={confirmAction?.onConfirm}
            >
              确认
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

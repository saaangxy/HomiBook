import { useState, useEffect, useCallback } from 'react'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
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
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { DatePicker } from '@/components/ui/date-picker'
import { DateTimePicker } from '@/components/ui/datetime-picker'
import { MultiSelect } from '@/components/ui/multi-select'
import dayjs from 'dayjs'
import { Spinner } from '@/components/ui/spinner'
import { Textarea } from '@/components/ui/textarea'
import { Tooltip, TooltipTrigger, TooltipContent } from '@/components/ui/tooltip'
import { DictCombobox } from '@/components/DictCombobox'
import { recordApi, type RecordItem, type RecordType, type RecordSummary } from '@/api/record'
import { accountApi, type AccountItem } from '@/api/account'
import { adminApi, type AdminUser } from '@/api/admin'
import { settingsApi, type DictItem } from '@/api/settings'
import { useBookStore } from '../stores/book'
import {
  Plus, ArrowUpRight, ArrowDownRight, ArrowLeftRight,
  Pencil, Trash2, Copy, Filter, X, ChevronLeft, ChevronRight,
} from 'lucide-react'

const TYPE_COLORS: Record<RecordType, string> = {
  INCOME: 'text-[#22c55e] bg-[#22c55e]/10',
  EXPENSE: 'text-[#ef4444] bg-[#ef4444]/10',
  TRANSFER: 'text-[#3b82f6] bg-[#3b82f6]/10',
}
const TYPE_LABELS: Record<RecordType, string> = {
  INCOME: '收入',
  EXPENSE: '支出',
  TRANSFER: '转账',
}

function formatMoney(amount: number): string {
  return new Intl.NumberFormat('zh-CN', { style: 'currency', currency: 'CNY' }).format(amount)
}

interface FilterState {
  types: string[]         // 多选类型 INCOME/EXPENSE/TRANSFER
  accountIds: string[]    // 多选账户
  categoryCodes: string[] // 多选分类
  dateFrom: string
  dateTo: string
  ownerIds: string[]      // 多选归属人
  payer: string
  amountFrom: string
  amountTo: string
  remark: string
}

function filterValueLabel(key: keyof FilterState, value: string[] | string, accounts: AccountItem[], users: AdminUser[]): string {
  if (!value || (Array.isArray(value) && value.length === 0)) return ''
  const v = Array.isArray(value) ? value.join(',') : value
  switch (key) {
    case 'types': {
      const ids = value as string[]
      const labels = ids.map((t) => TYPE_LABELS[t as RecordType] || t)
      return `类型: ${labels.join(', ')}`
    }
    case 'accountIds': {
      const ids = value as string[]
      const labels = ids.map((id) => accounts.find((a) => a.id === id)?.name || id)
      return `账户: ${labels.join(', ')}`
    }
    case 'categoryCodes': {
      const ids = value as string[]
      return `分类: ${ids.join(', ')}`
    }
    case 'ownerIds': {
      const ids = value as string[]
      const labels = ids.map((id) => {
        const u = users.find((u) => u.id === id)
        return u?.name || u?.email || id
      })
      return `归属人: ${labels.join(', ')}`
    }
    case 'dateFrom': return `${v} 起`
    case 'dateTo': return `至 ${v}`
    case 'payer': return `交易方: ${v}`
    case 'amountFrom': return `金额 ≥ ${v}`
    case 'amountTo': return `金额 ≤ ${v}`
    case 'remark': return `备注: ${v}`
    default: return v
  }
}

export function RecordsPage() {
  const currentBookId = useBookStore((s) => s.currentBookId)

  // 列表数据
  const [records, setRecords] = useState<RecordItem[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  // 汇总
  const [summary, setSummary] = useState<RecordSummary>({ income: 0, expense: 0, transfer: 0, netIncome: 0 })

  // 分页
  const [page, setPage] = useState(1)
  const [pageSize] = useState(20)
  const [total, setTotal] = useState(0)

  // 筛选
  const [filters, setFilters] = useState<FilterState>({
    types: [],
    accountIds: [],
    categoryCodes: [],
    dateFrom: '',
    dateTo: '',
    ownerIds: [],
    payer: '',
    amountFrom: '',
    amountTo: '',
    remark: '',
  })

  // 抽屉
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [draftFilters, setDraftFilters] = useState<FilterState>({ ...filters })

  // 账户列表
  const [accounts, setAccounts] = useState<AccountItem[]>([])
  // 用户列表
  const [users, setUsers] = useState<AdminUser[]>([])
  // 全部分类（用于筛选多选）
  const [allCategories, setAllCategories] = useState<DictItem[]>([])

  // 选择
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())

  // 弹窗状态
  const [createOpen, setCreateOpen] = useState(false)
  const [editRecord, setEditRecord] = useState<RecordItem | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<RecordItem | null>(null)

  // 批量更新弹窗
  const [batchOpen, setBatchOpen] = useState(false)
  const [batchCategory, setBatchCategory] = useState('')
  const [batchRemark, setBatchRemark] = useState('')

  // 表单状态
  const [formType, setFormType] = useState<RecordType>('EXPENSE')
  const [formAmount, setFormAmount] = useState('')
  const [formDate, setFormDate] = useState('')
  const [formAccountId, setFormAccountId] = useState('')
  const [formFromAccountId, setFormFromAccountId] = useState('')
  const [formToAccountId, setFormToAccountId] = useState('')
  const [formCategoryCode, setFormCategoryCode] = useState('')
  const [formPayer, setFormPayer] = useState('')
  const [formRemark, setFormRemark] = useState('')
  const [formOwnerId, setFormOwnerId] = useState('')
  const [formAttachments, setFormAttachments] = useState<string[]>([])
  const [formError, setFormError] = useState('')
  const [submitting, setSubmitting] = useState(false)

  // 加载账户
  const loadAccounts = useCallback(async () => {
    if (!currentBookId) return
    try {
      setAccounts(await accountApi.list(currentBookId))
    } catch { /* ignore */ }
  }, [currentBookId])

  // 加载用户
  const loadUsers = useCallback(async () => {
    try {
      const list = await adminApi.listUsers()
      setUsers(list)
    } catch { /* ignore */ }
  }, [])

  const loadCategories = useCallback(async () => {
    try {
      const groups = ['transaction_category_income', 'transaction_category_expense', 'transaction_category_transfer']
      const results = await Promise.all(groups.map((g) => settingsApi.getDictionary(g)))
      const merged: DictItem[] = []
      const seen = new Set<string>()
      for (const arr of results) {
        for (const item of arr) {
          if (!seen.has(item.code)) { seen.add(item.code); merged.push(item) }
        }
      }
      setAllCategories(merged)
    } catch { /* ignore */ }
  }, [])

  useEffect(() => { loadAccounts(); loadUsers(); loadCategories() }, [loadAccounts, loadUsers, loadCategories])

  // 加载汇总
  const loadSummary = useCallback(async () => {
    if (!currentBookId) return
    try {
      setSummary(await recordApi.summary({
        bookId: currentBookId,
        dateFrom: filters.dateFrom || undefined,
        dateTo: filters.dateTo || undefined,
      }))
    } catch { /* ignore */ }
  }, [currentBookId, filters.dateFrom, filters.dateTo])

  // 加载列表
  const loadRecords = useCallback(async () => {
    if (!currentBookId) return
    setLoading(true)
    setError('')
    try {
      const res = await recordApi.list({
        bookId: currentBookId,
        page,
        pageSize,
        type: filters.types.length > 0 ? filters.types.join(',') : undefined,
        accountId: filters.accountIds.length > 0 ? filters.accountIds.join(',') : undefined,
        categoryCode: filters.categoryCodes.length > 0 ? filters.categoryCodes.join(',') : undefined,
        dateFrom: filters.dateFrom || undefined,
        dateTo: filters.dateTo || undefined,
        ownerId: filters.ownerIds.length > 0 ? filters.ownerIds.join(',') : undefined,
        payer: filters.payer || undefined,
        amountFrom: filters.amountFrom ? parseFloat(filters.amountFrom) : undefined,
        amountTo: filters.amountTo ? parseFloat(filters.amountTo) : undefined,
        remark: filters.remark || undefined,
      })
      setRecords(res.records)
      setTotal(res.total)
    } catch (e: any) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }, [currentBookId, page, pageSize, filters])

  useEffect(() => { loadRecords() }, [loadRecords])
  useEffect(() => { loadSummary() }, [loadSummary])

  const resetFilters = () => {
    const empty: FilterState = { types: [], accountIds: [], categoryCodes: [], dateFrom: '', dateTo: '', ownerIds: [], payer: '', amountFrom: '', amountTo: '', remark: '' }
    setFilters(empty)
    setDraftFilters({ ...empty })
    setPage(1)
  }

  const openDrawer = () => {
    setDraftFilters({ ...filters })
    setDrawerOpen(true)
  }

  const applyFilters = () => {
    setFilters({ ...draftFilters })
    setPage(1)
    setDrawerOpen(false)
  }

  const removeFilter = (key: keyof FilterState) => {
    const emptyVal = key === 'types' || key === 'accountIds' || key === 'categoryCodes' || key === 'ownerIds' ? [] : ''
    setFilters((prev) => ({ ...prev, [key]: emptyVal }))
    setDraftFilters((prev) => ({ ...prev, [key]: emptyVal }))
    setPage(1)
  }

  const activeFilterCount = (Object.keys(filters) as (keyof FilterState)[]).filter((k) => {
    const v = filters[k]
    return Array.isArray(v) ? v.length > 0 : !!v
  }).length

  const openCreate = () => {
    setFormType('EXPENSE')
    setFormAmount('')
    setFormDate(dayjs().format('YYYY-MM-DDTHH:mm:ss'))
    setFormAccountId('')
    setFormFromAccountId('')
    setFormToAccountId('')
    setFormCategoryCode('')
    setFormPayer('')
    setFormRemark('')
    setFormOwnerId('')
    setFormAttachments([])
    setFormError('')
    setSubmitting(false)
    setCreateOpen(true)
  }

  const openEdit = (record: RecordItem) => {
    setFormType(record.type)
    setFormAmount(record.amount.toString())
    setFormDate(dayjs(record.date).format('YYYY-MM-DDTHH:mm:ss'))
    setFormAccountId(record.accountId)
    setFormFromAccountId(record.fromAccountId || '')
    setFormToAccountId(record.toAccountId || '')
    setFormCategoryCode(record.categoryCode || '')
    setFormPayer(record.payer || '')
    setFormRemark(record.remark || '')
    setFormOwnerId(record.ownerId)
    setFormAttachments(record.attachments)
    setFormError('')
    setSubmitting(false)
    setEditRecord(record)
  }

  const handleCreate = async () => {
    if (!formAmount || parseFloat(formAmount) <= 0) { setFormError('请输入有效金额'); return }
    if (!formAccountId) { setFormError('请选择账户'); return }
    if (!currentBookId) return
    setSubmitting(true)
    try {
      await recordApi.create({
        accountBookId: currentBookId,
        type: formType,
        amount: parseFloat(formAmount),
        date: new Date(formDate).toISOString(),
        accountId: formAccountId,
        fromAccountId: formType === 'TRANSFER' ? formFromAccountId : undefined,
        toAccountId: formType === 'TRANSFER' ? formToAccountId : undefined,
        categoryCode: formCategoryCode || undefined,
        payer: formPayer || undefined,
        remark: formRemark || undefined,
        ownerId: formOwnerId || undefined,
        attachments: formAttachments,
      })
      setCreateOpen(false)
      loadRecords()
      loadSummary()
      loadAccounts()
    } catch (e: any) { setFormError(e.message) }
    finally { setSubmitting(false) }
  }

  const handleUpdate = async () => {
    if (!editRecord) return
    if (!formAmount || parseFloat(formAmount) <= 0) { setFormError('请输入有效金额'); return }
    setSubmitting(true)
    try {
      await recordApi.update(editRecord.id, {
        type: formType,
        amount: parseFloat(formAmount),
        date: new Date(formDate).toISOString(),
        accountId: formAccountId,
        fromAccountId: formType === 'TRANSFER' ? formFromAccountId : undefined,
        toAccountId: formType === 'TRANSFER' ? formToAccountId : undefined,
        categoryCode: formCategoryCode || undefined,
        payer: formPayer || undefined,
        remark: formRemark || undefined,
        ownerId: formOwnerId || undefined,
        attachments: formAttachments,
      })
      setEditRecord(null)
      loadRecords()
      loadSummary()
      loadAccounts()
    } catch (e: any) { setFormError(e.message) }
    finally { setSubmitting(false) }
  }

  const handleDelete = async () => {
    if (!deleteTarget) return
    try {
      await recordApi.delete(deleteTarget.id)
      setDeleteTarget(null)
      loadRecords()
      loadSummary()
      loadAccounts()
    } catch (e: any) { setError(e.message) }
  }

  const handleClone = async (record: RecordItem) => {
    try {
      await recordApi.clone(record.id)
      loadRecords()
      loadSummary()
      loadAccounts()
    } catch (e: any) { setError(e.message) }
  }

  const handleBatchUpdate = async () => {
    if (selectedIds.size === 0) return
    setSubmitting(true)
    try {
      await recordApi.batchUpdate(
        Array.from(selectedIds),
        { categoryCode: batchCategory || undefined, remark: batchRemark || undefined }
      )
      setBatchOpen(false)
      setBatchCategory('')
      setBatchRemark('')
      loadRecords()
    } catch (e: any) { setError(e.message) }
    finally { setSubmitting(false) }
  }

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const toggleSelectAll = () => {
    if (selectedIds.size === records.length) setSelectedIds(new Set())
    else setSelectedIds(new Set(records.map((r) => r.id)))
  }

  const getCategoryGroup = (type: RecordType) => {
    if (type === 'INCOME') return 'transaction_category_income'
    if (type === 'EXPENSE') return 'transaction_category_expense'
    return 'transaction_category_transfer'
  }

  // 空状态
  if (!currentBookId) {
    return (
      <Card className="rounded-2xl">
        <CardContent className="flex flex-col items-center justify-center py-12 text-center gap-2">
          <ArrowLeftRight size={40} className="opacity-30" />
          <p className="text-base">请先选择账本</p>
          <p className="text-[13px] text-muted-foreground">在上方下拉菜单中选择账本</p>
        </CardContent>
      </Card>
    )
  }

  const totalPages = Math.ceil(total / pageSize)
  const activeFilterKeys = (Object.keys(filters) as (keyof FilterState)[]).filter((k) => {
    const v = filters[k]
    return Array.isArray(v) ? v.length > 0 : !!v
  })

  return (
    <div>
      {error && (
        <Alert variant="destructive" className="mb-6">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {/* 汇总卡片 */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        {([
          { label: '总收入', value: summary.income, icon: ArrowUpRight, color: 'text-[#22c55e]' },
          { label: '总支出', value: summary.expense, icon: ArrowDownRight, color: 'text-[#ef4444]' },
          { label: '转账总额', value: summary.transfer, icon: ArrowLeftRight, color: 'text-[#3b82f6]' },
          { label: '净收入', value: summary.netIncome, icon: summary.netIncome >= 0 ? ArrowUpRight : ArrowDownRight, color: summary.netIncome >= 0 ? 'text-[#22c55e]' : 'text-[#ef4444]' },
        ] as const).map(({ label, value, icon: Icon, color }) => (
          <Card key={label} className="rounded-xl">
            <CardContent className="p-4 flex items-center gap-3">
              <div className={`w-10 h-10 rounded-xl flex items-center justify-center bg-background ${color}`}>
                <Icon size={20} />
              </div>
              <div>
                <p className="text-xs text-muted-foreground">{label}</p>
                <p className={`text-lg font-bold tabular-nums ${color}`}>
                  {formatMoney(value)}
                </p>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* 记录列表 */}
      <Card className="rounded-xl overflow-hidden">
        {/* 表头：筛选按钮 + 新增按钮 */}
        <div className="flex items-center justify-between px-4 py-3 border-b">
          {/* 左侧：活跃筛选标签 */}
          <div className="flex items-center gap-2 flex-wrap min-h-8">
            {activeFilterCount === 0 ? (
              <span className="text-sm text-muted-foreground">暂无筛选条件</span>
            ) : (
              activeFilterKeys.map((key) => (
                <Badge key={key} variant="secondary" className="pl-2 pr-1 py-1 gap-1 text-xs font-normal">
                  {filterValueLabel(key, filters[key], accounts, users)}
                  <button
                    onClick={() => removeFilter(key)}
                    className="ml-1 rounded hover:bg-muted p-0.5"
                  >
                    <X size={12} />
                  </button>
                </Badge>
              ))
            )}
          </div>
          {/* 右侧：操作按钮 */}
          <div className="flex items-center gap-2 shrink-0">
            <Button
              onClick={openCreate}
              className="bg-[#f97316] hover:bg-[#ea580c] text-white rounded-lg h-8 text-xs"
            >
              <Plus size={14} /> 记一笔
            </Button>
            <Button
              variant="outline"
              onClick={openDrawer}
              className="h-8 text-xs rounded-lg"
            >
              <Filter size={14} /> 筛选
              {activeFilterCount > 0 && (
                <span className="ml-1 bg-[#f97316] text-white text-[10px] rounded-full w-4 h-4 flex items-center justify-center">
                  {activeFilterCount}
                </span>
              )}
            </Button>
            {activeFilterCount > 0 && (
              <Button
                variant="ghost"
                onClick={resetFilters}
                className="h-8 text-xs text-muted-foreground"
              >
                重置
              </Button>
            )}
          </div>
        </div>

        {/* 批量操作栏 */}
        {selectedIds.size > 0 && (
          <div className="flex items-center gap-3 px-4 py-2 bg-muted/50 border-b">
            <span className="text-sm">已选择 {selectedIds.size} 条</span>
            <Button size="sm" variant="outline" onClick={() => setBatchOpen(true)} className="text-xs h-7">
              批量更新
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setSelectedIds(new Set())} className="text-xs h-7">
              取消选择
            </Button>
          </div>
        )}

        {/* 表格 */}
        {loading && records.length === 0 ? (
          <div className="py-12"><Spinner className="mx-auto" /></div>
        ) : records.length === 0 ? (
          <CardContent className="flex flex-col items-center justify-center py-12 text-center gap-2">
            <ArrowLeftRight size={40} className="opacity-30" />
            <p className="text-base">暂无流水记录</p>
            <p className="text-[13px] text-muted-foreground">点击上方按钮记一笔</p>
          </CardContent>
        ) : (
          <>
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead className="w-8">
                    <input
                      type="checkbox"
                      checked={selectedIds.size === records.length}
                      onChange={toggleSelectAll}
                      className="rounded"
                    />
                  </TableHead>
                  <TableHead className="text-xs">日期</TableHead>
                  <TableHead className="text-xs">类型</TableHead>
                  <TableHead className="text-xs">账户</TableHead>
                  <TableHead className="text-xs">分类</TableHead>
                  <TableHead className="text-xs">交易方</TableHead>
                  <TableHead className="text-xs text-right">金额</TableHead>
                  <TableHead className="text-xs">备注</TableHead>
                  <TableHead className="text-xs w-24 text-right">操作</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {records.map((record) => (
                  <TableRow key={record.id} className="hover:bg-accent/50">
                    <TableCell className="py-2.5">
                      <input
                        type="checkbox"
                        checked={selectedIds.has(record.id)}
                        onChange={() => toggleSelect(record.id)}
                        className="rounded"
                      />
                    </TableCell>
                    <TableCell className="text-xs py-2.5">
                      {new Date(record.date).toLocaleDateString('zh-CN')}
                    </TableCell>
                    <TableCell className="py-2.5">
                      <Badge className={`text-[10px] ${TYPE_COLORS[record.type]}`}>
                        {TYPE_LABELS[record.type]}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-xs py-2.5">
                      <div className="flex flex-col gap-0.5">
                        <span>{record.account.name}</span>
                        {record.type === 'TRANSFER' && record.fromAccount && (
                          <span className="text-muted-foreground text-[10px]">
                            → {record.toAccount?.name}
                          </span>
                        )}
                      </div>
                    </TableCell>
                    <TableCell className="text-xs py-2.5 text-muted-foreground">
                      {record.categoryCode || '-'}
                    </TableCell>
                    <TableCell className="text-xs py-2.5 text-muted-foreground">
                      {record.payer || '-'}
                    </TableCell>
                    <TableCell className={`text-sm font-bold tabular-nums py-2.5 text-right ${
                      record.type === 'INCOME' ? 'text-[#22c55e]' :
                      record.type === 'EXPENSE' ? 'text-[#ef4444]' : 'text-[#3b82f6]'
                    }`}>
                      {record.type === 'EXPENSE' ? '-' : record.type === 'INCOME' ? '+' : ''}{formatMoney(record.amount)}
                    </TableCell>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <TableCell className="text-xs py-2.5 text-muted-foreground max-w-32 truncate cursor-default">
                          {record.remark || '-'}
                        </TableCell>
                      </TooltipTrigger>
                      <TooltipContent side="top" className="max-w-xs">
                        <p className="break-all">{record.remark || '无备注'}</p>
                      </TooltipContent>
                    </Tooltip>
                    <TableCell className="text-right py-2.5">
                      <div className="flex items-center justify-end gap-0.5">
                        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => openEdit(record)}>
                          <Pencil size={13} />
                        </Button>
                        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => handleClone(record)}>
                          <Copy size={13} />
                        </Button>
                        <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:text-[#ef4444]" onClick={() => setDeleteTarget(record)}>
                          <Trash2 size={13} />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>

            {/* 分页 */}
            {totalPages > 1 && (
              <div className="flex items-center justify-between p-4 border-t">
                <span className="text-sm text-muted-foreground">
                  共 {total} 条，第 {page}/{totalPages} 页
                </span>
                <div className="flex items-center gap-2">
                  <Button variant="outline" size="sm" onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page <= 1}>
                    <ChevronLeft size={14} />
                  </Button>
                  <span className="text-sm">{page} / {totalPages}</span>
                  <Button variant="outline" size="sm" onClick={() => setPage((p) => Math.min(totalPages, p + 1))} disabled={page >= totalPages}>
                    <ChevronRight size={14} />
                  </Button>
                </div>
              </div>
            )}
          </>
        )}
      </Card>

      {/* 筛选抽屉 */}
      <Sheet open={drawerOpen} onOpenChange={setDrawerOpen}>
        <SheetContent side="right" className="w-80 flex flex-col">
          <SheetHeader>
            <SheetTitle>筛选条件</SheetTitle>
          </SheetHeader>
          <div className="flex flex-col gap-4 flex-1 overflow-y-auto py-4">
            {/* 类型（多选） */}
            <div>
              <Label className="text-xs text-muted-foreground mb-1.5 block">类型</Label>
              <MultiSelect
                items={[
                  { value: 'INCOME', label: '收入' },
                  { value: 'EXPENSE', label: '支出' },
                  { value: 'TRANSFER', label: '转账' },
                ]}
                selected={draftFilters.types}
                onChange={(v) => setDraftFilters((p) => ({ ...p, types: v }))}
                placeholder="全部类型"
              />
            </div>

            {/* 账户（多选） */}
            <div>
              <Label className="text-xs text-muted-foreground mb-1.5 block">账户</Label>
              <MultiSelect
                items={accounts.map((a) => ({ value: a.id, label: a.name }))}
                selected={draftFilters.accountIds}
                onChange={(v) => setDraftFilters((p) => ({ ...p, accountIds: v }))}
                placeholder="全部账户"
              />
            </div>

            {/* 分类（多选，不关联类型） */}
            <div>
              <Label className="text-xs text-muted-foreground mb-1.5 block">分类</Label>
              <MultiSelect
                items={allCategories.map((c) => ({ value: c.code, label: c.label }))}
                selected={draftFilters.categoryCodes}
                onChange={(v) => setDraftFilters((p) => ({ ...p, categoryCodes: v }))}
                placeholder="全部分类"
              />
            </div>

            {/* 日期范围 */}
            <div>
              <Label className="text-xs text-muted-foreground mb-1.5 block">开始日期</Label>
              <DatePicker
                value={draftFilters.dateFrom}
                onChange={(v) => setDraftFilters((p) => ({ ...p, dateFrom: v }))}
                className="w-full"
              />
            </div>
            <div>
              <Label className="text-xs text-muted-foreground mb-1.5 block">结束日期</Label>
              <DatePicker
                value={draftFilters.dateTo}
                onChange={(v) => setDraftFilters((p) => ({ ...p, dateTo: v }))}
                className="w-full"
              />
            </div>

            {/* 归属人（多选） */}
            <div>
              <Label className="text-xs text-muted-foreground mb-1.5 block">归属人</Label>
              <MultiSelect
                items={users.map((u) => ({ value: u.id, label: u.name || u.email || u.id }))}
                selected={draftFilters.ownerIds}
                onChange={(v) => setDraftFilters((p) => ({ ...p, ownerIds: v }))}
                placeholder="全部成员"
              />
            </div>

            {/* 交易方 */}
            <div>
              <Label className="text-xs text-muted-foreground mb-1.5 block">交易方</Label>
              <div className="relative">
                <Input
                  placeholder="模糊搜索交易方..."
                  value={draftFilters.payer}
                  onChange={(e) => setDraftFilters((p) => ({ ...p, payer: e.target.value }))}
                  className="bg-background border-border h-9 text-sm pr-8"
                />
                {draftFilters.payer && (
                  <button
                    className="absolute right-2 top-1/2 -translate-y-1/2 h-5 w-5 rounded-full opacity-50 hover:opacity-100 flex items-center justify-center"
                    onClick={() => setDraftFilters((p) => ({ ...p, payer: '' }))}
                  >
                    <X size={14} />
                  </button>
                )}
              </div>
            </div>

            {/* 金额范围 */}
            <div className="flex gap-3">
              <div className="flex-1">
                <Label className="text-xs text-muted-foreground mb-1.5 block">金额 ≥</Label>
                <div className="relative">
                  <Input
                    type="number"
                    placeholder="最低金额"
                    value={draftFilters.amountFrom}
                    onChange={(e) => setDraftFilters((p) => ({ ...p, amountFrom: e.target.value }))}
                    className="bg-background border-border h-9 text-sm pr-8"
                  />
                  {draftFilters.amountFrom && (
                    <button
                      className="absolute right-2 top-1/2 -translate-y-1/2 h-5 w-5 rounded-full opacity-50 hover:opacity-100 flex items-center justify-center"
                      onClick={() => setDraftFilters((p) => ({ ...p, amountFrom: '' }))}
                    >
                      <X size={14} />
                    </button>
                  )}
                </div>
              </div>
              <div className="flex-1">
                <Label className="text-xs text-muted-foreground mb-1.5 block">金额 ≤</Label>
                <div className="relative">
                  <Input
                    type="number"
                    placeholder="最高金额"
                    value={draftFilters.amountTo}
                    onChange={(e) => setDraftFilters((p) => ({ ...p, amountTo: e.target.value }))}
                    className="bg-background border-border h-9 text-sm pr-8"
                  />
                  {draftFilters.amountTo && (
                    <button
                      className="absolute right-2 top-1/2 -translate-y-1/2 h-5 w-5 rounded-full opacity-50 hover:opacity-100 flex items-center justify-center"
                      onClick={() => setDraftFilters((p) => ({ ...p, amountTo: '' }))}
                    >
                      <X size={14} />
                    </button>
                  )}
                </div>
              </div>
            </div>

            {/* 备注模糊搜索 */}
            <div>
              <Label className="text-xs text-muted-foreground mb-1.5 block">备注</Label>
              <div className="relative">
                <Input
                  placeholder="模糊搜索备注..."
                  value={draftFilters.remark}
                  onChange={(e) => setDraftFilters((p) => ({ ...p, remark: e.target.value }))}
                  className="bg-background border-border h-9 text-sm pr-8"
                />
                {draftFilters.remark && (
                  <button
                    className="absolute right-2 top-1/2 -translate-y-1/2 h-5 w-5 rounded-full opacity-50 hover:opacity-100 flex items-center justify-center"
                    onClick={() => setDraftFilters((p) => ({ ...p, remark: '' }))}
                  >
                    <X size={14} />
                  </button>
                )}
              </div>
            </div>
          </div>

          {/* 抽屉底部按钮 */}
          <div className="flex items-center gap-2 pt-4 border-t">
            <Button variant="outline" className="flex-1" onClick={resetFilters}>重置</Button>
            <Button className="flex-1 bg-[#f97316] hover:bg-[#ea580c] text-white" onClick={applyFilters}>应用</Button>
          </div>
        </SheetContent>
      </Sheet>

      {/* 创建/编辑弹窗 */}
      <Dialog open={createOpen || !!editRecord} onOpenChange={() => { setCreateOpen(false); setEditRecord(null) }}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{editRecord ? '编辑流水' : '记一笔'}</DialogTitle>
          </DialogHeader>
          <div className="flex flex-col gap-3 max-h-[70vh] overflow-y-auto">
            {formError && <Alert variant="destructive"><AlertDescription>{formError}</AlertDescription></Alert>}

            <div className="flex gap-3">
              <div className="flex-1">
                <Label className="text-xs text-muted-foreground mb-1 block">类型</Label>
                <Tabs value={formType} onValueChange={(v) => setFormType(v as RecordType)}>
                  <TabsList className="h-9 w-full grid grid-cols-3 p-0.5 gap-0.5 bg-muted rounded-lg">
                    {(['EXPENSE', 'INCOME', 'TRANSFER'] as RecordType[]).map((t) => (
                      <TabsTrigger
                        key={t}
                        value={t}
                        className={`text-xs rounded-md h-8 data-[state=active]:bg-background data-[state=active]:shadow-sm ${
                          t === 'EXPENSE' ? 'text-[#ef4444]' : t === 'INCOME' ? 'text-[#22c55e]' : 'text-[#3b82f6]'
                        }`}
                      >
                        {TYPE_LABELS[t]}
                      </TabsTrigger>
                    ))}
                  </TabsList>
                </Tabs>
              </div>
              <div className="flex-1">
                <Label className="text-xs text-muted-foreground mb-1 block">金额</Label>
                <Input
                  type="number"
                  placeholder="0.00"
                  value={formAmount}
                  onChange={(e) => { setFormAmount(e.target.value); setFormError('') }}
                  className="bg-background border-border"
                  autoFocus
                />
              </div>
            </div>

            <div className="flex gap-3">
              <div className="flex-1">
                <Label className="text-xs text-muted-foreground mb-1 block">账户</Label>
                <Select value={formAccountId} onValueChange={(v) => { setFormAccountId(v); setFormError('') }}>
                  <SelectTrigger className="bg-background border-border">
                    <SelectValue placeholder="选择账户" />
                  </SelectTrigger>
                  <SelectContent className="bg-card border-border">
                    {accounts.map((a) => (
                      <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="flex-1">
                <Label className="text-xs text-muted-foreground mb-1 block">日期</Label>
                <DateTimePicker
                  value={formDate}
                  onChange={setFormDate}
                />
              </div>
            </div>

            {formType === 'TRANSFER' && (
              <div className="flex gap-3">
                <div className="flex-1">
                  <Label className="text-xs text-muted-foreground mb-1 block">源账户</Label>
                  <Select value={formFromAccountId} onValueChange={setFormFromAccountId}>
                    <SelectTrigger className="bg-background border-border">
                      <SelectValue placeholder="选择转出账户" />
                    </SelectTrigger>
                    <SelectContent className="bg-card border-border">
                      {accounts.map((a) => (
                        <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="flex-1">
                  <Label className="text-xs text-muted-foreground mb-1 block">目标账户</Label>
                  <Select value={formToAccountId} onValueChange={setFormToAccountId}>
                    <SelectTrigger className="bg-background border-border">
                      <SelectValue placeholder="选择转入账户" />
                    </SelectTrigger>
                    <SelectContent className="bg-card border-border">
                      {accounts.map((a) => (
                        <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
            )}

            <div>
              <Label className="text-xs text-muted-foreground mb-1 block">分类</Label>
              <DictCombobox
                group={getCategoryGroup(formType)}
                value={formCategoryCode}
                onChange={setFormCategoryCode}
                placeholder="选择分类（可选）"
              />
            </div>

            <div>
              <Label className="text-xs text-muted-foreground mb-1 block">交易方</Label>
              <Input
                placeholder="商家、对方账户名等（可选）"
                value={formPayer}
                onChange={(e) => setFormPayer(e.target.value)}
                className="bg-background border-border"
              />
            </div>

            <div>
              <Label className="text-xs text-muted-foreground mb-1 block">备注</Label>
              <Textarea
                placeholder="备注信息（可选）"
                value={formRemark}
                onChange={(e) => setFormRemark(e.target.value)}
                className="bg-background border-border min-h-[80px]"
                rows={3}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setCreateOpen(false); setEditRecord(null) }}>取消</Button>
            <Button
              className="bg-[#f97316] hover:bg-[#ea580c] text-white"
              onClick={editRecord ? handleUpdate : handleCreate}
              disabled={submitting}
            >
              {submitting ? '保存中...' : editRecord ? '保存' : '创建'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 删除确认 */}
      <AlertDialog open={!!deleteTarget} onOpenChange={() => setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>删除流水</AlertDialogTitle>
            <AlertDialogDescription>
              确定要删除这条流水记录吗？账户余额将相应调整。此操作不可撤销。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction className="bg-[#ef4444] hover:bg-[#dc2626]" onClick={handleDelete}>
              确认删除
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* 批量更新弹窗 */}
      <Dialog open={batchOpen} onOpenChange={setBatchOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>批量更新 {selectedIds.size} 条记录</DialogTitle>
          </DialogHeader>
          <div className="flex flex-col gap-3">
            <div>
              <Label className="text-xs text-muted-foreground mb-1 block">分类</Label>
              <DictCombobox
                group="transaction_category_expense"
                value={batchCategory}
                onChange={setBatchCategory}
                placeholder="留空则不更新分类"
              />
            </div>
            <div>
              <Label className="text-xs text-muted-foreground mb-1 block">备注</Label>
              <Textarea
                placeholder="留空则不更新备注"
                value={batchRemark}
                onChange={(e) => setBatchRemark(e.target.value)}
                className="bg-background border-border min-h-[60px]"
                rows={2}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setBatchOpen(false)}>取消</Button>
            <Button className="bg-[#f97316] hover:bg-[#ea580c] text-white" onClick={handleBatchUpdate} disabled={submitting}>
              {submitting ? '更新中...' : '确认更新'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

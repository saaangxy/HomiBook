import { useState, useEffect, useCallback } from 'react'
import { RECORD_TYPE_LABELS as TYPE_LABELS, RECORD_TYPE_TEXT_CLASS } from '@/lib/record-type'
import { RecordFormDialog } from '@/components/records/RecordFormDialog'
import { BatchEditDialog } from '@/components/records/BatchEditDialog'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
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
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
} from '@/components/ui/table'
import {Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger} from '@/components/ui/sheet'
import { DatePicker } from '@/components/ui/date-picker'
import { MultiSelect } from '@/components/ui/multi-select'
import { Spinner } from '@/components/ui/spinner'
import { AttachmentViewer } from '@/components/AttachmentViewer'
import { recordApi, type RecordItem, type RecordType, type RecordSummary } from '@/api/record'
import { accountApi, type AccountItem } from '@/api/account'
import { accountLabel, isMultiOwnerAccounts } from '@/lib/account'
import { formatMoney } from '@homibook/core'
import { bookApi, type BookMember } from '@/api/book'
import { settingsApi, type DictItem } from '@/api/settings'
import { useBookStore } from '../stores/book'
import { ImportDialog } from '@/components/ImportDialog'
import { DedupDialog } from '@/components/DedupDialog'
import { RecordRow } from '@/components/records/RecordRow'
import { useIsMobile } from '@/hooks/use-mobile'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { MoreHorizontal } from 'lucide-react'
import { importExportApi } from '@/api/import-export'
import {
  Plus, ArrowUpRight, ArrowDownRight, ArrowLeftRight,
  Pencil, Filter, X, ChevronLeft, ChevronRight,
  Upload, Download, Save, CopyMinus,
} from 'lucide-react'

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
  tags: string[]          // 多选标签
}

function filterValueLabel(key: keyof FilterState, value: string[] | string, accounts: AccountItem[], members: BookMember[]): string {
  const multiOwner = isMultiOwnerAccounts(accounts)
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
      const labels = ids.map((id) => {
        const a = accounts.find((a) => a.id === id)
        return a ? accountLabel(a, multiOwner) : id
      })
      return `账户: ${labels.join(', ')}`
    }
    case 'categoryCodes': {
      const ids = value as string[]
      return `分类: ${ids.join(', ')}`
    }
    case 'tags': {
      const ids = value as string[]
      return `标签: ${ids.join(', ')}`
    }
    case 'ownerIds': {
      const ids = value as string[]
      const labels = ids.map((id) => {
        const m = members.find((m) => m.userId === id)
        return m?.user.nickname || m?.user.email || id
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
  const isMobile = useIsMobile()

  // 列表数据
  const [records, setRecords] = useState<RecordItem[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  // 汇总
  const [summary, setSummary] = useState<RecordSummary>({ income: 0, expense: 0, transfer: 0, netIncome: 0 })

  // 分页
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(20)
  const [total, setTotal] = useState(0)
  const [jumpInput, setJumpInput] = useState('')

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
    tags: [],
  })

  // 抽屉
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [draftFilters, setDraftFilters] = useState<FilterState>({ ...filters })

  // 账户列表
  const [accounts, setAccounts] = useState<AccountItem[]>([])
  const multiOwnerAccounts = isMultiOwnerAccounts(accounts)
  // 用户列表
  const [bookMembers, setBookMembers] = useState<BookMember[]>([])
  // 全部分类（用于筛选多选）
  const [allCategories, setAllCategories] = useState<DictItem[]>([])
  // 全部标签（用于筛选多选）
  const [availableTags, setAvailableTags] = useState<string[]>([])

  // 选择
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())

  // 导入弹窗
  const [importOpen, setImportOpen] = useState(false)
  // 去重弹窗
  const [dedupOpen, setDedupOpen] = useState(false)

  // 记一笔/编辑弹窗(表单状态在 RecordFormDialog 内)
  const [formOpen, setFormOpen] = useState(false)
  const [editRecord, setEditRecord] = useState<RecordItem | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<RecordItem | null>(null)
  // 表格行附件查看
  const [viewingAttachments, setViewingAttachments] = useState<{ id: string; url: string; originalFilename: string }[] | null>(null)

  // 批量更新弹窗(表单状态在 BatchEditDialog 内)
  const [batchOpen, setBatchOpen] = useState(false)
  const [batchDeleteOpen, setBatchDeleteOpen] = useState(false)

  // 自由编辑模式
  const [editMode, setEditMode] = useState(false)
  const [editChanges, setEditChanges] = useState<Map<string, Record<string, string>>>(new Map())
  const [savingEdits, setSavingEdits] = useState(false)

  // 加载账户
  const loadAccounts = useCallback(async () => {
    if (!currentBookId) return
    try {
      setAccounts(await accountApi.list(currentBookId))
    } catch { /* ignore */ }
  }, [currentBookId])

  // 加载账本成员
  const loadBookMembers = useCallback(async () => {
    if (!currentBookId) return
    try {
      const list = await bookApi.listMembers(currentBookId)
      setBookMembers(list)
    } catch { /* ignore */ }
  }, [currentBookId])

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

  const loadTags = useCallback(async () => {
    if (!currentBookId) return
    try {
      setAvailableTags(await recordApi.getTags(currentBookId))
    } catch { /* ignore */ }
  }, [currentBookId])

  useEffect(() => { loadAccounts(); loadBookMembers(); loadCategories(); loadTags() }, [loadAccounts, loadBookMembers, loadCategories, loadTags])

  // 加载汇总
  const loadSummary = useCallback(async () => {
    if (!currentBookId) return
    try {
      setSummary(await recordApi.summary({
        bookId: currentBookId,
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
        tags: filters.tags.length > 0 ? filters.tags.join(',') : undefined,
      }))
    } catch { /* ignore */ }
  }, [currentBookId, filters.types, filters.accountIds, filters.categoryCodes, filters.dateFrom, filters.dateTo, filters.ownerIds, filters.payer, filters.amountFrom, filters.amountTo, filters.remark, filters.tags])

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
        tags: filters.tags.length > 0 ? filters.tags.join(',') : undefined,
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
    const empty: FilterState = { types: [], accountIds: [], categoryCodes: [], dateFrom: '', dateTo: '', ownerIds: [], payer: '', amountFrom: '', amountTo: '', remark: '', tags: [] }
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
    const emptyVal = key === 'types' || key === 'accountIds' || key === 'categoryCodes' || key === 'ownerIds' || key === 'tags' ? [] : ''
    setFilters((prev) => ({ ...prev, [key]: emptyVal }))
    setDraftFilters((prev) => ({ ...prev, [key]: emptyVal }))
    setPage(1)
  }

  const activeFilterCount = (Object.keys(filters) as (keyof FilterState)[]).filter((k) => {
    const v = filters[k]
    return Array.isArray(v) ? v.length > 0 : !!v
  }).length

  const openCreate = () => {
    setEditRecord(null)
    setFormOpen(true)
  }

  const openEdit = (record: RecordItem) => {
    setEditRecord(record)
    setFormOpen(true)
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

  const handleBatchDelete = async () => {
    if (selectedIds.size === 0) return
    try {
      await recordApi.batchDelete(Array.from(selectedIds))
      setBatchDeleteOpen(false)
      setSelectedIds(new Set())
      loadRecords()
      loadSummary()
      loadAccounts()
    } catch (e: any) { setError(e.message) }
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
    const currentIds = records.map((r) => r.id)
    const allSelected = currentIds.every((id) => selectedIds.has(id))
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (allSelected) {
        currentIds.forEach((id) => next.delete(id))
      } else {
        currentIds.forEach((id) => next.add(id))
      }
      return next
    })
  }

  const handleClone = async (record: RecordItem) => {
    try {
      await recordApi.clone(record.id)
      loadRecords()
      loadSummary()
      loadAccounts()
    } catch (e: any) { setError(e.message) }
  }

  // 编辑模式辅助函数
  const handleEditChange = (id: string, field: string, value: string) => {
    setEditChanges((prev) => {
      const next = new Map(prev)
      const existing = { ...next.get(id) }
      existing[field] = value
      next.set(id, existing)
      return next
    })
  }

  const handleSaveEdits = async () => {
    if (editChanges.size === 0) return
    setSavingEdits(true)
    try {
      await Promise.all(
        Array.from(editChanges.entries()).map(([id, changes]) => {
          const data: any = {}
          if ('date' in changes) data.date = new Date(changes.date).toISOString()
          if ('amount' in changes) data.amount = parseFloat(changes.amount)
          if ('type' in changes) data.type = changes.type
          if ('categoryCode' in changes) data.categoryCode = changes.categoryCode || null
          if ('payer' in changes) data.payer = changes.payer || null
          if ('remark' in changes) data.remark = changes.remark || null
          if ('accountId' in changes) data.accountId = changes.accountId
          if ('fromAccountId' in changes) data.fromAccountId = changes.fromAccountId
          if ('toAccountId' in changes) data.toAccountId = changes.toAccountId
          if ('ownerId' in changes) data.ownerId = changes.ownerId === '__self__' ? null : (changes.ownerId || null)
          if ('tags' in changes) data.tags = JSON.parse(changes.tags)
          return recordApi.update(id, data)
        })
      )
      setEditChanges(new Map())
      setEditMode(false)
      loadRecords()
      loadSummary()
      loadAccounts()
    } catch (e: any) { setError(e.message) }
    finally { setSavingEdits(false) }
  }

  const handleCancelEdits = () => {
    setEditChanges(new Map())
    setEditMode(false)
  }

  const handleExport = () => {
    if (!currentBookId) return
    const params: Record<string, string | number> = { bookId: currentBookId }
    if (filters.types.length > 0) params.type = filters.types.join(',')
    if (filters.accountIds.length > 0) params.accountId = filters.accountIds.join(',')
    if (filters.categoryCodes.length > 0) params.categoryCode = filters.categoryCodes.join(',')
    if (filters.dateFrom) params.dateFrom = filters.dateFrom
    if (filters.dateTo) params.dateTo = filters.dateTo
    if (filters.ownerIds.length > 0) params.ownerId = filters.ownerIds.join(',')
    if (filters.payer) params.payer = filters.payer
    if (filters.amountFrom) params.amountFrom = filters.amountFrom
    if (filters.amountTo) params.amountTo = filters.amountTo
    if (filters.remark) params.remark = filters.remark
    if (filters.tags.length > 0) params.tags = filters.tags.join(',')
    importExportApi.exportCsv(params).catch(e => setError(e.message))
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
          { label: '总收入', value: summary.income, icon: ArrowUpRight, color: RECORD_TYPE_TEXT_CLASS.INCOME },
          { label: '总支出', value: summary.expense, icon: ArrowDownRight, color: RECORD_TYPE_TEXT_CLASS.EXPENSE },
          { label: '转账总额', value: summary.transfer, icon: ArrowLeftRight, color: RECORD_TYPE_TEXT_CLASS.TRANSFER },
          { label: '净收入', value: summary.netIncome, icon: summary.netIncome >= 0 ? ArrowUpRight : ArrowDownRight, color: summary.netIncome >= 0 ? RECORD_TYPE_TEXT_CLASS.INCOME : RECORD_TYPE_TEXT_CLASS.EXPENSE },
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
                  {filterValueLabel(key, filters[key], accounts, bookMembers)}
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
            {isMobile ? (
              <>
                <Button
                  onClick={openCreate}
                  className="bg-primary hover:bg-primary/90 text-primary-foreground rounded-lg h-8 text-xs"
                >
                  <Plus size={14} /> 记一笔
                </Button>
                <Button variant="outline" size="icon" className="h-8 w-8 relative" onClick={openDrawer}>
                  <Filter size={16} />
                  {activeFilterCount > 0 && (
                    <span className="absolute -top-1 -right-1 bg-primary text-primary-foreground text-[10px] rounded-full w-4 h-4 flex items-center justify-center">
                      {activeFilterCount}
                    </span>
                  )}
                </Button>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="outline" size="icon" className="h-8 w-8">
                      <MoreHorizontal size={16} />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    {editMode ? (
                      <>
                        <DropdownMenuItem onClick={handleSaveEdits} disabled={editChanges.size === 0 || savingEdits}>
                          <Save size={14} /> {savingEdits ? '保存中...' : '保存修改'}
                          {editChanges.size > 0 && <span className="ml-1 text-xs">({editChanges.size})</span>}
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={handleCancelEdits} disabled={savingEdits}>
                          放弃修改
                        </DropdownMenuItem>
                      </>
                    ) : (
                      <DropdownMenuItem onClick={() => setEditMode(true)}>
                        <Pencil size={14} /> 自由编辑
                      </DropdownMenuItem>
                    )}
                    <DropdownMenuItem onClick={() => setImportOpen(true)}>
                      <Upload size={14} /> 导入
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={handleExport}>
                      <Download size={14} /> 导出
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => setDedupOpen(true)}>
                      <CopyMinus size={14} /> 去重
                    </DropdownMenuItem>
                    {activeFilterCount > 0 && (
                      <DropdownMenuItem onClick={resetFilters}>
                        <X size={14} /> 重置筛选
                      </DropdownMenuItem>
                    )}
                  </DropdownMenuContent>
                </DropdownMenu>
              </>
            ) : (
              <>
                <Button
                  onClick={openCreate}
                  className="bg-primary hover:bg-primary/90 text-primary-foreground rounded-lg h-8 text-xs"
                >
                  <Plus size={14} /> 记一笔
                </Button>
                {editMode ? (
                  <>
                    <Button
                      onClick={handleSaveEdits}
                      disabled={editChanges.size === 0 || savingEdits}
                      className="bg-primary hover:bg-primary/90 text-primary-foreground rounded-lg h-8 text-xs"
                    >
                      <Save size={14} /> {savingEdits ? '保存中...' : '保存修改'}
                      {editChanges.size > 0 && (
                        <span className="ml-1 bg-white/20 text-[10px] rounded-full px-1.5">{editChanges.size}</span>
                      )}
                    </Button>
                    <Button
                      variant="outline"
                      onClick={handleCancelEdits}
                      disabled={savingEdits}
                      className="h-8 text-xs rounded-lg"
                    >
                      放弃修改
                    </Button>
                  </>
                ) : (
                  <Button
                    variant="outline"
                    onClick={() => setEditMode(true)}
                    className="h-8 text-xs rounded-lg"
                  >
                    <Pencil size={14} /> 自由编辑
                  </Button>
                )}
                <Button variant="outline" onClick={() => setImportOpen(true)} className="h-8 text-xs rounded-lg">
                  <Upload size={14} /> 导入
                </Button>
                <Button variant="outline" onClick={handleExport} className="h-8 text-xs rounded-lg">
                  <Download size={14} /> 导出
                </Button>
                <Button variant="outline" onClick={() => setDedupOpen(true)} className="h-8 text-xs rounded-lg">
                  <CopyMinus size={14} /> 去重
                </Button>
                <Button
                  variant="outline"
                  onClick={openDrawer}
                  className="h-8 text-xs rounded-lg"
                >
                  <Filter size={14} /> 筛选
                  {activeFilterCount > 0 && (
                    <span className="ml-1 bg-primary text-primary-foreground text-[10px] rounded-full w-4 h-4 flex items-center justify-center">
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
              </>
            )}
          </div>
        </div>

        {/* 批量操作栏 */}
        {!editMode && selectedIds.size > 0 && (
          <div className="flex flex-wrap items-center gap-3 px-4 py-2 bg-muted/50 border-b">
            <span className="text-sm">已选择 {selectedIds.size} 条</span>
            <Button size="sm" variant="outline" onClick={() => setBatchOpen(true)} className="text-xs h-7">
              批量更新
            </Button>
            <Button size="sm" variant="outline" onClick={() => setBatchDeleteOpen(true)} className="text-xs h-7 text-red-600 hover:text-red-700 border-red-200 hover:border-red-300">
              批量删除
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
            {isMobile ? (
              <div className="space-y-2">
                {records.map((record) => (
                  <RecordRow
                    key={record.id}
                    variant="card"
                    record={record}
                    editMode={editMode}
                    editChanges={editChanges}
                    selectedIds={selectedIds}
                    accounts={accounts}
                    allCategories={allCategories}
                    bookMembers={bookMembers}
                    currentBookId={currentBookId || ''}
                    onToggleSelect={toggleSelect}
                    onEditChange={handleEditChange}
                    onOpenEdit={openEdit}
                    onClone={handleClone}
                    onDelete={setDeleteTarget}
                    onViewAttachments={setViewingAttachments}
                  />
                ))}
              </div>
            ) : (
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  {!editMode && (
                    <TableHead className="w-8">
                      <input
                        type="checkbox"
                        checked={records.length > 0 && records.every((r) => selectedIds.has(r.id))}
                        onChange={toggleSelectAll}
                        className="rounded"
                      />
                    </TableHead>
                  )}
                  <TableHead className="text-xs w-[100px]">日期</TableHead>
                  <TableHead className="text-xs w-[108px]">类型</TableHead>
                  <TableHead className="text-xs min-w-[150px]">账户</TableHead>
                  <TableHead className="text-xs min-w-[90px]">分类</TableHead>
                  <TableHead className="text-xs min-w-[70px]">标签</TableHead>
                  <TableHead className="text-xs min-w-[70px]">归属人</TableHead>
                  <TableHead className="text-xs min-w-[90px]">交易方</TableHead>
                  <TableHead className="text-xs w-[108px] text-right">金额</TableHead>
                  <TableHead className="text-xs min-w-[110px]">备注</TableHead>
                  <TableHead className="text-xs w-[80px] text-right">操作</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {records.map((record) => (
                  <RecordRow
                    key={record.id}
                    variant="table"
                    record={record}
                    editMode={editMode}
                    editChanges={editChanges}
                    selectedIds={selectedIds}
                    accounts={accounts}
                    allCategories={allCategories}
                    bookMembers={bookMembers}
                    currentBookId={currentBookId || ''}
                    onToggleSelect={toggleSelect}
                    onEditChange={handleEditChange}
                    onOpenEdit={openEdit}
                    onClone={handleClone}
                    onDelete={setDeleteTarget}
                    onViewAttachments={setViewingAttachments}
                  />
                ))}
              </TableBody>
            </Table>
            )}

            {/* 分页 */}
            <div className="flex flex-col sm:flex-row sm:items-center gap-3 sm:justify-between p-4 border-t">
              <div className="flex items-center gap-3">
                <span className="text-sm text-muted-foreground">每页</span>
                <Select
                  value={String(pageSize)}
                  onValueChange={(v) => { setPageSize(Number(v)); setPage(1) }}
                >
                  <SelectTrigger className="h-8 w-20 text-sm">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {[10, 20, 50, 100].map((n) => (
                      <SelectItem key={n} value={String(n)}>{n} 条</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <span className="text-sm text-muted-foreground">
                  共 {total} 条
                </span>
              </div>

              <div className="flex items-center gap-2">
                <Button variant="outline" size="sm" onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page <= 1}>
                  <ChevronLeft size={14} />
                </Button>

                <span className="text-sm min-w-[3.5rem] text-center">
                  {page} / {Math.max(totalPages, 1)}
                </span>

                <Button variant="outline" size="sm" onClick={() => setPage((p) => Math.min(totalPages, p + 1))} disabled={page >= totalPages}>
                  <ChevronRight size={14} />
                </Button>

                <span className="hidden sm:inline text-sm text-muted-foreground ml-2">跳至</span>
                <Input
                  aria-label="跳转页码"
                  className="hidden sm:block h-8 w-14 text-sm text-center"
                  placeholder={String(page)}
                  value={jumpInput}
                  onChange={(e) => setJumpInput(e.target.value.replace(/\D/g, ''))}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      const n = parseInt(jumpInput)
                      if (n >= 1 && n <= totalPages) { setPage(n); setJumpInput('') }
                    }
                  }}
                />
                <span className="hidden sm:inline text-sm text-muted-foreground">页</span>
              </div>
            </div>
          </>
        )}
      </Card>

      {/* 筛选抽屉 */}
      <Sheet open={drawerOpen} onOpenChange={setDrawerOpen}>
        <SheetTrigger/>
        <SheetContent side={isMobile ? 'bottom' : 'right'} className={isMobile ? 'w-full max-h-[80vh] flex flex-col' : 'w-80 flex flex-col'}>
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
                items={accounts.map((a) => ({ value: a.id, label: accountLabel(a, multiOwnerAccounts) }))}
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

            {/* 标签（多选） */}
            <div>
              <Label className="text-xs text-muted-foreground mb-1.5 block">标签</Label>
              <MultiSelect
                items={availableTags.map((t) => ({ value: t, label: t }))}
                selected={draftFilters.tags}
                onChange={(v) => setDraftFilters((p) => ({ ...p, tags: v }))}
                placeholder="全部标签"
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
                items={bookMembers.map((m) => ({ value: m.userId, label: m.user.nickname || m.user.email || m.userId }))}
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
                  aria-label="交易方"
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
                    aria-label="金额下限"
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
                    aria-label="金额上限"
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
                  aria-label="备注"
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
            <Button className="flex-1 bg-primary hover:bg-primary/90 text-primary-foreground" onClick={applyFilters}>应用</Button>
          </div>
        </SheetContent>
      </Sheet>

      {/* 创建/编辑弹窗 */}
      <RecordFormDialog
        open={formOpen}
        editRecord={editRecord}
        currentBookId={currentBookId || ''}
        accounts={accounts}
        multiOwnerAccounts={multiOwnerAccounts}
        bookMembers={bookMembers}
        onClose={() => { setFormOpen(false); setEditRecord(null) }}
        onSaved={(refreshRecords) => { if (refreshRecords) loadRecords(); loadSummary(); loadAccounts() }}
      />
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

      {/* 批量删除确认 */}
      <AlertDialog open={batchDeleteOpen} onOpenChange={setBatchDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>批量删除流水</AlertDialogTitle>
            <AlertDialogDescription>
              确定要删除选中的 {selectedIds.size} 条流水记录吗？相关账户余额将相应调整。此操作不可撤销。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction className="bg-[#ef4444] hover:bg-[#dc2626]" onClick={handleBatchDelete}>
              确认删除
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* 批量更新弹窗 */}
      <BatchEditDialog
        open={batchOpen}
        selectedIds={Array.from(selectedIds)}
        records={records}
        currentBookId={currentBookId || ''}
        accounts={accounts}
        bookMembers={bookMembers}
        onClose={() => setBatchOpen(false)}
        onDone={() => { setSelectedIds(new Set()); loadRecords(); loadSummary(); loadAccounts() }}
      />

      {/* 附件查看 */}
      <AttachmentViewer
        open={viewingAttachments !== null}
        onOpenChange={() => setViewingAttachments(null)}
        attachments={viewingAttachments || []}
      />

      {/* 导入弹窗 */}
      <ImportDialog
        open={importOpen}
        onOpenChange={setImportOpen}
        bookId={currentBookId || ''}
        accounts={accounts}
        dictCodes={allCategories.map(c => ({ code: c.code, label: c.label, group: c.group }))}
        onImportComplete={() => { loadRecords(); loadSummary(); loadAccounts(); loadCategories(); loadTags() }}
      />

      {/* 去重弹窗 */}
      <DedupDialog
        open={dedupOpen}
        onOpenChange={setDedupOpen}
        bookId={currentBookId || ''}
        onComplete={() => { loadRecords(); loadSummary(); loadAccounts() }}
      />
    </div>
  )
}

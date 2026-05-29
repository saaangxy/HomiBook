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
import { TagCombobox } from '@/components/TagCombobox'
import { AttachmentViewer } from '@/components/AttachmentViewer'
import { recordApi, type RecordItem, type RecordType, type RecordSummary } from '@/api/record'
import { accountApi, type AccountItem } from '@/api/account'
import { adminApi, type AdminUser } from '@/api/admin'
import { settingsApi, type DictItem } from '@/api/settings'
import { useBookStore } from '../stores/book'
import {
  Plus, ArrowUpRight, ArrowDownRight, ArrowLeftRight,
  Pencil, Trash2, Copy, Filter, X, ChevronLeft, ChevronRight,
  Upload, Download, Paperclip, Save,
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
  tags: string[]          // 多选标签
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
    case 'tags': {
      const ids = value as string[]
      return `标签: ${ids.join(', ')}`
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
  // 用户列表
  const [users, setUsers] = useState<AdminUser[]>([])
  // 全部分类（用于筛选多选）
  const [allCategories, setAllCategories] = useState<DictItem[]>([])
  // 全部标签（用于筛选多选）
  const [availableTags, setAvailableTags] = useState<string[]>([])

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
  const [formTags, setFormTags] = useState<string[]>([])
  const [formOwnerId, setFormOwnerId] = useState('')
  const [formAttachments, setFormAttachments] = useState<{ id: string; url: string; fullUrl: string; originalFilename: string }[]>([])
  const [uploadingAttachment, setUploadingAttachment] = useState(false)
  const [previewImage, setPreviewImage] = useState<string | null>(null)
  const [viewingAttachments, setViewingAttachments] = useState<{ id: string; url: string; originalFilename: string }[] | null>(null)
  const [formError, setFormError] = useState('')
  const [submitting, setSubmitting] = useState(false)

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

  const loadTags = useCallback(async () => {
    if (!currentBookId) return
    try {
      setAvailableTags(await recordApi.getTags(currentBookId))
    } catch { /* ignore */ }
  }, [currentBookId])

  useEffect(() => { loadAccounts(); loadUsers(); loadCategories(); loadTags() }, [loadAccounts, loadUsers, loadCategories, loadTags])

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
    setFormTags([])
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
    setFormTags(record.tags || [])
    setFormOwnerId(record.ownerId)
    // 附件数据已包含 id + url + originalFilename，补 fullUrl
    const origin = window.location.origin
    setFormAttachments(record.attachments.map((a) => {
      const fullUrl = a.url.startsWith('http') ? a.url : `${origin}${a.url}`
      return { id: a.id, url: a.url, fullUrl, originalFilename: a.originalFilename }
    }))
    setFormError('')
    setSubmitting(false)
    setEditRecord(record)
  }

  const handleCreate = async () => {
    if (!formAmount || parseFloat(formAmount) <= 0) { setFormError('请输入有效金额'); return }
    if (formType === 'TRANSFER') {
      if (!formFromAccountId) { setFormError('请选择转出账户'); return }
      if (!formToAccountId) { setFormError('请选择转入账户'); return }
      if (formFromAccountId === formToAccountId) { setFormError('转出和转入账户不能相同'); return }
    } else {
      if (!formAccountId) { setFormError('请选择账户'); return }
    }
    if (!currentBookId) return
    setSubmitting(true)
    try {
      await recordApi.create({
        accountBookId: currentBookId,
        type: formType,
        amount: parseFloat(formAmount),
        date: new Date(formDate).toISOString(),
        accountId: formType === 'TRANSFER' ? formFromAccountId : formAccountId,
        fromAccountId: formType === 'TRANSFER' ? formFromAccountId : undefined,
        toAccountId: formType === 'TRANSFER' ? formToAccountId : undefined,
        categoryCode: formCategoryCode || undefined,
        payer: formPayer || undefined,
        remark: formRemark || undefined,
        tags: formTags.length > 0 ? formTags : undefined,
        ownerId: formOwnerId || undefined,
        attachmentIds: formAttachments.map((a) => a.id),
      })
      setCreateOpen(false)
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
        accountId: formType === 'TRANSFER' ? formFromAccountId : formAccountId,
        fromAccountId: formType === 'TRANSFER' ? formFromAccountId : undefined,
        toAccountId: formType === 'TRANSFER' ? formToAccountId : undefined,
        categoryCode: formCategoryCode || undefined,
        payer: formPayer || undefined,
        remark: formRemark || undefined,
        tags: formTags.length > 0 ? formTags : undefined,
        ownerId: formOwnerId || undefined,
        attachmentIds: formAttachments.map((a) => a.id),
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

  const handleDownload = async (url: string, originalFilename: string) => {
    try {
      const relativePath = url.includes('/api/uploads/')
        ? `/api/uploads/${url.split('/api/uploads/').pop()}`
        : url
      const downloadUrl = `/api/records/download?path=${encodeURIComponent(relativePath)}&name=${encodeURIComponent(originalFilename)}`

      const token = (() => {
        try {
          const raw = localStorage.getItem('auth-storage')
          if (!raw) return null
          return JSON.parse(raw)?.state?.token || null
        } catch { return null }
      })()
      const headers: Record<string, string> = {}
      if (token) headers['Authorization'] = `Bearer ${token}`

      const res = await fetch(downloadUrl, { headers })
      if (!res.ok) throw new Error('下载失败')
      const blob = await res.blob()
      const blobUrl = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = blobUrl
      a.download = originalFilename
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(blobUrl)
    } catch (err: any) {
      setError(err.message || '下载失败')
    }
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

  // 编辑模式辅助函数
  const getEditValue = (record: RecordItem, field: string): string => {
    const changes = editChanges.get(record.id)
    if (changes && field in changes) return changes[field]
    switch (field) {
      case 'date': return dayjs(record.date).format('YYYY-MM-DD')
      case 'amount': return String(record.amount)
      case 'categoryCode': return record.categoryCode || ''
      case 'payer': return record.payer || ''
      case 'remark': return record.remark || ''
      case 'type': return record.type
      case 'accountId': return record.accountId
      case 'fromAccountId': return record.fromAccountId || ''
      case 'toAccountId': return record.toAccountId || ''
      default: return ''
    }
  }

  const getEditTags = (record: RecordItem): string[] => {
    const changes = editChanges.get(record.id)
    if (changes && 'tags' in changes) {
      try { return JSON.parse(changes.tags) } catch { return [] }
    }
    return record.tags || []
  }

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
            {editMode ? (
              <>
                <Button
                  onClick={handleSaveEdits}
                  disabled={editChanges.size === 0 || savingEdits}
                  className="bg-[#f97316] hover:bg-[#ea580c] text-white rounded-lg h-8 text-xs"
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
        {!editMode && selectedIds.size > 0 && (
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
                  {!editMode && (
                    <TableHead className="w-8">
                      <input
                        type="checkbox"
                        checked={selectedIds.size === records.length}
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
                  <TableHead className="text-xs min-w-[90px]">交易方</TableHead>
                  <TableHead className="text-xs w-[108px] text-right">金额</TableHead>
                  <TableHead className="text-xs min-w-[110px]">备注</TableHead>
                  <TableHead className="text-xs w-[80px] text-right">操作</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {records.map((record) => {
                  const isChanged = editChanges.has(record.id)
                  const effectiveType = (editChanges.get(record.id)?.type || record.type) as RecordType
                  const catGroup = getCategoryGroup(effectiveType)
                  const rowCategories = allCategories.filter((c) => c.group === catGroup)
                  return (
                  <TableRow key={record.id} className={isChanged ? 'shadow-[inset_3px_0_0_#f97316] hover:bg-accent/50' : 'hover:bg-accent/50'}>
                    {!editMode && (
                      <TableCell className="py-2.5">
                        <input
                          type="checkbox"
                          checked={selectedIds.has(record.id)}
                          onChange={() => toggleSelect(record.id)}
                          className="rounded"
                        />
                      </TableCell>
                    )}
                    {/* 日期 */}
                    <TableCell className="py-2.5">
                      <div className="flex items-center gap-1.5">
                        {editMode && isChanged && (
                          <span className="w-2 h-2 rounded-full bg-[#f97316] shrink-0" title="已修改" />
                        )}
                        {editMode ? (
                          <DatePicker
                            value={getEditValue(record, 'date')}
                            onChange={(v) => v && handleEditChange(record.id, 'date', v)}
                            className="h-8 px-2 flex-1 min-w-0"
                            compact
                          />
                        ) : (
                          <span className="text-xs">{new Date(record.date).toLocaleDateString('zh-CN')}</span>
                        )}
                      </div>
                    </TableCell>
                    {/* 类型 */}
                    <TableCell className="py-2.5">
                      {editMode ? (
                        <Select value={getEditValue(record, 'type')} onValueChange={(v) => handleEditChange(record.id, 'type', v)}>
                          <SelectTrigger className="h-7 text-xs w-full">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {(['INCOME', 'EXPENSE', 'TRANSFER'] as RecordType[]).map((t) => (
                              <SelectItem key={t} value={t}>{TYPE_LABELS[t]}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      ) : (
                        <Badge className={`text-[10px] ${TYPE_COLORS[record.type]}`}>
                          {TYPE_LABELS[record.type]}
                        </Badge>
                      )}
                    </TableCell>
                    {/* 账户 */}
                    <TableCell className="text-xs py-2.5">
                      {editMode ? (
                        effectiveType === 'TRANSFER' ? (
                          <div className="flex items-center gap-1">
                            <Select value={getEditValue(record, 'fromAccountId')} onValueChange={(v) => handleEditChange(record.id, 'fromAccountId', v)}>
                              <SelectTrigger className="h-7 text-xs flex-1 min-w-0">
                                <SelectValue placeholder="转出" />
                              </SelectTrigger>
                              <SelectContent>
                                {accounts.map((a) => <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>)}
                              </SelectContent>
                            </Select>
                            <span className="text-[10px] text-muted-foreground shrink-0">→</span>
                            <Select value={getEditValue(record, 'toAccountId')} onValueChange={(v) => handleEditChange(record.id, 'toAccountId', v)}>
                              <SelectTrigger className="h-7 text-xs flex-1 min-w-0">
                                <SelectValue placeholder="转入" />
                              </SelectTrigger>
                              <SelectContent>
                                {accounts.map((a) => <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>)}
                              </SelectContent>
                            </Select>
                          </div>
                        ) : (
                          <Select value={getEditValue(record, 'accountId')} onValueChange={(v) => handleEditChange(record.id, 'accountId', v)}>
                            <SelectTrigger className="h-7 text-xs w-full">
                              <SelectValue placeholder="账户" />
                            </SelectTrigger>
                            <SelectContent>
                              {accounts.map((a) => <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>)}
                            </SelectContent>
                          </Select>
                        )
                      ) : (
                        record.type === 'TRANSFER' && record.fromAccount ? (
                          <span>
                            <span className="text-[#ef4444]">{record.fromAccount.name}</span>
                            {' → '}
                            <span className="text-[#22c55e]">{record.toAccount?.name}</span>
                          </span>
                        ) : (
                          <span>{record.account.name}</span>
                        )
                      )}
                    </TableCell>
                    {/* 分类 */}
                    <TableCell className="text-xs py-2.5">
                      {editMode ? (
                        <Select value={getEditValue(record, 'categoryCode')} onValueChange={(v) => handleEditChange(record.id, 'categoryCode', v === '__clear__' ? '' : v)}>
                          <SelectTrigger className="h-7 text-xs w-full">
                            <SelectValue placeholder="分类" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="__clear__">无</SelectItem>
                            {rowCategories.map((c) => (
                              <SelectItem key={c.code} value={c.code}>{c.label}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      ) : (
                        <span className="text-muted-foreground">{record.categoryCode || '-'}</span>
                      )}
                    </TableCell>
                    {/* 标签 */}
                    <TableCell className="text-xs py-2.5">
                      {editMode ? (
                        <TagCombobox
                          value={getEditTags(record)}
                          onChange={(tags) => handleEditChange(record.id, 'tags', JSON.stringify(tags))}
                          bookId={currentBookId || ''}
                          placeholder="标签..."
                        />
                      ) : (
                        record.tags?.length > 0 ? (
                          <div className="flex flex-wrap gap-0.5">
                            {record.tags.map((tag) => (
                              <Badge key={tag} variant="secondary" className="text-[10px] py-0 px-1">{tag}</Badge>
                            ))}
                          </div>
                        ) : <span className="text-muted-foreground">-</span>
                      )}
                    </TableCell>
                    {/* 交易方 */}
                    <TableCell className="text-xs py-2.5">
                      {editMode ? (
                        <Input
                          value={getEditValue(record, 'payer')}
                          onChange={(e) => handleEditChange(record.id, 'payer', e.target.value)}
                          className="h-7 text-xs w-full"
                          placeholder="-"
                        />
                      ) : (
                        <span className="text-muted-foreground">{record.payer || '-'}</span>
                      )}
                    </TableCell>
                    {/* 金额 */}
                    <TableCell className="text-sm font-bold tabular-nums py-2.5 text-right">
                      {editMode ? (
                        <Input
                          type="number"
                          step="0.01"
                          value={getEditValue(record, 'amount')}
                          onChange={(e) => handleEditChange(record.id, 'amount', e.target.value)}
                          className={`h-7 text-xs w-full text-right ${
                            record.type === 'INCOME' ? 'text-[#22c55e]' :
                            record.type === 'EXPENSE' ? 'text-[#ef4444]' : 'text-[#3b82f6]'
                          }`}
                        />
                      ) : (
                        <span className={
                          record.type === 'INCOME' ? 'text-[#22c55e]' :
                          record.type === 'EXPENSE' ? 'text-[#ef4444]' : 'text-[#3b82f6]'
                        }>
                          {record.type === 'EXPENSE' ? '-' : record.type === 'INCOME' ? '+' : ''}{formatMoney(record.amount)}
                        </span>
                      )}
                    </TableCell>
                    {/* 备注 */}
                    <TableCell className="text-xs py-2.5">
                      {editMode ? (
                        <Input
                          value={getEditValue(record, 'remark')}
                          onChange={(e) => handleEditChange(record.id, 'remark', e.target.value)}
                          className="h-7 text-xs w-full"
                          placeholder="-"
                        />
                      ) : (
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <span className="text-muted-foreground max-w-32 truncate cursor-default block">
                              {record.remark || '-'}
                            </span>
                          </TooltipTrigger>
                          <TooltipContent side="top" className="max-w-xs">
                            <p className="break-all">{record.remark || '无备注'}</p>
                          </TooltipContent>
                        </Tooltip>
                      )}
                    </TableCell>
                    {/* 操作 */}
                    <TableCell className="text-right py-2.5">
                      <div className="flex items-center justify-end gap-0.5">
                        {record.attachments?.length > 0 && (
                          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setViewingAttachments(record.attachments)}>
                            <Paperclip size={13} />
                          </Button>
                        )}
                        {editMode ? (
                          <>
                            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => handleClone(record)}>
                              <Copy size={13} />
                            </Button>
                            <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:text-[#ef4444]" onClick={() => setDeleteTarget(record)}>
                              <Trash2 size={13} />
                            </Button>
                          </>
                        ) : (
                          <>
                            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => openEdit(record)}>
                              <Pencil size={13} />
                            </Button>
                            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => handleClone(record)}>
                              <Copy size={13} />
                            </Button>
                            <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:text-[#ef4444]" onClick={() => setDeleteTarget(record)}>
                              <Trash2 size={13} />
                            </Button>
                          </>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                )})}
              </TableBody>
            </Table>

            {/* 分页 */}
            <div className="flex items-center justify-between p-4 border-t">
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

                <span className="text-sm text-muted-foreground ml-2">跳至</span>
                <Input
                  className="h-8 w-14 text-sm text-center"
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
                <span className="text-sm text-muted-foreground">页</span>
              </div>
            </div>
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
              <Label className="text-xs text-muted-foreground mb-1 block">标签</Label>
              <TagCombobox
                value={formTags}
                onChange={setFormTags}
                bookId={currentBookId || ''}
                placeholder="选择或输入标签..."
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

            {/* 附件上传 */}
            <div>
              <Label className="text-xs text-muted-foreground mb-1 block">附件</Label>
              <div className="flex flex-col gap-2">
                {formAttachments.length > 0 && (
                  <div className="flex flex-wrap gap-2">
                    {formAttachments.map((att, idx) => {
                      const isImage = /\.(jpg|jpeg|png|gif|webp|bmp)$/i.test(att.url)
                      return (
                        <div key={idx} className="relative group">
                          {isImage ? (
                            <button
                              className="w-16 h-16 rounded-md border overflow-hidden"
                              onClick={() => setPreviewImage(att.fullUrl)}
                            >
                              <img
                                src={att.fullUrl}
                                alt="附件"
                                className="w-full h-full object-cover"
                              />
                            </button>
                          ) : (
                            <div className="w-16 h-16 rounded-md border bg-muted flex items-center justify-center">
                              <span className="text-xs text-muted-foreground truncate px-1">{att.originalFilename}</span>
                            </div>
                          )}
                          <button
                            className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-[#ef4444] text-white flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                            onClick={() => setFormAttachments((prev) => prev.filter((_, i) => i !== idx))}
                          >
                            <X size={10} />
                          </button>
                          <button
                            className="absolute -bottom-1 -right-1 w-4 h-4 rounded-full bg-[#3b82f6] text-white flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                            onClick={(e) => { e.stopPropagation(); handleDownload(att.url, att.originalFilename) }}
                          >
                            <Download size={10} />
                          </button>
                        </div>
                      )
                    })}
                  </div>
                )}
                <label className="flex items-center gap-2 px-3 py-2 border border-dashed border-border rounded-md cursor-pointer hover:bg-accent text-sm text-muted-foreground">
                  <Upload size={14} />
                  <span>{uploadingAttachment ? '上传中...' : '添加附件'}</span>
                  <input
                    type="file"
                    multiple
                    className="hidden"
                    disabled={uploadingAttachment}
                    onChange={async (e) => {
                      const files = Array.from(e.target.files || [])
                      if (!files.length) return
                      setUploadingAttachment(true)
                      try {
                        const results = await Promise.all(files.map((f) => recordApi.uploadAttachment(f)))
                        setFormAttachments((prev) => [...prev, ...results.map((r) => ({
                          id: r.id,
                          url: r.url,
                          fullUrl: r.fullUrl,
                          originalFilename: r.originalFilename,
                        }))])
                      } catch (err: any) {
                        setFormError(err.message || '上传失败')
                      } finally {
                        setUploadingAttachment(false)
                        e.target.value = ''
                      }
                    }}
                  />
                </label>
              </div>
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

      {/* 图片预览弹窗 */}
      {previewImage && (
        <Dialog open={!!previewImage} onOpenChange={() => setPreviewImage(null)}>
          <DialogContent className="max-w-3xl p-0 bg-transparent border-0">
            <div className="relative">
              <img
                src={previewImage}
                alt="预览"
                className="max-h-[80vh] max-w-full rounded-lg"
              />
              <div className="absolute top-2 right-2 flex gap-2">
                <button
                  onClick={() => {
                    const att = formAttachments.find((a) => a.fullUrl === previewImage)
                    handleDownload(previewImage, att?.originalFilename || '图片.png')
                  }}
                  className="w-8 h-8 rounded-full bg-black/50 flex items-center justify-center text-white hover:bg-black/70"
                >
                  <Download size={14} />
                </button>
                <button
                  onClick={() => setPreviewImage(null)}
                  className="w-8 h-8 rounded-full bg-black/50 flex items-center justify-center text-white hover:bg-black/70"
                >
                  <X size={14} />
                </button>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      )}

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

      {/* 附件查看 */}
      <AttachmentViewer
        open={viewingAttachments !== null}
        onOpenChange={() => setViewingAttachments(null)}
        attachments={viewingAttachments || []}
      />
    </div>
  )
}

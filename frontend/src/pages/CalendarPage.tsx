import { useState, useEffect, useCallback } from 'react'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  Dialog,
  DialogContent,
  DialogDescription,
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
import { Spinner } from '@/components/ui/spinner'
import { Textarea } from '@/components/ui/textarea'
import { DictCombobox } from '@/components/DictCombobox'
import { TransactionCalendar } from '@/components/TransactionCalendar'
import { AttachmentViewer, type AttachmentItem } from '@/components/AttachmentViewer'
import { recordApi, type RecordItem, type RecordType } from '@/api/record'
import { accountApi, type AccountItem } from '@/api/account'
import { settingsApi } from '@/api/settings'
import { holidayApi, type HolidayItem } from '@/api/holiday'
import { useBookStore } from '../stores/book'
import { useAuthStore } from '../stores/auth'
import { Plus, ArrowUpRight, ArrowDownRight, ArrowLeftRight, Pencil, Trash2, TrendingUp, TrendingDown, ReceiptText, Paperclip } from 'lucide-react'

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

export function CalendarPage() {
  const currentBookId = useBookStore((s) => s.currentBookId)
  const userId = useAuthStore((s) => s.user?.id)

  const today = new Date()
  const [year, setYear] = useState(today.getFullYear())
  const [month, setMonth] = useState(today.getMonth() + 1)

  // 日历数据
  const [dayData, setDayData] = useState<Record<string, { income: number; expense: number; count: number }>>({})
  const [loading, setLoading] = useState(false)

  // 月汇总
  const [summary, setSummary] = useState({ income: 0, expense: 0, transfer: 0 })
  const [highlightThreshold, setHighlightThreshold] = useState(1000)

  // 节假日
  const [holidays, setHolidays] = useState<HolidayItem[]>([])

  // 账户列表
  const [accounts, setAccounts] = useState<AccountItem[]>([])

  // 日详情弹窗
  const [selectedDate, setSelectedDate] = useState<string | null>(null)
  const [dayRecords, setDayRecords] = useState<RecordItem[]>([])
  const [dayLoading, setDayLoading] = useState(false)
  const [dayFilter, setDayFilter] = useState('') // 类型筛选
  const [dayCategoryFilter, setDayCategoryFilter] = useState('') // 分类筛选
  const [dayAmountMin, setDayAmountMin] = useState('') // 金额筛选
  const [dayAmountMax, setDayAmountMax] = useState('')

  // 附件查看
  const [viewingAttachments, setViewingAttachments] = useState<AttachmentItem[] | null>(null)

  // 表单
  const [formOpen, setFormOpen] = useState(false)
  const [editRecord, setEditRecord] = useState<RecordItem | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<RecordItem | null>(null)
  const [formType, setFormType] = useState<RecordType>('EXPENSE')
  const [formAmount, setFormAmount] = useState('')
  const [formAccountId, setFormAccountId] = useState('')
  const [formFromAccountId, setFormFromAccountId] = useState('')
  const [formToAccountId, setFormToAccountId] = useState('')
  const [formCategoryCode, setFormCategoryCode] = useState('')
  const [formPayer, setFormPayer] = useState('')
  const [formRemark, setFormRemark] = useState('')
  const [formError, setFormError] = useState('')
  const [submitting, setSubmitting] = useState(false)

  // 加载账户
  const loadAccounts = useCallback(async () => {
    if (!currentBookId) return
    try {
      setAccounts(await accountApi.list(currentBookId))
    } catch { /* ignore */ }
  }, [currentBookId])

  // 加载配置
  useEffect(() => {
    settingsApi.getConfig().then((config) => {
      if (typeof config.amountHighlightThreshold === 'number') {
        setHighlightThreshold(config.amountHighlightThreshold)
      }
    }).catch(() => {})
  }, [])

  // 加载日历数据
  const loadCalendar = useCallback(async () => {
    if (!currentBookId) return
    setLoading(true)
    try {
      const [data, monthSummary, holidayData] = await Promise.all([
        recordApi.calendar({ bookId: currentBookId, year, month }),
        recordApi.summary({
          bookId: currentBookId,
          dateFrom: `${year}-${String(month).padStart(2, '0')}-01`,
          dateTo: `${year}-${String(month).padStart(2, '0')}-${new Date(year, month, 0).getDate()}`,
        }),
        holidayApi.getByYear(year),
      ])
      const map: Record<string, { income: number; expense: number; count: number }> = {}
      for (const d of data) {
        map[d.date] = { income: d.income, expense: d.expense, count: d.count }
      }
      setDayData(map)
      setSummary(monthSummary)
      setHolidays(holidayData)
    } catch { /* ignore */ }
    finally { setLoading(false) }
  }, [currentBookId, year, month])

  useEffect(() => {
    loadAccounts()
  }, [loadAccounts])

  useEffect(() => {
    loadCalendar()
  }, [loadCalendar])

  // 加载选中日期的流水
  const loadDayRecords = useCallback(async () => {
    if (!selectedDate || !currentBookId) return
    setDayLoading(true)
    try {
      const result = await recordApi.list({
        bookId: currentBookId,
        dateFrom: selectedDate,
        dateTo: selectedDate,
        pageSize: 100,
        type: dayFilter === 'ALL' ? undefined : (dayFilter || undefined),
      })
      setDayRecords(result.records)
    } catch { /* ignore */ }
    finally { setDayLoading(false) }
  }, [selectedDate, currentBookId, dayFilter])

  useEffect(() => {
    loadDayRecords()
  }, [loadDayRecords])

  const openDay = (date: string) => {
    setSelectedDate(date)
    setDayFilter('ALL')
    setDayCategoryFilter('')
    setDayAmountMin('')
    setDayAmountMax('')
  }

  // 打开新增表单
  const openCreate = () => {
    resetForm()
    setFormOpen(true)
  }

  // 打开编辑表单
  const openEdit = (r: RecordItem) => {
    setEditRecord(r)
    setFormType(r.type)
    setFormAmount(r.amount.toString())
    setFormAccountId(r.accountId)
    setFormFromAccountId(r.fromAccountId || '')
    setFormToAccountId(r.toAccountId || '')
    setFormCategoryCode(r.categoryCode || '')
    setFormPayer(r.payer || '')
    setFormRemark(r.remark || '')
    setFormError('')
    setFormOpen(true)
  }

  const resetForm = () => {
    setEditRecord(null)
    setFormType('EXPENSE')
    setFormAmount('')
    if (selectedDate) {
      // 日期由选中日期决定，不单独设置
    }
    setFormAccountId('')
    setFormFromAccountId('')
    setFormToAccountId('')
    setFormCategoryCode('')
    setFormPayer('')
    setFormRemark('')
    setFormError('')
  }

  // 过滤显示的账户（转账时显示所有，否则只显示非转账类）
  const visibleAccounts = accounts.filter((a) => a.status === 'ACTIVE')

  const handleSubmit = async () => {
    if (!currentBookId || !selectedDate) return
    const amount = parseFloat(formAmount)
    if (!amount || amount <= 0) { setFormError('请输入有效金额'); return }
    if (!formAccountId) { setFormError('请选择账户'); return }

    setSubmitting(true)
    setFormError('')
    try {
      const baseData = {
        accountBookId: currentBookId,
        type: formType,
        amount,
        date: new Date(selectedDate + 'T12:00:00').toISOString(),
        accountId: formAccountId,
        fromAccountId: formType === 'TRANSFER' ? formFromAccountId : undefined,
        toAccountId: formType === 'TRANSFER' ? formToAccountId : undefined,
        categoryCode: formCategoryCode || undefined,
        payer: formPayer || undefined,
        remark: formRemark || undefined,
        ownerId: userId,
      }

      if (editRecord) {
        await recordApi.update(editRecord.id, baseData)
      } else {
        await recordApi.create(baseData)
      }

      setFormOpen(false)
      resetForm()
      loadDayRecords()
      loadCalendar()
      loadAccounts()
    } catch (e: any) {
      setFormError(e.message)
    } finally {
      setSubmitting(false)
    }
  }

  const handleDelete = async () => {
    if (!deleteTarget) return
    try {
      await recordApi.delete(deleteTarget.id)
      setDeleteTarget(null)
      loadDayRecords()
      loadCalendar()
      loadAccounts()
    } catch { /* ignore */ }
  }

  // 当日分类去重列表（供筛选下拉）
  const dayCategories = [...new Set(dayRecords.map((r) => r.categoryCode).filter(Boolean))]

  // 过滤并格式化日详情记录
  const filteredRecords = dayRecords.filter((r) => {
    if (dayCategoryFilter && dayCategoryFilter !== 'ALL' && r.categoryCode !== dayCategoryFilter) return false
    if (dayAmountMin) {
      const min = parseFloat(dayAmountMin)
      if (!isNaN(min) && r.amount < min) return false
    }
    if (dayAmountMax) {
      const max = parseFloat(dayAmountMax)
      if (!isNaN(max) && r.amount > max) return false
    }
    return true
  })

  if (!currentBookId) {
    return (
      <div className="flex items-center justify-center py-20">
        <p className="text-muted-foreground">请先选择或创建一个账本</p>
      </div>
    )
  }

  return (
    <div className="h-full flex flex-col">
      {/* 月汇总卡片 */}
      <div className="grid grid-cols-4 gap-3 mb-4 shrink-0">
        <Card className="border border-border">
          <CardContent className="p-3 flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-[#22c55e]/10 flex items-center justify-center shrink-0">
              <ArrowUpRight size={16} className="text-[#22c55e]" />
            </div>
            <div>
              <p className="text-xs text-muted-foreground">收入</p>
              <p className="text-base font-bold text-[#22c55e]">{formatMoney(summary.income)}</p>
            </div>
          </CardContent>
        </Card>
        <Card className="border border-border">
          <CardContent className="p-3 flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-[#ef4444]/10 flex items-center justify-center shrink-0">
              <ArrowDownRight size={16} className="text-[#ef4444]" />
            </div>
            <div>
              <p className="text-xs text-muted-foreground">支出</p>
              <p className="text-base font-bold text-[#ef4444]">{formatMoney(summary.expense)}</p>
            </div>
          </CardContent>
        </Card>
        <Card className="border border-border">
          <CardContent className="p-3 flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-[#22c55e]/10 flex items-center justify-center shrink-0">
              <span className="text-base font-bold text-[#22c55e]">¥</span>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">盈余</p>
              <p className={`text-base font-bold ${summary.income - summary.expense >= 0 ? 'text-[#22c55e]' : 'text-[#ef4444]'}`}>
                {formatMoney(summary.income - summary.expense)}
              </p>
            </div>
          </CardContent>
        </Card>
        <Card className="border border-border">
          <CardContent className="p-3 flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-[#3b82f6]/10 flex items-center justify-center shrink-0">
              <ArrowLeftRight size={16} className="text-[#3b82f6]" />
            </div>
            <div>
              <p className="text-xs text-muted-foreground">转账</p>
              <p className="text-base font-bold text-[#3b82f6]">{formatMoney(summary.transfer)}</p>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* 日历 */}
      <div className="flex-1 min-h-0">
        {loading ? (
          <Spinner className="py-12" />
        ) : (
          <TransactionCalendar
            year={year}
            month={month}
            dayData={dayData}
            highlightThreshold={highlightThreshold}
            holidays={holidays}
            onDayClick={openDay}
            onMonthChange={(y, m) => { setYear(y); setMonth(m) }}
          />
        )}
      </div>

      {/* 日详情弹窗 */}
      <Dialog open={!!selectedDate} onOpenChange={() => setSelectedDate(null)}>
        <DialogContent className="max-w-2xl max-h-[85vh] flex flex-col p-0 gap-0" aria-describedby={undefined}>
          {/* 头部 */}
          <div className="shrink-0 px-6 pt-6 pb-4 border-b border-border">
            <DialogHeader className="p-0">
              <DialogTitle className="pr-8">
                <span className="text-lg">{selectedDate} 流水明细</span>
              </DialogTitle>
              <DialogDescription className="sr-only">
                {selectedDate}的流水记录列表，可以添加、编辑或删除流水
              </DialogDescription>
            </DialogHeader>

            {/* 日汇总 */}
            <div className="flex items-center gap-4 text-sm mt-4">
              <div className="flex items-center gap-1.5">
                <TrendingDown size={14} className="text-[#ef4444]" />
                <span className="text-muted-foreground">支出</span>
                <span className="font-semibold text-[#ef4444]">
                  {formatMoney(dayRecords.filter(r => r.type === 'EXPENSE').reduce((s, r) => s + r.amount, 0))}
                </span>
              </div>
              <div className="flex items-center gap-1.5">
                <TrendingUp size={14} className="text-[#22c55e]" />
                <span className="text-muted-foreground">收入</span>
                <span className="font-semibold text-[#22c55e]">
                  {formatMoney(dayRecords.filter(r => r.type === 'INCOME').reduce((s, r) => s + r.amount, 0))}
                </span>
              </div>
            </div>

            {/* 筛选行 */}
            <div className="flex items-center gap-2 mt-3">
              <Select value={dayFilter} onValueChange={setDayFilter}>
                <SelectTrigger className="w-24 h-8 text-xs bg-background border-border rounded-lg">
                  <SelectValue placeholder="类型" />
                </SelectTrigger>
                <SelectContent className="bg-card border-border">
                  <SelectItem value="ALL">全部类型</SelectItem>
                  <SelectItem value="INCOME">收入</SelectItem>
                  <SelectItem value="EXPENSE">支出</SelectItem>
                  <SelectItem value="TRANSFER">转账</SelectItem>
                </SelectContent>
              </Select>
              <Select value={dayCategoryFilter} onValueChange={setDayCategoryFilter}>
                <SelectTrigger className="w-24 h-8 text-xs bg-background border-border rounded-lg">
                  <SelectValue placeholder="分类" />
                </SelectTrigger>
                <SelectContent className="bg-card border-border">
                  <SelectItem value="ALL">全部分类</SelectItem>
                  {dayCategories.map((c) => (
                    <SelectItem key={c} value={c}>{c}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Input
                type="number"
                placeholder="最低金额"
                value={dayAmountMin}
                onChange={(e) => setDayAmountMin(e.target.value)}
                className="w-24 h-8 text-xs bg-background border-border rounded-lg"
              />
              <Input
                type="number"
                placeholder="最高金额"
                value={dayAmountMax}
                onChange={(e) => setDayAmountMax(e.target.value)}
                className="w-24 h-8 text-xs bg-background border-border rounded-lg"
              />
              <div className="flex-1" />
              <Button size="sm" className="bg-[#f97316] hover:bg-[#ea580c] text-white h-8 text-xs rounded-lg" onClick={openCreate}>
                <Plus size={14} className="mr-1" />添加流水
              </Button>
            </div>
          </div>

          {/* 流水列表 */}
          <div className="flex-1 overflow-auto px-6 py-3">
            {dayLoading ? (
              <Spinner className="py-12" />
            ) : filteredRecords.length === 0 ? (
              <div className="py-16 flex flex-col items-center gap-3">
                <div className="w-12 h-12 rounded-full bg-muted flex items-center justify-center">
                  <ReceiptText size={22} className="text-muted-foreground/50" />
                </div>
                <p className="text-sm text-muted-foreground">暂无流水记录</p>
                <Button variant="outline" size="sm" className="text-xs rounded-lg" onClick={openCreate}>
                  <Plus size={13} className="mr-1" />添加一笔
                </Button>
              </div>
            ) : (
              <div className="space-y-1">
                {filteredRecords.map((r) => (
                  <div
                    key={r.id}
                    className="p-3 rounded-xl hover:bg-accent/60 group transition-colors border border-transparent hover:border-border"
                  >
                    {/* 第一行：交易方 + 金额 */}
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-medium truncate">
                        {r.payer || r.categoryCode || '未分类'}
                      </span>
                      <span className={`text-sm font-semibold shrink-0 ml-3 tabular-nums ${
                        r.type === 'INCOME' ? 'text-[#22c55e]' : r.type === 'EXPENSE' ? 'text-[#ef4444]' : 'text-[#3b82f6]'
                      }`}>
                        {r.type === 'INCOME' ? '+' : r.type === 'EXPENSE' ? '-' : ''}{formatMoney(r.amount)}
                      </span>
                    </div>

                    {/* 第二行：类型 | 分类 | 账户 */}
                    <div className="flex items-center gap-1.5 mt-1 text-xs text-muted-foreground">
                      <span className={r.type === 'INCOME' ? 'text-[#22c55e]' : r.type === 'EXPENSE' ? 'text-[#ef4444]' : 'text-[#3b82f6]'}>
                        {TYPE_LABELS[r.type]}
                      </span>
                      <span>|</span>
                      <span>{r.categoryCode || '未分类'}</span>
                      <span>|</span>
                      <span className="truncate">
                        {r.type === 'TRANSFER'
                          ? `${r.fromAccount?.name || '?'} → ${r.toAccount?.name || '?'}`
                          : r.account?.name || ''
                        }
                      </span>
                    </div>

                    {/* 第三行：备注 + 操作按钮 */}
                    <div className="flex items-center justify-between mt-1">
                      <span className="text-xs text-muted-foreground/60 truncate">
                        {r.remark || ''}
                      </span>
                      <div className="flex items-center gap-0.5 shrink-0 ml-3 opacity-0 group-hover:opacity-100 transition-opacity">
                        {r.attachments?.length > 0 && (
                          <Button variant="ghost" size="icon" className="h-6 w-6 rounded-lg hover:bg-accent" onClick={() => setViewingAttachments(r.attachments)}>
                            <Paperclip size={12} />
                          </Button>
                        )}
                        <Button variant="ghost" size="icon" className="h-6 w-6 rounded-lg hover:bg-accent" onClick={() => openEdit(r)}>
                          <Pencil size={12} />
                        </Button>
                        <Button variant="ghost" size="icon" className="h-6 w-6 rounded-lg text-[#ef4444] hover:text-[#ef4444] hover:bg-[#ef4444]/10" onClick={() => setDeleteTarget(r)}>
                          <Trash2 size={12} />
                        </Button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>

      {/* 新增/编辑弹窗 */}
      <Dialog open={formOpen} onOpenChange={setFormOpen}>
        <DialogContent className="max-w-md" aria-describedby={undefined}>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              {editRecord ? (
                <><Pencil size={18} className="text-muted-foreground" />编辑流水</>
              ) : (
                <><Plus size={18} className="text-muted-foreground" />添加流水</>
              )}
              <span className="text-sm font-normal text-muted-foreground">{selectedDate}</span>
            </DialogTitle>
            <DialogDescription className="sr-only">
              {editRecord ? '编辑' : '添加'} {selectedDate} 的流水记录
            </DialogDescription>
          </DialogHeader>

          <div className="flex flex-col gap-4">
            {formError && (
              <div className="flex items-center gap-2 text-xs text-[#ef4444] bg-[#ef4444]/10 rounded-xl px-3 py-2.5">
                <div className="w-4 h-4 rounded-full bg-[#ef4444]/20 flex items-center justify-center shrink-0">
                  <span className="text-[10px] font-bold">!</span>
                </div>
                {formError}
              </div>
            )}

            {/* 类型切换 */}
            <Tabs value={formType} onValueChange={(v) => { setFormType(v as RecordType); setFormCategoryCode('') }}>
              <Label className="text-xs text-muted-foreground mb-2 block">类型</Label>
              <TabsList className="w-full bg-muted p-1 rounded-xl h-10">
                {([
                  { type: 'EXPENSE' as RecordType, label: '支出', icon: TrendingDown },
                  { type: 'INCOME' as RecordType, label: '收入', icon: TrendingUp },
                  { type: 'TRANSFER' as RecordType, label: '转账', icon: ArrowLeftRight },
                ]).map(({ type, label, icon: Icon }) => (
                  <TabsTrigger key={type} value={type} className="flex-1 text-xs data-[state=active]:bg-background data-[state=active]:shadow-sm rounded-lg h-8 gap-1.5">
                    <Icon size={14} className={type === 'INCOME' ? 'text-[#22c55e]' : type === 'EXPENSE' ? 'text-[#ef4444]' : 'text-[#3b82f6]'} />
                    {label}
                  </TabsTrigger>
                ))}
              </TabsList>
            </Tabs>

            {/* 金额 */}
            <div>
              <Label className="text-xs text-muted-foreground mb-1.5 block">金额</Label>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground font-medium">¥</span>
                <Input
                  type="number"
                  placeholder="0.00"
                  value={formAmount}
                  onChange={(e) => { setFormAmount(e.target.value); setFormError('') }}
                  className="bg-background border-border pl-7 text-base font-medium rounded-xl"
                />
              </div>
            </div>

            {/* 账户 */}
            {formType === 'TRANSFER' ? (
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label className="text-xs text-muted-foreground mb-1.5 block">转出账户</Label>
                  <Select value={formFromAccountId} onValueChange={setFormFromAccountId}>
                    <SelectTrigger className="bg-background border-border rounded-xl">
                      <SelectValue placeholder="选择转出账户" />
                    </SelectTrigger>
                    <SelectContent className="bg-card border-border">
                      {visibleAccounts.map((a) => (
                        <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label className="text-xs text-muted-foreground mb-1.5 block">转入账户</Label>
                  <Select value={formToAccountId} onValueChange={setFormToAccountId}>
                    <SelectTrigger className="bg-background border-border rounded-xl">
                      <SelectValue placeholder="选择转入账户" />
                    </SelectTrigger>
                    <SelectContent className="bg-card border-border">
                      {visibleAccounts.map((a) => (
                        <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
            ) : (
              <div>
                <Label className="text-xs text-muted-foreground mb-1.5 block">账户</Label>
                <Select value={formAccountId} onValueChange={setFormAccountId}>
                  <SelectTrigger className="bg-background border-border rounded-xl">
                    <SelectValue placeholder="选择账户" />
                  </SelectTrigger>
                  <SelectContent className="bg-card border-border">
                    {visibleAccounts.map((a) => (
                      <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            {/* 分类 */}
            <div>
              <Label className="text-xs text-muted-foreground mb-1.5 block">分类</Label>
              <DictCombobox
                group={
                  formType === 'INCOME' ? 'transaction_category_income'
                  : formType === 'TRANSFER' ? 'transaction_category_transfer'
                  : 'transaction_category_expense'
                }
                value={formCategoryCode}
                onChange={setFormCategoryCode}
              />
            </div>

            {/* 交易方 */}
            <div>
              <Label className="text-xs text-muted-foreground mb-1.5 block">交易方</Label>
              <Input
                placeholder="商家/对方名称"
                value={formPayer}
                onChange={(e) => setFormPayer(e.target.value)}
                className="bg-background border-border rounded-xl"
              />
            </div>

            {/* 备注 */}
            <div>
              <Label className="text-xs text-muted-foreground mb-1.5 block">备注</Label>
              <Textarea
                placeholder="备注信息"
                value={formRemark}
                onChange={(e) => setFormRemark(e.target.value)}
                className="bg-background border-border resize-none rounded-xl"
                rows={2}
              />
            </div>
          </div>

          <DialogFooter className="mt-2">
            <Button variant="outline" className="rounded-xl" onClick={() => setFormOpen(false)}>取消</Button>
            <Button
              className="bg-[#f97316] hover:bg-[#ea580c] text-white rounded-xl"
              onClick={handleSubmit}
              disabled={submitting}
            >
              {submitting ? '保存中...' : editRecord ? '保存修改' : '添加流水'}
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

      {/* 删除确认 */}
      <AlertDialog open={!!deleteTarget} onOpenChange={() => setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>删除流水</AlertDialogTitle>
            <AlertDialogDescription>
              确定要删除该流水记录吗？此操作不可撤销。
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
    </div>
  )
}

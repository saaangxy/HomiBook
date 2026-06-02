import { useState, useEffect, useRef } from 'react'
import { CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Spinner } from '@/components/ui/spinner'
import { Textarea } from '@/components/ui/textarea'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog'
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel,
  AlertDialogContent, AlertDialogDescription, AlertDialogFooter,
  AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import {
  Table, TableHeader, TableBody, TableRow, TableHead, TableCell,
} from '@/components/ui/table'
import { CronBuilder } from '@/components/CronBuilder'
import { DatePicker } from '@/components/ui/date-picker'
import { RepaymentPlanTable } from '@/components/RepaymentPlanTable'
import { DictCombobox } from '@/components/DictCombobox'
import { TagCombobox } from '@/components/TagCombobox'
import { recurringApi, type RecurringTransaction, type LoanPreview } from '@/api/recurring'
import { accountApi, type AccountItem } from '@/api/account'
import { useBookStore } from '@/stores/book'
import { Plus, Pencil, Trash2, Power, PowerOff, FileText } from 'lucide-react'

const TYPE_LABELS: Record<string, string> = { INCOME: '收入', EXPENSE: '支出', TRANSFER: '转账' }
const TYPE_COLORS: Record<string, string> = {
  INCOME: 'text-[#22c55e] bg-[#22c55e]/10',
  EXPENSE: 'text-[#ef4444] bg-[#ef4444]/10',
  TRANSFER: 'text-[#3b82f6] bg-[#3b82f6]/10',
}
const RECURRING_TYPE_LABELS: Record<string, string> = { PERIODIC: '周期', LOAN: '贷款' }
const METHOD_LABELS: Record<string, string> = {
  EQUAL_INSTALLMENT: '等额本息',
  EQUAL_PRINCIPAL: '等额本金',
}

function formatMoney(amount: number): string {
  return new Intl.NumberFormat('zh-CN', { style: 'currency', currency: 'CNY' }).format(amount)
}

export function RecurringTransactionsPage() {
  const { currentBookId } = useBookStore()
  const [list, setList] = useState<RecurringTransaction[]>([])
  const [accounts, setAccounts] = useState<AccountItem[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  // 弹窗
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<RecurringTransaction | null>(null)

  // 还款计划查看
  const [planTarget, setPlanTarget] = useState<RecurringTransaction | null>(null)

  // 贷款预览
  const [loanPreview, setLoanPreview] = useState<LoanPreview | null>(null)
  const [previewLoading, setPreviewLoading] = useState(false)

  // 表单
  const [formName, setFormName] = useState('')
  const [formType, setFormType] = useState<'INCOME' | 'EXPENSE' | 'TRANSFER'>('EXPENSE')
  const [formAmount, setFormAmount] = useState('')
  const [formAccountId, setFormAccountId] = useState('')
  const [formToAccountId, setFormToAccountId] = useState('')
  const [formCategoryCode, setFormCategoryCode] = useState('')
  const [formPayer, setFormPayer] = useState('')
  const [formRemark, setFormRemark] = useState('')
  const [formCron, setFormCron] = useState('0 0 * * *')
  const [formRecurringType, setFormRecurringType] = useState<'PERIODIC' | 'LOAN'>('PERIODIC')
  // 贷款字段
  const [formLoanTotal, setFormLoanTotal] = useState('')
  const [formLoanRate, setFormLoanRate] = useState('')
  const [formLoanMethod, setFormLoanMethod] = useState<'EQUAL_INSTALLMENT' | 'EQUAL_PRINCIPAL'>('EQUAL_INSTALLMENT')
  const [formLoanStartDate, setFormLoanStartDate] = useState('')
  const [formLoanTermMonths, setFormLoanTermMonths] = useState('')
  const [formLoanDay, setFormLoanDay] = useState(1) // 每月还款日
  const [formLoanGenerateAll, setFormLoanGenerateAll] = useState(true) // 全部生成|只生成未还款
  const [formTags, setFormTags] = useState<string[]>(['固定收支'])
  const [formActive, setFormActive] = useState(true)
  const [formError, setFormError] = useState('')
  const [submitting, setSubmitting] = useState(false)

  const loadData = async () => {
    if (!currentBookId) return
    setLoading(true)
    try {
      const [listData, accData] = await Promise.all([
        recurringApi.list(currentBookId),
        accountApi.list(currentBookId),
      ])
      setList(listData)
      setAccounts(accData)
    } catch (e: any) { setError(e.message) }
    finally { setLoading(false) }
  }

  useEffect(() => { loadData() }, [currentBookId])

  const resetForm = () => {
    setFormName('')
    setFormType('EXPENSE')
    setFormAmount('')
    setFormAccountId('')
    setFormToAccountId('')
    setFormCategoryCode('')
    setFormPayer('')
    setFormRemark('')
    setFormCron('0 0 * * *')
    setFormRecurringType('PERIODIC')
    setFormLoanTotal('')
    setFormLoanRate('')
    setFormLoanMethod('EQUAL_INSTALLMENT')
    setFormLoanStartDate('')
    setFormLoanTermMonths('')
    setFormLoanDay(1)
    setFormLoanGenerateAll(true)
    setFormTags(['固定收支'])
    setFormActive(true)
    setFormError('')
    setLoanPreview(null)
  }

  const openCreate = () => {
    setEditingId(null)
    resetForm()
    setDialogOpen(true)
  }

  const openEdit = (rt: RecurringTransaction) => {
    setEditingId(rt.id)
    setFormName(rt.name || '')
    setFormType(rt.type as 'INCOME' | 'EXPENSE' | 'TRANSFER')
    setFormAmount(String(rt.amount))
    setFormAccountId(rt.accountId)
    setFormToAccountId(rt.toAccountId || '')
    setFormCategoryCode(rt.categoryCode || '')
    setFormPayer(rt.payer || '')
    setFormRemark(rt.remark || '')
    setFormCron(rt.cron)
    setFormRecurringType(rt.recurringType)
    setFormTags(rt.tags?.length ? rt.tags : ['固定收支'])
    setFormActive(rt.active)
    if (rt.recurringType === 'LOAN') {
      setFormLoanTotal(rt.loanTotalAmount ? String(rt.loanTotalAmount) : '')
      setFormLoanRate(rt.loanInterestRate ? String(rt.loanInterestRate) : '')
      setFormLoanMethod(rt.loanInterestMethod as 'EQUAL_INSTALLMENT' | 'EQUAL_PRINCIPAL' || 'EQUAL_INSTALLMENT')
      setFormLoanStartDate(rt.loanStartDate ? rt.loanStartDate.slice(0, 10) : '')
      setFormLoanTermMonths(rt.loanTermMonths ? String(rt.loanTermMonths) : '')
      // 从 cron 解析还款日: 0 0 <day> * *
      const parts = rt.cron.split(' ')
      setFormLoanDay(parseInt(parts[2]) || 1)
    }
    setFormError('')
    setLoanPreview(null)
    setDialogOpen(true)
  }

  // 贷款预览
  const handleLoanPreview = async () => {
    const total = parseFloat(formLoanTotal)
    const rate = parseFloat(formLoanRate)
    const months = parseInt(formLoanTermMonths)
    if (!total || !months || !formLoanStartDate) return

    setPreviewLoading(true)
    try {
      const preview = await recurringApi.loanPreview({
        total,
        annualRate: rate || 0,
        months,
        startDate: new Date(formLoanStartDate).toISOString(),
        method: formLoanMethod,
      })
      setLoanPreview(preview)
    } catch (e: any) { setFormError(e.message) }
    finally { setPreviewLoading(false) }
  }

  // 贷款预览自动触发（debounce 500ms）
  const previewTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => {
    if (formRecurringType !== 'LOAN' || editingId) return

    const total = parseFloat(formLoanTotal)
    const months = parseInt(formLoanTermMonths)
    if (!total || !months || !formLoanStartDate || total <= 0 || months <= 0) {
      setLoanPreview(null)
      return
    }

    if (previewTimerRef.current) clearTimeout(previewTimerRef.current)
    previewTimerRef.current = setTimeout(() => {
      handleLoanPreview()
    }, 500)

    return () => {
      if (previewTimerRef.current) clearTimeout(previewTimerRef.current)
    }
  }, [formLoanTotal, formLoanRate, formLoanTermMonths, formLoanStartDate, formLoanMethod, formRecurringType, editingId])

  const handleSubmit = async () => {
    if (!currentBookId) return
    setFormError('')

    if (!formName.trim()) { setFormError('请输入名称'); return }
    if (!formAccountId) { setFormError('请选择账户'); return }
    if (formType === 'TRANSFER' && !formToAccountId) { setFormError('请选择目标账户'); return }
    if (!formCron) { setFormError('请设置触发时间'); return }

    const isLoan = formRecurringType === 'LOAN'
    const amount = parseFloat(formAmount)
    if (!isLoan && (!amount || amount <= 0)) { setFormError('请输入有效金额'); return }

    setSubmitting(true)
    try {
      const baseData = {
        accountBookId: currentBookId,
        name: formName.trim(),
        type: formType,
        amount: isLoan ? 0 : amount,
        remark: formRemark || undefined,
        tags: formTags,
        accountId: formAccountId,
        toAccountId: formType === 'TRANSFER' ? formToAccountId : undefined,
        categoryCode: formType === 'TRANSFER' ? undefined : (formCategoryCode || undefined),
        payer: formType === 'TRANSFER' ? undefined : (formPayer || undefined),
        cron: formCron,
        recurringType: formRecurringType,
      }

      if (formRecurringType === 'LOAN') {
        const loanTotal = parseFloat(formLoanTotal)
        const loanRate = parseFloat(formLoanRate)
        const loanTerm = parseInt(formLoanTermMonths)
        if (!loanTotal || !loanTerm || !formLoanStartDate) {
          setFormError('请填写完整的贷款信息'); setSubmitting(false); return
        }

        if (editingId) {
          // 编辑模式：不更新 amount（贷款金额由系统计算）
          const { amount: _a, ...updateData } = baseData
          await recurringApi.update(editingId, { ...updateData, active: formActive })
        } else {
          await recurringApi.create({
            ...baseData,
            loanTotalAmount: loanTotal,
            loanInterestRate: loanRate || 0,
            loanInterestMethod: formLoanMethod,
            loanStartDate: new Date(formLoanStartDate).toISOString(),
            loanTermMonths: loanTerm,
            generateAll: formLoanGenerateAll,
          })
        }
      } else {
        if (editingId) {
          await recurringApi.update(editingId, { ...baseData, active: formActive })
        } else {
          await recurringApi.create(baseData)
        }
      }

      setDialogOpen(false)
      resetForm()
      loadData()
    } catch (e: any) { setFormError(e.message) }
    finally { setSubmitting(false) }
  }

  const handleDelete = async () => {
    if (!deleteTarget) return
    try {
      await recurringApi.delete(deleteTarget.id)
      setDeleteTarget(null)
      loadData()
    } catch (e: any) { setError(e.message) }
  }

  const handleToggle = async (rt: RecurringTransaction) => {
    try {
      await recurringApi.toggle(rt.id)
      loadData()
    } catch (e: any) { setError(e.message) }
  }

  const getCategoryGroup = (type: string) => {
    if (type === 'INCOME') return 'transaction_category_income'
    return 'transaction_category_expense'
  }

  return (
    <div className="space-y-4">
      {error && (
        <CardContent className="p-0"><div className="text-sm text-[#ef4444] bg-[#ef4444]/10 p-3 rounded-lg">{error}</div></CardContent>
      )}

      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">固定收支</h2>
        <Button onClick={openCreate} className="bg-[#f97316] hover:bg-[#ea580c] text-white rounded-lg h-8 text-xs">
          <Plus size={14} /> 新增固定收支
        </Button>
      </div>

      {loading && list.length === 0 ? (
        <div className="py-12"><Spinner className="mx-auto" /></div>
      ) : list.length === 0 ? (
        <CardContent className="flex flex-col items-center justify-center py-12 text-center gap-2">
          <FileText size={40} className="opacity-30" />
          <p className="text-sm text-muted-foreground">暂无固定收支</p>
          <Button onClick={openCreate} variant="outline" className="text-xs h-8"><Plus size={14} /> 新增</Button>
        </CardContent>
      ) : (
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="text-xs">名称</TableHead>
                <TableHead className="text-xs">类型</TableHead>
                <TableHead className="text-xs">分类</TableHead>
                <TableHead className="text-xs text-right">金额</TableHead>
                <TableHead className="text-xs">账户</TableHead>
                <TableHead className="text-xs">触发规则</TableHead>
                <TableHead className="text-xs">下次触发</TableHead>
                <TableHead className="text-xs">贷款详情</TableHead>
                <TableHead className="text-xs w-36 text-right">操作</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {list.map((rt) => (
                <TableRow key={rt.id} className={rt.active ? 'shadow-[inset_3px_0_0_#22c55e]' : 'shadow-[inset_3px_0_0_#6b7280]'}>
                  <TableCell className="text-xs font-medium">{rt.name || '-'}</TableCell>
                  <TableCell>
                    <div className="flex items-center gap-1.5">
                      <Badge className={`text-[10px] ${TYPE_COLORS[rt.type]}`}>{TYPE_LABELS[rt.type]}</Badge>
                      <span className="text-[10px] text-muted-foreground">{RECURRING_TYPE_LABELS[rt.recurringType]}</span>
                    </div>
                  </TableCell>
                  <TableCell className="text-xs">{rt.type === 'TRANSFER' ? '-' : (rt.categoryCode || '-')}</TableCell>
                  <TableCell className="text-xs text-right font-mono">
                    {rt.active ? <span className={rt.type === 'INCOME' ? 'text-[#22c55e]' : rt.type === 'TRANSFER' ? 'text-[#3b82f6]' : 'text-[#ef4444]'}>{formatMoney(rt.amount)}</span> : <span className="text-muted-foreground">{formatMoney(rt.amount)}</span>}
                  </TableCell>
                  <TableCell className="text-xs">
                    {rt.type === 'TRANSFER' ? `${rt.account?.name || '-'} → ${rt.toAccount?.name || '-'}` : (rt.account?.name || '-')}
                  </TableCell>
                  <TableCell className="text-xs font-mono">{rt.cron}</TableCell>
                  <TableCell className="text-xs">
                    {rt.nextGenerateAt ? new Date(rt.nextGenerateAt).toLocaleString('zh-CN') : '-'}
                  </TableCell>
                  <TableCell className="text-xs">
                    {rt.recurringType === 'LOAN' && rt.loanTotalAmount ? (
                      <div className="space-y-0.5">
                        <div>总额: {formatMoney(rt.loanTotalAmount)}</div>
                        <div>剩余: {formatMoney(rt.loanRemainingAmount || 0)}</div>
                        <div>期数: {rt.loanTermMonths}期</div>
                      </div>
                    ) : '-'}
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-0.5 justify-end">
                      <button onClick={() => handleToggle(rt)} title={rt.active ? '停用' : '启用'} className="p-0.5 rounded hover:bg-accent">
                        {rt.active
                          ? <Power size={14} className="text-[#22c55e]" />
                          : <PowerOff size={14} className="text-muted-foreground" />
                        }
                      </button>
                      {rt.recurringType === 'LOAN' && (
                        <Button variant="ghost" size="icon" className="h-7 w-7" title="还款计划" onClick={() => setPlanTarget(rt)}>
                          <FileText size={13} />
                        </Button>
                      )}
                      <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => openEdit(rt)}>
                        <Pencil size={13} />
                      </Button>
                      <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setDeleteTarget(rt)}>
                        <Trash2 size={13} />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      )}

      {/* 创建/编辑弹窗 */}
      <Dialog open={dialogOpen} onOpenChange={(open) => { if (!open) setDialogOpen(false) }}>
        <DialogContent className="max-h-[85vh] overflow-y-auto max-w-xl">
          <DialogHeader>
            <DialogTitle>{editingId ? '编辑' : '新增'}固定收支</DialogTitle>
          </DialogHeader>
          <div className="flex flex-col gap-4">
            {/* 固定收支类型 */}
            {!editingId && (
              <div>
                <Label className="text-xs text-muted-foreground mb-1 block">固定收支类型</Label>
                <div className="inline-flex rounded-md border border-border overflow-hidden h-9">
                  {(['PERIODIC', 'LOAN'] as const).map((t, idx) => (
                    <button
                      key={t} type="button"
                      className={`px-4 text-xs font-medium transition-colors ${
                        idx === 0 ? 'border-r border-border' : ''
                      } ${
                        formRecurringType === t ? 'bg-[#f97316] text-white' : 'bg-background text-foreground hover:bg-muted'
                      }`}
                      onClick={() => {
                        setFormRecurringType(t)
                        setLoanPreview(null)
                        if (t === 'PERIODIC') {
                          setFormLoanTotal(''); setFormLoanRate(''); setFormLoanStartDate(''); setFormLoanTermMonths('')
                          setFormCron('0 0 * * *')
                        } else if (t === 'LOAN') {
                          const day = formLoanStartDate ? new Date(formLoanStartDate).getDate() : 1
                          setFormLoanDay(day)
                          setFormCron(`0 0 ${day} * *`)
                        }
                      }}
                    >
                      {RECURRING_TYPE_LABELS[t]}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* 名称 */}
            <div>
              <Label className="text-xs text-muted-foreground mb-1 block">名称</Label>
              <Input
                placeholder="固定收支名称"
                value={formName}
                onChange={(e) => { setFormName(e.target.value); setFormError('') }}
                className="bg-background border-border h-9"
              />
            </div>

            {/* 启用开关（编辑模式） */}
            {editingId && (
                <div className="flex items-center gap-3">
                  <Label className="text-xs text-muted-foreground">启用状态</Label>
                  <div className="inline-flex rounded-md border border-border overflow-hidden h-9">
                    {([true, false] as const).map((val, idx) => (
                        <button
                            key={String(val)} type="button"
                            className={`px-4 text-xs font-medium transition-colors ${
                                idx === 0 ? 'border-r border-border' : ''
                            } ${
                                formActive === val ? (val ? 'bg-[#22c55e] text-white' : 'bg-[#6b7280] text-white') : 'bg-background text-foreground hover:bg-muted'
                            }`}
                            onClick={() => setFormActive(val)}
                        >
                          {val ? '启用' : '停用'}
                        </button>
                    ))}
                  </div>
                </div>
            )}

            {/* 类型 + 金额（贷款类型隐藏） */}
            {formRecurringType !== 'LOAN' && (
              <div className="flex gap-3">
                <div className="w-24">
                  <Label className="text-xs text-muted-foreground mb-1 block">类型</Label>
                  <Select value={formType} onValueChange={(v) => { setFormType(v as 'INCOME' | 'EXPENSE' | 'TRANSFER'); setFormCategoryCode('') }}>
                    <SelectTrigger className="bg-background border-border h-9">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="INCOME">收入</SelectItem>
                      <SelectItem value="EXPENSE">支出</SelectItem>
                      <SelectItem value="TRANSFER">转账</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="flex-1">
                  <Label className="text-xs text-muted-foreground mb-1 block">金额</Label>
                  <Input
                    type="number" min="0" step="0.01"
                    placeholder="0.00"
                    value={formAmount}
                    onChange={(e) => { setFormAmount(e.target.value); setFormError('') }}
                    className="bg-background border-border h-9"
                  />
                </div>
              </div>
            )}

            {/* 账户 */}
            <div>
              <Label className="text-xs text-muted-foreground mb-1 block">
                {formType === 'TRANSFER' ? '源账户' : '账户'}
              </Label>
              <Select value={formAccountId} onValueChange={setFormAccountId}>
                <SelectTrigger className="bg-background border-border h-9"><SelectValue placeholder="选择账户" /></SelectTrigger>
                <SelectContent>
                  {accounts.map((a) => <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>

            {/* 目标账户（转账类型专用） */}
            {formType === 'TRANSFER' && (
              <div>
                <Label className="text-xs text-muted-foreground mb-1 block">目标账户</Label>
                <Select value={formToAccountId} onValueChange={setFormToAccountId}>
                  <SelectTrigger className="bg-background border-border h-9"><SelectValue placeholder="选择目标账户" /></SelectTrigger>
                  <SelectContent>
                    {accounts.filter((a) => a.id !== formAccountId).map((a) => <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            )}

            {/* 分类（转账类型隐藏） */}
            {formType !== 'TRANSFER' && (
              <div>
                <Label className="text-xs text-muted-foreground mb-1 block">分类</Label>
                <DictCombobox
                  group={getCategoryGroup(formType)}
                  value={formCategoryCode}
                  onChange={setFormCategoryCode}
                  placeholder="选择分类"
                />
              </div>
            )}

            {/* 交易方（转账类型隐藏） */}
            {formType !== 'TRANSFER' && (
              <div>
                <Label className="text-xs text-muted-foreground mb-1 block">交易方</Label>
                <Input
                  placeholder="交易方"
                  value={formPayer}
                  onChange={(e) => setFormPayer(e.target.value)}
                  className="bg-background border-border h-9"
                />
              </div>
            )}

            {/* 备注 */}
            <div>
              <Label className="text-xs text-muted-foreground mb-1 block">备注</Label>
              <Textarea
                placeholder="备注"
                value={formRemark}
                onChange={(e) => setFormRemark(e.target.value)}
                className="bg-background border-border min-h-[60px]" rows={2}
              />
            </div>

            {/* 标签 */}
            <div>
              <Label className="text-xs text-muted-foreground mb-1 block">标签</Label>
              <div className="flex flex-wrap gap-1.5 mb-2">
                <Badge className="gap-1 pr-1 text-[10px] bg-[#22c55e]/10 text-[#22c55e]">
                  固定收支
                </Badge>
              </div>
              <TagCombobox
                value={formTags.filter(t => t !== '固定收支')}
                onChange={(tags) => setFormTags(['固定收支', ...tags])}
                bookId={currentBookId || ''}
                placeholder="添加标签..."
              />
            </div>

            {/* 贷款字段 */}
            {formRecurringType === 'LOAN' && !editingId && (
              <>
                <div className="flex gap-3">
                  <div className="flex-1">
                    <Label className="text-xs text-muted-foreground mb-1 block">贷款总额</Label>
                    <Input type="number" min="0" step="0.01" value={formLoanTotal} onChange={(e) => { setFormLoanTotal(e.target.value); setLoanPreview(null) }} className="bg-background border-border h-9" />
                  </div>
                  <div className="flex-1">
                    <Label className="text-xs text-muted-foreground mb-1 block">年利率(%)</Label>
                    <Input type="number" min="0" step="0.01" value={formLoanRate} onChange={(e) => { setFormLoanRate(e.target.value); setLoanPreview(null) }} className="bg-background border-border h-9" />
                  </div>
                </div>
                <div className="flex gap-3">
                  <div className="flex-1">
                    <Label className="text-xs text-muted-foreground mb-1 block">计息方式</Label>
                    <Select value={formLoanMethod} onValueChange={(v) => { setFormLoanMethod(v as 'EQUAL_INSTALLMENT' | 'EQUAL_PRINCIPAL'); setLoanPreview(null) }}>
                      <SelectTrigger className="bg-background border-border h-9"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="EQUAL_INSTALLMENT">等额本息</SelectItem>
                        <SelectItem value="EQUAL_PRINCIPAL">等额本金</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="flex-1">
                    <Label className="text-xs text-muted-foreground mb-1 block">还款期数(月)</Label>
                    <Input type="number" min="1" max="360" value={formLoanTermMonths} onChange={(e) => { setFormLoanTermMonths(e.target.value); setLoanPreview(null) }} className="bg-background border-border h-9" />
                  </div>
                </div>
                <div>
                  <Label className="text-xs text-muted-foreground mb-1 block">开始日期</Label>
                  <DatePicker value={formLoanStartDate} onChange={(v) => { setFormLoanStartDate(v); setLoanPreview(null); const d = v ? new Date(v).getDate() : 1; setFormLoanDay(d); setFormCron(`0 0 ${d} * *`) }} />
                </div>

                {/* 全部生成开关 */}
                <div>
                  <Label className="text-xs text-muted-foreground mb-1 block">生成方式</Label>
                  <div className="inline-flex rounded-md border border-border overflow-hidden h-9">
                    {([true, false] as const).map((val, idx) => (
                      <button
                        key={String(val)} type="button"
                        className={`px-4 text-xs font-medium transition-colors ${
                          idx === 0 ? 'border-r border-border' : ''
                        } ${
                          formLoanGenerateAll === val ? 'bg-[#f97316] text-white' : 'bg-background text-foreground hover:bg-muted'
                        }`}
                        onClick={() => { setFormLoanGenerateAll(val); setLoanPreview(null) }}
                      >
                        {val ? '全部生成' : '只生成未还款'}
                      </button>
                    ))}
                  </div>
                  <p className="text-[11px] text-muted-foreground mt-1">
                    {formLoanGenerateAll ? '将立即为已到期月份创建流水记录' : '仅从下次还款日开始生成流水'}
                  </p>
                </div>

                {/* 贷款预览结果 */}
                <div>
                  {!loanPreview && (
                    <Button variant="outline" size="sm" className="text-xs" onClick={handleLoanPreview} disabled={previewLoading || !formLoanTotal || !formLoanTermMonths || !formLoanStartDate}>
                      {previewLoading ? <Spinner /> : '计算还款计划预览'}
                    </Button>
                  )}
                  {previewLoading && <Spinner className="mt-2" />}
                </div>
                {loanPreview && (
                  <>
                    <div className="flex gap-4 text-xs">
                      <span>月还款额: <strong className="text-[#f97316]">{formatMoney(loanPreview.monthlyPayment)}</strong></span>
                      <span>总还款: {formatMoney(loanPreview.totalPayment)}</span>
                      <span>总利息: {formatMoney(loanPreview.totalInterest)}</span>
                      {formLoanGenerateAll && (
                        <span className="text-[#f97316]">
                          将立即生成 {loanPreview.plan.filter(p => new Date(p.dueDate) <= new Date()).length} 期历史流水
                        </span>
                      )}
                    </div>
                    <RepaymentPlanTable plans={loanPreview.plan.map((p) => ({
                      id: String(p.period),
                      recurringTransactionId: '',
                      period: p.period,
                      dueDate: p.dueDate,
                      totalPayment: p.totalPayment,
                      principal: p.principal,
                      interest: p.interest,
                      remainingPrincipal: p.remainingPrincipal,
                      status: 'PENDING' as const,
                      generatedRecordId: null,
                    }))} />
                  </>
                )}
              </>
            )}

            {/* 触发时间 */}
            <div>
              <Label className="text-xs text-muted-foreground mb-1 block">触发时间</Label>
              {formRecurringType === 'LOAN' ? (
                <div className="flex items-center gap-2">
                  <span className="text-xs text-muted-foreground">每月</span>
                  <Input
                    type="number" min={1} max={28}
                    value={formLoanDay}
                    onChange={(e) => {
                      const d = Math.min(28, Math.max(1, parseInt(e.target.value) || 1))
                      setFormLoanDay(d)
                      setFormCron(`0 0 ${d} * *`)
                    }}
                    className="w-20 h-9"
                  />
                  <span className="text-xs text-muted-foreground">号</span>
                </div>
              ) : (
                <CronBuilder
                  value={formCron}
                  onChange={setFormCron}
                />
              )}
            </div>

            {formError && <p className="text-sm text-[#ef4444]">{formError}</p>}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>取消</Button>
            <Button className="bg-[#f97316] hover:bg-[#ea580c] text-white" onClick={handleSubmit} disabled={submitting}>
              {submitting ? '保存中...' : (editingId ? '保存' : '创建')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 删除确认 */}
      <AlertDialog open={!!deleteTarget} onOpenChange={() => setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>确认删除</AlertDialogTitle>
            <AlertDialogDescription>
              确定要删除这条固定收支吗？已生成的流水不会被删除，还款计划将被清除。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete} className="bg-[#ef4444] hover:bg-[#dc2626]">删除</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* 还款计划查看 */}
      <Dialog open={!!planTarget} onOpenChange={() => setPlanTarget(null)}>
        <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>还款计划</DialogTitle>
          </DialogHeader>
          {planTarget && (
            <div className="space-y-2">
              <div className="flex gap-4 text-xs text-muted-foreground">
                <span>总额: {formatMoney(planTarget.loanTotalAmount || 0)}</span>
                <span>剩余: {formatMoney(planTarget.loanRemainingAmount || 0)}</span>
                <span>方式: {METHOD_LABELS[planTarget.loanInterestMethod || ''] || '-'}</span>
                <span>利率: {planTarget.loanInterestRate}%</span>
              </div>
              <RepaymentPlanTable plans={planTarget.repaymentPlans || []} />
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}

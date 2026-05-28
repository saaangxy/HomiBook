import { useState, useEffect, useCallback } from 'react'
import { Card, CardContent } from '@/components/ui/card'
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
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Alert, AlertDescription } from '@/components/ui/alert'
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
import { DictCombobox } from '@/components/DictCombobox'
import { useBookStore } from '../stores/book'
import { budgetApi, type BudgetItem, type BudgetType, type BudgetSummary } from '@/api/budget'
import { Plus, Copy, Trash2, Pencil, Target, PiggyBank, TrendingUp } from 'lucide-react'

const MONTHS = Array.from({ length: 12 }, (_, i) => i + 1)
const MONTH_LABELS = ['1月', '2月', '3月', '4月', '5月', '6月', '7月', '8月', '9月', '10月', '11月', '12月']

function BudgetTypeBadge({ type }: { type: BudgetType }) {
  return type === 'FIXED'
    ? <Badge variant="outline" className="text-xs border-[#3b82f6]/50 text-[#3b82f6]">固定</Badge>
    : <Badge variant="outline" className="text-xs border-[#f97316]/50 text-[#f97316]">自由</Badge>
}

function UsageBar({ percent, remaining }: { percent: number; remaining: number }) {
  let color = 'bg-[#22c55e]'
  if (percent > 100) color = 'bg-[#ef4444]'
  else if (percent > 80) color = 'bg-[#f97316]'
  else if (percent > 60) color = 'bg-[#eab308]'

  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 h-2 bg-muted rounded-full overflow-hidden">
        <div
          className={`h-full rounded-full transition-all ${color}`}
          style={{ width: `${Math.min(percent, 100)}%` }}
        />
      </div>
      <span className={`text-xs tabular-nums w-20 text-right ${remaining < 0 ? 'text-[#ef4444]' : 'text-muted-foreground'}`}>
        {remaining < 0 ? `超支 ¥${Math.abs(remaining).toFixed(2)}` : `剩余 ¥${remaining.toFixed(2)}`}
      </span>
    </div>
  )
}

export function BudgetsPage() {
  const currentBookId = useBookStore((s) => s.currentBookId)
  const [budgets, setBudgets] = useState<BudgetItem[]>([])
  const [summary, setSummary] = useState<BudgetSummary | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [summaryLoading, setSummaryLoading] = useState(false)

  // 筛选
  const now = new Date()
  const [year, setYear] = useState(now.getFullYear())
  const [month, setMonth] = useState<number | undefined>(now.getMonth() + 1)
  const [typeFilter, setTypeFilter] = useState<BudgetType | 'ALL'>('ALL')
  const [tabView, setTabView] = useState<'ALL' | 'FIXED' | 'FREE'>('ALL')

  // 对话框状态
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editingBudget, setEditingBudget] = useState<BudgetItem | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<BudgetItem | null>(null)
  const [batchOpen, setBatchOpen] = useState(false)
  const [copyOpen, setCopyOpen] = useState(false)

  // 表单
  const [formName, setFormName] = useState('')
  const [formType, setFormType] = useState<BudgetType>('FIXED')
  const [formAmount, setFormAmount] = useState('')
  const [formCategory, setFormCategory] = useState('')
  const [formMonth, setFormMonth] = useState(now.getMonth() + 1)
  const [formRemark, setFormRemark] = useState('')
  const [formSaving, setFormSaving] = useState(false)
  const [formError, setFormError] = useState('')

  // 批量生成表单
  const [batchName, setBatchName] = useState('')
  const [batchType, setBatchType] = useState<BudgetType>('FIXED')
  const [batchAmount, setBatchAmount] = useState('')
  const [batchCategory, setBatchCategory] = useState('')
  const [batchMonths, setBatchMonths] = useState<number[]>([])
  const [batchYear, setBatchYear] = useState(now.getFullYear())
  const [batchRemark, setBatchRemark] = useState('')
  const [batchSaving, setBatchSaving] = useState(false)

  // 复制表单
  const [copySourceYear, setCopySourceYear] = useState(now.getFullYear())
  const [copySourceMonth, setCopySourceMonth] = useState(now.getMonth() + 1)
  const [copyTargets, setCopyTargets] = useState<Array<{ year: number; month: number }>>([])
  const [copyTargetYear, setCopyTargetYear] = useState(now.getFullYear())
  const [copySaving, setCopySaving] = useState(false)

  const loadData = useCallback(async () => {
    if (!currentBookId) return
    setLoading(true)
    setError('')
    try {
      const params: any = { bookId: currentBookId, year }
      if (month !== undefined) params.month = month
      if (typeFilter !== 'ALL') params.type = typeFilter
      const data = await budgetApi.list(params)
      setBudgets(data)
    } catch (e: any) {
      setError(e.message || '加载失败')
    } finally {
      setLoading(false)
    }
  }, [currentBookId, year, month, typeFilter])

  const loadSummary = useCallback(async () => {
    if (!currentBookId) return
    setSummaryLoading(true)
    try {
      const data = await budgetApi.summary({ bookId: currentBookId, year, month })
      setSummary(data)
    } catch {
      // ignore
    } finally {
      setSummaryLoading(false)
    }
  }, [currentBookId, year, month])

  useEffect(() => {
    loadData()
    loadSummary()
  }, [loadData, loadSummary])

  const filteredBudgets = budgets.filter((b) => {
    if (tabView === 'ALL') return true
    return b.type === tabView
  })

  const fixedBudgets = filteredBudgets.filter((b) => b.type === 'FIXED')
  const freeBudgets = filteredBudgets.filter((b) => b.type === 'FREE')

  // 打开创建弹窗
  const openCreate = () => {
    setEditingBudget(null)
    setFormName('')
    setFormType('FIXED')
    setFormAmount('')
    setFormCategory('')
    setFormMonth(month ?? now.getMonth() + 1)
    setFormRemark('')
    setFormError('')
    setDialogOpen(true)
  }

  // 打开编辑弹窗
  const openEdit = (b: BudgetItem) => {
    setEditingBudget(b)
    setFormName(b.name)
    setFormType(b.type as BudgetType)
    setFormAmount(String(b.amount))
    setFormCategory(b.categoryCode || '')
    setFormMonth(b.month)
    setFormRemark(b.remark || '')
    setFormError('')
    setDialogOpen(true)
  }

  // 保存（创建/编辑）
  const handleSave = async () => {
    if (!currentBookId) return
    if (!formName.trim()) { setFormError('请输入预算名称'); return }
    if (!formAmount || Number(formAmount) <= 0) { setFormError('请输入有效金额'); return }
    if (formType === 'FIXED' && !formCategory) { setFormError('请选择分类'); return }

    setFormSaving(true)
    setFormError('')
    try {
      if (editingBudget) {
        await budgetApi.update(editingBudget.id, {
          name: formName.trim(),
          amount: Number(formAmount),
          categoryCode: formType === 'FIXED' ? formCategory : null,
          remark: formRemark || null,
        })
      } else {
        await budgetApi.create({
          accountBookId: currentBookId,
          name: formName.trim(),
          type: formType,
          year,
          month: formMonth,
          amount: Number(formAmount),
          categoryCode: formType === 'FIXED' ? formCategory : undefined,
          remark: formRemark || undefined,
        })
      }
      setDialogOpen(false)
      loadData()
      loadSummary()
    } catch (e: any) {
      setFormError(e.message || '保存失败')
    } finally {
      setFormSaving(false)
    }
  }

  // 删除
  const handleDelete = async () => {
    if (!deleteTarget) return
    try {
      await budgetApi.delete(deleteTarget.id)
      setDeleteTarget(null)
      loadData()
      loadSummary()
    } catch { /* ignore */ }
  }

  // 批量生成
  const handleBatchCreate = async () => {
    if (!currentBookId) return
    if (!batchName.trim()) return
    if (!batchAmount || Number(batchAmount) <= 0) return
    if (batchMonths.length === 0) return

    setBatchSaving(true)
    try {
      await budgetApi.batchCreate({
        accountBookId: currentBookId,
        name: batchName.trim(),
        type: batchType,
        amount: Number(batchAmount),
        categoryCode: batchType === 'FIXED' ? batchCategory : undefined,
        months: batchMonths,
        year: batchYear,
        remark: batchRemark || undefined,
      })
      setBatchOpen(false)
      loadData()
      loadSummary()
    } catch { /* ignore */ } finally {
      setBatchSaving(false)
    }
  }

  // 复制
  const handleCopy = async () => {
    if (!currentBookId) return
    if (copyTargets.length === 0) return

    setCopySaving(true)
    try {
      await budgetApi.copy({
        accountBookId: currentBookId,
        sourceYear: copySourceYear,
        sourceMonth: copySourceMonth,
        targetMonths: copyTargets,
      })
      setCopyOpen(false)
      loadData()
      loadSummary()
    } catch { /* ignore */ } finally {
      setCopySaving(false)
    }
  }

  const toggleBatchMonth = (m: number) => {
    setBatchMonths((prev) => prev.includes(m) ? prev.filter((x) => x !== m) : [...prev, m].sort())
  }

  const toggleCopyTarget = (targetYear: number, targetMonth: number) => {
    const key = `${targetYear}-${targetMonth}`
    setCopyTargets((prev) => {
      const exists = prev.some((t) => t.year === targetYear && t.month === targetMonth)
      if (exists) return prev.filter((t) => !(t.year === targetYear && t.month === targetMonth))
      return [...prev, { year: targetYear, month: targetMonth }]
    })
  }

  const summaryData = summary
    ? {
        details: summary.details,
        totalBudget: summary.totalBudget,
        totalActual: summary.totalActual,
        totalRemaining: summary.totalRemaining,
        totalUsagePercent: summary.totalUsagePercent,
      }
    : { details: [], totalBudget: 0, totalActual: 0, totalRemaining: 0, totalUsagePercent: 0 }

  // 将汇总详情与预算列表对齐（只显示选中tab的数据）
  const summaryDetailMap = new Map(summaryData.details.map((d) => [d.id, d]))

  const renderTable = (items: BudgetItem[]) => (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead className="w-[140px]">名称</TableHead>
          <TableHead className="w-[60px]">月份</TableHead>
          <TableHead className="w-[80px]">类型</TableHead>
          {tabView !== 'FIXED' && <TableHead className="w-[100px]">分类/标签</TableHead>}
          <TableHead className="text-right w-[100px]">预算额</TableHead>
          <TableHead className="text-right w-[100px]">实际支出</TableHead>
          <TableHead className="w-[200px]">使用进度</TableHead>
          <TableHead className="text-right w-[80px]">操作</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {items.map((b) => {
          const detail = summaryDetailMap.get(b.id)
          const actual = detail?.actualAmount ?? 0
          const percent = detail?.usagePercent ?? 0
          const remaining = detail?.remaining ?? b.amount
          return (
            <TableRow key={b.id}>
              <TableCell className="font-medium">{b.name}</TableCell>
              <TableCell className="text-muted-foreground">{b.month}月</TableCell>
              <TableCell><BudgetTypeBadge type={b.type as BudgetType} /></TableCell>
              {tabView !== 'FIXED' && (
                <TableCell className="text-muted-foreground text-xs">
                  {b.type === 'FIXED' ? b.categoryCode : b.tag}
                </TableCell>
              )}
              <TableCell className="text-right tabular-nums">¥{b.amount.toFixed(2)}</TableCell>
              <TableCell className="text-right tabular-nums">¥{actual.toFixed(2)}</TableCell>
              <TableCell>
                <UsageBar percent={percent} remaining={remaining} />
              </TableCell>
              <TableCell className="text-right">
                <div className="flex items-center justify-end gap-1">
                  <button className="p-1 hover:bg-muted rounded" onClick={() => openEdit(b)}>
                    <Pencil size={14} />
                  </button>
                  <button className="p-1 hover:bg-muted rounded text-[#ef4444]" onClick={() => setDeleteTarget(b)}>
                    <Trash2 size={14} />
                  </button>
                </div>
              </TableCell>
            </TableRow>
          )
        })}
        {items.length === 0 && (
          <TableRow>
            <TableCell colSpan={tabView !== 'FIXED' ? 8 : 7} className="text-center text-muted-foreground py-8">
              暂无预算数据
            </TableCell>
          </TableRow>
        )}
      </TableBody>
    </Table>
  )

  return (
    <div className="space-y-6 p-6">
      <h1 className="text-2xl font-bold flex items-center gap-2">
        <Target className="h-6 w-6" />预算管理
      </h1>

      {!currentBookId && (
        <Alert>
          <AlertDescription>请先选择或创建一个账本</AlertDescription>
        </Alert>
      )}

      {/* 工具栏 */}
      <div className="flex flex-wrap items-center gap-3">
        <Select value={String(year)} onValueChange={(v) => setYear(Number(v))}>
          <SelectTrigger className="w-[100px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {Array.from({ length: 10 }, (_, i) => year - 5 + i).map((y) => (
              <SelectItem key={y} value={String(y)}>{y}年</SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select value={month === undefined ? 'all' : String(month)} onValueChange={(v) => setMonth(v === 'all' ? undefined : Number(v))}>
          <SelectTrigger className="w-[100px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">全年</SelectItem>
            {MONTHS.map((m) => (
              <SelectItem key={m} value={String(m)}>{m}月</SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Tabs value={tabView} onValueChange={(v) => setTabView(v as any)}>
          <TabsList>
            <TabsTrigger value="ALL">全部</TabsTrigger>
            <TabsTrigger value="FIXED">固定预算</TabsTrigger>
            <TabsTrigger value="FREE">自由预算</TabsTrigger>
          </TabsList>
        </Tabs>

        <div className="flex-1" />

        <Button variant="outline" size="sm" onClick={() => { setCopySourceYear(year); setCopySourceMonth(month ?? now.getMonth() + 1); setCopyTargets([]); setCopyOpen(true) }}>
          <Copy size={14} className="mr-1" />复制预算
        </Button>
        <Button variant="outline" size="sm" onClick={() => { setBatchName(''); setBatchType('FIXED'); setBatchAmount(''); setBatchCategory(''); setBatchMonths([]); setBatchYear(year); setBatchRemark(''); setBatchOpen(true) }}>
          批量添加
        </Button>
        <Button size="sm" onClick={openCreate}>
          <Plus size={14} className="mr-1" />添加预算
        </Button>
      </div>

      {/* 汇总卡片 */}
      {summaryData.totalBudget > 0 && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <Card>
            <CardContent className="pt-6">
              <div className="text-xs text-muted-foreground mb-1">{month ? `${month}月` : '年度'}总预算</div>
              <div className="text-2xl font-bold tabular-nums">¥{summaryData.totalBudget.toFixed(2)}</div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-6">
              <div className="text-xs text-muted-foreground mb-1">实际支出</div>
              <div className="text-2xl font-bold tabular-nums">¥{summaryData.totalActual.toFixed(2)}</div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-6">
              <div className="text-xs text-muted-foreground mb-1">剩余预算</div>
              <div className={`text-2xl font-bold tabular-nums ${summaryData.totalRemaining < 0 ? 'text-[#ef4444]' : 'text-[#22c55e]'}`}>
                ¥{summaryData.totalRemaining.toFixed(2)}
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-6">
              <div className="text-xs text-muted-foreground mb-1">使用率</div>
              <div className={`text-2xl font-bold tabular-nums ${summaryData.totalUsagePercent > 100 ? 'text-[#ef4444]' : summaryData.totalUsagePercent > 80 ? 'text-[#f97316]' : 'text-[#22c55e]'}`}>
                {summaryData.totalUsagePercent.toFixed(1)}%
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* 加载 */}
      {loading && (
        <div className="flex justify-center py-12">
          <Spinner />
        </div>
      )}

      {/* 错误 */}
      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {/* 预算列表 */}
      {!loading && !error && (
        <div className="space-y-6">
          {tabView !== 'FREE' && (
            <div>
              <h2 className="text-lg font-semibold mb-3 flex items-center gap-2">
                <PiggyBank size={18} />固定预算
              </h2>
              {renderTable(fixedBudgets)}
            </div>
          )}
          {tabView !== 'FIXED' && (
            <div>
              <h2 className="text-lg font-semibold mb-3 flex items-center gap-2">
                <TrendingUp size={18} />自由预算
              </h2>
              {renderTable(freeBudgets)}
            </div>
          )}
        </div>
      )}

      {/* 创建/编辑弹窗 */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editingBudget ? '编辑预算' : '添加预算'}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label>类型</Label>
              <Select value={formType} onValueChange={(v) => setFormType(v as BudgetType)} disabled={!!editingBudget}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="FIXED">固定预算（每月固定支出）</SelectItem>
                  <SelectItem value="FREE">自由预算（临时项目预算）</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>名称</Label>
              <Input value={formName} onChange={(e) => setFormName(e.target.value)} placeholder="如：房租、饮食、三亚旅游" />
            </div>
            <div>
              <Label>金额</Label>
              <Input type="number" value={formAmount} onChange={(e) => setFormAmount(e.target.value)} placeholder="预算金额" />
            </div>
            {formType === 'FIXED' ? (
              <div>
                <Label>关联分类</Label>
                <DictCombobox
                  groups={['transaction_category_expense', 'transaction_category_income']}
                  value={formCategory}
                  onChange={setFormCategory}
                  placeholder="选择收支分类..."
                />
              </div>
            ) : (
              <div>
                <Label>标签（自动生成）</Label>
                <Input
                  value={formName.trim() ? `${formName.trim()}${!editingBudget ? '（将作为标签自动生成）' : ''}` : '（输入名称后自动生成）'}
                  disabled
                  className="text-muted-foreground"
                />
              </div>
            )}
            <div>
              <Label>月份</Label>
              <Select value={String(formMonth)} onValueChange={(v) => setFormMonth(Number(v))} disabled={!!editingBudget}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {MONTHS.map((m) => (
                    <SelectItem key={m} value={String(m)}>{m}月</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>备注（可选）</Label>
              <Input value={formRemark} onChange={(e) => setFormRemark(e.target.value)} placeholder="备注" />
            </div>
            {formError && <p className="text-sm text-[#ef4444]">{formError}</p>}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>取消</Button>
            <Button onClick={handleSave} disabled={formSaving}>
              {formSaving ? <Spinner /> : editingBudget ? '保存' : '创建'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 批量添加弹窗 */}
      <Dialog open={batchOpen} onOpenChange={setBatchOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>批量添加预算</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label>类型</Label>
              <Select value={batchType} onValueChange={(v) => setBatchType(v as BudgetType)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="FIXED">固定预算</SelectItem>
                  <SelectItem value="FREE">自由预算</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>名称</Label>
              <Input value={batchName} onChange={(e) => setBatchName(e.target.value)} placeholder="预算名称" />
            </div>
            <div>
              <Label>金额</Label>
              <Input type="number" value={batchAmount} onChange={(e) => setBatchAmount(e.target.value)} />
            </div>
            {batchType === 'FIXED' && (
              <div>
                <Label>关联分类</Label>
                <DictCombobox
                  groups={['transaction_category_expense', 'transaction_category_income']}
                  value={batchCategory}
                  onChange={setBatchCategory}
                  placeholder="选择分类..."
                />
              </div>
            )}
            <div>
              <Label>年份</Label>
              <Select value={String(batchYear)} onValueChange={(v) => setBatchYear(Number(v))}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Array.from({ length: 5 }, (_, i) => now.getFullYear() - 2 + i).map((y) => (
                    <SelectItem key={y} value={String(y)}>{y}年</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>选择月份（可多选）</Label>
              <div className="grid grid-cols-4 gap-2 mt-2">
                {MONTHS.map((m) => (
                  <button
                    key={m}
                    className={`py-2 px-3 rounded-lg border text-sm transition-colors ${
                      batchMonths.includes(m)
                        ? 'bg-[#3b82f6] text-white border-[#3b82f6]'
                        : 'border-border hover:bg-muted'
                    }`}
                    onClick={() => toggleBatchMonth(m)}
                  >
                    {m}月
                  </button>
                ))}
              </div>
            </div>
            <div>
              <Label>备注（可选）</Label>
              <Input value={batchRemark} onChange={(e) => setBatchRemark(e.target.value)} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setBatchOpen(false)}>取消</Button>
            <Button onClick={handleBatchCreate} disabled={batchSaving || batchMonths.length === 0}>
              {batchSaving ? <Spinner /> : `生成（${batchMonths.length}个月）`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 复制弹窗 */}
      <Dialog open={copyOpen} onOpenChange={setCopyOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>复制预算</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="flex gap-3 items-end">
              <div className="flex-1">
                <Label>源年份</Label>
                <Select value={String(copySourceYear)} onValueChange={(v) => setCopySourceYear(Number(v))}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {Array.from({ length: 5 }, (_, i) => now.getFullYear() - 2 + i).map((y) => (
                      <SelectItem key={y} value={String(y)}>{y}年</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="flex-1">
                <Label>源月份</Label>
                <Select value={String(copySourceMonth)} onValueChange={(v) => setCopySourceMonth(Number(v))}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {MONTHS.map((m) => (
                      <SelectItem key={m} value={String(m)}>{m}月</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div>
              <Label>目标</Label>
              <Select value={String(copyTargetYear)} onValueChange={(v) => setCopyTargetYear(Number(v))}>
                <SelectTrigger className="mb-2">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Array.from({ length: 5 }, (_, i) => now.getFullYear() - 2 + i).map((y) => (
                    <SelectItem key={y} value={String(y)}>{y}年</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <div className="grid grid-cols-4 gap-2 mt-2">
                {MONTHS.map((m) => {
                  const isSelected = copyTargets.some((t) => t.year === copyTargetYear && t.month === m)
                  return (
                    <button
                      key={m}
                      className={`py-2 px-3 rounded-lg border text-sm transition-colors ${
                        isSelected
                          ? 'bg-[#3b82f6] text-white border-[#3b82f6]'
                          : 'border-border hover:bg-muted'
                      }`}
                      onClick={() => toggleCopyTarget(copyTargetYear, m)}
                    >
                      {m}月
                    </button>
                  )
                })}
              </div>
              {copyTargets.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-1">
                  {copyTargets.map((t, i) => (
                    <Badge key={i} variant="outline" className="text-xs">
                      {t.year}/{t.month}月
                      <button className="ml-1" onClick={() => toggleCopyTarget(t.year, t.month)}>
                        <Trash2 size={10} />
                      </button>
                    </Badge>
                  ))}
                </div>
              )}
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCopyOpen(false)}>取消</Button>
            <Button onClick={handleCopy} disabled={copySaving || copyTargets.length === 0}>
              {copySaving ? <Spinner /> : `复制（${copyTargets.length}个目标）`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 删除确认 */}
      <AlertDialog open={deleteTarget !== null} onOpenChange={() => setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>删除预算</AlertDialogTitle>
            <AlertDialogDescription>
              确定要删除预算 &ldquo;{deleteTarget?.name}&rdquo;（{deleteTarget?.year}年{deleteTarget?.month}月）吗？此操作不可撤销。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction className="bg-[#ef4444] hover:bg-[#ef4444]/90" onClick={handleDelete}>
              删除
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

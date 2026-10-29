import { useMemo, useState } from 'react'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Switch } from '@/components/ui/switch'
import {
  Table, TableHeader, TableBody, TableRow, TableHead, TableCell,
} from '@/components/ui/table'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import { MultiSelect } from '@/components/ui/multi-select'
import { EllipsisText } from '@/components/ui/ellipsis-text'
import { DatePicker } from '@/components/ui/date-picker'
import { recordApi, type OffsetGroupDTO, type RecordItem } from '@/api/record'
import type { AccountItem } from '@/api/account'
import { accountLabel, isMultiOwnerAccounts } from '@/lib/account'
import { errorMessage } from '@/lib/error'
import { toast } from 'sonner'

type GroupState = 'pending' | 'confirmed' | 'ignored'

interface OffsetDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  bookId: string
  accounts: AccountItem[]
  categories: { code: string; label: string }[]
  onComplete: () => void
}

const WINDOW_OPTIONS = [
  { value: '30', label: '30 天' },
  { value: '90', label: '90 天' },
  { value: '180', label: '180 天' },
  { value: '365', label: '1 年' },
  { value: '0', label: '不限' },
]

const fmt = (v: number) => v.toFixed(2)
const sumOf = (rows: RecordItem[], ids: Set<string>) =>
  rows.filter((r) => ids.has(r.id)).reduce((s, r) => s + r.amount, 0)

/** 手动模式暂存的一组(左/右勾选后金额相等才可加入) */
interface StagedGroup {
  income: RecordItem[]
  expense: RecordItem[]
  amount: number
}

export function OffsetDialog({ open, onOpenChange, bookId, accounts, categories, onComplete }: OffsetDialogProps) {
  const multiOwner = isMultiOwnerAccounts(accounts)
  const [tab, setTab] = useState<'auto' | 'manual'>('auto')
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  // ---- 自动配对 ----
  const [step, setStep] = useState<'filter' | 'result'>('filter')
  const [windowDays, setWindowDays] = useState('90')
  const [sameAccount, setSameAccount] = useState(false)
  const [sameOwner, setSameOwner] = useState(false)
  /** 备注相似度阈值(0~100,0 = 不启用) */
  const [similarity, setSimilarity] = useState('')
  const [groups, setGroups] = useState<OffsetGroupDTO[]>([])
  const [state, setState] = useState<Record<string, GroupState>>({})
  const [truncated, setTruncated] = useState(false)

  // 范围筛选(自动配对与手动右栏共用日期/金额;账户与分类支持多选)
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [accountIds, setAccountIds] = useState<string[]>([])
  const [categoryCodes, setCategoryCodes] = useState<string[]>([])
  const [amountFrom, setAmountFrom] = useState('')
  const [amountTo, setAmountTo] = useState('')
  const [remark, setRemark] = useState('')

  // ---- 手动配对 ----
  const [leftRows, setLeftRows] = useState<RecordItem[]>([])
  const [leftSel, setLeftSel] = useState<Set<string>>(new Set())
  const [rightRows, setRightRows] = useState<RecordItem[]>([])
  const [rightSel, setRightSel] = useState<Set<string>>(new Set())
  const [staged, setStaged] = useState<StagedGroup[]>([])

  const filterPayload = () => ({
    bookId,
    dateFrom: dateFrom || undefined,
    dateTo: dateTo || undefined,
    // 账户/分类多选:后端按逗号分隔解析
    accountId: accountIds.length ? accountIds.join(',') : undefined,
    categoryCode: categoryCodes.length ? categoryCodes.join(',') : undefined,
    amountFrom: amountFrom ? Number(amountFrom) : undefined,
    amountTo: amountTo ? Number(amountTo) : undefined,
    remark: remark || undefined,
  })

  const runMatch = async () => {
    setLoading(true)
    setError('')
    try {
      const res = await recordApi.offsetPreview({
        ...filterPayload(),
        windowDays: windowDays === '0' ? null : Number(windowDays),
        sameAccount,
        sameOwner,
        minRemarkSimilarity: similarity ? Number(similarity) / 100 : undefined,
      })
      setGroups(res.groups)
      setTruncated(res.truncated)
      setState(Object.fromEntries(res.groups.map((g) => [g.key, 'pending' as GroupState])))
      setStep('result')
    } catch (e) {
      setError(errorMessage(e))
    } finally {
      setLoading(false)
    }
  }

  /** 加载手动配对数据:左右两侧各查一次(右侧可再加筛选) */
  const loadManual = async () => {
    setLoading(true)
    setError('')
    try {
      const [left, right] = await Promise.all([
        recordApi.list({ bookId, page: 1, pageSize: 100 }),
        recordApi.list({ ...filterPayload(), page: 1, pageSize: 100 }),
      ])
      setLeftRows(left.records.filter((r) => r.type === 'INCOME' || r.type === 'EXPENSE'))
      setRightRows(right.records.filter((r) => r.type === 'INCOME' || r.type === 'EXPENSE'))
      setLeftSel(new Set())
      setRightSel(new Set())
    } catch (e) {
      setError(errorMessage(e))
    } finally {
      setLoading(false)
    }
  }

  const leftSum = useMemo(() => sumOf(leftRows, leftSel), [leftRows, leftSel])
  const rightSum = useMemo(() => sumOf(rightRows, rightSel), [rightRows, rightSel])
  const diff = Math.round((leftSum - rightSum) * 100) / 100
  const canStage = leftSel.size > 0 && rightSel.size > 0 && Math.abs(diff) < 0.005

  const stage = () => {
    if (!canStage) return
    const left = leftRows.filter((r) => leftSel.has(r.id))
    const right = rightRows.filter((r) => rightSel.has(r.id))
    // 合并成一组:收入侧/支出侧按类型归位(左右只是操作区,不代表方向)
    const income = [...left, ...right].filter((r) => r.type === 'INCOME')
    const expense = [...left, ...right].filter((r) => r.type === 'EXPENSE')
    setStaged((prev) => [...prev, { income, expense, amount: leftSum }])
    setLeftSel(new Set())
    setRightSel(new Set())
  }

  const confirmedGroups = groups.filter((g) => state[g.key] === 'confirmed')

  /** 结果页状态 tab:全部 / 待处理 / 已平账 / 已忽略 */
  const [statusFilter, setStatusFilter] = useState<'all' | 'pending' | 'confirmed' | 'ignored'>('all')
  const counts = useMemo(() => {
    const c = { pending: 0, confirmed: 0, ignored: 0 }
    for (const g of groups) {
      const s = state[g.key] ?? 'pending'
      if (s === 'confirmed') c.confirmed++
      else if (s === 'ignored') c.ignored++
      else c.pending++
    }
    return c
  }, [groups, state])
  const visibleGroups = groups.filter(
    (g) => statusFilter === 'all' || (state[g.key] ?? 'pending') === statusFilter,
  )

  const save = async () => {
    const ids = new Set<string>()
    for (const g of confirmedGroups) {
      for (const r of [...g.income, ...g.expense]) ids.add(r.id)
    }
    for (const g of staged) {
      for (const r of [...g.income, ...g.expense]) ids.add(r.id)
    }
    if (ids.size === 0) return

    setSaving(true)
    try {
      const res = await recordApi.batchOffset(Array.from(ids), true)
      toast.success(`已平账 ${res.updated} 条`)
      onComplete()
      onOpenChange(false)
    } catch (e) {
      setError(errorMessage(e))
    } finally {
      setSaving(false)
    }
  }

  const accountName = (r: RecordItem) =>
    r.fromAccount ? `${r.fromAccount.name} → ${r.toAccount?.name ?? '?'}` : accountLabel(r.account as never, multiOwner)

  const toggle = (setter: React.Dispatch<React.SetStateAction<Set<string>>>, id: string) => {
    setter((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  /** 单条记录行(手动区左右两栏共用) */
  const rowLine = (r: RecordItem, selected: boolean, onToggle: () => void) => (
    <label key={r.id} className="flex items-center gap-2 text-xs py-1 px-1 rounded hover:bg-muted/40 cursor-pointer">
      <input type="checkbox" checked={selected} onChange={onToggle} />
      <span className={r.type === 'INCOME' ? 'text-emerald-600 tabular-nums' : 'text-red-600 tabular-nums'}>
        {r.type === 'INCOME' ? '+' : '-'}{fmt(r.amount)}
      </span>
      <span className="text-muted-foreground shrink-0">{new Date(r.date).toLocaleDateString('zh-CN')}</span>
      <div className="max-w-[110px] min-w-0"><EllipsisText text={accountName(r)} /></div>
      <div className="min-w-0 flex-1"><EllipsisText text={r.remark || r.payer} /></div>
    </label>
  )

  const totalToSave = confirmedGroups.length + staged.length

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-5xl max-h-[90vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>平账</DialogTitle>
        </DialogHeader>

        <div className="flex gap-2 border-b pb-2">
          <Button size="sm" variant={tab === 'auto' ? 'default' : 'ghost'} onClick={() => setTab('auto')} className="text-xs h-8">
            自动配对
          </Button>
          <Button size="sm" variant={tab === 'manual' ? 'default' : 'ghost'} onClick={() => setTab('manual')} className="text-xs h-8">
            手动配对
          </Button>
        </div>

        {error && <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>}

        <div className="flex-1 overflow-y-auto py-2">
          {/* ================= 自动配对:筛选 ================= */}
          {tab === 'auto' && step === 'filter' && (
            <div className="space-y-4">
              {/* 匹配条件:决定怎么算「可以平账的一组」 */}
              <div className="rounded-lg border">
                <div className="px-3 py-2 border-b bg-muted/50 text-xs font-medium">匹配条件</div>
                <div className="p-3 space-y-3">
                  <div className="grid grid-cols-4 gap-3">
                    <div>
                      <Label className="text-xs text-muted-foreground">时间跨度</Label>
                      <Select value={windowDays} onValueChange={setWindowDays}>
                        <SelectTrigger className="h-8 text-xs mt-1"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {WINDOW_OPTIONS.map((o) => <SelectItem key={o.value} value={o.value} className="text-xs">{o.label}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </div>
                    <div>
                      <Label className="text-xs text-muted-foreground">备注相似度 ≥ (%)</Label>
                      <Input
                        type="number"
                        min={0}
                        max={100}
                        value={similarity}
                        onChange={(e) => setSimilarity(e.target.value)}
                        placeholder="不启用"
                        className="h-8 text-xs mt-1"
                      />
                    </div>
                    <div>
                      <Label className="text-xs text-muted-foreground">账户范围</Label>
                      <label className="flex items-center gap-2 text-xs h-8 mt-1">
                        <Switch checked={sameAccount} onCheckedChange={setSameAccount} />只配同一账户
                      </label>
                    </div>
                    <div>
                      <Label className="text-xs text-muted-foreground">归属人</Label>
                      <label className="flex items-center gap-2 text-xs h-8 mt-1">
                        <Switch checked={sameOwner} onCheckedChange={setSameOwner} />只配同一归属人
                      </label>
                    </div>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    只配「金额相等、一收一支」的记录：优先一笔对一笔，凑不上再一侧拆成多笔（最多 5 笔）。
                  </p>
                </div>
              </div>

              {/* 筛选条件:决定在哪些流水里找 */}
              <div className="rounded-lg border">
                <div className="px-3 py-2 border-b bg-muted/50 text-xs font-medium">筛选条件</div>
                <div className="p-3 grid grid-cols-4 gap-3">
                  <div>
                    <Label className="text-xs text-muted-foreground">账户（多选）</Label>
                    <div className="mt-1">
                      <MultiSelect
                        items={accounts.map((a) => ({ value: a.id, label: accountLabel(a, multiOwner) }))}
                        selected={accountIds}
                        onChange={setAccountIds}
                        placeholder="全部账户"
                      />
                    </div>
                  </div>
                  <div>
                    <Label className="text-xs text-muted-foreground">分类（多选）</Label>
                    <div className="mt-1">
                      <MultiSelect
                        items={categories.map((c) => ({ value: c.code, label: c.label }))}
                        selected={categoryCodes}
                        onChange={setCategoryCodes}
                        placeholder="全部分类"
                      />
                    </div>
                  </div>
                  <div>
                    <Label className="text-xs text-muted-foreground">开始日期</Label>
                    <div className="mt-1"><DatePicker compact value={dateFrom} onChange={setDateFrom} /></div>
                  </div>
                  <div>
                    <Label className="text-xs text-muted-foreground">结束日期</Label>
                    <div className="mt-1"><DatePicker compact value={dateTo} onChange={setDateTo} /></div>
                  </div>
                  <div>
                    <Label className="text-xs text-muted-foreground">金额下限</Label>
                    <Input type="number" value={amountFrom} onChange={(e) => setAmountFrom(e.target.value)} className="h-8 text-xs mt-1" />
                  </div>
                  <div>
                    <Label className="text-xs text-muted-foreground">金额上限</Label>
                    <Input type="number" value={amountTo} onChange={(e) => setAmountTo(e.target.value)} className="h-8 text-xs mt-1" />
                  </div>
                  <div className="col-span-2">
                    <Label className="text-xs text-muted-foreground">备注包含</Label>
                    <Input value={remark} onChange={(e) => setRemark(e.target.value)} placeholder="如：退款" className="h-8 text-xs mt-1" />
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* ================= 自动配对:表格结果 ================= */}
          {tab === 'auto' && step === 'result' && (
            <div className="space-y-3">
              {truncated && (
                <Alert><AlertDescription className="text-xs">结果过多，仅展示前 200 组，请收窄范围。</AlertDescription></Alert>
              )}
              {/* 状态筛选 tab */}
              <div className="flex items-center gap-1.5 flex-wrap">
                {([
                  { key: 'all' as const, label: '全部', count: groups.length },
                  { key: 'pending' as const, label: '待处理', count: counts.pending },
                  { key: 'confirmed' as const, label: '平账', count: counts.confirmed },
                  { key: 'ignored' as const, label: '忽略', count: counts.ignored },
                ]).map((t) => (
                  <Button
                    key={t.key}
                    size="sm"
                    variant={statusFilter === t.key ? 'default' : 'outline'}
                    className="h-7 text-xs"
                    onClick={() => setStatusFilter(t.key)}
                  >
                    {t.label} ({t.count})
                  </Button>
                ))}
              </div>

              <div className="space-y-4">
                {visibleGroups.length === 0 && (
                  <div className="py-8 text-center text-xs text-muted-foreground">
                    {statusFilter === 'ignored' ? '没有已忽略的组' : '没有找到可配对的收支记录'}
                  </div>
                )}
                {visibleGroups.map((g, gi) => {
                  const current = state[g.key] ?? 'pending'
                  const confirmed = current === 'confirmed'
                  const ignored = current === 'ignored'
                  // 组内按「收入在前、支出在后」排列,每条流水一行
                  const list = [
                    ...g.income.map((r) => ({ r, dir: 'INCOME' as const })),
                    ...g.expense.map((r) => ({ r, dir: 'EXPENSE' as const })),
                  ]
                  return (
                    <div key={g.key} className="border rounded-lg overflow-hidden">
                      {/* 组头 */}
                      <div className="flex items-center gap-2 px-3 py-2 bg-muted/50 border-b">
                        <span className="text-xs text-muted-foreground">#{gi + 1}</span>
                        <span className="text-sm font-semibold tabular-nums">¥{fmt(g.amount)}</span>
                        <span className="text-xs text-muted-foreground">
                          {g.income.length} 收 / {g.expense.length} 支
                        </span>
                        {g.spanDays > 0 && (
                          <Badge variant="outline" className="text-[10px] py-0 px-1.5">跨 {g.spanDays} 天</Badge>
                        )}
                        {confirmed && <Badge className="text-[10px] ml-auto">已确认</Badge>}
                      </div>

                      {/* 组内流水 */}
                      <div className="overflow-x-auto">
                        <Table>
                          <TableHeader>
                            <TableRow className="hover:bg-transparent">
                              <TableHead className="text-xs py-1.5 w-[100px]">日期</TableHead>
                              <TableHead className="text-xs py-1.5 w-[60px]">类型</TableHead>
                              <TableHead className="text-xs py-1.5">账户</TableHead>
                              <TableHead className="text-xs py-1.5">交易方</TableHead>
                              <TableHead className="text-xs py-1.5 w-[100px]">金额</TableHead>
                              <TableHead className="text-xs py-1.5">分类</TableHead>
                              <TableHead className="text-xs py-1.5">备注</TableHead>
                              <TableHead className="text-xs py-1.5">标签</TableHead>
                              <TableHead className="text-xs py-1.5">归属人</TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {list.map(({ r, dir }) => (
                              <TableRow key={r.id} className={confirmed ? 'bg-primary/5' : ''}>
                                <TableCell className="text-xs py-1.5 whitespace-nowrap text-muted-foreground">
                                  {new Date(r.date).toLocaleDateString('zh-CN')}
                                </TableCell>
                                <TableCell className={`text-xs py-1.5 ${dir === 'INCOME' ? 'text-emerald-600' : 'text-red-600'}`}>
                                  {dir === 'INCOME' ? '收入' : '支出'}
                                </TableCell>
                                <TableCell className="text-xs py-1.5">
                                  <div className="max-w-[160px]"><EllipsisText text={accountName(r)} /></div>
                                </TableCell>
                                <TableCell className="text-xs py-1.5">
                                  <div className="max-w-[140px]"><EllipsisText text={r.payer} /></div>
                                </TableCell>
                                <TableCell className={`text-xs py-1.5 font-mono ${dir === 'INCOME' ? 'text-emerald-600' : 'text-red-600'}`}>
                                  {dir === 'INCOME' ? '+' : '-'}{fmt(r.amount)}
                                </TableCell>
                                <TableCell className="text-xs py-1.5">
                                  <div className="max-w-[110px]"><EllipsisText text={r.categoryCode} /></div>
                                </TableCell>
                                <TableCell className="text-xs py-1.5">
                                  <div className="max-w-[200px]"><EllipsisText text={r.remark} /></div>
                                </TableCell>
                                <TableCell className="text-xs py-1.5">
                                  <div className="max-w-[130px]"><EllipsisText text={r.tags?.join(' / ')} /></div>
                                </TableCell>
                                <TableCell className="text-xs py-1.5">
                                  <div className="max-w-[90px]"><EllipsisText text={r.ownerName} /></div>
                                </TableCell>
                              </TableRow>
                            ))}
                          </TableBody>
                        </Table>
                      </div>

                      {/* 组底操作区 */}
                      <div className="border-t bg-muted/40 px-3 py-2 flex items-center gap-2">
                        <span className="text-[11px] text-muted-foreground">
                          {ignored
                            ? '已忽略:本组不会保存,可点「恢复」重新处理'
                            : confirmed
                              ? '已确认:保存后这些记录不再计入收支统计'
                              : `确认后这 ${list.length} 条记录都不再计入收支统计`}
                        </span>
                        <div className="ml-auto flex gap-1.5">
                          {ignored ? (
                            <Button
                              size="sm"
                              variant="outline"
                              className="h-7 text-xs"
                              onClick={() => setState((p) => ({ ...p, [g.key]: 'pending' }))}
                            >
                              恢复
                            </Button>
                          ) : (
                            <>
                              <Button
                                size="sm"
                                variant={confirmed ? 'default' : 'outline'}
                                className="h-7 text-xs"
                                onClick={() => setState((p) => ({ ...p, [g.key]: confirmed ? 'pending' : 'confirmed' }))}
                              >
                                {confirmed ? '取消确认' : '确认平账'}
                              </Button>
                              <Button
                                size="sm"
                                variant="ghost"
                                className="h-7 text-xs text-muted-foreground"
                                onClick={() => setState((p) => ({ ...p, [g.key]: 'ignored' }))}
                              >
                                忽略
                              </Button>
                            </>
                          )}
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          )}

          {/* ================= 手动配对:左选右筛 ================= */}
          {tab === 'manual' && (
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <Button size="sm" variant="outline" className="h-8 text-xs" onClick={loadManual} disabled={loading}>
                  {leftRows.length === 0 ? '加载未平账记录' : '重新查询'}
                </Button>
                <span className="text-xs text-muted-foreground">左侧选要平账的记录，右侧筛选同一笔的对应记录</span>
              </div>

              <div className="grid grid-cols-2 gap-3">
                {/* 左栏 */}
                <div className="rounded-lg border">
                  <div className="px-2 py-1.5 border-b text-xs font-medium flex items-center">
                    待平账记录
                    <span className="ml-auto text-muted-foreground">已选 {leftSel.size} 笔 · {fmt(leftSum)}</span>
                  </div>
                  <div className="max-h-[260px] overflow-y-auto p-1.5">
                    {leftRows.length === 0
                      ? <p className="text-xs text-muted-foreground text-center py-6">先点上方按钮加载</p>
                      : leftRows.map((r) => rowLine(r, leftSel.has(r.id), () => toggle(setLeftSel, r.id)))}
                  </div>
                </div>

                {/* 右栏 */}
                <div className="rounded-lg border">
                  <div className="px-2 py-1.5 border-b text-xs font-medium flex items-center gap-2">
                    对应记录（可筛选）
                    <span className="ml-auto text-muted-foreground">已选 {rightSel.size} 笔 · {fmt(rightSum)}</span>
                  </div>
                  <div className="px-2 py-1.5 border-b flex flex-wrap gap-1.5">
                    <div className="w-[132px]"><DatePicker compact value={dateFrom} onChange={setDateFrom} /></div>
                    <div className="w-[132px]"><DatePicker compact value={dateTo} onChange={setDateTo} /></div>
                    <Input type="number" value={amountFrom} onChange={(e) => setAmountFrom(e.target.value)} placeholder="金额≥" className="h-7 text-xs w-[80px]" />
                    <Input type="number" value={amountTo} onChange={(e) => setAmountTo(e.target.value)} placeholder="金额≤" className="h-7 text-xs w-[80px]" />
                    <Button size="sm" variant="outline" className="h-7 text-xs" onClick={loadManual} disabled={loading}>筛选</Button>
                  </div>
                  <div className="max-h-[220px] overflow-y-auto p-1.5">
                    {rightRows.length === 0
                      ? <p className="text-xs text-muted-foreground text-center py-6">无匹配记录</p>
                      : rightRows.map((r) => rowLine(r, rightSel.has(r.id), () => toggle(setRightSel, r.id)))}
                  </div>
                </div>
              </div>

              {/* 差额 + 暂存 */}
              <div className="flex items-center gap-3 rounded-md border px-3 py-2 text-xs">
                <span>左 {fmt(leftSum)}</span>
                <span className="text-muted-foreground">−</span>
                <span>右 {fmt(rightSum)}</span>
                <span className="text-muted-foreground">=</span>
                <span className={Math.abs(diff) < 0.005 ? 'text-emerald-600 font-semibold' : 'text-amber-600 font-semibold'}>
                  差额 {fmt(diff)}
                </span>
                {!canStage && <span className="text-muted-foreground">（两侧金额需相等才能加入）</span>}
                <Button size="sm" className="ml-auto h-7 text-xs" onClick={stage} disabled={!canStage}>
                  加入确认列表
                </Button>
              </div>

              {/* 暂存列表 */}
              <div className="rounded-lg border">
                <div className="px-2 py-1.5 border-b text-xs font-medium">确认列表（{staged.length} 组，保存前可移除）</div>
                <div className="p-1.5 space-y-1">
                  {staged.length === 0
                    ? <p className="text-xs text-muted-foreground text-center py-4">还没有暂存的组</p>
                    : staged.map((g, i) => (
                      <div key={`${g.amount}-${i}`} className="flex items-center gap-2 text-xs">
                        <Badge className="text-xs">¥{fmt(g.amount)}</Badge>
                        <span className="text-muted-foreground">{g.income.length} 收 / {g.expense.length} 支</span>
                        <span className="truncate">
                          {[...g.income, ...g.expense].map((r) => (r.remark || r.payer || '').slice(0, 12)).join(' / ')}
                        </span>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="ml-auto h-6 text-xs text-muted-foreground"
                          onClick={() => setStaged((prev) => prev.filter((_, idx) => idx !== i))}
                        >
                          移除
                        </Button>
                      </div>
                    ))}
                </div>
              </div>
            </div>
          )}
        </div>

        <DialogFooter className="gap-2">
          {tab === 'auto' && step === 'result' && (
            <Button
              variant="outline"
              size="sm"
              className="text-xs mr-auto"
              onClick={() => setStep('filter')}
            >
              返回筛选
            </Button>
          )}
          <Button variant="ghost" size="sm" className="text-xs" onClick={() => onOpenChange(false)}>关闭</Button>
          {tab === 'auto' && step === 'filter' ? (
            <Button size="sm" className="text-xs" onClick={runMatch} disabled={loading}>
              {loading ? '匹配中…' : '开始匹配'}
            </Button>
          ) : (
            <Button size="sm" className="text-xs" onClick={save} disabled={saving || totalToSave === 0}>
              {saving ? '保存中…' : `保存 ${totalToSave} 组`}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

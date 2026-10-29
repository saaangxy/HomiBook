import { useMemo, useState } from 'react'
import { ChevronDown, ChevronRight } from 'lucide-react'
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

/**
 * 平账组卡片:自动配对与手动配对共用。
 * 一处改动两处生效,避免两个 Tab 的展示样式漂移。
 */
function OffsetGroupCard({
  group,
  index,
  confirmed,
  note,
  actions,
  accountName,
}: {
  group: OffsetGroupDTO
  index: number
  confirmed?: boolean
  note: string
  actions: React.ReactNode
  accountName: (r: RecordItem) => string
}) {
  const list = [
    ...group.income.map((r) => ({ r, dir: 'INCOME' as const })),
    ...group.expense.map((r) => ({ r, dir: 'EXPENSE' as const })),
  ]

  return (
    <div className="border rounded-lg overflow-hidden">
      {/* 组头 */}
      <div className="flex items-center gap-2 px-3 py-2 bg-muted/50 border-b">
        <span className="text-xs text-muted-foreground">#{index + 1}</span>
        <span className="text-sm font-semibold tabular-nums">¥{fmt(group.amount)}</span>
        <span className="text-xs text-muted-foreground">
          {group.income.length} 收 / {group.expense.length} 支
        </span>
        {group.spanDays > 0 && (
          <Badge variant="outline" className="text-[10px] py-0 px-1.5">跨 {group.spanDays} 天</Badge>
        )}
        {confirmed && <Badge className="text-[10px] ml-auto">已确认</Badge>}
      </div>

      {/* 组内流水:每条一行、每字段一列 */}
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
        <span className="text-[11px] text-muted-foreground">{note}</span>
        <div className="ml-auto flex gap-1.5">{actions}</div>
      </div>
    </div>
  )
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

  // ---- 手动配对:先筛选查询 → 选一条锚点 → 候选组 → 待保存 ----
  const [leftRows, setLeftRows] = useState<RecordItem[]>([])
  /** 是否已经点过「查询」:未查询时左侧为空,不再默认拉全量 */
  const [queryDone, setQueryDone] = useState(false)
  /** 手动页两个条件区的折叠状态 */
  const [scopeOpen, setScopeOpen] = useState(true)
  const [matchOpen, setMatchOpen] = useState(true)
  const [anchorId, setAnchorId] = useState<string | null>(null)
  const [anchorGroups, setAnchorGroups] = useState<OffsetGroupDTO[]>([])
  const [anchorTruncated, setAnchorTruncated] = useState(false)
  const [anchorLoading, setAnchorLoading] = useState(false)
  /** 待保存的组:保存时与自动配对的「已确认」组合并提交 */
  const [staged, setStaged] = useState<OffsetGroupDTO[]>([])

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

  /** 按筛选条件查询左侧待平账列表(必须先查询,不再默认拉全量) */
  const queryLeft = async () => {
    setLoading(true)
    setError('')
    try {
      const res = await recordApi.list({ ...filterPayload(), page: 1, pageSize: 100 })
      setLeftRows(res.records.filter((r) => r.type === 'INCOME' || r.type === 'EXPENSE'))
      setQueryDone(true)
      setAnchorId(null)
      setAnchorGroups([])
      setAnchorTruncated(false)
    } catch (e) {
      setError(errorMessage(e))
    } finally {
      setLoading(false)
    }
  }

  /** 选中一条锚点 → 拉取所有能配平的候选组 */
  const pickAnchor = async (record: RecordItem) => {
    setAnchorId(record.id)
    setAnchorGroups([])
    setAnchorTruncated(false)
    setAnchorLoading(true)
    setError('')
    try {
      const res = await recordApi.offsetAnchorGroups({
        bookId,
        anchorId: record.id,
        windowDays: windowDays === '0' ? null : Number(windowDays),
        sameAccount,
        sameOwner,
        minRemarkSimilarity: similarity ? Number(similarity) / 100 : undefined,
      })
      setAnchorGroups(res.groups)
      setAnchorTruncated(res.truncated)
    } catch (e) {
      setError(errorMessage(e))
    } finally {
      setAnchorLoading(false)
    }
  }

  /** 已被待保存组占用的记录:左侧列表不再显示 */
  const usedIds = useMemo(
    () => new Set(staged.flatMap((g) => [...g.income, ...g.expense].map((r) => r.id))),
    [staged],
  )
  const leftVisible = leftRows.filter((r) => !usedIds.has(r.id))

  const addStaged = (group: OffsetGroupDTO) => {
    setStaged((prev) => (prev.some((g) => g.key === group.key) ? prev : [...prev, group]))
    setAnchorId(null)
    setAnchorGroups([])
    setAnchorTruncated(false)
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

  const totalToSave = confirmedGroups.length + staged.length

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[90vw] max-w-[1600px] max-h-[90vh] flex flex-col">
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
                  const count = g.income.length + g.expense.length
                  return (
                    <OffsetGroupCard
                      key={g.key}
                      group={g}
                      index={gi}
                      confirmed={confirmed}
                      accountName={accountName}
                      note={
                        ignored
                          ? '已忽略:本组不会保存,可点「恢复」重新处理'
                          : confirmed
                            ? '已确认:保存后这些记录不再计入收支统计'
                            : `确认后这 ${count} 条记录都不再计入收支统计`
                      }
                      actions={
                        ignored ? (
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
                        )
                      }
                    />
                  )
                })}
              </div>
            </div>
          )}

          {/* ================= 手动配对:先筛选查询 → 选锚点 → 候选组 → 待保存 ================= */}
          {tab === 'manual' && (
            <div className="space-y-3">
              {/* 筛选条件:决定左侧待平账列表包含哪些记录(可折叠) */}
              <div className="rounded-lg border">
                <button
                  type="button"
                  onClick={() => setScopeOpen((v) => !v)}
                  className="w-full flex items-center gap-1.5 px-3 py-2 text-left"
                >
                  {scopeOpen ? <ChevronDown size={14} className="text-muted-foreground" /> : <ChevronRight size={14} className="text-muted-foreground" />}
                  <span className="text-xs font-medium">筛选条件</span>
                </button>
                {scopeOpen && (
                <div className="border-t p-3 grid grid-cols-4 gap-3">
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
                    <div className="flex gap-2 mt-1">
                      <Input value={remark} onChange={(e) => setRemark(e.target.value)} placeholder="如：退款" className="h-8 text-xs" />
                      <Button size="sm" className="h-8 text-xs shrink-0" onClick={queryLeft} disabled={loading}>
                        {loading ? '查询中…' : '查询'}
                      </Button>
                    </div>
                  </div>
                </div>
                )}
              </div>

              {/* 匹配条件:决定候选组怎么算(可折叠,与自动配对共用同一套 state) */}
              <div className="rounded-lg border">
                <button
                  type="button"
                  onClick={() => setMatchOpen((v) => !v)}
                  className="w-full flex items-center gap-1.5 px-3 py-2 text-left"
                >
                  {matchOpen ? <ChevronDown size={14} className="text-muted-foreground" /> : <ChevronRight size={14} className="text-muted-foreground" />}
                  <span className="text-xs font-medium">匹配条件</span>
                  <span className="ml-auto text-xs text-muted-foreground">
                    {windowDays === '0' ? '时间不限' : `时间跨度 ${windowDays} 天`}
                    {similarity ? ` · 相似度 ≥ ${similarity}%` : ''}
                    {sameAccount ? ' · 同账户' : ''}
                    {sameOwner ? ' · 同归属人' : ''}
                  </span>
                </button>
                {matchOpen && (
                  <div className="border-t p-3 space-y-3">
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
                      候选组按此条件生成：对侧笔数最多 5 笔，金额之和需与锚点相等。
                    </p>
                  </div>
                )}
              </div>

              {!queryDone ? (
                <div className="py-10 text-center text-xs text-muted-foreground">
                  先设置筛选条件，点「查询」加载待平账记录
                </div>
              ) : (
                // 右栏(候选组)列更多,给它多一点宽度
                <div className="grid grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)] gap-3">
                  {/* 左:待平账记录(单选锚点) */}
                  <div className="rounded-lg border flex flex-col">
                    <div className="px-2 py-1.5 border-b text-xs font-medium flex items-center">
                      待平账记录（{leftVisible.length}）
                      <span className="ml-auto font-normal text-muted-foreground">点选一条作为锚点</span>
                    </div>
                    <div className="max-h-[320px] overflow-y-auto">
                      {leftVisible.length === 0 ? (
                        <p className="text-xs text-muted-foreground text-center py-6">没有可用记录</p>
                      ) : (
                        <Table>
                          <TableHeader>
                            <TableRow className="hover:bg-transparent">
                              <TableHead className="text-xs py-1.5 w-[92px]">日期</TableHead>
                              <TableHead className="text-xs py-1.5 w-[58px]">类型</TableHead>
                              <TableHead className="text-xs py-1.5">账户</TableHead>
                              <TableHead className="text-xs py-1.5">交易方</TableHead>
                              <TableHead className="text-xs py-1.5 w-[92px]">金额</TableHead>
                              <TableHead className="text-xs py-1.5">备注</TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {leftVisible.map((r) => (
                              <TableRow
                                key={r.id}
                                onClick={() => pickAnchor(r)}
                                className={`cursor-pointer ${anchorId === r.id ? 'bg-primary/10' : ''}`}
                              >
                                <TableCell className="text-xs py-1.5 whitespace-nowrap text-muted-foreground">
                                  {new Date(r.date).toLocaleDateString('zh-CN')}
                                </TableCell>
                                <TableCell className={`text-xs py-1.5 ${r.type === 'INCOME' ? 'text-emerald-600' : 'text-red-600'}`}>
                                  {r.type === 'INCOME' ? '收入' : '支出'}
                                </TableCell>
                                <TableCell className="text-xs py-1.5">
                                  <div className="max-w-[110px]"><EllipsisText text={accountName(r)} /></div>
                                </TableCell>
                                <TableCell className="text-xs py-1.5">
                                  <div className="max-w-[100px]"><EllipsisText text={r.payer} /></div>
                                </TableCell>
                                <TableCell className={`text-xs py-1.5 font-mono ${r.type === 'INCOME' ? 'text-emerald-600' : 'text-red-600'}`}>
                                  {r.type === 'INCOME' ? '+' : '-'}{fmt(r.amount)}
                                </TableCell>
                                <TableCell className="text-xs py-1.5">
                                  <div className="max-w-[150px]"><EllipsisText text={r.remark} /></div>
                                </TableCell>
                              </TableRow>
                            ))}
                          </TableBody>
                        </Table>
                      )}
                    </div>
                  </div>

                  {/* 右:候选组 */}
                  <div className="rounded-lg border flex flex-col">
                    <div className="px-2 py-1.5 border-b text-xs font-medium">
                      候选组{anchorId ? `（${anchorGroups.length}）` : ''}
                    </div>
                    <div className="max-h-[280px] overflow-y-auto p-1.5 space-y-2">
                      {!anchorId ? (
                        <p className="text-xs text-muted-foreground text-center py-6">左侧选一条记录</p>
                      ) : anchorLoading ? (
                        <p className="text-xs text-muted-foreground text-center py-6">生成候选组…</p>
                      ) : anchorGroups.length === 0 ? (
                        <p className="text-xs text-muted-foreground text-center py-6">没有能配平的组合，可调整匹配条件</p>
                      ) : anchorGroups.map((g, gi) => (
                        <OffsetGroupCard
                          key={g.key}
                          group={g}
                          index={gi}
                          accountName={accountName}
                          note="锚点已在组内"
                          actions={
                            <Button size="sm" className="h-7 text-xs" onClick={() => addStaged(g)}>
                              加入待保存
                            </Button>
                          }
                        />
                      ))}
                      {anchorTruncated && (
                        <p className="text-[10px] text-amber-600">候选组过多，仅显示前 20 组，请收窄时间跨度或相似度</p>
                      )}
                    </div>
                  </div>
                </div>
              )}

              {/* 待保存:与自动配对同款卡片 */}
              <div className="rounded-lg border">
                <div className="px-3 py-2 border-b bg-muted/50 text-xs font-medium">
                  待保存（{staged.length} 组，保存前可移除）
                </div>
                <div className="p-2 space-y-3">
                  {staged.length === 0 ? (
                    <p className="text-xs text-muted-foreground text-center py-4">还没有加入待保存的组</p>
                  ) : staged.map((g, gi) => (
                    <OffsetGroupCard
                      key={g.key}
                      group={g}
                      index={gi}
                      accountName={accountName}
                      note="待保存:点底部「保存 N 组」后提交"
                      actions={
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-7 text-xs"
                          onClick={() => setStaged((prev) => prev.filter((x) => x.key !== g.key))}
                        >
                          移除
                        </Button>
                      }
                    />
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

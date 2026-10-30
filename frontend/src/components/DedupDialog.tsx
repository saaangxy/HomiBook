import { useEffect, useMemo, useState } from 'react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { EllipsisText } from '@/components/ui/ellipsis-text'
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
import { Badge } from '@/components/ui/badge'
import { Spinner } from '@/components/ui/spinner'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Switch } from '@/components/ui/switch'
import { DatePicker } from '@/components/ui/date-picker'
import { recordApi, type RecordItem } from '@/api/record'
import { accountApi, type AccountItem } from '@/api/account'
import { accountLabel, isMultiOwnerAccounts } from '@/lib/account'
import {
  DEDUP_EMPTY_LABEL,
  DEDUP_SCOPE_DEFAULT,
  DEFAULT_DEDUP_MATCH_FIELDS,
  DEDUP_TOGGLE_FIELDS,
  RECORD_TYPES,
  hasDedupScopeFilter,
  parseDuplicateGroupKey,
  planDuplicateMerge,
  summarizeDedupScopeFilter,
  type DedupMatchFields,
  type DedupScopeFilter,
  type DuplicateMergeChoice,
  type DuplicateMergeConflict,
  type DuplicateMergeConflictField,
  type DuplicateMergePlan,
  type DuplicateMergeRecord,
} from '@homibook/core'
import { RECORD_TYPE_LABELS, RECORD_TYPE_TEXT_CLASS } from '@/lib/record-type'
import { errorMessage } from '@/lib/error'
import { CopyMinus, Check, ChevronDown, ChevronRight } from 'lucide-react'
import dayjs from 'dayjs'

interface DedupDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  bookId: string
  onComplete: () => void
}

type GroupStatus = 'pending' | 'confirmed' | 'ignored'

interface DuplicateGroup {
  key: string
  count: number
  records: RecordItem[]
}

const TYPE_LABELS = RECORD_TYPE_LABELS
const TYPE_COLORS = RECORD_TYPE_TEXT_CLASS

/** 日期精度文案:下拉与「匹配条件」折叠摘要共用,避免两处漂移(从严格到宽松:精确到秒常因两条记录差几秒漏判,同日又太宽,同分钟居中) */
const DATE_PRECISION_LABELS = {
  exact: '时间: 精确',
  minute: '时间: 同分钟',
  date: '时间: 同日',
  ignore: '时间: 忽略',
} as const

function parseGroupKey(key: string, fields: DedupMatchFields, accountDisplay: Map<string, string>, ownerNames: Map<string, string>): string[] {
  return parseDuplicateGroupKey(key, fields, {
    accountDisplay,
    ownerNames,
    formatDateTime: (iso) => dayjs(iso).format('YYYY-MM-DD HH:mm:ss'),
  })
}

/** 冲突选择里「不填」的哨兵值(Select 的 value 必须是字符串) */
const EMPTY_CHIP = '__empty__'

/** 金额区间用**文本**保存(直接存 number 会吞掉「1.」这类中间输入,小数点打不出来);空/非法 → null */
function parseAmountText(text: string): number | null {
  const t = text.trim()
  if (!t) return null
  const n = Number(t)
  return Number.isFinite(n) ? n : null
}

/** 流水 → core 的合并入参 */
function toMergeRecord(r: RecordItem): DuplicateMergeRecord {
  return {
    id: r.id,
    accountId: r.accountId,
    fromAccountId: r.fromAccountId ?? null,
    toAccountId: r.toAccountId ?? null,
    categoryCode: r.categoryCode ?? null,
    payer: r.payer ?? null,
    remark: r.remark ?? null,
    tags: r.tags ?? [],
    attachments: r.attachments ?? [],
    type: r.type,
  }
}

export function DedupDialog({ open, onOpenChange, bookId, onComplete }: DedupDialogProps) {
  const [matchFields, setMatchFields] = useState<DedupMatchFields>(DEFAULT_DEDUP_MATCH_FIELDS)
  /** 备注相似度阈值(0~100,空 = 不启用):启用后组内与首条差异过大的记录会被剔出该组 */
  const [remarkSimilarity, setRemarkSimilarity] = useState('')
  // 匹配条件默认展开;点「检测重复」后自动收起(给结果让位)
  const [matchOpen, setMatchOpen] = useState(true)

  // 检测**范围**筛选:与匹配条件独立 —— 先按范围缩小参与检测的流水,再按匹配字段分组
  const [filters, setFilters] = useState<DedupScopeFilter>(DEDUP_SCOPE_DEFAULT)
  // 筛选区默认展开(与匹配条件一致);点「检测重复」后自动收起
  const [scopeOpen, setScopeOpen] = useState(true)
  // 金额区间用文本保存,避免吞掉「1.」这类中间输入
  const [amountMinText, setAmountMinText] = useState('')
  const [amountMaxText, setAmountMaxText] = useState('')

  const [groups, setGroups] = useState<DuplicateGroup[]>([])
  const [, setTotalDuplicates] = useState(0)
  const [detected, setDetected] = useState(false)
  const [detecting, setDetecting] = useState(false)
  const [error, setError] = useState('')

  // 选中要处理的记录 ID(两种模式语义一致:勾选 = 该记录会被处理,切模式不动勾选)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())

  /** 组级状态(与平账弹窗一致):确认即按当前勾选锁定整组,取消确认后才能改 */
  const [groupStates, setGroupStates] = useState<Record<string, GroupStatus>>({})
  /** 状态 tab 筛选 */
  const [statusFilter, setStatusFilter] = useState<'all' | GroupStatus>('all')

  // 处理方式(合并 / 删除)
  const [mode, setMode] = useState<'merge' | 'delete'>('merge')
  // 每组合并结果的编辑(keepId → 冲突选择 / 文本覆盖)
  const [choices, setChoices] = useState<Record<string, DuplicateMergeChoice>>({})
  // 合并与删除共用的「执行中」标记
  const [running, setRunning] = useState(false)

  // 账户列表(用于组头标签显示"账户名 · 归属人")
  const [accounts, setAccounts] = useState<AccountItem[]>([])
  useEffect(() => {
    if (open && bookId) {
      accountApi.list(bookId).then(setAccounts).catch(() => {})
    }
  }, [open, bookId])
  const multiOwner = isMultiOwnerAccounts(accounts)
  const accountDisplay = new Map(accounts.map((a) => [a.id, accountLabel(a, multiOwner)]))

  const toggleField = (key: keyof DedupMatchFields) => {
    if (key === 'date') return // 日期用 dropdown
    setMatchFields(prev => ({ ...prev, [key]: !prev[key] }))
  }

  // 实际提交的范围筛选(金额从文本解析);归一化(日期取到日、金额换序)由 core 负责
  const scope = useMemo<DedupScopeFilter>(() => ({
    ...filters,
    amountMin: parseAmountText(amountMinText),
    amountMax: parseAmountText(amountMaxText),
  }), [filters, amountMinText, amountMaxText])
  const scopeSummary = summarizeDedupScopeFilter(scope)
  const clearScope = () => {
    setFilters(DEDUP_SCOPE_DEFAULT)
    setAmountMinText('')
    setAmountMaxText('')
  }

  const handleDetect = async () => {
    setDetecting(true)
    setError('')
    setDetected(false)
    setGroups([])
    setSelectedIds(new Set())
    setMatchOpen(false)
    setScopeOpen(false)
    try {
      const result = await recordApi.detectDuplicates(
        bookId,
        matchFields,
        hasDedupScopeFilter(scope) ? scope : undefined,
        remarkSimilarity ? Number(remarkSimilarity) / 100 : undefined,
      )
      setGroups(result.groups)
      // 每次检测后所有组回到待处理
      setGroupStates(Object.fromEntries(result.groups.map((g) => [g.key, 'pending' as GroupStatus])))
      setStatusFilter('all')
      setTotalDuplicates(result.totalDuplicates)
      setDetected(true)

      // 默认选择：每组保留最早的（第一条），勾选其余
      const toDelete = new Set<string>()
      for (const g of result.groups) {
        for (let i = 1; i < g.records.length; i++) {
          toDelete.add(g.records[i].id)
        }
      }
      setSelectedIds(toDelete)
    } catch (e) {
      setError(errorMessage(e, '检测失败'))
    } finally {
      setDetecting(false)
    }
  }

  const toggleRecord = (id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const toggleGroup = (group: DuplicateGroup) => {
    setSelectedIds(prev => {
      const next = new Set(prev)
      const groupIds = group.records.map(r => r.id)
      const allSelected = groupIds.every(id => next.has(id))
      if (allSelected) {
        for (const id of groupIds) next.delete(id)
      } else {
        for (const id of groupIds) next.add(id)
      }
      return next
    })
  }

  const doDelete = async () => {
    // 只提交「已确认」组里被勾选的记录;待处理/忽略组一律不提交
    const ids = confirmedGroups.flatMap((g) =>
      g.records.filter((r) => selectedIds.has(r.id)).map((r) => r.id),
    )
    if (ids.length === 0) return

    setRunning(true)
    setError('')
    try {
      await recordApi.batchDelete(ids)
      onOpenChange(false)
      onComplete()
    } catch (e) {
      setError(errorMessage(e, '删除失败'))
    } finally {
      setRunning(false)
    }
  }

  // ── 合并预演 ──
  // 处理单位:每组「第 1 条 + 该组被勾选的其余记录」(第 1 条永远是保留记录,不参与被并入)。
  // 结果面板与提交走后端的是同一个 core 函数 → 所见即所做。
  const mergePlans = useMemo(() => {
    const out: { group: DuplicateGroup; plan: DuplicateMergePlan }[] = []
    for (const g of groups) {
      const keep = g.records[0]
      const picked = g.records.slice(1).filter((r) => selectedIds.has(r.id))
      if (picked.length === 0) continue
      out.push({
        group: g,
        plan: planDuplicateMerge([toMergeRecord(keep), ...picked.map(toMergeRecord)], choices[keep.id]),
      })
    }
    return out
  }, [groups, selectedIds, choices])

  const planOf = (group: DuplicateGroup) => mergePlans.find((p) => p.group === group)?.plan
  const blockedCount = mergePlans.filter((p) => p.plan.blocked).length

  /** 该组是否可确认:合并模式下须有勾选成员且未被阻断;删除模式只要有勾选 */
  const groupReady = (g: DuplicateGroup): boolean => {
    if (mode === 'merge') {
      const picked = g.records.slice(1).filter((r) => selectedIds.has(r.id))
      return picked.length > 0 && !planOf(g)?.blocked
    }
    return g.records.some((r) => selectedIds.has(r.id))
  }
  // 分组筛选(全部 / 无冲突 / 有冲突):**按整组判定,与勾选无关** ——
  // 勾选决定「处理哪些」,筛选决定「先看哪些」,所以用全组记录算一次,而不是用当前勾选算。
  // 「有冲突」= 账户/分类组内不一致(要选一个)或方向不一致(根本不能合),即"需要人工处理的组"。
  const [groupFilter, setGroupFilter] = useState<'all' | 'clean' | 'conflict'>('all')
  const groupInfo = useMemo(() => {
    const map = new Map<DuplicateGroup, { dirty: boolean }>()
    for (const g of groups) {
      const plan = planDuplicateMerge(g.records.map(toMergeRecord))
      map.set(g, { dirty: plan.conflicts.length > 0 || !!plan.blocked })
    }
    return map
  }, [groups])
  // 组级状态:全部 / 待处理 / 已确认 / 忽略(数量随时反映当前检测结果)
  const statusCounts = useMemo(() => {
    const c = { pending: 0, confirmed: 0, ignored: 0 }
    for (const g of groups) {
      const s = groupStates[g.key] ?? 'pending'
      if (s === 'confirmed') c.confirmed++
      else if (s === 'ignored') c.ignored++
      else c.pending++
    }
    return c
  }, [groups, groupStates])
  const confirmedGroups = groups.filter((g) => groupStates[g.key] === 'confirmed')
  /** 一级状态筛完的组:二级冲突计数据此计算(而不是全局) */
  const statusScoped = groups.filter(
    (g) => statusFilter === 'all' || (groupStates[g.key] ?? 'pending') === statusFilter,
  )
  const scopedCleanCount = statusScoped.filter((g) => !groupInfo.get(g)?.dirty).length
  const scopedConflictCount = statusScoped.length - scopedCleanCount

  const visibleGroups = groupFilter === 'all'
    ? statusScoped
    : statusScoped.filter((g) => (groupFilter === 'clean' ? !groupInfo.get(g)?.dirty : !!groupInfo.get(g)?.dirty))

  const chipValue = (v: string | null | undefined) => (v == null ? EMPTY_CHIP : v)
  // 取该字段的当前选择:**显式选过(含选「不填」= null)一律以选择为准** ——
  // 不能用 `?? c.default` 兜底:null 会被判为「没选」而回退默认值,导致「不填」选不上
  const mergeValueOf = (plan: DuplicateMergePlan, c: DuplicateMergeConflict) => {
    const chosen = choices[plan.keepId]
    if (chosen && c.field in chosen) return chosen[c.field] ?? null
    return c.default
  }
  const setMergeChoice = (keepId: string, field: DuplicateMergeConflictField, v: string) => {
    setChoices((prev) => ({ ...prev, [keepId]: { ...prev[keepId], [field]: v === EMPTY_CHIP ? null : v } }))
  }
  const setMergeText = (keepId: string, field: 'remarkText' | 'payerText', v: string) => {
    setChoices((prev) => ({ ...prev, [keepId]: { ...prev[keepId], [field]: v } }))
  }
  const mergeOptionLabel = (v: string | null, field: DuplicateMergeConflictField) =>
    v === null ? DEDUP_EMPTY_LABEL : field === 'accountId' ? (accountDisplay.get(v) ?? v) : v
  const mergeOptionsOf = (c: DuplicateMergeConflict) => {
    const options = c.options.map((o) => ({
      value: chipValue(o.value),
      label: `${mergeOptionLabel(o.value, c.field)} ×${o.count}`,
    }))
    // 分类可空:组内没人留空时也要能选「不填」
    if (c.field === 'categoryCode' && !c.options.some((o) => o.value === null)) {
      options.push({ value: EMPTY_CHIP, label: '不填' })
    }
    return options
  }
  const conflictOf = (plan: DuplicateMergePlan, field: DuplicateMergeConflictField) =>
    plan.conflicts.find((c) => c.field === field)

  const doMerge = async () => {
    setRunning(true)
    setError('')
    try {
      // 只提交「已确认」且未被阻断的组
      const targets = mergePlans.filter(
        (p) => groupStates[p.group.key] === 'confirmed' && !p.plan.blocked,
      )
      if (targets.length === 0) return
      await recordApi.mergeDuplicates(
        bookId,
        matchFields,
        targets.map(({ group, plan }) => ({
          keepId: plan.keepId,
          mergeIds: plan.mergeIds,
          choices: choices[group.records[0].id],
        })),
      )
      onComplete()
      setChoices({})
      // 重新检测:合并后组会消失,列表与真实状态保持一致
      await handleDetect()
    } catch (e) {
      setError(errorMessage(e, '合并失败'))
    } finally {
      setRunning(false)
    }
  }

  /** 底部按钮:按当前模式弹确认(web 用 window.confirm 之外的既有 ConfirmSheet 缺失,这里直接执行) */
  const handleRun = () => {
    if (running || confirmedGroups.length === 0) return
    if (mode === 'delete') void doDelete()
    else void doMerge()
  }

  const reset = () => {
    setGroups([])
    setTotalDuplicates(0)
    setDetected(false)
    setDetecting(false)
    setRunning(false)
    setError('')
    setSelectedIds(new Set())
    setMatchFields(DEFAULT_DEDUP_MATCH_FIELDS)
    setMatchOpen(true)
    clearScope()
    setScopeOpen(true)
    setMode('merge')
    setChoices({})
    setGroupFilter('all')
  }

  const handleClose = () => {
    reset()
    onOpenChange(false)
  }

  // 至少需要一个匹配字段
  const activeFieldCount = DEDUP_TOGGLE_FIELDS.filter(f => matchFields[f.key]).length + (matchFields.date ? 1 : 0)
  const canDetect = activeFieldCount >= 1
  // 「匹配条件」折叠态摘要:日期精度 + 已启用的匹配字段
  const matchSummary = [
    DATE_PRECISION_LABELS[matchFields.date ?? 'ignore'],
    ...DEDUP_TOGGLE_FIELDS.filter(f => matchFields[f.key]).map(f => f.label),
  ].join(' · ')

  // 归属人 id → 名称映射(从检测结果记录收集,避免额外拉取成员列表)
  const ownerNames = new Map<string, string>()
  for (const g of groups) {
    for (const r of g.records) {
      if (r.ownerId && r.ownerName) ownerNames.set(r.ownerId, r.ownerName)
    }
  }

  return (
    <>
      <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-5xl max-h-[90vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>去重检测</DialogTitle>
        </DialogHeader>

        <div className="flex flex-col gap-4 flex-1 overflow-y-auto py-4">
          {error && (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}

          {/* 筛选范围(可折叠,默认展开):限制「在哪些流水里找重复」,与「匹配条件」(怎么算同一笔)独立;点「检测重复」后自动收起 */}
          <div className="border rounded-md">
            <div className="flex items-center gap-1 px-2">
              <button
                type="button"
                onClick={() => setScopeOpen(v => !v)}
                className="flex items-center gap-1.5 flex-1 py-1.5 text-left min-w-0"
              >
                {scopeOpen ? (
                  <ChevronDown size={14} className="text-muted-foreground shrink-0" />
                ) : (
                  <ChevronRight size={14} className="text-muted-foreground shrink-0" />
                )}
                <span className="text-xs font-medium shrink-0">筛选范围</span>
                <span className="text-xs text-muted-foreground truncate">
                  {scopeSummary || '不限(全部流水参与检测)'}
                </span>
              </button>
              {scopeSummary ? (
                <button type="button" onClick={clearScope} className="text-xs text-primary hover:underline shrink-0">
                  清空
                </button>
              ) : null}
            </div>

            {scopeOpen && (
              <div className="border-t px-3 py-2.5 grid grid-cols-3 gap-3">
                {/* 起始日 */}
                <div>
                  <div className="text-xs text-muted-foreground mb-1">起始日</div>
                  <div className="flex items-center gap-1">
                    <div className="flex-1 min-w-0">
                      <DatePicker
                        compact
                        value={filters.dateFrom || ''}
                        onChange={(v) => setFilters(prev => ({ ...prev, dateFrom: v || null }))}
                      />
                    </div>
                    {/* 清空交给 DatePicker 自带的 ×，这里不再重复放一个 */}
                  </div>
                </div>

                {/* 结束日 */}
                <div>
                  <div className="text-xs text-muted-foreground mb-1">结束日</div>
                  <div className="flex items-center gap-1">
                    <div className="flex-1 min-w-0">
                      <DatePicker
                        compact
                        value={filters.dateTo || ''}
                        onChange={(v) => setFilters(prev => ({ ...prev, dateTo: v || null }))}
                      />
                    </div>
                    {/* 清空交给 DatePicker 自带的 ×，这里不再重复放一个 */}
                  </div>
                </div>

                {/* 类型 */}
                <div>
                  <div className="text-xs text-muted-foreground mb-1">类型（不选 = 全部）</div>
                  <div className="flex items-center gap-1.5 flex-wrap">
                    {RECORD_TYPES.map(t => {
                      const on = filters.types.includes(t)
                      return (
                        <button
                          key={t}
                          type="button"
                          onClick={() => setFilters(prev => ({
                            ...prev,
                            types: on ? prev.types.filter(x => x !== t) : [...prev.types, t],
                          }))}
                          className={`h-8 px-2.5 rounded-md text-xs border transition-colors ${
                            on
                              ? 'bg-primary border-primary text-primary-foreground'
                              : 'bg-background border-border text-muted-foreground hover:border-primary/30'
                          }`}
                        >
                          {TYPE_LABELS[t]}
                          {on ? <Check size={12} className="inline ml-1" /> : null}
                        </button>
                      )
                    })}
                  </div>
                </div>

                {/* 金额区间(按绝对值) */}
                <div>
                  <div className="text-xs text-muted-foreground mb-1">金额下限</div>
                  <input
                    value={amountMinText}
                    onChange={(e) => setAmountMinText(e.target.value)}
                    inputMode="decimal"
                    placeholder="不限"
                    className="h-8 w-full rounded border border-border bg-background px-2 text-xs"
                  />
                </div>
                <div>
                  <div className="text-xs text-muted-foreground mb-1">金额上限</div>
                  <input
                    value={amountMaxText}
                    onChange={(e) => setAmountMaxText(e.target.value)}
                    inputMode="decimal"
                    placeholder="不限"
                    className="h-8 w-full rounded border border-border bg-background px-2 text-xs"
                  />
                </div>
                <div className="flex items-end">
                  <p className="text-[10px] text-muted-foreground leading-relaxed">
                    时间按本地日，含首尾当天；金额按绝对值，留空不限
                  </p>
                </div>
              </div>
            )}
          </div>

          {/* 匹配条件(可折叠):默认展开,点「检测重复」后自动收起给结果让位 */}
          <div className="border rounded-md">
            <div className="flex items-center gap-1 px-2">
              <button
                type="button"
                onClick={() => setMatchOpen(v => !v)}
                className="flex items-center gap-1.5 flex-1 py-1.5 text-left min-w-0"
              >
                {matchOpen ? (
                  <ChevronDown size={14} className="text-muted-foreground shrink-0" />
                ) : (
                  <ChevronRight size={14} className="text-muted-foreground shrink-0" />
                )}
                <span className="text-xs font-medium shrink-0">匹配条件</span>
                <span className="text-xs text-muted-foreground truncate ml-auto">{matchSummary}</span>
              </button>
            </div>

            {matchOpen && (
              <div className="border-t px-3 py-2.5 space-y-2.5">
                <div className="flex items-center gap-2 flex-wrap">
                  {/* 日期精度 */}
                  <Select
                    value={matchFields.date || 'ignore'}
                    onValueChange={(v) => setMatchFields(prev => ({ ...prev, date: (v === 'ignore' ? null : v as 'exact' | 'minute' | 'date') }))}
                  >
                    <SelectTrigger className="h-8 text-xs w-28 bg-background">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent className="bg-card border-border">
                      <SelectItem value="exact" className="text-xs">{DATE_PRECISION_LABELS.exact}</SelectItem>
                      <SelectItem value="minute" className="text-xs">{DATE_PRECISION_LABELS.minute}</SelectItem>
                      <SelectItem value="date" className="text-xs">{DATE_PRECISION_LABELS.date}</SelectItem>
                      <SelectItem value="ignore" className="text-xs">{DATE_PRECISION_LABELS.ignore}</SelectItem>
                    </SelectContent>
                  </Select>

                  {DEDUP_TOGGLE_FIELDS.map(f => (
                    <button
                      key={f.key}
                      onClick={() => toggleField(f.key)}
                      className={`h-8 px-3 rounded-md text-xs border transition-colors ${
                        matchFields[f.key]
                          ? 'bg-primary border-primary text-primary-foreground'
                          : 'bg-background border-border text-muted-foreground hover:border-primary/30'
                      }`}
                    >
                      {f.label}
                      {matchFields[f.key] ? <Check size={12} className="inline ml-1" /> : null}
                    </button>
                  ))}
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-muted-foreground">备注相似度 ≥</span>
                  <Input
                    type="number"
                    min={0}
                    max={100}
                    value={remarkSimilarity}
                    onChange={(e) => setRemarkSimilarity(e.target.value)}
                    placeholder="不启用"
                    className="h-8 text-xs w-24 bg-background"
                  />
                  <span className="text-xs text-muted-foreground">%</span>
                </div>
                <p className="text-[10px] text-muted-foreground">至少选中一项；填写相似度后会剔除组内备注差异过大的记录</p>
              </div>
            )}
          </div>

          <div>
            <Button
              size="sm"
              className="h-8 text-xs bg-primary hover:bg-primary/90 text-primary-foreground"
              onClick={handleDetect}
              disabled={!canDetect || detecting}
            >
              {detecting ? <Spinner /> : '检测重复'}
            </Button>
          </div>

          {/* Loading */}
          {detecting && (
            <div className="py-12 flex justify-center">
              <Spinner />
            </div>
          )}

          {/* 结果 */}
          {detected && (
            <>
              {groups.length === 0 ? (
                <div className="py-12 text-center">
                  <CopyMinus size={40} className="opacity-30 mx-auto mb-3" />
                  <p className="text-sm text-muted-foreground">未发现重复记录</p>
                </div>
              ) : (
                <>
                  {/* 处理方式:开关一行(右侧放摘要),说明单独一行 */}
                  <div className="space-y-1.5">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className={`text-xs font-medium ${mode === 'merge' ? 'text-primary' : 'text-muted-foreground'}`}>
                        合并重复
                      </span>
                      <Switch
                        checked={mode === 'merge'}
                        onCheckedChange={(v) => {
                          setMode(v ? 'merge' : 'delete')
                          // 合并与删除语义不同:切模式后所有组退回待处理,避免把「已确认合并」当删除执行
                          setGroupStates((prev) =>
                            Object.fromEntries(Object.keys(prev).map((k) => [k, 'pending' as GroupStatus])),
                          )
                        }}
                      />
                      <span className={`text-xs font-medium ${mode === 'delete' ? 'text-[#ef4444]' : 'text-muted-foreground'}`}>
                        删除重复
                      </span>
                      <div className="ml-auto flex items-center gap-1.5 flex-wrap">
                        {mode === 'merge' && blockedCount > 0 && (
                          <Badge variant="secondary" className="text-xs text-destructive">
                            {blockedCount} 组方向不一致,不参与合并
                          </Badge>
                        )}
                      </div>
                    </div>
                    <p className="text-[11px] text-muted-foreground leading-relaxed">
                      {mode === 'merge'
                        ? '勾选要并入的记录(默认每组除第 1 条外全选),每组保留最早一条;下方结果面板淡绿 = 自动收敛、淡红 = 需你确认'
                        : '勾选要删除的记录(默认每组除第 1 条外全选),每组保留最早一条'}
                    </p>
                  </div>

                  {/* 一级:组状态(与平账弹窗一致) */}
                  <div className="flex items-center gap-1.5 flex-wrap mt-3">
                    {([
                      ['all', '全部', groups.length],
                      ['pending', '待处理', statusCounts.pending],
                      ['confirmed', '已确认', statusCounts.confirmed],
                      ['ignored', '忽略', statusCounts.ignored],
                    ] as const).map(([key, label, count]) => (
                      <Button
                        key={key}
                        size="sm"
                        variant={statusFilter === key ? 'default' : 'outline'}
                        className="h-7 text-xs"
                        onClick={() => {
                          setStatusFilter(key)
                          // 忽略视图不区分冲突,切过去时把二级筛选复位
                          if (key === 'ignored') setGroupFilter('all')
                        }}
                      >
                        {label} ({count})
                      </Button>
                    ))}
                  </div>

                  {/* 二级:冲突筛选 —— 只在有意义的视图(全部/待处理/已确认)下出现 */}
                  {statusFilter !== 'ignored' && (
                    <div className="flex items-center gap-1.5 flex-wrap pl-1">
                      {([
                        ['all', '全部', statusScoped.length],
                        ['clean', '无冲突', scopedCleanCount],
                        ['conflict', '有冲突', scopedConflictCount],
                      ] as const).map(([key, label, count]) => {
                        const on = groupFilter === key
                        return (
                          <button
                            key={key}
                            onClick={() => setGroupFilter(key)}
                            className={`h-6 px-2 rounded-full text-[11px] border transition-colors ${
                              on
                                ? 'bg-primary border-primary text-primary-foreground'
                                : 'bg-background border-border text-muted-foreground hover:border-primary/30'
                            }`}
                          >
                            {label} {count}
                          </button>
                        )
                      })}
                    </div>
                  )}

                  {/* 重复分组 */}
                  <div className="space-y-4">
                    {visibleGroups.length === 0 ? (
                      <div className="py-8 text-center text-xs text-muted-foreground">当前筛选下没有分组</div>
                    ) : null}
                    {visibleGroups.map((group) => {
                      const groupIds = group.records.map(r => r.id)
                      const allSelected = groupIds.every(id => selectedIds.has(id))
                      const keyLabels = parseGroupKey(group.key, matchFields, accountDisplay, ownerNames)
                      const groupPlan = planOf(group)
                      const keepRec = group.records[0]
                      const accountConflict = groupPlan ? conflictOf(groupPlan, 'accountId') : undefined
                      const categoryConflict = groupPlan ? conflictOf(groupPlan, 'categoryCode') : undefined
                      const accountValue = groupPlan?.patch.accountId ?? keepRec.accountId
                      const categoryValue = groupPlan?.patch.categoryCode ?? keepRec.categoryCode ?? null
                      const payerValue = choices[keepRec.id]?.payerText ?? groupPlan?.patch.payer ?? keepRec.payer ?? ''
                      const remarkValue = choices[keepRec.id]?.remarkText ?? groupPlan?.remark ?? ''
                      const tagsValue = groupPlan?.patch.tags ?? keepRec.tags ?? []
                      const attachCount =
                        (keepRec.attachments?.length ?? 0) +
                        group.records.slice(1).filter(r => selectedIds.has(r.id)).reduce((n, r) => n + (r.attachments?.length ?? 0), 0)
                      const status = groupStates[group.key] ?? 'pending'
                      const locked = status !== 'pending'
                      const ready = groupReady(group)

                      return (
                        <div
                          key={group.key}
                          className={`border rounded-lg overflow-hidden ${status === 'confirmed' ? 'border-primary/60' : ''}`}
                        >
                          {/* 组头 */}
                          <div className="flex items-center gap-2 px-3 py-2 bg-muted/50 border-b">
                            {!locked && (
                              <button
                                className="text-xs text-muted-foreground hover:text-foreground"
                                onClick={() => toggleGroup(group)}
                              >
                                {allSelected ? '取消全选' : '全选'}
                              </button>
                            )}
                            <span className="text-xs text-muted-foreground">
                              {group.count} 条重复
                            </span>
                            {mode === 'merge' && groupPlan ? (
                              <span className="text-xs text-muted-foreground">
                                {groupPlan.blocked ? '方向不一致,不合并' : `将并入 ${groupPlan.mergeIds.length} 条`}
                              </span>
                            ) : null}
                            <div className="flex items-center gap-1.5 ml-auto flex-wrap">
                              {keyLabels.map((label, i) => (
                                <Badge key={i} variant="outline" className="text-[10px] py-0 px-1.5">
                                  {label}
                                </Badge>
                              ))}
                              {status === 'confirmed' && <Badge className="text-[10px]">已确认</Badge>}
                              {status === 'ignored' && <Badge variant="outline" className="text-[10px]">已忽略</Badge>}
                            </div>
                          </div>

                          {/* 组内记录 */}
                          <div className="overflow-x-auto">
                            <Table>
                              <TableHeader>
                                <TableRow className="hover:bg-transparent">
                                  <TableHead className="text-xs w-8 py-1.5">
                                    <input
                                      type="checkbox"
                                      checked={allSelected}
                                      onChange={() => toggleGroup(group)}
                                      disabled={locked}
                                      className="rounded"
                                    />
                                  </TableHead>
                                  <TableHead className="text-xs py-1.5">日期</TableHead>
                                  <TableHead className="text-xs py-1.5">类型</TableHead>
                                  <TableHead className="text-xs py-1.5">账户</TableHead>
                                  <TableHead className="text-xs py-1.5">交易方</TableHead>
                                  <TableHead className="text-xs py-1.5">金额</TableHead>
                                  <TableHead className="text-xs py-1.5">分类</TableHead>
                                  <TableHead className="text-xs py-1.5">备注</TableHead>
                                  <TableHead className="text-xs py-1.5">标签</TableHead>
                                  <TableHead className="text-xs py-1.5">附件</TableHead>
                                </TableRow>
                              </TableHeader>
                              <TableBody>
                                {group.records.map((r, ri) => (
                                  <TableRow key={r.id} className={ri === 0 ? 'bg-[#22c55e]/5' : ''}>
                                    <TableCell className="py-1.5">
                                      <input
                                        type="checkbox"
                                        checked={selectedIds.has(r.id)}
                                        onChange={() => toggleRecord(r.id)}
                                        disabled={locked}
                                        className="rounded"
                                      />
                                    </TableCell>
                                    <TableCell className="text-xs py-1.5 whitespace-nowrap">
                                      {ri === 0 && (
                                        <Badge variant="outline" className="text-[10px] py-0 px-1 mr-1 bg-[#22c55e]/10 border-[#22c55e]/30 text-[#22c55e]">
                                          保留
                                        </Badge>
                                      )}
                                      {dayjs(r.date).format('YYYY-MM-DD HH:mm:ss')}
                                    </TableCell>
                                    <TableCell className={`text-xs py-1.5 ${TYPE_COLORS[r.type]}`}>
                                      {TYPE_LABELS[r.type]}
                                    </TableCell>
                                    <TableCell className="text-xs py-1.5">
                                      <div className="max-w-[180px]">
                                        <EllipsisText
                                          text={r.type === 'TRANSFER' && r.fromAccount && r.toAccount
                                            ? `${r.fromAccount.name} → ${r.toAccount.name}`
                                            : r.account?.name}
                                          empty="-"
                                        />
                                      </div>
                                    </TableCell>
                                    <TableCell className="text-xs py-1.5">
                                      <div className="max-w-[120px]"><EllipsisText text={r.payer} empty="-" /></div>
                                    </TableCell>
                                    <TableCell className="text-xs py-1.5 font-mono">
                                      {r.amount.toFixed(2)}
                                    </TableCell>
                                    <TableCell className="text-xs py-1.5">
                                      <div className="max-w-[120px]"><EllipsisText text={r.categoryCode} empty="-" /></div>
                                    </TableCell>
                                    <TableCell className="text-xs py-1.5">
                                      <div className="max-w-[200px]"><EllipsisText text={r.remark} empty="-" /></div>
                                    </TableCell>
                                    <TableCell className="text-xs py-1.5">
                                      <div className="max-w-[160px]"><EllipsisText text={r.tags?.join(' / ')} empty="-" /></div>
                                    </TableCell>
                                    <TableCell className="text-xs py-1.5 text-muted-foreground">
                                      {r.attachments?.length ? `${r.attachments.length} 个` : '-'}
                                    </TableCell>
                                  </TableRow>
                                ))}
                              </TableBody>
                            </Table>
                          </div>

                          {/* 合并结果(内联可编辑,不再另弹窗):淡绿 = 自动收敛,淡红 = 组内不一致需确认 */}
                          {mode === 'merge' ? (
                            <div className={`border-t bg-muted/40 px-3 py-2.5 space-y-1.5 ${locked ? 'pointer-events-none opacity-60' : ''}`}>
                              {!groupPlan ? (
                                <p className="text-[11px] text-muted-foreground">未勾选要并入的记录 — 本组不处理</p>
                              ) : groupPlan.blocked ? (
                                <p className="text-[11px] text-destructive">本组不参与合并:{groupPlan.blocked}</p>
                              ) : (
                                <>
                                  <div className="flex items-center gap-2 flex-wrap">
                                    <span className="text-xs font-medium">合并结果(可编辑)</span>
                                    <Badge variant="outline" className="text-[10px] py-0 px-1.5">
                                      类型 {TYPE_LABELS[keepRec.type]}
                                    </Badge>
                                    <Badge variant="outline" className="text-[10px] py-0 px-1.5">
                                      金额 {keepRec.amount.toFixed(2)}
                                    </Badge>
                                    <Badge variant="outline" className="text-[10px] py-0 px-1.5">
                                      日期 {dayjs(keepRec.date).format('YYYY-MM-DD HH:mm:ss')}
                                    </Badge>
                                  </div>

                                  {/* 账户:组内不一致 → 淡红 + 选择;否则淡绿 */}
                                  <div className={`rounded px-2 py-1.5 ${accountConflict ? 'bg-[#ef4444]/10' : 'bg-[#22c55e]/10'}`}>
                                    <div className="text-[10px] text-muted-foreground mb-1">
                                      账户{accountConflict ? ' · 组内不一致,请选择' : ''}
                                    </div>
                                    {accountConflict ? (
                                      <Select
                                        value={chipValue(mergeValueOf(groupPlan, accountConflict))}
                                        onValueChange={(v) => setMergeChoice(groupPlan.keepId, 'accountId', v)}
                                      >
                                        <SelectTrigger className="h-7 text-xs bg-background">
                                          <SelectValue />
                                        </SelectTrigger>
                                        <SelectContent className="bg-card border-border">
                                          {mergeOptionsOf(accountConflict).map((o) => (
                                            <SelectItem key={o.value} value={o.value} className="text-xs">
                                              {o.label}
                                            </SelectItem>
                                          ))}
                                        </SelectContent>
                                      </Select>
                                    ) : (
                                      <div className="text-xs">{mergeOptionLabel(accountValue, 'accountId')}</div>
                                    )}
                                  </div>

                                  {/* 分类:同上,可空 → 可显式选「不填」 */}
                                  <div className={`rounded px-2 py-1.5 ${categoryConflict ? 'bg-[#ef4444]/10' : 'bg-[#22c55e]/10'}`}>
                                    <div className="text-[10px] text-muted-foreground mb-1">
                                      分类{categoryConflict ? ' · 组内不一致,请选择' : ''}
                                    </div>
                                    {categoryConflict ? (
                                      <Select
                                        value={chipValue(mergeValueOf(groupPlan, categoryConflict))}
                                        onValueChange={(v) => setMergeChoice(groupPlan.keepId, 'categoryCode', v)}
                                      >
                                        <SelectTrigger className="h-7 text-xs bg-background">
                                          <SelectValue />
                                        </SelectTrigger>
                                        <SelectContent className="bg-card border-border">
                                          {mergeOptionsOf(categoryConflict).map((o) => (
                                            <SelectItem key={o.value} value={o.value} className="text-xs">
                                              {o.label}
                                            </SelectItem>
                                          ))}
                                        </SelectContent>
                                      </Select>
                                    ) : (
                                      <div className="text-xs">{categoryValue ?? DEDUP_EMPTY_LABEL}</div>
                                    )}
                                  </div>

                                  <div className="rounded px-2 py-1.5 bg-[#22c55e]/10">
                                    <div className="text-[10px] text-muted-foreground mb-1">交易方</div>
                                    <input
                                      value={payerValue}
                                      onChange={(e) => setMergeText(groupPlan.keepId, 'payerText', e.target.value)}
                                      placeholder="可不填"
                                      className="h-7 w-full rounded border border-border bg-background px-2 text-xs"
                                    />
                                  </div>

                                  <div className="rounded px-2 py-1.5 bg-[#22c55e]/10">
                                    <div className="text-[10px] text-muted-foreground mb-1">备注(默认拼接,可改)</div>
                                    <input
                                      value={remarkValue}
                                      onChange={(e) => setMergeText(groupPlan.keepId, 'remarkText', e.target.value)}
                                      placeholder="可不填"
                                      className="h-7 w-full rounded border border-border bg-background px-2 text-xs"
                                    />
                                  </div>

                                  <div className="rounded px-2 py-1.5 bg-[#22c55e]/10">
                                    <div className="text-[10px] text-muted-foreground mb-1">标签 / 附件(自动并集)</div>
                                    <div className="text-xs">
                                      标签 {tagsValue.length > 0 ? tagsValue.join(' / ') : '无'} · 附件 {attachCount} 个
                                    </div>
                                  </div>

                                  {groupPlan.autoFilled.length > 0 ? (
                                    <p className="text-[10px] text-muted-foreground">
                                      自动:{groupPlan.autoFilled.map((f) => f.detail).join(';')}
                                    </p>
                                  ) : null}
                                </>
                              )}
                            </div>
                          ) : null}

                          {/* 组底操作区:确认 / 忽略放这里,比塞在组头明显得多 */}
                          <div className={`border-t px-3 py-2 flex items-center gap-2 ${status === 'pending' ? 'bg-card' : 'bg-muted/40'}`}>
                            <span className="text-[11px] text-muted-foreground">
                              {status === 'confirmed'
                                ? '已确认:按当前勾选提交,可取消确认后调整'
                                : status === 'ignored'
                                  ? '已忽略:不会提交,可恢复'
                                  : mode === 'merge'
                                    ? '确认后按当前勾选合并(保留第 1 条)'
                                    : '确认后按当前勾选删除'}
                            </span>
                            <div className="ml-auto flex gap-1.5">
                              {status === 'pending' ? (
                                <>
                                  <Button
                                    size="sm"
                                    className="h-7 text-xs px-3"
                                    disabled={!ready}
                                    onClick={() => setGroupStates((p) => ({ ...p, [group.key]: 'confirmed' }))}
                                  >
                                    确认
                                  </Button>
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    className="h-7 text-xs px-3"
                                    onClick={() => setGroupStates((p) => ({ ...p, [group.key]: 'ignored' }))}
                                  >
                                    忽略
                                  </Button>
                                </>
                              ) : (
                                <Button
                                  size="sm"
                                  variant="outline"
                                  className="h-7 text-xs px-3"
                                  onClick={() => setGroupStates((p) => ({ ...p, [group.key]: 'pending' }))}
                                >
                                  {status === 'confirmed' ? '取消确认' : '恢复'}
                                </Button>
                              )}
                            </div>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                </>
              )}
            </>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={handleClose} disabled={running}>
            取消
          </Button>
          {detected && groups.length > 0 && (
            <Button
              className={
                mode === 'delete'
                  ? 'bg-[#ef4444] hover:bg-[#dc2626] text-white'
                  : 'bg-primary hover:bg-primary/90 text-primary-foreground'
              }
              onClick={handleRun}
              disabled={running || confirmedGroups.length === 0}
            >
              {running
                ? mode === 'delete'
                  ? '删除中...'
                  : '合并中...'
                : mode === 'delete'
                  ? `删除 ${confirmedGroups.length} 组`
                  : `合并 ${confirmedGroups.length} 组`}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
      </Dialog>
    </>
  )
}

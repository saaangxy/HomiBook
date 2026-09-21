import { useEffect, useMemo, useState } from 'react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
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
import { recordApi, type RecordItem } from '@/api/record'
import { accountApi, type AccountItem } from '@/api/account'
import { accountLabel, isMultiOwnerAccounts } from '@/lib/account'
import {
  DEDUP_EMPTY_LABEL,
  DEFAULT_DEDUP_MATCH_FIELDS,
  DEDUP_TOGGLE_FIELDS,
  parseDuplicateGroupKey,
  planDuplicateMerge,
  type DedupMatchFields,
  type DuplicateMergeChoice,
  type DuplicateMergeConflict,
  type DuplicateMergeConflictField,
  type DuplicateMergePlan,
  type DuplicateMergeRecord,
} from '@homibook/core'
import { RECORD_TYPE_LABELS, RECORD_TYPE_TEXT_CLASS } from '@/lib/record-type'
import { errorMessage } from '@/lib/error'
import { CopyMinus, Check } from 'lucide-react'
import dayjs from 'dayjs'

interface DedupDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  bookId: string
  onComplete: () => void
}

interface DuplicateGroup {
  key: string
  count: number
  records: RecordItem[]
}

const TYPE_LABELS = RECORD_TYPE_LABELS
const TYPE_COLORS = RECORD_TYPE_TEXT_CLASS

function parseGroupKey(key: string, fields: DedupMatchFields, accountDisplay: Map<string, string>, ownerNames: Map<string, string>): string[] {
  return parseDuplicateGroupKey(key, fields, {
    accountDisplay,
    ownerNames,
    formatDateTime: (iso) => dayjs(iso).format('YYYY-MM-DD HH:mm:ss'),
  })
}

/** 冲突选择里「不填」的哨兵值(Select 的 value 必须是字符串) */
const EMPTY_CHIP = '__empty__'

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

  const [groups, setGroups] = useState<DuplicateGroup[]>([])
  const [totalDuplicates, setTotalDuplicates] = useState(0)
  const [detected, setDetected] = useState(false)
  const [detecting, setDetecting] = useState(false)
  const [error, setError] = useState('')

  // 选中要处理的记录 ID(两种模式语义一致:勾选 = 该记录会被处理,切模式不动勾选)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())

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

  const handleDetect = async () => {
    setDetecting(true)
    setError('')
    setDetected(false)
    setGroups([])
    setSelectedIds(new Set())
    try {
      const result = await recordApi.detectDuplicates(bookId, matchFields)
      setGroups(result.groups)
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
    setRunning(true)
    setError('')
    try {
      await recordApi.batchDelete(Array.from(selectedIds))
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
  const pendingMergeCount = mergePlans.reduce((sum, p) => sum + (p.plan.blocked ? 0 : p.plan.mergeIds.length), 0)
  const blockedCount = mergePlans.filter((p) => p.plan.blocked).length

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
  const cleanCount = groups.filter((g) => !groupInfo.get(g)?.dirty).length
  const conflictCount = groups.length - cleanCount
  const visibleGroups = groupFilter === 'all'
    ? groups
    : groups.filter((g) => (groupFilter === 'clean' ? !groupInfo.get(g)?.dirty : !!groupInfo.get(g)?.dirty))

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
      const targets = mergePlans.filter((p) => !p.plan.blocked)
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
    if (running) return
    if (mode === 'delete') {
      if (selectedIds.size > 0) void doDelete()
    } else if (pendingMergeCount > 0) {
      void doMerge()
    }
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

          {/* 匹配字段选择 */}
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm text-muted-foreground mr-1">匹配条件:</span>

            {/* 日期精度 */}
            <Select
              value={matchFields.date || 'ignore'}
              onValueChange={(v) => setMatchFields(prev => ({ ...prev, date: (v === 'ignore' ? null : v as 'exact' | 'minute' | 'date') }))}
            >
              <SelectTrigger className="h-8 text-xs w-28 bg-background">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="bg-card border-border">
                {/* 从严格到宽松:精确到秒常因两条记录差几秒漏判,同日又太宽,同分钟居中(与移动端一致) */}
                <SelectItem value="exact" className="text-xs">时间: 精确</SelectItem>
                <SelectItem value="minute" className="text-xs">时间: 同分钟</SelectItem>
                <SelectItem value="date" className="text-xs">时间: 同日</SelectItem>
                <SelectItem value="ignore" className="text-xs">时间: 忽略</SelectItem>
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
                  {/* 处理方式二选一(switch):勾选语义两模式一致(勾选 = 该记录会被处理),切模式不动勾选 */}
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className={`text-xs font-medium ${mode === 'merge' ? 'text-primary' : 'text-muted-foreground'}`}>
                      合并重复
                    </span>
                    <Switch checked={mode === 'merge'} onCheckedChange={(v) => setMode(v ? 'merge' : 'delete')} />
                    <span className={`text-xs font-medium ${mode === 'delete' ? 'text-[#ef4444]' : 'text-muted-foreground'}`}>
                      删除重复
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {mode === 'merge'
                        ? '勾选要并入的记录(默认每组除第 1 条外全选),每组保留最早一条;下方结果面板淡绿 = 自动收敛、淡红 = 需你确认'
                        : '勾选要删除的记录(默认每组除第 1 条外全选),每组保留最早一条'}
                    </span>
                  </div>

                  {/* 摘要 */}
                  <div className="flex items-center gap-2 text-sm flex-wrap">
                    <Badge variant="secondary" className="text-xs">
                      共 {groups.length} 组重复
                    </Badge>
                    <Badge variant="secondary" className="text-xs">
                      {totalDuplicates} 条重复
                    </Badge>
                    <Badge variant="secondary" className="text-xs">
                      {mode === 'merge' ? `将合并 ${pendingMergeCount} 条` : `已选 ${selectedIds.size} 条`}
                    </Badge>
                    {mode === 'merge' && blockedCount > 0 ? (
                      <Badge variant="secondary" className="text-xs text-destructive">
                        {blockedCount} 组方向不一致,不参与合并
                      </Badge>
                    ) : null}
                  </div>

                  {/* 分组筛选:先看需要拍板的组(计数按整组算,与勾选无关) */}
                  <div className="flex items-center gap-2 flex-wrap">
                    {([
                      ['all', '全部', groups.length],
                      ['clean', '无冲突', cleanCount],
                      ['conflict', '有冲突', conflictCount],
                    ] as const).map(([key, label, count]) => {
                      const on = groupFilter === key
                      return (
                        <button
                          key={key}
                          onClick={() => setGroupFilter(key)}
                          className={`h-7 px-3 rounded-full text-xs border transition-colors ${
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

                      return (
                        <div key={group.key} className="border rounded-lg overflow-hidden">
                          {/* 组头 */}
                          <div className="flex items-center gap-2 px-3 py-2 bg-muted/50 border-b">
                            <button
                              className="text-xs text-muted-foreground hover:text-foreground"
                              onClick={() => toggleGroup(group)}
                            >
                              {allSelected ? '取消全选' : '全选'}
                            </button>
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
                                      {r.type === 'TRANSFER' && r.fromAccount && r.toAccount
                                        ? `${r.fromAccount.name} → ${r.toAccount.name}`
                                        : r.account?.name || '-'}
                                    </TableCell>
                                    <TableCell className="text-xs py-1.5 text-muted-foreground">
                                      {r.payer || '-'}
                                    </TableCell>
                                    <TableCell className="text-xs py-1.5 font-mono">
                                      {r.amount.toFixed(2)}
                                    </TableCell>
                                    <TableCell className="text-xs py-1.5 text-muted-foreground">
                                      {r.categoryCode || '-'}
                                    </TableCell>
                                    <TableCell className="text-xs py-1.5 text-muted-foreground max-w-[120px] truncate">
                                      {r.remark || '-'}
                                    </TableCell>
                                    <TableCell className="text-xs py-1.5 text-muted-foreground max-w-[140px] truncate">
                                      {r.tags?.length ? r.tags.join(' / ') : '-'}
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
                            <div className="border-t bg-muted/40 px-3 py-2.5 space-y-1.5">
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
              disabled={running || (mode === 'delete' ? selectedIds.size === 0 : pendingMergeCount === 0)}
            >
              {running
                ? mode === 'delete'
                  ? '删除中...'
                  : '合并中...'
                : mode === 'delete'
                  ? `删除 (${selectedIds.size})`
                  : `合并 (${pendingMergeCount})`}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
      </Dialog>
    </>
  )
}

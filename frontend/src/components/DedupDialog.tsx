import { useState } from 'react'
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
import { recordApi, type RecordItem } from '@/api/record'
import { CopyMinus, Check } from 'lucide-react'
import dayjs from 'dayjs'

interface DedupDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  bookId: string
  onComplete: () => void
}

type DatePrecision = 'date' | 'exact' | null

interface MatchFields {
  date: DatePrecision
  type: boolean
  accountId: boolean
  payer: boolean
  amount: boolean
}

interface DuplicateGroup {
  key: string
  count: number
  records: RecordItem[]
}

const TYPE_LABELS: Record<string, string> = {
  INCOME: '收入',
  EXPENSE: '支出',
  TRANSFER: '转账',
}

const TYPE_COLORS: Record<string, string> = {
  INCOME: 'text-[#22c55e]',
  EXPENSE: 'text-[#ef4444]',
  TRANSFER: 'text-[#3b82f6]',
}

const FIELD_LABELS: { key: keyof MatchFields; label: string }[] = [
  { key: 'type', label: '类型' },
  { key: 'accountId', label: '账户' },
  { key: 'payer', label: '交易方' },
  { key: 'amount', label: '金额' },
]

function parseGroupKey(key: string, fields: MatchFields): string[] {
  const parts = key.split('||')
  const labels: string[] = []
  let idx = 0

  if (fields.date) {
    const val = parts[idx++]
    labels.push(`日期: ${fields.date === 'date' ? val : dayjs(val).format('YYYY-MM-DD HH:mm:ss')}`)
  }
  if (fields.type) labels.push(`类型: ${TYPE_LABELS[parts[idx++]] || parts[idx - 1]}`)
  if (fields.accountId) labels.push(`账户: ${parts[idx++]}`)
  if (fields.payer) labels.push(`交易方: ${parts[idx++]}`)
  if (fields.amount) labels.push(`金额: ${parts[idx++]}`)

  return labels
}

export function DedupDialog({ open, onOpenChange, bookId, onComplete }: DedupDialogProps) {
  const [matchFields, setMatchFields] = useState<MatchFields>({
    date: 'date',
    type: true,
    accountId: true,
    payer: true,
    amount: true,
  })

  const [groups, setGroups] = useState<DuplicateGroup[]>([])
  const [totalDuplicates, setTotalDuplicates] = useState(0)
  const [detected, setDetected] = useState(false)
  const [detecting, setDetecting] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [error, setError] = useState('')

  // 选中要删除的记录 ID
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())

  const toggleField = (key: keyof MatchFields) => {
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
    } catch (e: any) {
      setError(e.message)
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

  const handleDelete = async () => {
    if (selectedIds.size === 0) return
    setDeleting(true)
    setError('')
    try {
      await recordApi.batchDelete(Array.from(selectedIds))
      onOpenChange(false)
      onComplete()
    } catch (e: any) {
      setError(e.message)
    } finally {
      setDeleting(false)
    }
  }

  const reset = () => {
    setGroups([])
    setTotalDuplicates(0)
    setDetected(false)
    setDetecting(false)
    setDeleting(false)
    setError('')
    setSelectedIds(new Set())
    setMatchFields({
      date: 'date',
      type: true,
      accountId: true,
      payer: true,
      amount: true,
    })
  }

  const handleClose = () => {
    reset()
    onOpenChange(false)
  }

  // 至少需要两个匹配字段
  const activeFieldCount = FIELD_LABELS.filter(f => matchFields[f.key]).length + (matchFields.date ? 1 : 0)
  const canDetect = activeFieldCount >= 1

  return (
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
              onValueChange={(v) => setMatchFields(prev => ({ ...prev, date: (v === 'ignore' ? null : v as DatePrecision) }))}
            >
              <SelectTrigger className="h-8 text-xs w-28 bg-background">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="bg-card border-border">
                <SelectItem value="date" className="text-xs">时间: 同日</SelectItem>
                <SelectItem value="exact" className="text-xs">时间: 精确</SelectItem>
                <SelectItem value="ignore" className="text-xs">时间: 忽略</SelectItem>
              </SelectContent>
            </Select>

            {FIELD_LABELS.map(f => (
              <button
                key={f.key}
                onClick={() => toggleField(f.key)}
                className={`h-8 px-3 rounded-md text-xs border transition-colors ${
                  matchFields[f.key]
                    ? 'bg-primary/10 border-primary text-primary'
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
                  {/* 摘要 */}
                  <div className="flex items-center gap-2 text-sm">
                    <Badge variant="secondary" className="text-xs">
                      共 {groups.length} 组重复
                    </Badge>
                    <Badge variant="secondary" className="text-xs">
                      {totalDuplicates} 条可删除
                    </Badge>
                    <Badge variant="secondary" className="text-xs">
                      已选 {selectedIds.size} 条
                    </Badge>
                  </div>

                  {/* 重复分组 */}
                  <div className="space-y-4">
                    {groups.map((group, gi) => {
                      const groupIds = group.records.map(r => r.id)
                      const allSelected = groupIds.every(id => selectedIds.has(id))
                      const keyLabels = parseGroupKey(group.key, matchFields)

                      return (
                        <div key={gi} className="border rounded-lg overflow-hidden">
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
                                  </TableRow>
                                ))}
                              </TableBody>
                            </Table>
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
          <Button variant="outline" onClick={handleClose} disabled={deleting}>
            取消
          </Button>
          {detected && groups.length > 0 && (
            <Button
              className="bg-[#ef4444] hover:bg-[#dc2626] text-white"
              onClick={handleDelete}
              disabled={selectedIds.size === 0 || deleting}
            >
              {deleting ? '删除中...' : `删除选中 (${selectedIds.size})`}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

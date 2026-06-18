import { useState, useEffect, useCallback, useMemo } from 'react'
import ReactECharts from 'echarts-for-react'
import type { EChartsOption } from 'echarts'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { MultiSelect } from '@/components/ui/multi-select'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import {
  Dialog, DialogTrigger, DialogContent, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'
import {
  Table, TableHeader, TableBody, TableRow, TableHead, TableCell,
} from '@/components/ui/table'
import { Spinner } from '@/components/ui/spinner'
import { recordApi, type RecordItem } from '@/api/record'
import { accountApi, type AccountItem } from '@/api/account'
import { adminApi, type AdminUser } from '@/api/admin'
import { PieChart, Users, Wallet, X, List, ChevronLeft, ChevronRight } from 'lucide-react'
import { useChartTheme, type ChartTheme } from '@/hooks/useChartTheme'

function formatMoney(amount: number): string {
  return new Intl.NumberFormat('zh-CN', { style: 'currency', currency: 'CNY' }).format(amount)
}

const ANALYSIS_TYPES = [
  { value: 'EXPENSE', label: '支出分析', color: '#ef4444' },
  { value: 'INCOME', label: '收入分析', color: '#22c55e' },
  { value: 'TRANSFER', label: '转账分析', color: '#3b82f6' },
] as const

const GROUP_LABELS: Record<string, string> = {
  category: '分类占比',
  ownerId: '归属占比',
  accountId: '支付账户占比',
}

const GROUP_ICONS: Record<string, React.ReactNode> = {
  category: <PieChart size={14} />,
  ownerId: <Users size={14} />,
  accountId: <Wallet size={14} />,
}

function buildPie(data: { name: string; value: number }[], t: ChartTheme): { option: EChartsOption; chartHeight: number } {
  // 图例换行时才增加空间，每额外行约16px（fontSize 12）
  const legendLines = Math.ceil(data.length / 4)
  const extraBottom = Math.max(0, legendLines - 1) * 16
  const extraHeight = Math.max(0, legendLines - 1) * 16

  const option: EChartsOption = {
    tooltip: {
      trigger: 'item' as const,
      backgroundColor: t.cardBg,
      borderColor: t.border,
      textStyle: { color: t.cardFg, fontSize: 13 },
      formatter: (p: any) => `${p.name}: ${formatMoney(p.value)} (${p.percent}%)`,
    },
    legend: {
      orient: 'horizontal' as const,
      bottom: 0,
      type: 'plain' as const,
      textStyle: { color: t.mutedForeground, fontSize: 12 },
    },
    color: t.COLORS,
    series: [{
      type: 'pie',
      radius: ['45%', '75%'],
      center: ['50%', '45%'],
      top: 0,
      bottom: 50 + extraBottom,
      itemStyle: { borderRadius: 3, borderColor: t.bg, borderWidth: 2 },
      label: { show: false },
      emphasis: { label: { show: true, fontSize: 14, fontWeight: 'bold' }, scaleSize: 8 },
      data,
    }],
  }

  return { option, chartHeight: 260 + extraHeight }
}

interface Props {
  bookId: string
  dateFrom?: string
  dateTo?: string
  accountId?: string
  ownerId?: string
  tags?: string
}

type GroupData = { key: string; label: string; amount: number }[]
type SelectedInfo = { groupBy: string; key: string; label: string; amount: number } | null

export function AnalysisPanel({ bookId, dateFrom, dateTo, accountId, ownerId, tags }: Props) {
  const [activeType, setActiveType] = useState('EXPENSE')
  const [loading, setLoading] = useState(false)
  const [groupData, setGroupData] = useState<Record<string, GroupData>>({})

  // 选中项
  const [selected, setSelected] = useState<SelectedInfo>(null)
  const t = useChartTheme()

  const { pieOptions, pieMaxHeight } = useMemo(() => {
    const options: Record<string, { option: EChartsOption; chartHeight: number } | null> = {}
    let maxH = 260 // 原始高度
    for (const groupBy of ['category', 'ownerId', 'accountId'] as const) {
      const rawData = groupData[groupBy] || []
      const data = rawData.map((d) => ({ name: d.label, value: d.amount })).sort((a, b) => b.value - a.value)
      if (data.length > 0) {
        const result = buildPie(data, t)
        options[groupBy] = result
        if (result.chartHeight > maxH) maxH = result.chartHeight
      } else {
        options[groupBy] = null
      }
    }
    return { pieOptions: options, pieMaxHeight: maxH }
  }, [groupData, t])

  // 详情弹窗
  const [detailOpen, setDetailOpen] = useState(false)
  const [detailRecords, setDetailRecords] = useState<RecordItem[]>([])
  const [detailLoading, setDetailLoading] = useState(false)
  const [detailPage, setDetailPage] = useState(1)
  const [detailTotal, setDetailTotal] = useState(0)
  const [detailTotalPages, setDetailTotalPages] = useState(0)
  const [detailJumpPage, setDetailJumpPage] = useState('')
  // 附加筛选
  const [detailPayer, setDetailPayer] = useState('')
  const [detailRemark, setDetailRemark] = useState('')
  const [detailAmountFrom, setDetailAmountFrom] = useState('')
  const [detailAmountTo, setDetailAmountTo] = useState('')
  const [detailFilterAccountId, setDetailFilterAccountId] = useState('')
  const [detailFilterOwnerId, setDetailFilterOwnerId] = useState('')
  const [detailTags, setDetailTags] = useState<string[]>([])
  const [availableTags, setAvailableTags] = useState<string[]>([])
  // 下拉数据
  const [detailAccounts, setDetailAccounts] = useState<AccountItem[]>([])
  const [detailUsers, setDetailUsers] = useState<AdminUser[]>([])

  useEffect(() => {
    if (bookId) {
      accountApi.list(bookId).then(setDetailAccounts).catch(() => {})
      adminApi.listUsers().then(setDetailUsers).catch(() => {})
      recordApi.getTags(bookId).then(setAvailableTags).catch(() => {})
    }
  }, [bookId])

  const loadAnalysis = useCallback(async () => {
    if (!bookId) return
    setLoading(true)
    setSelected(null)
    try {
      const params = { bookId, dateFrom, dateTo, accountId, ownerId, tags }
      const [category, owner, account] = await Promise.all([
        recordApi.groupSummary({ ...params, type: activeType, groupBy: 'category' }),
        recordApi.groupSummary({ ...params, type: activeType, groupBy: 'ownerId' }),
        recordApi.groupSummary({ ...params, type: activeType, groupBy: 'accountId' }),
      ])
      setGroupData({ category, ownerId: owner, accountId: account })
    } catch { /* ignore */ }
    finally { setLoading(false) }
  }, [bookId, activeType, dateFrom, dateTo, accountId, ownerId, tags])

  useEffect(() => { loadAnalysis() }, [loadAnalysis])

  const handlePieClick = (groupBy: string, data: GroupData) => (params: any) => {
    if (!params || !params.name) return
    const item = data.find((d) => d.label === params.name)
    if (item) {
      setSelected({ groupBy, key: item.key, label: item.label, amount: item.amount })
    }
  }

  const loadDetailRecords = async (page: number) => {
    if (!selected || !bookId) return
    setDetailLoading(true)
    try {
      const res = await recordApi.list({
        bookId,
        page,
        pageSize: 20,
        type: activeType,
        dateFrom,
        dateTo,
        accountId: selected.groupBy === 'accountId' ? selected.key : (detailFilterAccountId || accountId || undefined),
        ownerId: selected.groupBy === 'ownerId' ? selected.key : (detailFilterOwnerId || ownerId || undefined),
        categoryCode: selected.groupBy === 'category' ? selected.key : undefined,
        payer: detailPayer || undefined,
        remark: detailRemark || undefined,
        amountFrom: detailAmountFrom ? Number(detailAmountFrom) : undefined,
        amountTo: detailAmountTo ? Number(detailAmountTo) : undefined,
        tags: detailTags.length > 0 ? detailTags.join(',') : undefined,
      })
      setDetailRecords(res.records)
      setDetailPage(res.page)
      setDetailTotal(res.total)
      setDetailTotalPages(res.totalPages)
    } catch { /* ignore */ }
    finally { setDetailLoading(false) }
  }

  const TYPE_LABEL: Record<string, string> = { EXPENSE: '支出分析', INCOME: '收入分析', TRANSFER: '转账分析' }

  const handleViewDetail = () => {
    setDetailPayer('')
    setDetailRemark('')
    setDetailAmountFrom('')
    setDetailAmountTo('')
    setDetailFilterAccountId('')
    setDetailFilterOwnerId('')
    setDetailTags([])
    setDetailPage(1)
    setDetailOpen(true)
    loadDetailRecords(1)
  }

  const handleDetailFilter = () => {
    setDetailPage(1)
    loadDetailRecords(1)
  }

  const handleDetailPageChange = (page: number) => {
    setDetailPage(page)
    loadDetailRecords(page)
  }

  const handleDetailJump = () => {
    const p = parseInt(detailJumpPage, 10)
    if (p >= 1 && p <= detailTotalPages) {
      setDetailJumpPage('')
      handleDetailPageChange(p)
    }
  }

  return (
    <Card className="rounded-xl overflow-hidden">
      <CardContent className="p-4">
        <Tabs value={activeType} onValueChange={setActiveType}>
          <TabsList className="h-9 p-0.5 gap-0.5 bg-muted rounded-lg mb-4">
            {ANALYSIS_TYPES.map(({ value, label, color }) => (
              <TabsTrigger
                key={value}
                value={value}
                className="text-xs rounded-md h-8 data-[state=active]:bg-background data-[state=active]:shadow-sm"
                style={{ color: activeType === value ? color : undefined }}
              >
                {label}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>

        {loading ? (
          <div className="flex items-center justify-center py-12"><Spinner /></div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {(['category', 'ownerId', 'accountId'] as const).map((groupBy) => {
              const rawData = groupData[groupBy] || []
              const data = rawData.map((d) => ({ name: d.label, value: d.amount })).sort((a, b) => b.value - a.value)
              const isSelected = selected?.groupBy === groupBy
              return (
                <div key={groupBy} className="flex flex-col">
                  <div className="flex items-center justify-center gap-1.5 mb-1 text-sm text-muted-foreground">
                    {GROUP_ICONS[groupBy]}
                    <span>{GROUP_LABELS[groupBy]}</span>
                  </div>
                  <div style={{ width: '100%', height: pieMaxHeight, cursor: 'pointer' }}>
                    {data.length === 0 ? (
                      <div className="flex items-center justify-center h-full text-xs text-muted-foreground">暂无数据</div>
                    ) : (
                      <ReactECharts
                        option={pieOptions[groupBy]?.option}
                        notMerge={true}
                        style={{ width: '100%', height: '100%' }}
                        onEvents={{ click: handlePieClick(groupBy, rawData) }}
                      />
                    )}
                  </div>

                  {/* 选中项信息 */}
                  {isSelected && selected && (
                    <div className="mt-2 p-2 rounded-lg bg-muted/50 border border-border">
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-xs font-medium">{selected.label}</span>
                        <button onClick={() => setSelected(null)} className="hover:text-[#ef4444]">
                          <X size={14} />
                        </button>
                      </div>
                      <span className="text-sm font-bold" style={{ color: t.COLORS[rawData.findIndex((d) => d.key === selected.key) % t.COLORS.length] || 'hsl(var(--primary))' }}>
                        {formatMoney(selected.amount)}
                      </span>
                      <div className="mt-2">
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-7 text-xs w-full"
                          onClick={handleViewDetail}
                          disabled={detailLoading}
                        >
                          <List size={12} /> {detailLoading ? '加载中...' : '查看详情'}
                        </Button>
                      </div>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </CardContent>

      {/* 流水明细弹窗 */}
      <Dialog open={detailOpen} onOpenChange={setDetailOpen}>
        <DialogTrigger />
        <DialogContent className="max-w-3xl max-h-[85vh]">
          <DialogHeader>
            <DialogTitle className="text-sm flex items-center gap-2 flex-wrap">
              <span>{selected?.label}</span>
              <span className="font-normal text-muted-foreground">{formatMoney(selected?.amount ?? 0)}</span>
            </DialogTitle>
            {/* 继承的查询参数 */}
            <div className="flex items-center gap-1.5 flex-wrap mt-1">
              <span className="text-xs px-1.5 py-0.5 rounded bg-muted text-muted-foreground">{TYPE_LABEL[activeType] || activeType}</span>
              <span className="text-xs px-1.5 py-0.5 rounded bg-muted text-muted-foreground">{selected?.label}</span>
              {dateFrom && <span className="text-xs px-1.5 py-0.5 rounded bg-muted text-muted-foreground">{dateFrom} ~ {dateTo || dateFrom}</span>}
            </div>
          </DialogHeader>

          {/* 附加筛选条件 */}
          <div className="flex items-center gap-2 flex-wrap">
            {selected?.groupBy !== 'accountId' && (
              <Select value={detailFilterAccountId || 'all'} onValueChange={(v) => setDetailFilterAccountId(v === 'all' ? '' : v)}>
                <SelectTrigger className="h-8 w-28 text-xs"><SelectValue placeholder="账户" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">全部账户</SelectItem>
                  {detailAccounts.filter((a) => a.status === 'ACTIVE').map((a) => (
                    <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
            {selected?.groupBy !== 'ownerId' && (
              <Select value={detailFilterOwnerId || 'all'} onValueChange={(v) => setDetailFilterOwnerId(v === 'all' ? '' : v)}>
                <SelectTrigger className="h-8 w-24 text-xs"><SelectValue placeholder="成员" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">全部成员</SelectItem>
                  {detailUsers.map((u) => (
                    <SelectItem key={u.id} value={u.id}>{u.nickname || u.username || u.email || u.id}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
            <Input aria-label="交易方" placeholder="交易方" value={detailPayer} onChange={(e) => setDetailPayer(e.target.value)} className="h-8 w-24 text-xs" />
            <Input aria-label="备注" placeholder="备注" value={detailRemark} onChange={(e) => setDetailRemark(e.target.value)} className="h-8 w-28 text-xs" />
            <Input aria-label="金额下限" type="number" placeholder="金额≥" value={detailAmountFrom} onChange={(e) => setDetailAmountFrom(e.target.value)} className="h-8 w-20 text-xs" />
            <Input aria-label="金额上限" type="number" placeholder="金额≤" value={detailAmountTo} onChange={(e) => setDetailAmountTo(e.target.value)} className="h-8 w-20 text-xs" />
            <div className="min-w-28">
              <MultiSelect
                items={availableTags.map((t) => ({ value: t, label: t }))}
                selected={detailTags}
                onChange={setDetailTags}
                placeholder="标签"
              />
            </div>
            <Button size="sm" variant="outline" className="h-8 text-xs" onClick={handleDetailFilter}>
              筛选
            </Button>
            <span className="text-xs text-muted-foreground">共 {detailTotal} 条</span>
          </div>

          <div className="overflow-auto max-h-[50vh] relative">
            {detailLoading && (
              <div className="absolute inset-0 bg-background/60 z-10 flex items-center justify-center">
                <Spinner />
              </div>
            )}
            {!detailLoading && detailRecords.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-8">暂无数据</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="text-xs whitespace-nowrap">日期</TableHead>
                    <TableHead className="text-xs whitespace-nowrap">账户</TableHead>
                    <TableHead className="text-xs whitespace-nowrap">分类</TableHead>
                    <TableHead className="text-xs whitespace-nowrap">归属人</TableHead>
                    <TableHead className="text-xs whitespace-nowrap">交易方</TableHead>
                    <TableHead className="text-xs whitespace-nowrap">备注</TableHead>
                    <TableHead className="text-xs whitespace-nowrap text-right">金额</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {detailRecords.map((r) => (
                    <TableRow key={r.id}>
                      <TableCell className="text-xs whitespace-nowrap py-2">{r.date?.slice(0, 10)}</TableCell>
                      <TableCell className="text-xs whitespace-nowrap py-2">{r.account?.name}</TableCell>
                      <TableCell className="text-xs whitespace-nowrap py-2">{r.categoryCode || '-'}</TableCell>
                      <TableCell className="text-xs whitespace-nowrap py-2">{r.ownerName}</TableCell>
                      <TableCell className="text-xs whitespace-nowrap py-2">{r.payer || '-'}</TableCell>
                      <TableCell className="text-xs py-2 max-w-[150px] truncate">{r.remark || '-'}</TableCell>
                      <TableCell className="text-xs whitespace-nowrap py-2 text-right font-bold" style={{ color: r.type === 'INCOME' ? '#22c55e' : r.type === 'EXPENSE' ? '#ef4444' : '#3b82f6' }}>
                        {formatMoney(r.amount)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </div>

          {/* 分页 */}
          {detailTotalPages > 1 && (
            <div className="flex items-center justify-center gap-2 pt-2">
              <Button
                size="sm" variant="outline" className="h-7 text-xs"
                disabled={detailPage <= 1}
                onClick={() => handleDetailPageChange(detailPage - 1)}
              >
                <ChevronLeft size={14} /> 上一页
              </Button>
              <span className="text-xs text-muted-foreground">
                {detailPage} / {detailTotalPages}
              </span>
              <Button
                size="sm" variant="outline" className="h-7 text-xs"
                disabled={detailPage >= detailTotalPages}
                onClick={() => handleDetailPageChange(detailPage + 1)}
              >
                下一页 <ChevronRight size={14} />
              </Button>
              <Input
                aria-label="跳转页码"
                type="number"
                min={1}
                max={detailTotalPages}
                value={detailJumpPage}
                onChange={(e) => setDetailJumpPage(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleDetailJump()}
                placeholder="页码"
                className="h-7 w-16 text-xs text-center"
              />
              <Button size="sm" variant="outline" className="h-7 text-xs" onClick={handleDetailJump}>
                跳转
              </Button>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </Card>
  )
}

import { useState, useEffect, useCallback } from 'react'
import ReactECharts from 'echarts-for-react'
import type { EChartsOption } from 'echarts'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'
import {
  Table, TableHeader, TableBody, TableRow, TableHead, TableCell,
} from '@/components/ui/table'
import { Spinner } from '@/components/ui/spinner'
import { recordApi, type RecordItem } from '@/api/record'
import { PieChart, Users, Wallet, X, List, ChevronLeft, ChevronRight } from 'lucide-react'

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

const COLORS = ['#f97316', '#ef4444', '#3b82f6', '#22c55e', '#a855f7', '#eab308', '#ec4899', '#14b8a6', '#8b5cf6', '#f43f5e']

function buildPie(data: { name: string; value: number }[]): EChartsOption {
  return {
    tooltip: {
      trigger: 'item' as const,
      backgroundColor: '#1e293b',
      borderColor: '#334155',
      textStyle: { color: '#e2e8f0', fontSize: 13 },
      formatter: (p: any) => `${p.name}: ${formatMoney(p.value)} (${p.percent}%)`,
    },
    legend: {
      orient: 'horizontal' as const,
      bottom: 0,
      type: 'plain' as const,
      textStyle: { color: '#cbd5e1', fontSize: 12 },
    },
    color: COLORS,
    series: [{
      type: 'pie',
      radius: ['45%', '75%'],
      center: ['50%', '50%'],
      top: 0,
      bottom: 50,
      itemStyle: { borderRadius: 3, borderColor: 'hsl(var(--background))', borderWidth: 2 },
      label: { show: false },
      emphasis: { label: { show: true, fontSize: 14, fontWeight: 'bold' }, scaleSize: 8 },
      data,
    }],
  }
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

  // 详情弹窗
  const [detailOpen, setDetailOpen] = useState(false)
  const [detailRecords, setDetailRecords] = useState<RecordItem[]>([])
  const [detailLoading, setDetailLoading] = useState(false)
  const [detailPage, setDetailPage] = useState(1)
  const [detailTotal, setDetailTotal] = useState(0)
  const [detailTotalPages, setDetailTotalPages] = useState(0)
  const [detailDateFrom, setDetailDateFrom] = useState('')
  const [detailDateTo, setDetailDateTo] = useState('')

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

  const loadDetailRecords = async (page: number, df: string, dt: string) => {
    if (!selected || !bookId) return
    setDetailLoading(true)
    try {
      let filter: Record<string, string> = {}
      if (selected.groupBy === 'category') filter.categoryCode = selected.key
      else if (selected.groupBy === 'ownerId') filter.ownerId = selected.key
      else filter.accountId = selected.key

      const res = await recordApi.list({
        bookId,
        page,
        pageSize: 20,
        type: activeType,
        dateFrom: df || dateFrom,
        dateTo: dt || dateTo,
        accountId,
        ownerId,
        ...filter,
      })
      setDetailRecords(res.records)
      setDetailPage(res.page)
      setDetailTotal(res.total)
      setDetailTotalPages(res.totalPages)
    } catch { /* ignore */ }
    finally { setDetailLoading(false) }
  }

  const handleViewDetail = () => {
    setDetailDateFrom('')
    setDetailDateTo('')
    setDetailPage(1)
    setDetailOpen(true)
    loadDetailRecords(1, '', '')
  }

  const handleDetailPageChange = (page: number) => {
    loadDetailRecords(page, detailDateFrom, detailDateTo)
  }

  const handleDetailFilter = () => {
    setDetailPage(1)
    loadDetailRecords(1, detailDateFrom, detailDateTo)
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
                  <div style={{ width: '100%', height: 260, cursor: 'pointer' }}>
                    {data.length === 0 ? (
                      <div className="flex items-center justify-center h-full text-xs text-muted-foreground">暂无数据</div>
                    ) : (
                      <ReactECharts
                        option={buildPie(data)}
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
                      <span className="text-sm font-bold" style={{ color: COLORS[rawData.findIndex((d) => d.key === selected.key) % COLORS.length] || '#f97316' }}>
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
        <DialogContent className="max-w-3xl max-h-[85vh]">
          <DialogHeader>
            <DialogTitle className="text-sm">
              {selected?.label} — {formatMoney(selected?.amount ?? 0)}
            </DialogTitle>
          </DialogHeader>

          {/* 筛选条件 */}
          <div className="flex items-center gap-3 flex-wrap">
            <div className="flex items-center gap-1.5">
              <span className="text-xs text-muted-foreground whitespace-nowrap">日期</span>
              <Input
                type="date"
                value={detailDateFrom}
                onChange={(e) => setDetailDateFrom(e.target.value)}
                className="h-8 w-36 text-xs"
              />
              <span className="text-xs text-muted-foreground">—</span>
              <Input
                type="date"
                value={detailDateTo}
                onChange={(e) => setDetailDateTo(e.target.value)}
                className="h-8 w-36 text-xs"
              />
            </div>
            <Button size="sm" variant="outline" className="h-8 text-xs" onClick={handleDetailFilter}>
              筛选
            </Button>
            <span className="text-xs text-muted-foreground">共 {detailTotal} 条</span>
          </div>

          <div className="overflow-auto max-h-[50vh]">
            {detailLoading ? (
              <div className="flex items-center justify-center py-8"><Spinner /></div>
            ) : detailRecords.length === 0 ? (
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
            </div>
          )}
        </DialogContent>
      </Dialog>
    </Card>
  )
}

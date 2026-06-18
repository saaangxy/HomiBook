import { useState, useEffect, useCallback } from 'react'
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Spinner } from '@/components/ui/spinner'
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from '@/components/ui/table'
import ReactECharts from 'echarts-for-react'
import type { EChartsOption } from 'echarts'
import { ChevronLeft, ChevronRight, Filter, X } from 'lucide-react'
import { recordApi, type RecordItem } from '@/api/record'
import { accountApi, type AccountItem } from '@/api/account'
import type { BudgetItem } from '@/api/budget'
import { useBudgetFilterParams } from '@/hooks/useBudgetFilterParams'
import { useChartTheme, type ChartTheme } from '@/hooks/useChartTheme'
import { DictCombobox } from '@/components/DictCombobox'
import { DatePicker } from '@/components/ui/date-picker'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'

const TYPE_COLORS: Record<string, string> = {
  INCOME: '#22c55e',
  EXPENSE: '#ef4444',
  TRANSFER: '#3b82f6',
}
const TYPE_LABELS: Record<string, string> = {
  INCOME: '收入',
  EXPENSE: '支出',
  TRANSFER: '转账',
}

function formatMoney(amount: number): string {
  return new Intl.NumberFormat('zh-CN', { style: 'currency', currency: 'CNY' }).format(amount)
}

function UsageBadge({ percent }: { percent: number }) {
  let color = 'text-[#22c55e] bg-[#22c55e]/10'
  if (percent > 100) color = 'text-[#ef4444] bg-[#ef4444]/10'
  else if (percent > 80) color = 'text-primary bg-primary/10'
  else if (percent > 60) color = 'text-[#eab308] bg-[#eab308]/10'
  return <Badge className={`text-xs ${color}`}>{percent.toFixed(0)}%</Badge>
}

function buildCategoryPie(
  data: { name: string; value: number }[],
  t: ChartTheme,
): { option: EChartsOption; chartHeight: number } {
  // 图例换行时才增加空间，每额外行约14px
  const legendLines = Math.ceil(data.length / 5)
  const extraBottom = Math.max(0, legendLines - 1) * 14
  const extraHeight = Math.max(0, legendLines - 1) * 14

  const option: EChartsOption = {
    tooltip: {
      trigger: 'item',
      backgroundColor: t.cardBg,
      borderColor: t.border,
      textStyle: { color: t.cardFg, fontSize: 13 },
      formatter: (p: any) =>
        `${p.name}: ${formatMoney(p.value)} (${p.percent}%)`,
    },
    legend: {
      orient: 'horizontal',
      bottom: 0,
      type: 'plain',
      textStyle: { color: t.mutedForeground, fontSize: 11 },
    },
    color: t.COLORS,
    series: [
      {
        type: 'pie',
        radius: ['45%', '75%'],
        center: ['50%', '45%'],
        top: 0,
        bottom: 50 + extraBottom,
        itemStyle: { borderRadius: 3, borderColor: t.bg, borderWidth: 2 },
        label: { show: false },
        emphasis: { label: { show: true, fontSize: 14, fontWeight: 'bold' } },
        data,
      },
    ],
  }

  return { option, chartHeight: 220 + extraHeight }
}

function buildTrendChart(
  periods: string[],
  categories: { name: string; data: number[] }[],
  t: ChartTheme,
  isDaily: boolean,
): { option: EChartsOption; chartHeight: number } {
  const series = categories.map((cat) => ({
    name: cat.name,
    type: 'bar',
    stack: 'total',
    data: cat.data,
    emphasis: { focus: 'series' },
  }))

  // 图例换行时才增加空间，每额外行约14px
  const legendLines = Math.ceil(categories.length / 5)
  const extraBottom = Math.max(0, legendLines - 1) * 14
  const extraHeight = Math.max(0, legendLines - 1) * 14
  const gridBottom = (isDaily ? 35 : 25) + extraBottom

  const option: EChartsOption = {
    tooltip: {
      trigger: 'axis',
      axisPointer: { type: 'shadow' },
      backgroundColor: t.cardBg,
      borderColor: t.border,
      textStyle: { color: t.cardFg, fontSize: 13 },
      formatter: (params: any) => {
        if (!Array.isArray(params)) return ''
        let total = 0
        let html = `<div style="font-weight:bold;margin-bottom:4px">${params[0].axisValue}</div>`
        for (const p of params) {
          if (p.value > 0) {
            html += `<div style="display:flex;justify-content:space-between;gap:24px"><span>${p.marker}${p.seriesName}</span><span style="font-weight:bold">${formatMoney(p.value)}</span></div>`
            total += p.value
          }
        }
        html += `<div style="border-top:1px solid ${t.border};margin-top:4px;padding-top:4px;display:flex;justify-content:space-between"><span>合计</span><span style="font-weight:bold">${formatMoney(total)}</span></div>`
        return html
      },
    },
    legend: {
      orient: 'horizontal',
      bottom: 0,
      type: 'plain',
      textStyle: { color: t.mutedForeground, fontSize: 11 },
    },
    grid: { left: 10, right: 10, top: 10, bottom: gridBottom },
    xAxis: {
      type: 'category',
      data: periods,
      axisLabel: {
        color: t.mutedForeground,
        fontSize: 10,
        ...(isDaily
          ? { rotate: 45 }
          : {}),
      },
      axisLine: { lineStyle: { color: t.border } },
      axisTick: { show: false },
    },
    yAxis: {
      type: 'value',
      axisLabel: { color: t.mutedForeground, fontSize: 10, formatter: (v: number) => `¥${(v / 10000).toFixed(1)}万` },
      splitLine: { lineStyle: { color: t.border } },
    },
    color: t.COLORS,
    series,
  }

  return { option, chartHeight: 220 + extraHeight }
}

interface Props {
  budget: BudgetItem | null
  bookId: string
  onClose: () => void
}

export function BudgetDetailSheet({ budget, bookId, onClose }: Props) {
  const open = budget !== null
  const { params: filterParams, loading: filterLoading } = useBudgetFilterParams(budget)
  const t = useChartTheme()

  // Tabs
  const [activeTab, setActiveTab] = useState<'records' | 'stats'>('records')

  // Records tab
  const [records, setRecords] = useState<RecordItem[]>([])
  const [recordsLoading, setRecordsLoading] = useState(false)
  const [recordsError, setRecordsError] = useState('')
  const [page, setPage] = useState(1)
  const [totalPages, setTotalPages] = useState(0)
  const pageSize = 20

  // 筛选状态
  const [showFilters, setShowFilters] = useState(false)
  const [filterCategoryCode, setFilterCategoryCode] = useState('')
  const [filterAccountId, setFilterAccountId] = useState('')
  const [filterPayer, setFilterPayer] = useState('')
  const [filterDateFrom, setFilterDateFrom] = useState('')
  const [filterDateTo, setFilterDateTo] = useState('')
  const [filterAmountFrom, setFilterAmountFrom] = useState('')
  const [filterAmountTo, setFilterAmountTo] = useState('')
  const [accounts, setAccounts] = useState<AccountItem[]>([])

  // 加载账户列表
  useEffect(() => {
    if (open && bookId) {
      accountApi.list(bookId).then(setAccounts).catch(() => {})
    }
  }, [open, bookId])

  // Stats tab
  const [statsLoaded, setStatsLoaded] = useState(false)
  const [statsLoading, setStatsLoading] = useState(false)
  const [statsError, setStatsError] = useState('')
  const [pieData, setPieData] = useState<{ name: string; value: number }[]>([])
  const [trendPeriods, setTrendPeriods] = useState<string[]>([])
  const [trendCategories, setTrendCategories] = useState<{ name: string; data: number[] }[]>([])

  const loadRecords = useCallback(async (p: number) => {
    if (!bookId || !filterParams || filterLoading) return
    setRecordsLoading(true)
    setRecordsError('')
    try {
      const result = await recordApi.list({
        bookId,
        page: p,
        pageSize,
        type: filterParams.type,
        categoryCode: filterCategoryCode || filterParams.categoryCode,
        accountId: filterAccountId || undefined,
        payer: filterPayer || undefined,
        tags: filterParams.tags,
        dateFrom: filterDateFrom || filterParams.dateFrom,
        dateTo: filterDateTo || filterParams.dateTo,
        amountFrom: filterAmountFrom ? Number(filterAmountFrom) : undefined,
        amountTo: filterAmountTo ? Number(filterAmountTo) : undefined,
      })
      setRecords(result.records)
      setTotalPages(result.totalPages)
    } catch (e: any) {
      setRecordsError(e.message || '加载失败')
    } finally {
      setRecordsLoading(false)
    }
  }, [bookId, filterParams, filterLoading, filterCategoryCode, filterAccountId, filterPayer, filterDateFrom, filterDateTo, filterAmountFrom, filterAmountTo])

  const loadStats = useCallback(async () => {
    if (!bookId || !filterParams || filterLoading || statsLoaded) return
    setStatsLoading(true)
    setStatsError('')
    try {
      // 分类分布
      const categoryData = await recordApi.categorySummary({
        bookId,
        type: filterParams.type,
        tags: filterParams.tags,
        dateFrom: filterParams.dateFrom,
        dateTo: filterParams.dateTo,
      })
      const total = categoryData.reduce((s, d) => s + d.amount, 0)
      setPieData(
        categoryData
          .filter((d) => d.amount > 0)
          .sort((a, b) => b.amount - a.amount)
          .map((d) => ({
            name: d.categoryName,
            value: Math.round(d.amount * 100) / 100,
          })),
      )

      // 趋势图：FIXED 预算按日，FREE 按日/月
      const dFrom = filterParams.dateFrom
      const dTo = filterParams.dateTo
      let granularity: 'daily' | 'monthly' = 'daily'
      if (dFrom && dTo) {
        const diffDays = (new Date(dTo).getTime() - new Date(dFrom).getTime()) / (1000 * 60 * 60 * 24)
        if (diffDays > 62) granularity = 'monthly'
      }

      const trendData = await recordApi.categoryTrend({
        bookId,
        type: filterParams.type,
        granularity,
        dateFrom: filterParams.dateFrom,
        dateTo: filterParams.dateTo,
        tags: filterParams.tags,
      })
      setTrendPeriods(trendData.periods)
      setTrendCategories(
        trendData.categories
          .filter((c) => c.data.some((v) => v > 0))
          .map((c) => ({
            name: c.name,
            data: c.data.map((v) => Math.round(v * 100) / 100),
          })),
      )

      setStatsLoaded(true)
    } catch (e: any) {
      setStatsError(e.message || '加载统计失败')
    } finally {
      setStatsLoading(false)
    }
  }, [bookId, filterParams, filterLoading, statsLoaded])

  // Record loading - budget 或用户筛选条件变化时重新加载
  useEffect(() => {
    if (open && filterParams && !filterLoading) {
      setPage(1)
      loadRecords(1)
    }
  }, [open, filterParams, filterLoading, filterCategoryCode, filterAccountId, filterPayer, filterDateFrom, filterDateTo, filterAmountFrom, filterAmountTo])

  // Page change
  const handlePageChange = (newPage: number) => {
    setPage(newPage)
    loadRecords(newPage)
  }

  // Reset on budget change
  useEffect(() => {
    setActiveTab('records')
    setStatsLoaded(false)
    setRecordsError('')
    setStatsError('')
    setShowFilters(false)
    setFilterCategoryCode('')
    setFilterAccountId('')
    setFilterPayer('')
    setFilterDateFrom('')
    setFilterDateTo('')
    setFilterAmountFrom('')
    setFilterAmountTo('')
  }, [budget?.id])

  // Load stats on tab switch
  useEffect(() => {
    if (activeTab === 'stats' && open) {
      loadStats()
    }
  }, [activeTab, open])

  const actual = budget?.actualAmount ?? 0
  const budgetAmount = budget?.amount ?? 0
  const remaining = budgetAmount - actual
  const percent = budgetAmount > 0 ? (actual / budgetAmount) * 100 : 0

  const isDaily = (() => {
    if (!filterParams.dateFrom || !filterParams.dateTo) return false
    const diff = (new Date(filterParams.dateTo).getTime() - new Date(filterParams.dateFrom).getTime()) / (1000 * 60 * 60 * 24)
    return diff <= 62
  })()

  return (
    <Sheet open={open} onOpenChange={(o) => { if (!o) onClose() }}>
      <SheetContent side="right" className="w-full sm:max-w-lg lg:max-w-xl flex flex-col">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2">
            {budget?.name}
            <Badge variant="outline" className={budget?.type === 'FIXED' ? 'text-xs border-[#3b82f6]/50 text-[#3b82f6]' : 'text-xs border-primary/50 text-primary'}>
              {budget?.type === 'FIXED' ? '固定' : '自由'}
            </Badge>
          </SheetTitle>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
            <span>预算 ¥{budgetAmount.toFixed(2)}</span>
            <span>实际 ¥{actual.toFixed(2)}</span>
            <span className={remaining < 0 ? 'text-[#ef4444]' : 'text-[#22c55e]'}>
              {remaining < 0 ? '超支' : '剩余'} ¥{Math.abs(remaining).toFixed(2)}
            </span>
            <UsageBadge percent={percent} />
          </div>
        </SheetHeader>

        <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as 'records' | 'stats')} className="flex-1 flex flex-col min-h-0 mt-4">
          <TabsList className="w-full">
            <TabsTrigger value="records" className="flex-1 text-xs">记录明细</TabsTrigger>
            <TabsTrigger value="stats" className="flex-1 text-xs">统计图表</TabsTrigger>
          </TabsList>

          {/* 筛选切换按钮 */}
          {activeTab === 'records' && (
            <div className="flex items-center gap-1 mt-2">
              <Button
                variant="ghost"
                size="sm"
                className="h-7 text-xs gap-1"
                onClick={() => setShowFilters((v) => !v)}
              >
                <Filter size={12} />
                筛选
                {showFilters && <X size={12} className="ml-0.5" />}
              </Button>
              {showFilters && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 text-xs text-muted-foreground"
                  onClick={() => {
                    setFilterCategoryCode('')
                    setFilterAccountId('')
                    setFilterPayer('')
                    setFilterDateFrom('')
                    setFilterDateTo('')
                    setFilterAmountFrom('')
                    setFilterAmountTo('')
                  }}
                >
                  清除
                </Button>
              )}
            </div>
          )}

          {/* 筛选区域 */}
          {activeTab === 'records' && showFilters && (
            <div className="space-y-2 mt-2">
              <div className="grid grid-cols-3 gap-2">
                <div>
                  <Label className="text-[10px] text-muted-foreground mb-0.5 block">分类</Label>
                  <DictCombobox
                    groups={['transaction_category_expense', 'transaction_category_income']}
                    value={filterCategoryCode}
                    onChange={setFilterCategoryCode}
                    placeholder="全部分类"
                    className="h-7 text-xs"
                  />
                </div>
                <div>
                  <Label className="text-[10px] text-muted-foreground mb-0.5 block">账户</Label>
                  <Select value={filterAccountId} onValueChange={setFilterAccountId}>
                    <SelectTrigger className="h-7 text-xs bg-background border-border">
                      <SelectValue placeholder="全部账户" />
                    </SelectTrigger>
                    <SelectContent>
                      {accounts.map((a) => (
                        <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label className="text-[10px] text-muted-foreground mb-0.5 block">交易方</Label>
                  <Input
                    placeholder="交易方名称"
                    value={filterPayer}
                    onChange={(e) => setFilterPayer(e.target.value)}
                    className="h-7 text-xs"
                  />
                </div>
              </div>
              <div className="grid grid-cols-4 gap-2">
                <div>
                  <Label className="text-[10px] text-muted-foreground mb-0.5 block">日期从</Label>
                  <DatePicker
                    value={filterDateFrom}
                    onChange={setFilterDateFrom}
                    placeholder="起始日期"
                    compact
                    className="h-7"
                  />
                </div>
                <div>
                  <Label className="text-[10px] text-muted-foreground mb-0.5 block">日期至</Label>
                  <DatePicker
                    value={filterDateTo}
                    onChange={setFilterDateTo}
                    placeholder="结束日期"
                    compact
                    className="h-7"
                  />
                </div>
                <div>
                  <Label className="text-[10px] text-muted-foreground mb-0.5 block">金额从</Label>
                  <Input
                    type="number"
                    placeholder="最低金额"
                    value={filterAmountFrom}
                    onChange={(e) => setFilterAmountFrom(e.target.value)}
                    className="h-7 text-xs"
                  />
                </div>
                <div>
                  <Label className="text-[10px] text-muted-foreground mb-0.5 block">金额至</Label>
                  <Input
                    type="number"
                    placeholder="最高金额"
                    value={filterAmountTo}
                    onChange={(e) => setFilterAmountTo(e.target.value)}
                    className="h-7 text-xs"
                  />
                </div>
              </div>
            </div>
          )}

          {/* 记录明细 Tab */}
          {activeTab === 'records' && (
            <div className="flex-1 flex flex-col min-h-0 mt-3">
              <div className="flex-1 overflow-auto relative">
                {recordsLoading && (
                  <div className="absolute inset-0 bg-background/60 z-10 flex items-center justify-center">
                    <Spinner />
                  </div>
                )}
                {recordsError && (
                  <p className="text-sm text-[#ef4444] text-center py-8">{recordsError}</p>
                )}
                {!recordsLoading && !recordsError && records.length === 0 ? (
                  <p className="text-sm text-muted-foreground text-center py-8">暂无匹配记录</p>
                ) : (
                  !recordsError && (
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
                        {records.map((r) => (
                          <TableRow key={r.id}>
                            <TableCell className="text-xs whitespace-nowrap py-2">{r.date?.slice(0, 10)}</TableCell>
                            <TableCell className="text-xs whitespace-nowrap py-2">{r.account?.name}</TableCell>
                            <TableCell className="text-xs whitespace-nowrap py-2">{r.categoryCode || '-'}</TableCell>
                            <TableCell className="text-xs whitespace-nowrap py-2">{r.ownerName}</TableCell>
                            <TableCell className="text-xs whitespace-nowrap py-2">{r.payer || '-'}</TableCell>
                            <TableCell className="text-xs py-2 max-w-[120px] truncate">{r.remark || '-'}</TableCell>
                            <TableCell className="text-xs whitespace-nowrap py-2 text-right font-bold" style={{ color: TYPE_COLORS[r.type] || '#888' }}>
                              {formatMoney(r.amount)}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  )
                )}
              </div>

              {totalPages > 1 && (
                <div className="flex items-center justify-center gap-2 pt-2 shrink-0">
                  <Button size="sm" variant="outline" className="h-7 text-xs" disabled={page <= 1} onClick={() => handlePageChange(page - 1)}>
                    <ChevronLeft size={14} /> 上一页
                  </Button>
                  <span className="text-xs text-muted-foreground">{page} / {totalPages}</span>
                  <Button size="sm" variant="outline" className="h-7 text-xs" disabled={page >= totalPages} onClick={() => handlePageChange(page + 1)}>
                    下一页 <ChevronRight size={14} />
                  </Button>
                </div>
              )}
            </div>
          )}

          {/* 统计图表 Tab */}
          {activeTab === 'stats' && (
            <div className="flex-1 overflow-auto mt-3 space-y-4">
              {statsLoading && (
                <div className="flex items-center justify-center py-12">
                  <Spinner />
                </div>
              )}
              {statsError && (
                <p className="text-sm text-[#ef4444] text-center py-8">{statsError}</p>
              )}
              {!statsLoading && !statsError && (
                <>
                  {/* Summary 卡片 */}
                  <div className="grid grid-cols-3 gap-2">
                    <div className="rounded-md border p-3 text-center">
                      <div className="text-xs text-muted-foreground mb-1">总支出</div>
                      <div className="text-sm font-bold text-[#ef4444]">{formatMoney(actual)}</div>
                    </div>
                    <div className="rounded-md border p-3 text-center">
                      <div className="text-xs text-muted-foreground mb-1">剩余预算</div>
                      <div className={`text-sm font-bold ${remaining < 0 ? 'text-[#ef4444]' : 'text-[#22c55e]'}`}>
                        {formatMoney(remaining)}
                      </div>
                    </div>
                    <div className="rounded-md border p-3 text-center">
                      <div className="text-xs text-muted-foreground mb-1">使用率</div>
                      <div className="text-sm font-bold">{percent.toFixed(0)}%</div>
                    </div>
                  </div>

                  {/* 饼图 */}
                  {pieData.length > 0 ? (
                    <div>
                      <h4 className="text-xs font-medium text-muted-foreground mb-1">分类分布</h4>
                      {(() => {
                        const { option, chartHeight } = buildCategoryPie(pieData, t)
                        return <ReactECharts option={option} style={{ height: chartHeight }} />
                      })()}
                    </div>
                  ) : (
                    <p className="text-sm text-muted-foreground text-center py-4">暂无分类数据</p>
                  )}

                  {/* 趋势图 */}
                  {trendPeriods.length > 0 && trendCategories.length > 0 ? (
                    <div>
                      <h4 className="text-xs font-medium text-muted-foreground mb-1">支出趋势</h4>
                  {(() => {
                    const { option, chartHeight } = buildTrendChart(trendPeriods, trendCategories, t, isDaily)
                    return <ReactECharts option={option} style={{ height: chartHeight }} />
                  })()}
                    </div>
                  ) : (
                    <p className="text-sm text-muted-foreground text-center py-4">暂无趋势数据</p>
                  )}
                </>
              )}
            </div>
          )}
        </Tabs>
      </SheetContent>
    </Sheet>
  )
}

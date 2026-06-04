import { useState, useEffect, useCallback } from 'react'
import ReactECharts from 'echarts-for-react'
import type { EChartsOption } from 'echarts'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Spinner } from '@/components/ui/spinner'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { MultiSelect } from '@/components/ui/multi-select'
import { DatePicker } from '@/components/ui/date-picker'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'
import {
  Table, TableHeader, TableBody, TableRow, TableHead, TableCell,
} from '@/components/ui/table'
import { recordApi, type RecordSummary, type RecordItem } from '@/api/record'
import { accountApi, type AccountItem } from '@/api/account'
import { adminApi, type AdminUser } from '@/api/admin'
import { AnalysisPanel } from './AnalysisPanel'
import { BarChart3, Search, X, List, ChevronLeft, ChevronRight } from 'lucide-react'
import dayjs from 'dayjs'

function formatMoney(amount: number): string {
  return new Intl.NumberFormat('zh-CN', { style: 'currency', currency: 'CNY' }).format(amount)
}

const COLORS = ['#f97316', '#ef4444', '#3b82f6', '#22c55e', '#a855f7', '#eab308', '#ec4899', '#14b8a6', '#8b5cf6', '#f43f5e']

const chartTextStyle = {
  legend: { textStyle: { color: '#cbd5e1' } },
  xAxis: { axisLabel: { color: '#94a3b8' }, axisLine: { lineStyle: { color: '#334155' } } },
  yAxis: { axisLabel: { color: '#94a3b8' }, splitLine: { lineStyle: { color: '#1e293b' } } },
  tooltip: { backgroundColor: '#1e293b', borderColor: '#334155', textStyle: { color: '#e2e8f0' } },
}

function buildStackedBar(periods: string[], categories: { name: string; data: number[] }[]): EChartsOption {
  return {
    ...chartTextStyle,
    tooltip: {
      ...chartTextStyle.tooltip,
      trigger: 'axis' as const,
      axisPointer: { type: 'shadow' as const },
      formatter: (params: any) => {
        let html = `<b>${params[0].axisValue}</b><br/>`
        let total = 0
        for (const p of params) { total += p.value; html += `${p.marker} ${p.seriesName}: ${formatMoney(p.value)}<br/>` }
        html += `<hr/>合计: ${formatMoney(total)}`
        return html
      },
    },
    legend: { type: 'plain' as const, top: 0, ...chartTextStyle.legend },
    grid: { top: 60, right: 20, bottom: 40, left: 60 },
    xAxis: { type: 'category' as const, data: periods, axisLabel: { ...chartTextStyle.xAxis.axisLabel, rotate: 45, fontSize: 11, formatter: (v: string) => v.length > 7 ? v.slice(5) : v } },
    yAxis: { type: 'value' as const, ...chartTextStyle.yAxis, axisLabel: { ...chartTextStyle.yAxis.axisLabel, formatter: (v: number) => v >= 10000 ? `${(v / 10000).toFixed(1)}万` : String(v) } },
    color: COLORS,
    series: categories.map((c) => ({
      name: c.name,
      type: 'bar' as const,
      data: c.data,
      stack: 'total',
      emphasis: { focus: 'series' as const },
    })),
  }
}

function buildRadarOption(metrics: { name: string; value: number }[]): EChartsOption {
  return {
    ...chartTextStyle,
    tooltip: { trigger: 'item' as const },
    legend: { show: false },
    radar: {
      center: ['50%', '50%'],
      radius: '55%',
      indicator: metrics.map((m) => ({ name: m.name, max: 100 })),
      axisName: { color: '#cbd5e1', fontSize: 11 },
      splitArea: { areaStyle: { color: ['transparent'] } },
      splitLine: { lineStyle: { color: '#334155' } },
    },
    series: [{
      type: 'radar',
      data: [{ value: metrics.map((m) => m.value), name: '财务健康', areaStyle: { color: 'rgba(249,115,22,0.2)' }, lineStyle: { color: '#f97316' }, itemStyle: { color: '#f97316' } }],
    }],
  }
}

function computeRadar(summary: RecordSummary, catCount: number): { name: string; value: number }[] {
  const income = summary.income || 1
  const expense = summary.expense || 0
  return [
    { name: '储蓄率', value: Math.min(100, Math.max(0, Math.round((income - expense) / income * 100))) },
    { name: '收支比', value: Math.min(100, Math.max(0, Math.round((1 - expense / (income + expense)) * 100))) },
    { name: '活跃度', value: Math.min(100, Math.round(catCount / 10 * 100)) },
    { name: '分类分散度', value: Math.min(100, Math.round(catCount / 10 * 100)) },
    { name: '收支平衡', value: income > expense ? 100 : Math.min(100, Math.max(0, Math.round(income / Math.max(expense, 1) * 100))) },
  ]
}

interface Props {
  bookId: string
  mode: 'yearly' | 'monthly' | 'free'
}

export function StatsTimeView({ bookId, mode }: Props) {
  const now = dayjs()
  const [year, setYear] = useState(now.year())
  const [month, setMonth] = useState(now.month() + 1)

  // 自由筛选状态
  const [freeDateFrom, setFreeDateFrom] = useState('')
  const [freeDateTo, setFreeDateTo] = useState('')
  const [freeAccountIds, setFreeAccountIds] = useState<string[]>([])
  const [freeOwnerIds, setFreeOwnerIds] = useState<string[]>([])
  const [searched, setSearched] = useState(false)
  const [searchParams, setSearchParams] = useState<{
    dateFrom?: string; dateTo?: string; accountId?: string; ownerId?: string
  }>({})

  const [summary, setSummary] = useState<RecordSummary>({ income: 0, expense: 0, transfer: 0, netIncome: 0 })
  const [loading, setLoading] = useState(false)
  const [periods, setPeriods] = useState<string[]>([])
  const [categories, setCategories] = useState<{ code: string | null; name: string; data: number[] }[]>([])
  const [radarMetrics, setRadarMetrics] = useState<{ name: string; value: number }[]>([])

  // 堆叠柱状图选中
  const [barSelected, setBarSelected] = useState<{ code: string | null; name: string; period: string } | null>(null)
  const [barDetailOpen, setBarDetailOpen] = useState(false)
  const [barDetailRecords, setBarDetailRecords] = useState<RecordItem[]>([])
  const [barDetailLoading, setBarDetailLoading] = useState(false)
  const [barDetailPage, setBarDetailPage] = useState(1)
  const [barDetailTotal, setBarDetailTotal] = useState(0)
  const [barDetailTotalPages, setBarDetailTotalPages] = useState(0)
  const [barDetailDateFrom, setBarDetailDateFrom] = useState('')
  const [barDetailDateTo, setBarDetailDateTo] = useState('')

  // 基础数据
  const [accounts, setAccounts] = useState<AccountItem[]>([])
  const [users, setUsers] = useState<AdminUser[]>([])

  useEffect(() => {
    accountApi.list(bookId).then(setAccounts).catch(() => {})
    adminApi.listUsers().then(setUsers).catch(() => {})
  }, [bookId])

  const loadData = useCallback(async () => {
    if (!bookId) return
    setLoading(true)
    setBarSelected(null)
    try {
      let params: { dateFrom?: string; dateTo?: string; accountId?: string; ownerId?: string }

      if (mode === 'free') {
        params = { ...searchParams }
      } else if (mode === 'yearly') {
        params = {
          dateFrom: `${year}-01-01`,
          dateTo: `${year}-12-31`,
        }
      } else {
        const daysInMonth = new Date(year, month, 0).getDate()
        params = {
          dateFrom: `${year}-${String(month).padStart(2, '0')}-01`,
          dateTo: `${year}-${String(month).padStart(2, '0')}-${String(daysInMonth).padStart(2, '0')}`,
        }
      }

      const [trendData, summaryData] = await Promise.all([
        recordApi.categoryTrend({
          bookId,
          type: 'EXPENSE',
          granularity: mode === 'yearly' ? 'monthly' : 'daily',
          year: mode === 'free' ? undefined : year,
          month: mode === 'monthly' ? month : undefined,
          dateFrom: mode === 'free' ? params.dateFrom : undefined,
          dateTo: mode === 'free' ? params.dateTo : undefined,
          accountId: params.accountId,
          ownerId: params.ownerId,
        }),
        recordApi.summary({ bookId, ...params }),
      ])

      setPeriods(trendData.periods)
      setCategories(trendData.categories.filter((c) => c.data.some((v) => v > 0)))
      setSummary(summaryData)
      setRadarMetrics(computeRadar(summaryData, trendData.categories.length))
    } catch { /* ignore */ }
    finally { setLoading(false) }
  }, [bookId, mode, year, month, searchParams, searched])

  useEffect(() => {
    if (mode === 'free' && !searched) return
    loadData()
  }, [loadData])

  const handleSearch = () => {
    setSearchParams({
      dateFrom: freeDateFrom || undefined,
      dateTo: freeDateTo || undefined,
      accountId: freeAccountIds.length > 0 ? freeAccountIds.join(',') : undefined,
      ownerId: freeOwnerIds.length > 0 ? freeOwnerIds.join(',') : undefined,
    })
    setSearched(true)
  }

  const handleBarClick = (params: any) => {
    if (!params || !params.seriesName || !params.name) return
    const cat = categories.find((c) => c.name === params.seriesName)
    setBarSelected({ code: cat?.code ?? null, name: params.seriesName, period: params.name })
  }

  const loadBarDetail = async (page: number, df: string, dt: string) => {
    if (!barSelected || !bookId) return
    setBarDetailLoading(true)
    try {
      let dateFrom: string
      let dateTo: string
      if (barSelected.period.length === 7) {
        const [y, m] = barSelected.period.split('-').map(Number)
        dateFrom = `${y}-${String(m).padStart(2, '0')}-01`
        const daysInMonth = new Date(y, m, 0).getDate()
        dateTo = `${y}-${String(m).padStart(2, '0')}-${String(daysInMonth).padStart(2, '0')}`
      } else {
        dateFrom = barSelected.period
        dateTo = barSelected.period
      }
      const res = await recordApi.list({
        bookId,
        page,
        pageSize: 20,
        type: 'EXPENSE',
        dateFrom: df || dateFrom,
        dateTo: dt || dateTo,
        categoryCode: barSelected.code ?? undefined,
      })
      setBarDetailRecords(res.records)
      setBarDetailPage(res.page)
      setBarDetailTotal(res.total)
      setBarDetailTotalPages(res.totalPages)
    } catch { /* ignore */ }
    finally { setBarDetailLoading(false) }
  }

  const handleBarViewDetail = () => {
    setBarDetailDateFrom('')
    setBarDetailDateTo('')
    setBarDetailPage(1)
    setBarDetailOpen(true)
    loadBarDetail(1, '', '')
  }

  const handleBarDetailPageChange = (page: number) => {
    loadBarDetail(page, barDetailDateFrom, barDetailDateTo)
  }

  const handleBarDetailFilter = () => {
    setBarDetailPage(1)
    loadBarDetail(1, barDetailDateFrom, barDetailDateTo)
  }

  return (
    <div>
      {/* 时间选择器 */}
      <div className="flex items-center gap-4 mb-6 flex-wrap">
        {mode === 'yearly' && (
          <div className="flex items-center gap-2">
            <Select value={String(year)} onValueChange={(v) => setYear(Number(v))}>
              <SelectTrigger className="h-9 w-28"><SelectValue /></SelectTrigger>
              <SelectContent>
                {Array.from({ length: 10 }, (_, i) => now.year() - 5 + i).map((y) => (
                  <SelectItem key={y} value={String(y)}>{y} 年</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}
        {mode === 'monthly' && (
          <div className="flex items-center gap-2">
            <Select value={String(year)} onValueChange={(v) => setYear(Number(v))}>
              <SelectTrigger className="h-9 w-28"><SelectValue /></SelectTrigger>
              <SelectContent>
                {Array.from({ length: 10 }, (_, i) => now.year() - 5 + i).map((y) => (
                  <SelectItem key={y} value={String(y)}>{y}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <span className="text-sm">年</span>
            <Select value={String(month)} onValueChange={(v) => setMonth(Number(v))}>
              <SelectTrigger className="h-9 w-24"><SelectValue /></SelectTrigger>
              <SelectContent>
                {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => (
                  <SelectItem key={m} value={String(m)}>{m} 月</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}

        {/* 自由筛选 */}
        {mode === 'free' && (
          <div className="flex items-center gap-3 flex-wrap">
            <div>
              <Label className="text-xs text-muted-foreground mb-1 block">开始日期</Label>
              <DatePicker value={freeDateFrom} onChange={setFreeDateFrom} />
            </div>
            <div>
              <Label className="text-xs text-muted-foreground mb-1 block">结束日期</Label>
              <DatePicker value={freeDateTo} onChange={setFreeDateTo} />
            </div>
            <div className="min-w-36">
              <Label className="text-xs text-muted-foreground mb-1 block">账户</Label>
              <MultiSelect
                items={accounts.filter((a) => a.status === 'ACTIVE').map((a) => ({ value: a.id, label: a.name }))}
                selected={freeAccountIds}
                onChange={setFreeAccountIds}
                placeholder="全部"
              />
            </div>
            <div className="min-w-36">
              <Label className="text-xs text-muted-foreground mb-1 block">成员</Label>
              <MultiSelect
                items={users.map((u) => ({ value: u.id, label: u.name || u.email || u.id }))}
                selected={freeOwnerIds}
                onChange={setFreeOwnerIds}
                placeholder="全部"
              />
            </div>
            <Button onClick={handleSearch} className="bg-[#f97316] hover:bg-[#ea580c] text-white h-9 mt-5">
              <Search size={14} /> 搜索
            </Button>
          </div>
        )}
      </div>

      {/* 自由筛选未搜索提示 */}
      {mode === 'free' && !searched && (
        <Card className="rounded-xl mb-6">
          <CardContent className="flex flex-col items-center justify-center py-12 text-center gap-2">
            <Search size={40} className="opacity-30" />
            <p className="text-base">设置筛选条件后点击搜索</p>
            <p className="text-[13px] text-muted-foreground">自由筛选不会自动查询数据</p>
          </CardContent>
        </Card>
      )}

      {(mode !== 'free' || searched) && (
        loading ? (
          <div className="flex items-center justify-center py-20"><Spinner /></div>
        ) : (
          <>
            {/* 汇总卡片 + 雷达图 左右布局 */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-6">
              {/* 左侧：收支汇总 2x2 */}
              <div className="lg:col-span-2">
                <div className="grid grid-cols-2 gap-3 h-full">
                  {([
                    { label: '总收入', value: summary.income, color: 'text-[#22c55e]' },
                    { label: '总支出', value: summary.expense, color: 'text-[#ef4444]' },
                    { label: '净收入', value: summary.netIncome, color: summary.netIncome >= 0 ? 'text-[#22c55e]' : 'text-[#ef4444]' },
                    { label: '转账总额', value: summary.transfer, color: 'text-[#3b82f6]' },
                  ] as const).map(({ label, value, color }) => (
                    <Card key={label} className="rounded-xl flex items-center justify-center">
                      <CardContent className="p-3 text-center">
                        <p className="text-sm text-muted-foreground">{label}</p>
                        <p className={`text-lg font-bold tabular-nums mt-0.5 ${color}`}>
                          {loading ? '...' : formatMoney(value)}
                        </p>
                      </CardContent>
                    </Card>
                  ))}
                </div>
              </div>
              {/* 右侧：雷达图 */}
              <Card className="rounded-xl overflow-hidden">
                <CardContent className="p-4">
                  <div className="flex items-center gap-2 mb-3">
                    <BarChart3 size={18} className="text-[#f97316]" />
                    <h3 className="text-sm font-semibold">财务健康评估</h3>
                  </div>
                  <div style={{ height: 240 }}>
                    <ReactECharts option={buildRadarOption(radarMetrics)} style={{ width: '100%', height: '100%' }} />
                  </div>
                </CardContent>
              </Card>
            </div>

            {/* 分析面板 */}
            <div className="mb-6">
              <AnalysisPanel
                bookId={bookId}
                dateFrom={mode === 'free' ? searchParams.dateFrom : (mode === 'yearly' ? `${year}-01-01` : `${year}-${String(month).padStart(2, '0')}-01`)}
                dateTo={mode === 'free' ? searchParams.dateTo : (mode === 'yearly' ? `${year}-12-31` : `${year}-${String(month).padStart(2, '0')}-${String(new Date(year, month, 0).getDate()).padStart(2, '0')}`)}
                accountId={mode === 'free' ? searchParams.accountId : undefined}
                ownerId={mode === 'free' ? searchParams.ownerId : undefined}
              />
            </div>

            {/* 堆叠柱状图 */}
            <Card className="rounded-xl overflow-hidden mb-6">
              <CardContent className="p-4">
                <div className="flex items-center gap-2 mb-3">
                  <BarChart3 size={18} className="text-[#f97316]" />
                  <h3 className="text-sm font-semibold">
                    {mode === 'yearly' ? '各月分类支出构成' : '每日分类支出构成'}
                  </h3>
                </div>
                <div style={{ height: 400, cursor: 'pointer' }}>
                  {periods.length === 0 ? (
                    <div className="flex items-center justify-center h-full text-xs text-muted-foreground">暂无数据</div>
                  ) : (
                    <ReactECharts
                      option={buildStackedBar(periods, categories)}
                      style={{ width: '100%', height: '100%' }}
                      onEvents={{ click: handleBarClick }}
                    />
                  )}
                </div>

                {/* 选中柱段信息 */}
                {barSelected && (
                  <div className="mt-3 p-3 rounded-lg bg-muted/50 border border-border">
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-xs text-muted-foreground">
                        {barSelected.period} · {barSelected.name}
                      </span>
                      <button onClick={() => setBarSelected(null)} className="hover:text-[#ef4444]">
                        <X size={14} />
                      </button>
                    </div>
                    <span className="text-sm font-bold text-[#f97316]">
                      {formatMoney(
                        categories
                          .find((c) => c.name === barSelected.name)
                          ?.data[periods.indexOf(barSelected.period)] ?? 0
                      )}
                    </span>
                    <div className="mt-2">
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-7 text-xs w-full"
                        onClick={handleBarViewDetail}
                        disabled={barDetailLoading}
                      >
                        <List size={12} /> {barDetailLoading ? '加载中...' : '查看详情'}
                      </Button>
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          </>
        )
      )}

      {/* 堆叠柱状图详情弹窗 */}
      <Dialog open={barDetailOpen} onOpenChange={setBarDetailOpen}>
        <DialogContent className="max-w-3xl max-h-[85vh]">
          <DialogHeader>
            <DialogTitle className="text-sm">
              {barSelected?.period} · {barSelected?.name}
            </DialogTitle>
          </DialogHeader>

          {/* 筛选条件 */}
          <div className="flex items-center gap-3 flex-wrap">
            <div className="flex items-center gap-1.5">
              <span className="text-xs text-muted-foreground whitespace-nowrap">日期</span>
              <Input
                type="date"
                value={barDetailDateFrom}
                onChange={(e) => setBarDetailDateFrom(e.target.value)}
                className="h-8 w-36 text-xs"
              />
              <span className="text-xs text-muted-foreground">—</span>
              <Input
                type="date"
                value={barDetailDateTo}
                onChange={(e) => setBarDetailDateTo(e.target.value)}
                className="h-8 w-36 text-xs"
              />
            </div>
            <Button size="sm" variant="outline" className="h-8 text-xs" onClick={handleBarDetailFilter}>
              筛选
            </Button>
            <span className="text-xs text-muted-foreground">共 {barDetailTotal} 条</span>
          </div>

          <div className="overflow-auto max-h-[50vh]">
            {barDetailLoading ? (
              <div className="flex items-center justify-center py-8"><Spinner /></div>
            ) : barDetailRecords.length === 0 ? (
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
                  {barDetailRecords.map((r) => (
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
          {barDetailTotalPages > 1 && (
            <div className="flex items-center justify-center gap-2 pt-2">
              <Button
                size="sm" variant="outline" className="h-7 text-xs"
                disabled={barDetailPage <= 1}
                onClick={() => handleBarDetailPageChange(barDetailPage - 1)}
              >
                <ChevronLeft size={14} /> 上一页
              </Button>
              <span className="text-xs text-muted-foreground">
                {barDetailPage} / {barDetailTotalPages}
              </span>
              <Button
                size="sm" variant="outline" className="h-7 text-xs"
                disabled={barDetailPage >= barDetailTotalPages}
                onClick={() => handleBarDetailPageChange(barDetailPage + 1)}
              >
                下一页 <ChevronRight size={14} />
              </Button>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}

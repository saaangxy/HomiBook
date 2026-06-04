import { useState, useEffect, useCallback } from 'react'
import ReactECharts from 'echarts-for-react'
import type { EChartsOption } from 'echarts'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Label } from '@/components/ui/label'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Alert, AlertDescription } from '@/components/ui/alert'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'
import {
  Table, TableHeader, TableBody, TableRow, TableHead, TableCell,
} from '@/components/ui/table'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import { DatePicker } from '@/components/ui/date-picker'
import { MultiSelect } from '@/components/ui/multi-select'
import { Spinner } from '@/components/ui/spinner'
import { recordApi, type RecordSummary } from '@/api/record'
import { accountApi, type AccountItem } from '@/api/account'
import { adminApi, type AdminUser } from '@/api/admin'
import { settingsApi, type DictItem } from '@/api/settings'
import { useBookStore } from '../stores/book'
import {
  ArrowUpRight, ArrowDownRight, BarChart3, Filter, X, TrendingUp, PieChart, Wallet,
} from 'lucide-react'

function formatMoney(amount: number): string {
  return new Intl.NumberFormat('zh-CN', { style: 'currency', currency: 'CNY' }).format(amount)
}

interface FilterState {
  dateFrom: string
  dateTo: string
  accountIds: string[]
  categoryCodes: string[]
  ownerIds: string[]
  type: 'INCOME' | 'EXPENSE' | ''
}

interface DetailData {
  title: string
  headers: string[]
  rows: string[][]
}

// ---------- 图表共用配置 ----------
const chartBaseStyle: React.CSSProperties = { width: '100%', height: '100%' }

function buildPieOption(
  data: { name: string; value: number }[],
): EChartsOption {
  const colors = ['#f97316', '#ef4444', '#3b82f6', '#22c55e', '#a855f7', '#eab308', '#ec4899', '#14b8a6', '#8b5cf6', '#f43f5e']
  return {
    tooltip: {
      trigger: 'item' as const,
      backgroundColor: '#1e293b',
      borderColor: '#334155',
      textStyle: { color: '#e2e8f0' },
      formatter: (p: any) => `${p.name}: ${formatMoney(p.value)} (${p.percent}%)`,
    },
    legend: {
      type: 'scroll' as const,
      orient: 'vertical' as const,
      right: 10,
      top: 'center',
      textStyle: { color: '#cbd5e1' },
      formatter: (name: string) => name.length > 6 ? name.slice(0, 6) + '…' : name,
    },
    color: colors,
    series: [{
      type: 'pie',
      radius: ['45%', '75%'],
      center: ['40%', '50%'],
      avoidLabelOverlap: false,
      itemStyle: { borderRadius: 4, borderColor: 'hsl(var(--background))', borderWidth: 2 },
      label: { show: false },
      emphasis: {
        label: { show: true, fontSize: 14, fontWeight: 'bold' },
        scaleSize: 10,
      },
      data,
    }],
  }
}

function buildBarOption(
  months: string[],
  incomes: number[],
  expenses: number[],
): EChartsOption {
  return {
    tooltip: {
      trigger: 'axis' as const,
      axisPointer: { type: 'shadow' as const },
      backgroundColor: '#1e293b',
      borderColor: '#334155',
      textStyle: { color: '#e2e8f0' },
      formatter: (params: any) => {
        let html = `<b>${params[0].axisValue}</b><br/>`
        for (const p of params) {
          html += `${p.marker} ${p.seriesName}: ${formatMoney(p.value)}<br/>`
        }
        return html
      },
    },
    legend: {
      data: ['收入', '支出'],
      top: 0,
      textStyle: { color: '#cbd5e1' },
    },
    grid: { top: 40, right: 20, bottom: 40, left: 60 },
    xAxis: {
      type: 'category' as const,
      data: months,
      axisLabel: { rotate: 45, fontSize: 11, color: '#94a3b8' },
      axisLine: { lineStyle: { color: '#334155' } },
      axisTick: { lineStyle: { color: '#334155' } },
    },
    yAxis: {
      type: 'value' as const,
      axisLabel: { color: '#94a3b8', formatter: (v: number) => v >= 10000 ? `${(v / 10000).toFixed(1)}万` : String(v) },
      splitLine: { lineStyle: { color: '#1e293b' } },
    },
    series: [
      {
        name: '收入',
        type: 'bar',
        data: incomes,
        color: '#22c55e',
        itemStyle: { borderRadius: [4, 4, 0, 0] },
      },
      {
        name: '支出',
        type: 'bar',
        data: expenses,
        color: '#ef4444',
        itemStyle: { borderRadius: [4, 4, 0, 0] },
      },
    ],
  }
}

function buildLineOption(
  dates: string[],
  series: { name: string; data: number[] }[],
): EChartsOption {
  const colors = ['#f97316', '#3b82f6', '#22c55e', '#a855f7', '#eab308', '#ec4899', '#14b8a6', '#8b5cf6', '#f43f5e', '#06b6d4']
  return {
    tooltip: {
      trigger: 'axis' as const,
      backgroundColor: '#1e293b',
      borderColor: '#334155',
      textStyle: { color: '#e2e8f0' },
      formatter: (params: any) => {
        let html = `<b>${params[0].axisValue}</b><br/>`
        for (const p of params) {
          html += `${p.marker} ${p.seriesName}: ${formatMoney(p.value)}<br/>`
        }
        return html
      },
    },
    legend: {
      type: 'scroll' as const,
      top: 0,
      textStyle: { color: '#cbd5e1' },
      formatter: (name: string) => name.length > 8 ? name.slice(0, 8) + '…' : name,
    },
    grid: { top: 40, right: 20, bottom: 40, left: 60 },
    xAxis: {
      type: 'category' as const,
      data: dates,
      axisLabel: {
        rotate: 45,
        fontSize: 11,
        color: '#94a3b8',
        formatter: (v: string) => v.length > 7 ? v.slice(5) : v,
      },
      axisLine: { lineStyle: { color: '#334155' } },
      axisTick: { lineStyle: { color: '#334155' } },
    },
    yAxis: {
      type: 'value' as const,
      axisLabel: { color: '#94a3b8', formatter: (v: number) => v >= 10000 ? `${(v / 10000).toFixed(1)}万` : String(v) },
      splitLine: { lineStyle: { color: '#1e293b' } },
    },
    color: colors,
    series: series.map((s) => ({
      ...s,
      type: 'line' as const,
      smooth: true,
      symbol: 'none' as const,
    })),
  }
}

export function StatsPage() {
  const currentBookId = useBookStore((s) => s.currentBookId)

  // 筛选条件
  const [filters, setFilters] = useState<FilterState>({
    dateFrom: '',
    dateTo: '',
    accountIds: [],
    categoryCodes: [],
    ownerIds: [],
    type: '',
  })
  const [draftFilters, setDraftFilters] = useState<FilterState>({ ...filters })

  // 汇总数据
  const [summary, setSummary] = useState<RecordSummary>({ income: 0, expense: 0, transfer: 0, netIncome: 0 })
  const [summaryLoading, setSummaryLoading] = useState(false)

  // 分类数据
  const [pieData, setPieData] = useState<{ name: string; value: number }[]>([])
  const [pieLoading, setPieLoading] = useState(false)

  // 月度趋势
  const [trendMonths, setTrendMonths] = useState<string[]>([])
  const [trendIncomes, setTrendIncomes] = useState<number[]>([])
  const [trendExpenses, setTrendExpenses] = useState<number[]>([])
  const [trendLoading, setTrendLoading] = useState(false)

  // 账户余额
  const [balanceAccounts, setBalanceAccounts] = useState<{ name: string; data: number[] }[]>([])
  const [balanceDates, setBalanceDates] = useState<string[]>([])
  const [balanceLoading, setBalanceLoading] = useState(false)
  const [balanceGranularity, setBalanceGranularity] = useState<'daily' | 'monthly'>('monthly')

  // 明细弹窗
  const [detailOpen, setDetailOpen] = useState(false)
  const [detailData, setDetailData] = useState<DetailData>({ title: '', headers: [], rows: [] })

  // 基础数据
  const [accounts, setAccounts] = useState<AccountItem[]>([])
  const [users, setUsers] = useState<AdminUser[]>([])
  const [allCategories, setAllCategories] = useState<DictItem[]>([])
  const [error, setError] = useState('')
  const [drawerOpen, setDrawerOpen] = useState(false)

  // 加载基础数据
  useEffect(() => {
    if (!currentBookId) return
    Promise.all([
      accountApi.list(currentBookId).then(setAccounts).catch(() => {}),
      adminApi.listUsers().then(setUsers).catch(() => {}),
      (async () => {
        const groups = ['transaction_category_income', 'transaction_category_expense', 'transaction_category_transfer']
        const results = await Promise.all(groups.map((g) => settingsApi.getDictionary(g)))
        const merged: DictItem[] = []
        const seen = new Set<string>()
        for (const arr of results) {
          for (const item of arr) {
            if (!seen.has(item.code)) { seen.add(item.code); merged.push(item) }
          }
        }
        setAllCategories(merged)
      })().catch(() => {}),
    ])
  }, [currentBookId])

  // 加载所有统计数据
  const loadAllData = useCallback(async () => {
    if (!currentBookId) return

    const params = {
      bookId: currentBookId,
      dateFrom: filters.dateFrom || undefined,
      dateTo: filters.dateTo || undefined,
      accountId: filters.accountIds.length > 0 ? filters.accountIds.join(',') : undefined,
      categoryCode: filters.categoryCodes.length > 0 ? filters.categoryCodes.join(',') : undefined,
      ownerId: filters.ownerIds.length > 0 ? filters.ownerIds.join(',') : undefined,
    }

    setError('')

    // 并行加载
    const promises: Promise<void>[] = []

    // 汇总
    promises.push((async () => {
      setSummaryLoading(true)
      try {
        setSummary(await recordApi.summary({
          ...params,
          type: filters.type || undefined,
        }))
      } catch { /* ignore */ }
      finally { setSummaryLoading(false) }
    })())

    // 分类饼图
    promises.push((async () => {
      setPieLoading(true)
      try {
        const data = await recordApi.categorySummary({
          ...params,
          type: filters.type || 'EXPENSE',
        })
        setPieData(data.map((d) => ({ name: d.categoryName, value: d.amount })))
      } catch { /* ignore */ }
      finally { setPieLoading(false) }
    })())

    // 月度趋势
    promises.push((async () => {
      setTrendLoading(true)
      try {
        const data = await recordApi.monthlyTrend(params)
        setTrendMonths(data.map((d) => d.month))
        setTrendIncomes(data.map((d) => d.income))
        setTrendExpenses(data.map((d) => d.expense))
      } catch { /* ignore */ }
      finally { setTrendLoading(false) }
    })())

    await Promise.all(promises)
  }, [currentBookId, filters])

  // 加载账户余额（使用独立的日期范围或默认最近12个月）
  const loadBalanceHistory = useCallback(async () => {
    if (!currentBookId) return
    setBalanceLoading(true)
    try {
      const now = new Date()
      const to = filters.dateTo || now.toISOString().slice(0, 10)
      const defaultFrom = new Date(now.getFullYear(), now.getMonth() - 11, 1).toISOString().slice(0, 10)
      const from = filters.dateFrom || defaultFrom

      const accountFilter = filters.accountIds.length > 0
        ? filters.accountIds.join(',')
        : accounts.filter((a) => a.status === 'ACTIVE').slice(0, 5).map((a) => a.id).join(',')

      if (!accountFilter) {
        setBalanceAccounts([])
        setBalanceDates([])
        return
      }

      const data = await accountApi.balanceHistory({
        bookId: currentBookId,
        accountIds: accountFilter,
        granularity: balanceGranularity,
        dateFrom: from,
        dateTo: to,
      })

      if (data.length > 0) {
        setBalanceDates(data[0].balances.map((b) => b.date))
        setBalanceAccounts(data.map((a) => ({
          name: a.accountName,
          data: a.balances.map((b) => b.balance),
        })))
      } else {
        setBalanceAccounts([])
        setBalanceDates([])
      }
    } catch { /* ignore */ }
    finally { setBalanceLoading(false) }
  }, [currentBookId, filters.dateFrom, filters.dateTo, filters.accountIds, accounts, balanceGranularity])

  // 数据加载（filters 变化时重新加载）
  useEffect(() => {
    loadAllData()
  }, [loadAllData])

  useEffect(() => {
    loadBalanceHistory()
  }, [loadBalanceHistory])

  // 筛选变化时重新加载
  const applyFilters = () => {
    setFilters({ ...draftFilters })
    setDrawerOpen(false)
  }

  const resetFilters = () => {
    const empty: FilterState = { dateFrom: '', dateTo: '', accountIds: [], categoryCodes: [], ownerIds: [], type: '' }
    setFilters(empty)
    setDraftFilters({ ...empty })
  }

  const activeFilterCount = [filters.dateFrom, filters.dateTo].filter(Boolean).length
    + (filters.accountIds.length > 0 ? 1 : 0)
    + (filters.categoryCodes.length > 0 ? 1 : 0)
    + (filters.ownerIds.length > 0 ? 1 : 0)
    + (filters.type ? 1 : 0)

  // 空状态
  if (!currentBookId) {
    return (
      <Card className="rounded-2xl">
        <CardContent className="flex flex-col items-center justify-center py-12 text-center gap-2">
          <BarChart3 size={40} className="opacity-30" />
          <p className="text-base">请先选择账本</p>
          <p className="text-[13px] text-muted-foreground">在上方下拉菜单中选择账本</p>
        </CardContent>
      </Card>
    )
  }

  // 图表交互事件
  const handleChartDblClick = (chartType: string, _params: any) => {
    switch (chartType) {
      case 'pie': {
        const rows = pieData.map((d) => [d.name, formatMoney(d.value)])
        setDetailData({ title: '分类支出明细', headers: ['分类', '金额'], rows })
        break
      }
      case 'bar': {
        const rows = trendMonths.map((m, i) => [
          m,
          formatMoney(trendIncomes[i]),
          formatMoney(trendExpenses[i]),
          formatMoney(trendIncomes[i] - trendExpenses[i]),
        ])
        setDetailData({ title: '月度收支明细', headers: ['月份', '收入', '支出', '结余'], rows })
        break
      }
      case 'line': {
        const headers = ['日期', ...balanceAccounts.map((a) => a.name)]
        const rows = balanceDates.map((d, i) => [
          d,
          ...balanceAccounts.map((a) => formatMoney(a.data[i] ?? 0)),
        ])
        setDetailData({ title: '账户余额明细', headers, rows })
        break
      }
    }
    setDetailOpen(true)
  }

  const pieOption = buildPieOption(pieData)
  const barOption = buildBarOption(trendMonths, trendIncomes, trendExpenses)
  const lineOption = buildLineOption(balanceDates, balanceAccounts)

  return (
    <div>
      {error && (
        <Alert variant="destructive" className="mb-6">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {/* 筛选栏 */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-2 flex-wrap">
          {/* 类型切换 */}
          <Tabs
            value={filters.type || 'all'}
            onValueChange={(v) => {
              const next = { ...filters, type: (v === 'all' ? '' : v) as FilterState['type'] }
              setFilters(next)
              setDraftFilters((prev) => ({ ...prev, type: next.type }))
            }}
          >
            <TabsList className="h-9 p-0.5 gap-0.5 bg-muted rounded-lg">
              <TabsTrigger value="all" className="text-xs rounded-md h-8">全部</TabsTrigger>
              <TabsTrigger value="EXPENSE" className="text-xs rounded-md h-8 text-[#ef4444] data-[state=active]:bg-background data-[state=active]:shadow-sm">支出</TabsTrigger>
              <TabsTrigger value="INCOME" className="text-xs rounded-md h-8 text-[#22c55e] data-[state=active]:bg-background data-[state=active]:shadow-sm">收入</TabsTrigger>
            </TabsList>
          </Tabs>

          {/* 活跃筛选标签 */}
          {filters.dateFrom && (
            <Badge variant="secondary" className="pl-2 pr-1 py-1 gap-1 text-xs font-normal">
              {filters.dateFrom} 起
              <button onClick={() => { const next = { ...filters, dateFrom: '' }; setFilters(next); setDraftFilters((p) => ({ ...p, dateFrom: '' })) }}>
                <X size={12} className="ml-1" />
              </button>
            </Badge>
          )}
          {filters.dateTo && (
            <Badge variant="secondary" className="pl-2 pr-1 py-1 gap-1 text-xs font-normal">
              至 {filters.dateTo}
              <button onClick={() => { const next = { ...filters, dateTo: '' }; setFilters(next); setDraftFilters((p) => ({ ...p, dateTo: '' })) }}>
                <X size={12} className="ml-1" />
              </button>
            </Badge>
          )}
          {filters.accountIds.length > 0 && (
            <Badge variant="secondary" className="pl-2 pr-1 py-1 gap-1 text-xs font-normal">
              账户: {filters.accountIds.map((id) => accounts.find((a) => a.id === id)?.name || id).join(', ')}
              <button onClick={() => { const next = { ...filters, accountIds: [] }; setFilters(next); setDraftFilters((p) => ({ ...p, accountIds: [] })) }}>
                <X size={12} className="ml-1" />
              </button>
            </Badge>
          )}
          {filters.categoryCodes.length > 0 && (
            <Badge variant="secondary" className="pl-2 pr-1 py-1 gap-1 text-xs font-normal">
              分类: {filters.categoryCodes.join(', ')}
              <button onClick={() => { const next = { ...filters, categoryCodes: [] }; setFilters(next); setDraftFilters((p) => ({ ...p, categoryCodes: [] })) }}>
                <X size={12} className="ml-1" />
              </button>
            </Badge>
          )}
          {filters.ownerIds.length > 0 && (
            <Badge variant="secondary" className="pl-2 pr-1 py-1 gap-1 text-xs font-normal">
              成员: {filters.ownerIds.map((id) => users.find((u) => u.id === id)?.name || id).join(', ')}
              <button onClick={() => { const next = { ...filters, ownerIds: [] }; setFilters(next); setDraftFilters((p) => ({ ...p, ownerIds: [] })) }}>
                <X size={12} className="ml-1" />
              </button>
            </Badge>
          )}
          {activeFilterCount === 0 && (
            <span className="text-sm text-muted-foreground">点击"筛选"设置统计条件</span>
          )}
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <Button variant="outline" onClick={() => { setDraftFilters({ ...filters }); setDrawerOpen(true) }} className="h-8 text-xs rounded-lg">
            <Filter size={14} /> 筛选
            {activeFilterCount > 0 && (
              <span className="ml-1 bg-[#f97316] text-white text-[10px] rounded-full w-4 h-4 flex items-center justify-center">
                {activeFilterCount}
              </span>
            )}
          </Button>
          {activeFilterCount > 0 && (
            <Button variant="ghost" onClick={resetFilters} className="h-8 text-xs">重置</Button>
          )}
        </div>
      </div>

      {/* 汇总卡片 */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        {([
          { label: '总收入', value: summary.income, icon: ArrowUpRight, color: 'text-[#22c55e]' },
          { label: '总支出', value: summary.expense, icon: ArrowDownRight, color: 'text-[#ef4444]' },
          { label: '净收入', value: summary.netIncome, icon: TrendingUp, color: summary.netIncome >= 0 ? 'text-[#22c55e]' : 'text-[#ef4444]' },
          { label: '转账总额', value: summary.transfer, icon: Wallet, color: 'text-[#3b82f6]' },
        ] as const).map(({ label, value, icon: Icon, color }) => (
          <Card key={label} className="rounded-xl">
            <CardContent className="p-4 flex items-center gap-3">
              <div className={`w-10 h-10 rounded-xl flex items-center justify-center bg-background ${color}`}>
                <Icon size={20} />
              </div>
              <div>
                <p className="text-xs text-muted-foreground">{label}</p>
                <p className={`text-lg font-bold tabular-nums ${color}`}>
                  {summaryLoading ? '...' : formatMoney(value)}
                </p>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* 图表区域 */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
        {/* 分类饼图 */}
        <Card className="rounded-xl overflow-hidden">
          <CardContent className="p-4">
            <div className="flex items-center gap-2 mb-3">
              <PieChart size={18} className="text-[#f97316]" />
              <h3 className="text-sm font-semibold">
                {filters.type === 'INCOME' ? '收入分类占比' : '支出分类占比'}
              </h3>
            </div>
            <div className="relative" style={{ height: 380 }}>
              {pieLoading ? (
                <div className="absolute inset-0 flex items-center justify-center"><Spinner /></div>
              ) : pieData.length === 0 ? (
                <div className="absolute inset-0 flex items-center justify-center text-muted-foreground text-sm">暂无数据</div>
              ) : (
                <ReactECharts
                  option={pieOption}
                  style={chartBaseStyle}
                  onEvents={{ dblclick: (p: any) => handleChartDblClick('pie', p) }}
                />
              )}
            </div>
          </CardContent>
        </Card>

        {/* 月度趋势柱状图 */}
        <Card className="rounded-xl overflow-hidden">
          <CardContent className="p-4">
            <div className="flex items-center gap-2 mb-3">
              <BarChart3 size={18} className="text-[#f97316]" />
              <h3 className="text-sm font-semibold">月度收支趋势</h3>
            </div>
            <div className="relative" style={{ height: 380 }}>
              {trendLoading ? (
                <div className="absolute inset-0 flex items-center justify-center"><Spinner /></div>
              ) : trendMonths.length === 0 ? (
                <div className="absolute inset-0 flex items-center justify-center text-muted-foreground text-sm">暂无数据</div>
              ) : (
                <ReactECharts
                  option={barOption}
                  style={chartBaseStyle}
                  onEvents={{ dblclick: (p: any) => handleChartDblClick('bar', p) }}
                />
              )}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* 账户余额变化图 */}
      <Card className="rounded-xl overflow-hidden mb-6">
        <CardContent className="p-4">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <TrendingUp size={18} className="text-[#f97316]" />
              <h3 className="text-sm font-semibold">账户余额变化</h3>
            </div>
            <div className="flex items-center gap-3">
              {balanceAccounts.length >= 5 && (
                <span className="text-xs text-muted-foreground">
                  显示前 {Math.min(balanceAccounts.length, 5)} 个账户
                </span>
              )}
              <Select value={balanceGranularity} onValueChange={(v) => setBalanceGranularity(v as 'daily' | 'monthly')}>
                <SelectTrigger className="h-7 text-xs w-20">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="daily">按日</SelectItem>
                  <SelectItem value="monthly">按月</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="relative" style={{ height: 400 }}>
            {balanceLoading ? (
              <div className="absolute inset-0 flex items-center justify-center"><Spinner /></div>
            ) : balanceAccounts.length === 0 ? (
              <div className="absolute inset-0 flex items-center justify-center text-muted-foreground text-sm">
                请确保账本中有活跃账户和流水数据
              </div>
            ) : (
              <ReactECharts
                option={lineOption}
                style={chartBaseStyle}
                onEvents={{ dblclick: (p: any) => handleChartDblClick('line', p) }}
              />
            )}
          </div>
        </CardContent>
      </Card>

      {/* 明细弹窗 */}
      <Dialog open={detailOpen} onOpenChange={setDetailOpen}>
        <DialogContent className="max-w-2xl max-h-[80vh]">
          <DialogHeader>
            <DialogTitle>{detailData.title}</DialogTitle>
          </DialogHeader>
          <div className="overflow-auto max-h-[60vh]">
            <Table>
              <TableHeader>
                <TableRow>
                  {detailData.headers.map((h, i) => (
                    <TableHead key={i} className="text-xs whitespace-nowrap">
                      {h}
                    </TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {detailData.rows.map((row, ri) => (
                  <TableRow key={ri}>
                    {row.map((cell, ci) => (
                      <TableCell key={ci} className="text-xs whitespace-nowrap py-2">
                        {cell}
                      </TableCell>
                    ))}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </DialogContent>
      </Dialog>

      {/* 筛选抽屉 */}
      <Dialog open={drawerOpen} onOpenChange={setDrawerOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>筛选条件</DialogTitle>
          </DialogHeader>
          <div className="flex flex-col gap-4 max-h-[60vh] overflow-y-auto py-2">
            {/* 日期范围 */}
            <div>
              <Label className="text-xs text-muted-foreground mb-1.5 block">开始日期</Label>
              <DatePicker
                value={draftFilters.dateFrom}
                onChange={(v) => setDraftFilters((p) => ({ ...p, dateFrom: v }))}
              />
            </div>
            <div>
              <Label className="text-xs text-muted-foreground mb-1.5 block">结束日期</Label>
              <DatePicker
                value={draftFilters.dateTo}
                onChange={(v) => setDraftFilters((p) => ({ ...p, dateTo: v }))}
              />
            </div>

            {/* 账户 */}
            <div>
              <Label className="text-xs text-muted-foreground mb-1.5 block">账户</Label>
              <MultiSelect
                items={accounts.filter((a) => a.status === 'ACTIVE').map((a) => ({ value: a.id, label: a.name }))}
                selected={draftFilters.accountIds}
                onChange={(v) => setDraftFilters((p) => ({ ...p, accountIds: v }))}
                placeholder="全部账户"
              />
            </div>

            {/* 分类 */}
            <div>
              <Label className="text-xs text-muted-foreground mb-1.5 block">分类</Label>
              <MultiSelect
                items={allCategories.map((c) => ({ value: c.code, label: c.label }))}
                selected={draftFilters.categoryCodes}
                onChange={(v) => setDraftFilters((p) => ({ ...p, categoryCodes: v }))}
                placeholder="全部分类"
              />
            </div>

            {/* 成员 */}
            <div>
              <Label className="text-xs text-muted-foreground mb-1.5 block">成员</Label>
              <MultiSelect
                items={users.map((u) => ({ value: u.id, label: u.name || u.email || u.id }))}
                selected={draftFilters.ownerIds}
                onChange={(v) => setDraftFilters((p) => ({ ...p, ownerIds: v }))}
                placeholder="全部成员"
              />
            </div>
          </div>
          <div className="flex items-center gap-2 pt-4 border-t">
            <Button variant="outline" className="flex-1" onClick={resetFilters}>重置</Button>
            <Button className="flex-1 bg-[#f97316] hover:bg-[#ea580c] text-white" onClick={applyFilters}>应用</Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}

import { useState, useEffect, useCallback, useMemo } from 'react'
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
  Dialog, DialogTrigger, DialogContent, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'
import {
  Table, TableHeader, TableBody, TableRow, TableHead, TableCell,
} from '@/components/ui/table'
import { recordApi, type RecordSummary, type RecordItem } from '@/api/record'
import { accountApi, type AccountItem } from '@/api/account'
import { adminApi, type AdminUser } from '@/api/admin'
import { budgetApi } from '@/api/budget'
import { recurringApi } from '@/api/recurring'
import {
  scoreSavings,
  scoreDebtBurden,
  scoreFreedom,
  type RadarMetric,
} from '@/lib/financial-health'
import { AnalysisPanel } from './AnalysisPanel'
import { BarChart3, Search, X, List, ChevronLeft, ChevronRight, HelpCircle } from 'lucide-react'
import { Tooltip, TooltipTrigger, TooltipContent } from '@/components/ui/tooltip'
import { useChartTheme, type ChartTheme, generateChartColors } from '@/hooks/useChartTheme'
import dayjs from 'dayjs'

function formatMoney(amount: number): string {
  return new Intl.NumberFormat('zh-CN', { style: 'currency', currency: 'CNY' }).format(amount)
}

function buildStackedBar(periods: string[], categories: { name: string; data: number[] }[], t: ChartTheme): { option: EChartsOption; chartHeight: number } {
  // 图例换行时才增加空间，每额外行约16px（fontSize 13）
  const legendLines = Math.ceil(categories.length / 7)
  const extraBottom = Math.max(0, legendLines - 1) * 16
  const extraHeight = Math.max(0, legendLines - 1) * 16

  const option: EChartsOption = {
    tooltip: {
      trigger: 'axis' as const,
      axisPointer: { type: 'shadow' as const },
      backgroundColor: t.cardBg,
      borderColor: t.border,
      textStyle: { color: t.cardFg },
      formatter: (params: any) => {
        let html = `<b>${params[0].axisValue}</b><br/>`
        let total = 0
        for (const p of params) { total += p.value; html += `${p.marker} ${p.seriesName}: ${formatMoney(p.value)}<br/>` }
        html += `<hr/>合计: ${formatMoney(total)}`
        return html
      },
    },
    legend: { type: 'plain' as const, bottom: 0, textStyle: { color: t.mutedForeground } },
    grid: { top: 20, right: 20, bottom: 40 + extraBottom, left: 60 },
    xAxis: { type: 'category' as const, data: periods, axisLabel: { color: t.mutedForeground, rotate: 45, fontSize: 11, formatter: (v: string) => v.length > 7 ? v.slice(5) : v }, axisLine: { lineStyle: { color: t.border } } },
    yAxis: { type: 'value' as const, axisLabel: { color: t.mutedForeground, formatter: (v: number) => v >= 10000 ? `${(v / 10000).toFixed(1)}万` : String(v) }, splitLine: { lineStyle: { color: t.border } } },
    color: generateChartColors(categories.length, t.COLORS),
    series: categories.map((c) => ({
      name: c.name,
      type: 'bar' as const,
      data: c.data,
      stack: 'total',
      emphasis: {
        focus: 'series' as const,
        itemStyle: { shadowBlur: 10, shadowOffsetX: 0, shadowColor: 'rgba(0,0,0,0.35)' },
      },
    })),
  }

  return { option, chartHeight: 400 + extraHeight }
}

const RADAR_TIPS: Record<string, string> = {
  '储蓄率': '（收入-支出）/ 收入，反映本期能存下多少钱',
  '收支平衡': '收入是否大于等于支出，低于100表示入不敷出',
  '预算执行': '实际支出与预算的符合度，超支越多分数越低',
  '偿债压力': '月供 ÷ 本期月均收入，越低越健康。健康区间 ≤35%',
  '财务自由度': '被动收入 ÷ 本期支出，越接近 100% 越接近财务自由',
}

function buildRadarOption(metrics: RadarMetric[], t: ChartTheme): EChartsOption {
  return {
    tooltip: {
      trigger: 'item' as const,
      backgroundColor: t.cardBg,
      borderColor: t.border,
      textStyle: { color: t.cardFg, fontSize: 12 },
      formatter: (p: any) => {
        const fullValues: number[] = p.data?.value ?? (Array.isArray(p.value) ? p.value : [])
        const hoverIdx: number | undefined = p.dimensionIndex
        let html = `<b>${p.seriesName || ''}</b><br/>`
        metrics.forEach((m, i) => {
          const v = fullValues[i]
          const display = v != null ? `${v} 分` : '-'
          if (hoverIdx === i) {
            html += `<span style="font-weight:bold;color:${t.primary}">◆ ${m.name}: ${display}</span>`
            if (m.detail) html += `<span style="color:${t.mutedForeground}"> · ${m.detail}</span>`
            html += `<br/>`
          } else {
            html += `&nbsp;&nbsp;${m.name}: ${display}<br/>`
          }
        })
        return html
      },
    },
    legend: { show: false },
    radar: {
      center: ['50%', '50%'],
      radius: '55%',
      indicator: metrics.map((m) => ({ name: m.name, max: 100 })),
      axisName: { color: t.mutedForeground, fontSize: 11 },
      splitArea: { areaStyle: { color: ['transparent'] } },
      splitLine: { lineStyle: { color: t.border } },
    },
    series: [{
      type: 'radar',
      data: [{ value: metrics.map((m) => m.value), name: '财务健康', areaStyle: { color: t.primaryRgba(0.2) }, lineStyle: { color: t.primary }, itemStyle: { color: t.primary } }],
    }],
  }
}

interface TimeRadarInput {
  summary: RecordSummary
  budgetHealth: number
  monthlyPayment: number
  monthsInPeriod: number
  passiveIncome: number
}

// 时间段财务健康 5 维评估(全部为所选时间段内的流指标)
function computeRadar(input: TimeRadarInput): RadarMetric[] {
  const income = input.summary.income || 0
  const expense = input.summary.expense || 0
  const metrics: RadarMetric[] = []

  // 储蓄率
  if (income > 0) {
    const savings = (income - expense) / income
    metrics.push({ name: '储蓄率', value: scoreSavings(savings), detail: `储蓄率 ${(savings * 100).toFixed(1)}%` })
  } else {
    metrics.push({ name: '储蓄率', value: 0, available: false, detail: '数据不足(无收入记录)' })
  }

  // 收支平衡
  if (expense > 0) {
    const balance = income >= expense ? 100 : Math.round((income / expense) * 100)
    metrics.push({ name: '收支平衡', value: balance, detail: `收入/支出 ${income >= expense ? '≥100%' : `${(income / expense * 100).toFixed(1)}%`}` })
  } else if (income > 0) {
    metrics.push({ name: '收支平衡', value: 100, detail: '本期内无支出' })
  } else {
    metrics.push({ name: '收支平衡', value: 0, available: false, detail: '数据不足' })
  }

  // 预算执行
  metrics.push({ name: '预算执行', value: Math.max(0, Math.min(100, Math.round(input.budgetHealth))), detail: `预算契合度 ${Math.round(input.budgetHealth)} 分` })

  // 偿债压力(反向)
  const monthlyIncome = income > 0 ? income / input.monthsInPeriod : 0
  if (input.monthlyPayment > 0 && monthlyIncome > 0) {
    const ratio = input.monthlyPayment / monthlyIncome
    metrics.push({ name: '偿债压力', value: scoreDebtBurden(ratio), detail: `月供占比 ${(ratio * 100).toFixed(1)}%` })
  } else if (input.monthlyPayment <= 0) {
    metrics.push({ name: '偿债压力', value: 100, detail: '无贷款,无负债压力' })
  } else {
    metrics.push({ name: '偿债压力', value: 20, available: false, detail: '数据不足(无收入记录)' })
  }

  // 财务自由度
  if (expense > 0) {
    const ratio = input.passiveIncome / expense
    metrics.push({ name: '财务自由度', value: scoreFreedom(ratio), detail: `被动收入覆盖支出 ${(ratio * 100).toFixed(1)}%` })
  } else {
    metrics.push({ name: '财务自由度', value: 0, available: false, detail: '数据不足(无支出记录)' })
  }

  return metrics
}

async function fetchBudgetHealth(
  bookId: string,
  mode: 'yearly' | 'monthly' | 'free',
  year: number,
  month: number,
  dateFrom?: string,
  dateTo?: string,
): Promise<number> {
  try {
    let budgets: { amount: number; actualAmount: number }[] = []

    if (mode === 'yearly') {
      budgets = await budgetApi.listFixed({ bookId, year })
    } else if (mode === 'monthly') {
      budgets = await budgetApi.listFixed({ bookId, year, month })
    } else if (mode === 'free' && dateFrom && dateTo) {
      // 收集日期范围内的所有 (年, 月) 组合
      const yearMonths = new Map<number, Set<number>>()
      let cursor = dayjs(dateFrom).startOf('month')
      const end = dayjs(dateTo)
      while (cursor.isBefore(end) || cursor.isSame(end, 'month')) {
        const y = cursor.year()
        const m = cursor.month() + 1
        if (!yearMonths.has(y)) yearMonths.set(y, new Set())
        yearMonths.get(y)!.add(m)
        cursor = cursor.add(1, 'month')
      }
      // 按年获取预算，再按月份过滤
      const results = await Promise.all(
        Array.from(yearMonths.keys()).map((y) => budgetApi.listFixed({ bookId, year: y })),
      )
      budgets = results.flat().filter((b) => yearMonths.get(b.year)?.has(b.month))
    }

    const totalBudgeted = budgets.reduce((s, b) => s + b.amount, 0)
    const totalActual = budgets.reduce((s, b) => s + b.actualAmount, 0)

    if (totalBudgeted === 0) return 100
    // 超支比例越高分数越低
    const overspendRatio = Math.max(0, totalActual - totalBudgeted) / totalBudgeted
    return Math.max(0, Math.round((1 - overspendRatio) * 100))
  } catch {
    return 100 // 获取失败默认满分，不阻塞主流程
  }
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
  const [radarMetrics, setRadarMetrics] = useState<RadarMetric[]>([])

  // 堆叠柱状图选中
  const [barSelected, setBarSelected] = useState<{ code: string | null; name: string; period: string } | null>(null)
  const [barDetailOpen, setBarDetailOpen] = useState(false)
  const [barDetailRecords, setBarDetailRecords] = useState<RecordItem[]>([])
  const [barDetailLoading, setBarDetailLoading] = useState(false)
  const [barDetailPage, setBarDetailPage] = useState(1)
  const [barDetailTotal, setBarDetailTotal] = useState(0)
  const [barDetailTotalPages, setBarDetailTotalPages] = useState(0)
  const [barDetailPayer, setBarDetailPayer] = useState('')
  const [barDetailRemark, setBarDetailRemark] = useState('')
  const [barDetailAmountFrom, setBarDetailAmountFrom] = useState('')
  const [barDetailAmountTo, setBarDetailAmountTo] = useState('')
  const [barDetailFilterAccountId, setBarDetailFilterAccountId] = useState('')
  const [barDetailFilterOwnerId, setBarDetailFilterOwnerId] = useState('')
  const [barDetailJumpPage, setBarDetailJumpPage] = useState('')
  const [barDetailTags, setBarDetailTags] = useState<string[]>([])
  const [availableTags, setAvailableTags] = useState<string[]>([])

  // 基础数据
  const [accounts, setAccounts] = useState<AccountItem[]>([])
  const [users, setUsers] = useState<AdminUser[]>([])

  useEffect(() => {
    accountApi.list(bookId).then(setAccounts).catch(() => {})
    adminApi.listUsers().then(setUsers).catch(() => {})
    recordApi.getTags(bookId).then(setAvailableTags).catch(() => {})
  }, [bookId])

  const t = useChartTheme()

  const { stackedBarOption, stackedBarHeight } = useMemo(() => {
    if (periods.length === 0) return { stackedBarOption: null, stackedBarHeight: 400 } // 原始高度
    const result = buildStackedBar(periods, categories, t)
    return { stackedBarOption: result.option, stackedBarHeight: result.chartHeight }
  }, [periods, categories, t])
  const radarOption = useMemo(
    () => (radarMetrics.length > 0 ? buildRadarOption(radarMetrics, t) : null),
    [radarMetrics, t],
  )

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

      const [trendData, summaryData, budgetHealth, loans, passiveSummary] = await Promise.all([
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
        fetchBudgetHealth(bookId, mode, year, month, params.dateFrom, params.dateTo),
        recurringApi.list(bookId),
        recordApi.summary({ bookId, type: 'INCOME', categoryCode: '投资收益,分红', ...params }),
      ])

      const filteredCategories = trendData.categories.filter((c) => c.data.some((v) => v > 0))
      setPeriods(trendData.periods)
      setCategories(filteredCategories)
      setSummary(summaryData)
      // 雷达图:时间段内流健康 5 维
      const activeLoans = loans.filter((l) => l.recurringType === 'LOAN' && l.active)
      const monthlyPayment = activeLoans.reduce((s, l) => s + (l.amount ?? 0), 0)
      const monthsInPeriod = params.dateFrom && params.dateTo
        ? Math.max(1, dayjs(params.dateTo).diff(dayjs(params.dateFrom), 'month') + 1)
        : 1
      setRadarMetrics(computeRadar({
        summary: summaryData,
        budgetHealth,
        monthlyPayment,
        monthsInPeriod,
        passiveIncome: passiveSummary.income,
      }))
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

  const loadBarDetail = async (page: number) => {
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
        dateFrom,
        dateTo,
        categoryCode: barSelected.code ?? undefined,
        accountId: barDetailFilterAccountId || undefined,
        ownerId: barDetailFilterOwnerId || undefined,
        payer: barDetailPayer || undefined,
        remark: barDetailRemark || undefined,
        amountFrom: barDetailAmountFrom ? Number(barDetailAmountFrom) : undefined,
        amountTo: barDetailAmountTo ? Number(barDetailAmountTo) : undefined,
        tags: barDetailTags.length > 0 ? barDetailTags.join(',') : undefined,
      })
      setBarDetailRecords(res.records)
      setBarDetailPage(res.page)
      setBarDetailTotal(res.total)
      setBarDetailTotalPages(res.totalPages)
    } catch { /* ignore */ }
    finally { setBarDetailLoading(false) }
  }

  const handleBarViewDetail = () => {
    setBarDetailPayer('')
    setBarDetailRemark('')
    setBarDetailAmountFrom('')
    setBarDetailAmountTo('')
    setBarDetailFilterAccountId('')
    setBarDetailFilterOwnerId('')
    setBarDetailTags([])
    setBarDetailPage(1)
    setBarDetailOpen(true)
    loadBarDetail(1)
  }

  const handleBarDetailFilter = () => {
    setBarDetailPage(1)
    loadBarDetail(1)
  }

  const handleBarDetailPageChange = (page: number) => {
    setBarDetailPage(page)
    loadBarDetail(page)
  }

  const handleBarDetailJump = () => {
    const p = parseInt(barDetailJumpPage, 10)
    if (p >= 1 && p <= barDetailTotalPages) {
      setBarDetailJumpPage('')
      handleBarDetailPageChange(p)
    }
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
                items={users.map((u) => ({ value: u.id, label: u.nickname || u.username || u.email || u.id }))}
                selected={freeOwnerIds}
                onChange={setFreeOwnerIds}
                placeholder="全部"
              />
            </div>
            <Button onClick={handleSearch} className="bg-primary hover:bg-primary/90 text-primary-foreground h-9 mt-5">
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
                    <BarChart3 size={18} className="text-primary" />
                    <h3 className="text-sm font-semibold">财务健康评估</h3>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <button className="ml-auto text-muted-foreground hover:text-foreground transition-colors">
                          <HelpCircle size={15} />
                        </button>
                      </TooltipTrigger>
                      <TooltipContent side="bottom" align="end" className="max-w-[260px] p-3">
                        <div className="space-y-2">
                          {radarMetrics.map((m) => (
                            <div key={m.name}>
                              <span className="font-medium text-xs">{m.name}</span>
                              <p className="text-xs text-muted-foreground leading-tight mt-0.5">{RADAR_TIPS[m.name]}</p>
                            </div>
                          ))}
                        </div>
                      </TooltipContent>
                    </Tooltip>
                  </div>
                  <div style={{ height: 240 }}>
                    <ReactECharts option={radarOption} notMerge={true} style={{ width: '100%', height: '100%' }} />
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
                  <BarChart3 size={18} className="text-primary" />
                  <h3 className="text-sm font-semibold">
                    {mode === 'yearly' ? '各月分类支出构成' : '每日分类支出构成'}
                  </h3>
                </div>
                <div style={{ height: stackedBarHeight, cursor: 'pointer' }}>
                  {periods.length === 0 ? (
                    <div className="flex items-center justify-center h-full text-xs text-muted-foreground">暂无数据</div>
                  ) : (
                    <ReactECharts
                      option={stackedBarOption}
                      notMerge={true}
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
                    <span className="text-sm font-bold text-primary">
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
        <DialogTrigger />
        <DialogContent className="max-w-3xl max-h-[85vh]">
          <DialogHeader>
            <DialogTitle className="text-sm flex items-center gap-2 flex-wrap">
              <span>{barSelected?.name}</span>
            </DialogTitle>
            {/* 继承的查询参数 */}
            <div className="flex items-center gap-1.5 flex-wrap mt-1">
              <span className="text-xs px-1.5 py-0.5 rounded bg-muted text-muted-foreground">支出分析</span>
              <span className="text-xs px-1.5 py-0.5 rounded bg-muted text-muted-foreground">{barSelected?.name}</span>
              <span className="text-xs px-1.5 py-0.5 rounded bg-muted text-muted-foreground">{barSelected?.period}</span>
            </div>
          </DialogHeader>

          {/* 附加筛选条件 */}
          <div className="flex items-center gap-2 flex-wrap">
            <Select value={barDetailFilterAccountId || 'all'} onValueChange={(v) => setBarDetailFilterAccountId(v === 'all' ? '' : v)}>
              <SelectTrigger className="h-8 w-28 text-xs"><SelectValue placeholder="账户" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">全部账户</SelectItem>
                {accounts.filter((a) => a.status === 'ACTIVE').map((a) => (
                  <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={barDetailFilterOwnerId || 'all'} onValueChange={(v) => setBarDetailFilterOwnerId(v === 'all' ? '' : v)}>
              <SelectTrigger className="h-8 w-24 text-xs"><SelectValue placeholder="成员" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">全部成员</SelectItem>
                {users.map((u) => (
                  <SelectItem key={u.id} value={u.id}>{u.nickname || u.username || u.email || u.id}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Input aria-label="交易方" placeholder="交易方" value={barDetailPayer} onChange={(e) => setBarDetailPayer(e.target.value)} className="h-8 w-24 text-xs" />
            <Input aria-label="备注" placeholder="备注" value={barDetailRemark} onChange={(e) => setBarDetailRemark(e.target.value)} className="h-8 w-28 text-xs" />
            <Input aria-label="金额下限" type="number" placeholder="金额≥" value={barDetailAmountFrom} onChange={(e) => setBarDetailAmountFrom(e.target.value)} className="h-8 w-20 text-xs" />
            <Input aria-label="金额上限" type="number" placeholder="金额≤" value={barDetailAmountTo} onChange={(e) => setBarDetailAmountTo(e.target.value)} className="h-8 w-20 text-xs" />
            <div className="min-w-28">
              <MultiSelect
                items={availableTags.map((t) => ({ value: t, label: t }))}
                selected={barDetailTags}
                onChange={setBarDetailTags}
                placeholder="标签"
              />
            </div>
            <Button size="sm" variant="outline" className="h-8 text-xs" onClick={handleBarDetailFilter}>
              筛选
            </Button>
            <span className="text-xs text-muted-foreground">共 {barDetailTotal} 条</span>
          </div>

          <div className="overflow-auto max-h-[50vh] relative">
            {barDetailLoading && (
              <div className="absolute inset-0 bg-background/60 z-10 flex items-center justify-center">
                <Spinner />
              </div>
            )}
            {!barDetailLoading && barDetailRecords.length === 0 ? (
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
              <Input
                type="number"
                aria-label="跳转页码"
                min={1}
                max={barDetailTotalPages}
                value={barDetailJumpPage}
                onChange={(e) => setBarDetailJumpPage(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleBarDetailJump()}
                placeholder="页码"
                className="h-7 w-16 text-xs text-center"
              />
              <Button aria-label="跳转" size="sm" variant="outline" className="h-7 text-xs" onClick={handleBarDetailJump}>
                跳转
              </Button>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}

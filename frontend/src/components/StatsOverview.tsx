import { useState, useEffect, useCallback } from 'react'
import ReactECharts from 'echarts-for-react'
import type { EChartsOption } from 'echarts'
import { Card, CardContent } from '@/components/ui/card'
import { Spinner } from '@/components/ui/spinner'
import { recordApi, type RecordSummary } from '@/api/record'
import { accountApi } from '@/api/account'
import { budgetApi } from '@/api/budget'
import { useBookStore } from '@/stores/book'
import { TrendingUp, BarChart3, Wallet, Target, HelpCircle } from 'lucide-react'
import { Tooltip, TooltipTrigger, TooltipContent } from '@/components/ui/tooltip'
import dayjs from 'dayjs'

function formatMoney(amount: number): string {
  return new Intl.NumberFormat('zh-CN', { style: 'currency', currency: 'CNY' }).format(amount)
}

const COLORS = ['#f97316', '#3b82f6', '#22c55e', '#a855f7', '#eab308', '#ec4899', '#14b8a6', '#8b5cf6', '#f43f5e', '#06b6d4']

const chartTextStyle = {
  legend: { textStyle: { color: '#cbd5e1' } },
  xAxis: { axisLabel: { color: '#94a3b8' }, axisLine: { lineStyle: { color: '#334155' } } },
  yAxis: { axisLabel: { color: '#94a3b8' }, splitLine: { lineStyle: { color: '#1e293b' } } },
  tooltip: { backgroundColor: '#1e293b', borderColor: '#334155', textStyle: { color: '#e2e8f0' } },
}

function buildTrendLineOption(months: string[], incomes: number[], expenses: number[]): EChartsOption {
  return {
    ...chartTextStyle,
    tooltip: {
      ...chartTextStyle.tooltip,
      trigger: 'axis' as const,
      formatter: (params: any) => {
        let html = `<b>${params[0].axisValue}</b><br/>`
        for (const p of params) html += `${p.marker} ${p.seriesName}: ${formatMoney(p.value)}<br/>`
        return html
      },
    },
    legend: { data: ['收入', '支出', '结余'], top: 0, ...chartTextStyle.legend },
    grid: { top: 40, right: 20, bottom: 40, left: 60 },
    xAxis: { type: 'category' as const, data: months, axisLabel: { ...chartTextStyle.xAxis.axisLabel, rotate: 45, fontSize: 11 }, axisLine: chartTextStyle.xAxis.axisLine },
    yAxis: { type: 'value' as const, ...chartTextStyle.yAxis, axisLabel: { ...chartTextStyle.yAxis.axisLabel, formatter: (v: number) => v >= 10000 ? `${(v / 10000).toFixed(1)}万` : String(v) } },
    color: ['#22c55e', '#ef4444', '#f97316'],
    series: [
      { name: '收入', type: 'line', data: incomes, smooth: true, symbol: 'none' as const },
      { name: '支出', type: 'line', data: expenses, smooth: true, symbol: 'none' as const },
      { name: '结余', type: 'line', data: incomes.map((v, i) => v - expenses[i]), smooth: true, symbol: 'none' as const, lineStyle: { type: 'dashed' as const } },
    ],
  }
}

function buildNetWorthOption(dates: string[], balances: number[]): EChartsOption {
  return {
    ...chartTextStyle,
    tooltip: {
      ...chartTextStyle.tooltip,
      trigger: 'axis' as const,
      formatter: (p: any) => `<b>${p[0].axisValue}</b><br/>${p[0].marker} 资产净值: ${formatMoney(p[0].value)}`,
    },
    legend: { data: ['资产净值'], top: 0, ...chartTextStyle.legend },
    grid: { top: 40, right: 20, bottom: 40, left: 60 },
    xAxis: { type: 'category' as const, data: dates, axisLabel: { ...chartTextStyle.xAxis.axisLabel, rotate: 45, fontSize: 11, formatter: (v: string) => v.length > 7 ? v.slice(5) : v } },
    yAxis: { type: 'value' as const, ...chartTextStyle.yAxis, axisLabel: { ...chartTextStyle.yAxis.axisLabel, formatter: (v: number) => v >= 10000 ? `${(v / 10000).toFixed(1)}万` : String(v) } },
    color: ['#f97316'],
    series: [{
      name: '资产净值', type: 'line', data: balances, smooth: true, symbol: 'none' as const,
      areaStyle: { color: { type: 'linear' as const, x: 0, y: 0, x2: 0, y2: 1, colorStops: [{ offset: 0, color: 'rgba(249,115,22,0.2)' }, { offset: 1, color: 'rgba(249,115,22,0)' }] } },
    }],
  }
}

function buildBalanceOption(dates: string[], series: { name: string; data: number[] }[]): EChartsOption {
  return {
    ...chartTextStyle,
    tooltip: {
      ...chartTextStyle.tooltip,
      trigger: 'axis' as const,
      formatter: (params: any) => {
        let html = `<b>${params[0].axisValue}</b><br/>`
        for (const p of params) html += `${p.marker} ${p.seriesName}: ${formatMoney(p.value)}<br/>`
        return html
      },
    },
    legend: { type: 'scroll' as const, top: 0, ...chartTextStyle.legend, formatter: (n: string) => n.length > 6 ? n.slice(0, 6) + '…' : n },
    grid: { top: 40, right: 20, bottom: 40, left: 60 },
    xAxis: { type: 'category' as const, data: dates, axisLabel: { ...chartTextStyle.xAxis.axisLabel, rotate: 45, fontSize: 11, formatter: (v: string) => v.length > 7 ? v.slice(5) : v } },
    yAxis: { type: 'value' as const, ...chartTextStyle.yAxis, axisLabel: { ...chartTextStyle.yAxis.axisLabel, formatter: (v: number) => v >= 10000 ? `${(v / 10000).toFixed(1)}万` : String(v) } },
    color: COLORS,
    series: series.map((s) => ({ ...s, type: 'line' as const, smooth: true, symbol: 'none' as const })),
  }
}

const RADAR_TIPS: Record<string, string> = {
  '储蓄率': '（收入-支出）/ 收入，反映每月能存下多少钱',
  '收支平衡': '收入是否大于等于支出，低于100表示入不敷出',
  '记账覆盖度': '使用的支出分类数 / 10，反映记账的细致程度',
  '预算执行': '实际支出与预算的符合度，超支越多分数越低',
  '资金沉淀率': '1 - 转账/总流水，反映资金用于实际收支而非账户间划转的比例',
}

function buildRadarOption(metrics: { name: string; value: number }[]): EChartsOption {
  return {
    ...chartTextStyle,
    tooltip: {
      trigger: 'item' as const,
      backgroundColor: '#1e293b',
      borderColor: '#334155',
      textStyle: { color: '#e2e8f0', fontSize: 12 },
      formatter: (p: any) => {
        const values: number[] = Array.isArray(p.value) ? p.value : [p.value]
        let html = `<b>${p.seriesName || ''}</b><br/>`
        metrics.forEach((m, i) => {
          html += `${m.name}: ${values[i] ?? '-'} 分<br/>`
        })
        return html
      },
    },
    legend: { show: false },
    radar: {
      center: ['50%', '55%'],
      radius: '70%',
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

function computeRadarMetrics(summary: RecordSummary, categoryCount: number, budgetHealth: number): { name: string; value: number }[] {
  const income = summary.income || 1
  const expense = summary.expense || 0
  const transfer = summary.transfer || 0

  const savingsRate = Math.min(100, Math.max(0, Math.round(((income - expense) / Math.max(income, 1)) * 100)))
  const balance = income >= expense ? 100 : Math.min(100, Math.max(0, Math.round((income / Math.max(expense, 1)) * 100)))
  const coverage = Math.min(100, Math.round((categoryCount / 10) * 100))
  const totalFlow = income + expense + transfer
  const retention = totalFlow > 0 ? Math.min(100, Math.max(0, Math.round((1 - transfer / totalFlow) * 100))) : 100

  return [
    { name: '储蓄率', value: savingsRate },
    { name: '收支平衡', value: balance },
    { name: '记账覆盖度', value: coverage },
    { name: '预算执行', value: budgetHealth },
    { name: '资金沉淀率', value: retention },
  ]
}

export function StatsOverview() {
  const currentBookId = useBookStore((s) => s.currentBookId)

  const [summary, setSummary] = useState<RecordSummary>({ income: 0, expense: 0, transfer: 0, netIncome: 0 })
  const [loading, setLoading] = useState(true)

  // 月度趋势
  const [trendMonths, setTrendMonths] = useState<string[]>([])
  const [trendIncomes, setTrendIncomes] = useState<number[]>([])
  const [trendExpenses, setTrendExpenses] = useState<number[]>([])

  // 资产净值
  const [nwDates, setNwDates] = useState<string[]>([])
  const [nwBalances, setNwBalances] = useState<number[]>([])

  // 账户余额
  const [balDates, setBalDates] = useState<string[]>([])
  const [balSeries, setBalSeries] = useState<{ name: string; data: number[] }[]>([])

  // 雷达图
  const [radarMetrics, setRadarMetrics] = useState<{ name: string; value: number }[]>([])

  const loadData = useCallback(async () => {
    if (!currentBookId) return
    setLoading(true)
    try {
      const now = dayjs()
      const dateFrom = now.subtract(11, 'month').startOf('month').format('YYYY-MM-DD')
      const dateTo = now.format('YYYY-MM-DD')

      // 并行加载
      const [summaryData, trendData, accounts, catSummary, budgets] = await Promise.all([
        recordApi.summary({ bookId: currentBookId }),
        recordApi.monthlyTrend({ bookId: currentBookId, dateFrom, dateTo }),
        accountApi.list(currentBookId),
        recordApi.categorySummary({ bookId: currentBookId }),
        budgetApi.listFixed({ bookId: currentBookId, year: now.year() }),
      ])

      setSummary(summaryData)
      setTrendMonths(trendData.map((d) => d.month))
      setTrendIncomes(trendData.map((d) => d.income))
      setTrendExpenses(trendData.map((d) => d.expense))

      // 资产净值趋势：汇总所有账户余额
      const activeAccts = accounts.filter((a) => a.status === 'ACTIVE')
      const acctIds = activeAccts.map((a) => a.id)
      if (acctIds.length > 0) {
        const hist = await accountApi.balanceHistory({
          bookId: currentBookId,
          accountIds: acctIds.join(','),
          granularity: 'monthly',
          dateFrom,
          dateTo,
        })
        if (hist.length > 0) {
          const dates = hist[0].balances.map((b) => b.date)
          const totalBalances = dates.map((_, i) =>
            Math.round(hist.reduce((sum, a) => sum + (a.balances[i]?.balance ?? 0), 0) * 100) / 100
          )
          setNwDates(dates)
          setNwBalances(totalBalances)
        }
        // 账户余额变化（按日，最近60天）
        const dailyFrom = now.subtract(59, 'day').format('YYYY-MM-DD')
        const dailyHist = await accountApi.balanceHistory({
          bookId: currentBookId,
          accountIds: acctIds.slice(0, 5).join(','),
          granularity: 'daily',
          dateFrom: dailyFrom,
          dateTo,
        })
        if (dailyHist.length > 0) {
          setBalDates(dailyHist[0].balances.map((b) => b.date))
          setBalSeries(dailyHist.map((a) => ({
            name: a.accountName,
            data: a.balances.map((b) => b.balance),
          })))
        }
      }

      // 雷达图
      const totalBudgeted = budgets.reduce((s, b) => s + b.amount, 0)
      const totalActual = budgets.reduce((s, b) => s + b.actualAmount, 0)
      const budgetHealth = totalBudgeted === 0 ? 100 : Math.max(0, Math.round((1 - Math.max(0, totalActual - totalBudgeted) / totalBudgeted) * 100))
      setRadarMetrics(computeRadarMetrics(summaryData, catSummary.length, budgetHealth))
    } catch { /* ignore */ }
    finally { setLoading(false) }
  }, [currentBookId])

  useEffect(() => { loadData() }, [loadData])

  if (!currentBookId) {
    return (
      <Card className="rounded-2xl">
        <CardContent className="flex flex-col items-center justify-center py-12 text-center gap-2">
          <BarChart3 size={40} className="opacity-30" />
          <p className="text-base">请先选择账本</p>
        </CardContent>
      </Card>
    )
  }

  return (
    <div>
      {/* 汇总卡片 */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        {([
          { label: '总收入', value: summary.income, color: 'text-[#22c55e]' },
          { label: '总支出', value: summary.expense, color: 'text-[#ef4444]' },
          { label: '净收入', value: summary.netIncome, color: summary.netIncome >= 0 ? 'text-[#22c55e]' : 'text-[#ef4444]' },
          { label: '转账总额', value: summary.transfer, color: 'text-[#3b82f6]' },
        ] as const).map(({ label, value, color }) => (
          <Card key={label} className="rounded-xl">
            <CardContent className="p-4 text-center">
              <p className="text-xs text-muted-foreground mb-1">{label}</p>
              <p className={`text-lg font-bold tabular-nums ${color}`}>
                {loading ? '...' : formatMoney(value)}
              </p>
            </CardContent>
          </Card>
        ))}
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-20"><Spinner /></div>
      ) : (
        <>
          {/* 图表区：上排月度趋势 + 资产净值，下排账户余额 + 雷达图 */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
            <Card className="rounded-xl overflow-hidden">
              <CardContent className="p-4">
                <div className="flex items-center gap-2 mb-3">
                  <TrendingUp size={18} className="text-[#f97316]" />
                  <h3 className="text-sm font-semibold">月度收支趋势</h3>
                </div>
                <div style={{ height: 320 }}>
                  <ReactECharts option={buildTrendLineOption(trendMonths, trendIncomes, trendExpenses)} style={{ width: '100%', height: '100%' }} />
                </div>
              </CardContent>
            </Card>

            <Card className="rounded-xl overflow-hidden">
              <CardContent className="p-4">
                <div className="flex items-center gap-2 mb-3">
                  <Wallet size={18} className="text-[#f97316]" />
                  <h3 className="text-sm font-semibold">资产净值趋势</h3>
                </div>
                {nwDates.length === 0 ? (
                  <div className="flex items-center justify-center h-80 text-xs text-muted-foreground">暂无数据</div>
                ) : (
                  <div style={{ height: 320 }}>
                    <ReactECharts option={buildNetWorthOption(nwDates, nwBalances)} style={{ width: '100%', height: '100%' }} />
                  </div>
                )}
              </CardContent>
            </Card>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-6">
            <div className="lg:col-span-2">
              <Card className="rounded-xl overflow-hidden h-full">
                <CardContent className="p-4">
                  <div className="flex items-center gap-2 mb-3">
                    <BarChart3 size={18} className="text-[#f97316]" />
                    <h3 className="text-sm font-semibold">账户余额变化（近60天）</h3>
                  </div>
                  {balSeries.length === 0 ? (
                    <div className="flex items-center justify-center h-80 text-xs text-muted-foreground">暂无数据</div>
                  ) : (
                    <div style={{ height: 320 }}>
                      <ReactECharts option={buildBalanceOption(balDates, balSeries)} style={{ width: '100%', height: '100%' }} />
                    </div>
                  )}
                </CardContent>
              </Card>
            </div>
            <Card className="rounded-xl overflow-hidden">
              <CardContent className="p-4">
                <div className="flex items-center gap-2 mb-3">
                  <Target size={18} className="text-[#f97316]" />
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
                <div style={{ height: 320 }}>
                  <ReactECharts option={buildRadarOption(radarMetrics)} style={{ width: '100%', height: '100%' }} />
                </div>
              </CardContent>
            </Card>
          </div>
        </>
      )}
    </div>
  )
}

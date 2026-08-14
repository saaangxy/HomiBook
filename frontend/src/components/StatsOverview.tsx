import { useState, useEffect, useCallback, useMemo } from 'react'
import ReactECharts from 'echarts-for-react'
import type { EChartsOption } from 'echarts'
import { Card, CardContent } from '@/components/ui/card'
import { Spinner } from '@/components/ui/spinner'
import { recordApi, type RecordSummary } from '@/api/record'
import { accountApi, type AccountItem } from '@/api/account'
import { recurringApi, type RecurringTransaction } from '@/api/recurring'
import { useBookStore } from '@/stores/book'
import { useChartTheme, type ChartTheme, generateChartColors } from '@/hooks/useChartTheme'
import { TrendingUp, BarChart3, Wallet, Target, HelpCircle } from 'lucide-react'
import { Tooltip, TooltipTrigger, TooltipContent } from '@/components/ui/tooltip'
import dayjs from 'dayjs'
import {
  scoreEmergency,
  scoreDebtBurden,
  scoreLeverage,
  scoreSavings,
  scoreInvestment,
  scoreFreedom,
  scoreInsurance,
  type RadarMetric,
} from '@/lib/financial-health'

function formatMoney(amount: number): string {
  return new Intl.NumberFormat('zh-CN', { style: 'currency', currency: 'CNY' }).format(amount)
}

const RADAR_TIPS: Record<string, string> = {
  '应急能力': '紧急备用金 ÷ 月均支出，反映应对突发开支的现金缓冲。健康区间 ≥6 个月',
  '偿债压力': '月供 ÷ 月均收入，越低越健康。健康区间 ≤35%',
  '杠杆水平': '总负债 ÷ 总资产，越低越健康。健康区间 ≤50%',
  '储蓄能力': '年储蓄 ÷ 年收入。健康区间 ≥30%',
  '投资积累': '投资资产 ÷ 净资产。健康区间 ≥50%',
  '财务自由度': '被动收入 ÷ 年支出，越接近 100% 越接近财务自由',
  '保障充足度': '保费支出 ÷ 年收入占比近似（健康区间 5%-15%；因无保额字段，以保费占比近似）',
}

function buildTrendLineOption(months: string[], incomes: number[], expenses: number[], t: ChartTheme): EChartsOption {
  return {
    tooltip: {
      trigger: 'axis' as const,
      backgroundColor: t.cardBg,
      borderColor: t.border,
      textStyle: { color: t.cardFg },
      formatter: (params: any) => {
        let html = `<b>${params[0].axisValue}</b><br/>`
        for (const p of params) html += `${p.marker} ${p.seriesName}: ${formatMoney(p.value)}<br/>`
        return html
      },
    },
    legend: { data: ['收入', '支出', '结余'], top: 0, textStyle: { color: t.mutedForeground } },
    grid: { top: 40, right: 20, bottom: 40, left: 60 },
    xAxis: { type: 'category' as const, data: months, axisLabel: { color: t.mutedForeground, rotate: 45, fontSize: 11 }, axisLine: { lineStyle: { color: t.border } } },
    yAxis: { type: 'value' as const, axisLabel: { color: t.mutedForeground, formatter: (v: number) => v >= 10000 ? `${(v / 10000).toFixed(1)}万` : String(v) }, splitLine: { lineStyle: { color: t.border } } },
    color: ['#22c55e', '#ef4444', t.primary],
    series: [
      { name: '收入', type: 'line', data: incomes, smooth: true, symbol: 'none' as const },
      { name: '支出', type: 'line', data: expenses, smooth: true, symbol: 'none' as const },
      { name: '结余', type: 'line', data: incomes.map((v, i) => v - expenses[i]), smooth: true, symbol: 'none' as const, lineStyle: { type: 'dashed' as const } },
    ],
  }
}

function buildNetWorthOption(dates: string[], balances: number[], t: ChartTheme): EChartsOption {
  return {
    tooltip: {
      trigger: 'axis' as const,
      backgroundColor: t.cardBg,
      borderColor: t.border,
      textStyle: { color: t.cardFg },
      formatter: (p: any) => `<b>${p[0].axisValue}</b><br/>${p[0].marker} 资产净值: ${formatMoney(p[0].value)}`,
    },
    legend: { data: ['资产净值'], top: 0, textStyle: { color: t.mutedForeground } },
    grid: { top: 40, right: 20, bottom: 40, left: 60 },
    xAxis: { type: 'category' as const, data: dates, axisLabel: { color: t.mutedForeground, rotate: 45, fontSize: 11, formatter: (v: string) => v.length > 7 ? v.slice(5) : v } },
    yAxis: { type: 'value' as const, axisLabel: { color: t.mutedForeground, formatter: (v: number) => v >= 10000 ? `${(v / 10000).toFixed(1)}万` : String(v) }, splitLine: { lineStyle: { color: t.border } } },
    color: [t.primary],
    series: [{
      name: '资产净值', type: 'line', data: balances, smooth: true, symbol: 'none' as const,
      areaStyle: { color: { type: 'linear' as const, x: 0, y: 0, x2: 0, y2: 1, colorStops: [{ offset: 0, color: t.primaryRgba(0.2) }, { offset: 1, color: t.primaryRgba(0) }] } },
    }],
  }
}

function buildBalanceOption(dates: string[], series: { name: string; data: number[] }[], t: ChartTheme): EChartsOption {
  return {
    tooltip: {
      trigger: 'axis' as const,
      backgroundColor: t.cardBg,
      borderColor: t.border,
      textStyle: { color: t.cardFg },
      formatter: (params: any) => {
        let html = `<b>${params[0].axisValue}</b><br/>`
        for (const p of params) html += `${p.marker} ${p.seriesName}: ${formatMoney(p.value)}<br/>`
        return html
      },
    },
    legend: { type: 'scroll' as const, top: 0, textStyle: { color: t.mutedForeground }, formatter: (n: string) => n.length > 6 ? n.slice(0, 6) + '…' : n },
    grid: { top: 40, right: 20, bottom: 40, left: 60 },
    xAxis: { type: 'category' as const, data: dates, axisLabel: { color: t.mutedForeground, rotate: 45, fontSize: 11, formatter: (v: string) => v.length > 7 ? v.slice(5) : v } },
    yAxis: { type: 'value' as const, axisLabel: { color: t.mutedForeground, formatter: (v: number) => v >= 10000 ? `${(v / 10000).toFixed(1)}万` : String(v) }, splitLine: { lineStyle: { color: t.border } } },
    color: generateChartColors(series.length, t.COLORS),
    series: series.map((s) => ({ ...s, type: 'line' as const, smooth: true, symbol: 'none' as const })),
  }
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
      center: ['50%', '55%'],
      radius: '70%',
      indicator: metrics.map((m) => ({ name: m.name, max: 100 })),
      axisName: { color: t.mutedForeground, fontSize: 11 },
      splitArea: { areaStyle: { color: ['transparent'] } },
      splitLine: { lineStyle: { color: t.border } },
    },
    series: [{
      type: 'radar',
      data: [{
        value: metrics.map((m) => m.value), name: '财务健康',
        areaStyle: { color: t.primaryRgba(0.2) },
        lineStyle: { color: t.primary },
        itemStyle: { color: t.primary },
      }],
    }],
  }
}

interface RadarInput {
  accounts: AccountItem[]
  loans: RecurringTransaction[]
  summary: RecordSummary
  passiveIncome: number
  insuranceExpense: number
}

// 家庭财务健康 7 维评分(近 12 个月口径)
function computeRadarMetrics(input: RadarInput): RadarMetric[] {
  const act = input.accounts.filter((a) => a.status === 'ACTIVE')
  // 信用卡余额为负数(欠款),取绝对值作为负债
  const creditBal = Math.abs(act.filter((a) => a.type === 'CREDIT_CARD').reduce((s, a) => s + (a.computedBalance ?? 0), 0))
  const totalLiab = creditBal + input.loans.reduce((s, l) => s + (l.loanRemainingAmount ?? 0), 0)
  // 总资产剔除信用卡,避免重复计算
  const assetTypes = ['BANK_DEBIT', 'ALIPAY', 'WECHAT', 'CASH', 'RECHARGE_CARD', 'INVESTMENT', 'OTHER']
  const totalAssets = act.filter((a) => assetTypes.includes(a.type)).reduce((s, a) => s + (a.computedBalance ?? 0), 0)
  const netAssets = totalAssets - totalLiab
  const investAssets = act.filter((a) => a.type === 'INVESTMENT').reduce((s, a) => s + (a.computedBalance ?? 0), 0)
  // 紧急备用金:流动性现金账户
  const emergency = act.filter((a) => ['BANK_DEBIT', 'ALIPAY', 'WECHAT', 'CASH'].includes(a.type)).reduce((s, a) => s + (a.computedBalance ?? 0), 0)

  const monthlyPayment = input.loans.reduce((s, l) => s + (l.amount ?? 0), 0)
  const income = input.summary.income || 0
  const expense = input.summary.expense || 0
  const monthlyIncome = income / 12
  const monthlyExpense = expense / 12

  const metrics: RadarMetric[] = []

  // 1. 应急能力
  if (monthlyExpense > 0) {
    const months = emergency / monthlyExpense
    metrics.push({ name: '应急能力', value: scoreEmergency(months), detail: `备用金可覆盖 ${months.toFixed(1)} 个月支出` })
  } else {
    metrics.push({ name: '应急能力', value: 0, available: false, detail: '数据不足(无支出记录)' })
  }

  // 2. 偿债压力(反向)
  if (monthlyPayment > 0 && monthlyIncome > 0) {
    const ratio = monthlyPayment / monthlyIncome
    metrics.push({ name: '偿债压力', value: scoreDebtBurden(ratio), detail: `月供占比 ${(ratio * 100).toFixed(1)}%` })
  } else if (monthlyPayment <= 0) {
    metrics.push({ name: '偿债压力', value: 100, detail: '无贷款,无负债压力' })
  } else {
    metrics.push({ name: '偿债压力', value: 20, available: false, detail: '数据不足(无收入记录)' })
  }

  // 3. 杠杆水平(反向)
  if (totalAssets > 0) {
    const ratio = totalLiab / totalAssets
    metrics.push({ name: '杠杆水平', value: scoreLeverage(ratio), detail: `负债率 ${(ratio * 100).toFixed(1)}%` })
  } else if (totalAssets === 0 && totalLiab === 0) {
    metrics.push({ name: '杠杆水平', value: 100, detail: '无资产与负债' })
  } else {
    metrics.push({ name: '杠杆水平', value: 20, available: false, detail: '数据不足(无资产数据)' })
  }

  // 4. 储蓄能力
  if (income > 0) {
    const savings = (income - expense) / income
    metrics.push({ name: '储蓄能力', value: scoreSavings(savings), detail: `储蓄率 ${(savings * 100).toFixed(1)}%` })
  } else {
    metrics.push({ name: '储蓄能力', value: 0, available: false, detail: '数据不足(无收入记录)' })
  }

  // 5. 投资积累
  if (netAssets > 0) {
    const ratio = investAssets / netAssets
    metrics.push({ name: '投资积累', value: scoreInvestment(ratio), detail: `投资占净资产 ${(ratio * 100).toFixed(1)}%` })
  } else {
    metrics.push({ name: '投资积累', value: 0, available: false, detail: '数据不足(净资产非正)' })
  }

  // 6. 财务自由度
  if (expense > 0) {
    const ratio = input.passiveIncome / expense
    metrics.push({ name: '财务自由度', value: scoreFreedom(ratio), detail: `被动收入覆盖支出 ${(ratio * 100).toFixed(1)}%` })
  } else {
    metrics.push({ name: '财务自由度', value: 0, available: false, detail: '数据不足(无支出记录)' })
  }

  // 7. 保障充足度(保费占比近似)
  if (income > 0) {
    const ratio = input.insuranceExpense / income
    metrics.push({ name: '保障充足度', value: scoreInsurance(ratio), detail: `保费占收入 ${(ratio * 100).toFixed(1)}%` })
  } else {
    metrics.push({ name: '保障充足度', value: 0, available: false, detail: '数据不足(无收入记录)' })
  }

  return metrics
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
  const t = useChartTheme()

  const trendLineOption = useMemo(
    () => (trendMonths.length > 0 ? buildTrendLineOption(trendMonths, trendIncomes, trendExpenses, t) : null),
    [trendMonths, trendIncomes, trendExpenses, t],
  )
  const netWorthOption = useMemo(
    () => (nwDates.length > 0 ? buildNetWorthOption(nwDates, nwBalances, t) : null),
    [nwDates, nwBalances, t],
  )
  const balanceOption = useMemo(
    () => (balSeries.length > 0 ? buildBalanceOption(balDates, balSeries, t) : null),
    [balDates, balSeries, t],
  )
  const radarOption = useMemo(
    () => (radarMetrics.length > 0 ? buildRadarOption(radarMetrics, t) : null),
    [radarMetrics, t],
  )

  const loadData = useCallback(async () => {
    if (!currentBookId) return
    setLoading(true)
    try {
      const now = dayjs()
      const dateFrom = now.subtract(11, 'month').startOf('month').format('YYYY-MM-DD')
      const dateTo = now.format('YYYY-MM-DD')

      // 并行加载
      const [summaryData, trendData, accounts, loans, passiveIncome, insuranceExpense] = await Promise.all([
        recordApi.summary({ bookId: currentBookId }),
        recordApi.monthlyTrend({ bookId: currentBookId, dateFrom, dateTo }),
        accountApi.list(currentBookId),
        recurringApi.list(currentBookId),
        recordApi.summary({ bookId: currentBookId, type: 'INCOME', categoryCode: '投资收益,分红', dateFrom, dateTo }),
        recordApi.summary({ bookId: currentBookId, type: 'EXPENSE', categoryCode: '保险', dateFrom, dateTo }),
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

      // 雷达图(家庭财务健康 7 维)
      const activeLoans = loans.filter((l) => l.recurringType === 'LOAN' && l.active)
      setRadarMetrics(computeRadarMetrics({
        accounts,
        loans: activeLoans,
        summary: summaryData,
        passiveIncome: passiveIncome.income,
        insuranceExpense: insuranceExpense.expense,
      }))
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
                  <TrendingUp size={18} className="text-primary" />
                  <h3 className="text-sm font-semibold">月度收支趋势</h3>
                </div>
                <div style={{ height: 320 }}>
                  <ReactECharts option={trendLineOption} notMerge={true} style={{ width: '100%', height: '100%' }} />
                </div>
              </CardContent>
            </Card>

            <Card className="rounded-xl overflow-hidden">
              <CardContent className="p-4">
                <div className="flex items-center gap-2 mb-3">
                  <Wallet size={18} className="text-primary" />
                  <h3 className="text-sm font-semibold">资产净值趋势</h3>
                </div>
                {nwDates.length === 0 ? (
                  <div className="flex items-center justify-center h-80 text-xs text-muted-foreground">暂无数据</div>
                ) : (
                  <div style={{ height: 320 }}>
                    <ReactECharts option={netWorthOption} notMerge={true} style={{ width: '100%', height: '100%' }} />
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
                    <BarChart3 size={18} className="text-primary" />
                    <h3 className="text-sm font-semibold">账户余额变化（近60天）</h3>
                  </div>
                  {balSeries.length === 0 ? (
                    <div className="flex items-center justify-center h-80 text-xs text-muted-foreground">暂无数据</div>
                  ) : (
                    <div style={{ height: 320 }}>
                      <ReactECharts option={balanceOption} notMerge={true} style={{ width: '100%', height: '100%' }} />
                    </div>
                  )}
                </CardContent>
              </Card>
            </div>
            <Card className="rounded-xl overflow-hidden">
              <CardContent className="p-4">
                <div className="flex items-center gap-2 mb-3">
                  <Target size={18} className="text-primary" />
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
                  <ReactECharts option={radarOption} notMerge={true} style={{ width: '100%', height: '100%' }} />
                </div>
              </CardContent>
            </Card>
          </div>
        </>
      )}
    </div>
  )
}

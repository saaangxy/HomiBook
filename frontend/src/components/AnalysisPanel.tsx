import { useState, useEffect, useCallback } from 'react'
import ReactECharts from 'echarts-for-react'
import type { EChartsOption } from 'echarts'
import { Card, CardContent } from '@/components/ui/card'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Spinner } from '@/components/ui/spinner'
import { recordApi } from '@/api/record'
import { PieChart, Users, Wallet } from 'lucide-react'

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

function buildMiniPie(data: { name: string; value: number }[]): EChartsOption {
  return {
    tooltip: {
      trigger: 'item' as const,
      backgroundColor: '#1e293b',
      borderColor: '#334155',
      textStyle: { color: '#e2e8f0', fontSize: 12 },
      formatter: (p: any) => `${p.name}: ${formatMoney(p.value)} (${p.percent}%)`,
    },
    color: COLORS,
    series: [{
      type: 'pie',
      radius: ['50%', '75%'],
      center: ['50%', '55%'],
      itemStyle: { borderRadius: 3, borderColor: 'hsl(var(--background))', borderWidth: 2 },
      label: { show: false },
      emphasis: { label: { show: true, fontSize: 12 } },
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

export function AnalysisPanel({ bookId, dateFrom, dateTo, accountId, ownerId, tags }: Props) {
  const [activeType, setActiveType] = useState('EXPENSE')
  const [loading, setLoading] = useState(false)
  const [groupData, setGroupData] = useState<Record<string, GroupData>>({})

  const loadAnalysis = useCallback(async () => {
    if (!bookId) return
    setLoading(true)
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
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {(['category', 'ownerId', 'accountId'] as const).map((groupBy) => {
              const data = (groupData[groupBy] || []).map((d) => ({ name: d.label, value: d.amount }))
              return (
                <div key={groupBy} className="flex flex-col items-center">
                  <div className="flex items-center gap-1.5 mb-2 text-xs text-muted-foreground">
                    {GROUP_ICONS[groupBy]}
                    <span>{GROUP_LABELS[groupBy]}</span>
                  </div>
                  <div style={{ width: '100%', height: 200 }}>
                    {data.length === 0 ? (
                      <div className="flex items-center justify-center h-full text-xs text-muted-foreground">暂无数据</div>
                    ) : (
                      <ReactECharts option={buildMiniPie(data)} style={{ width: '100%', height: '100%' }} />
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </CardContent>
    </Card>
  )
}

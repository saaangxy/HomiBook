import { useState } from 'react'
import { Card, CardContent } from '@/components/ui/card'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { BarChart3 } from 'lucide-react'
import { useBookStore } from '@/stores/book'
import { StatsOverview } from '@/components/StatsOverview'
import { StatsTimeView } from '@/components/StatsTimeView'

type TabKey = 'overview' | 'yearly' | 'monthly' | 'free'

const TABS: { key: TabKey; label: string }[] = [
  { key: 'overview', label: '首页' },
  { key: 'yearly', label: '年度统计' },
  { key: 'monthly', label: '月度统计' },
  { key: 'free', label: '自由筛选' },
]

export function StatsPage() {
  const currentBookId = useBookStore((s) => s.currentBookId)
  const [activeTab, setActiveTab] = useState<TabKey>('overview')

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

  return (
    <div>
      {/* Tab 导航 */}
      <div className="mb-6">
        <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as TabKey)}>
          <TabsList className="h-10 p-1 gap-1 bg-muted rounded-lg">
            {TABS.map(({ key, label }) => (
              <TabsTrigger
                key={key}
                value={key}
                className="text-sm rounded-md h-8 px-4 data-[state=active]:bg-background data-[state=active]:shadow-sm"
              >
                {label}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
      </div>

      {/* 页面内容 */}
      {activeTab === 'overview' && <StatsOverview />}
      {activeTab === 'yearly' && <StatsTimeView bookId={currentBookId} mode="yearly" />}
      {activeTab === 'monthly' && <StatsTimeView bookId={currentBookId} mode="monthly" />}
      {activeTab === 'free' && <StatsTimeView bookId={currentBookId} mode="free" />}
    </div>
  )
}

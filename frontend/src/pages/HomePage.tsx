import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Card, CardContent } from '@/components/ui/card'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Skeleton } from '@/components/ui/skeleton'
import { Book, Wallet, ArrowUpCircle, ArrowDownCircle, TrendingUp, TrendingDown, AlertTriangle, Bot, Settings } from 'lucide-react'
import { useBookStore } from '../stores/book'
import { useIsMobile } from '@/hooks/use-mobile'
import { recordApi, type RecordSummary } from '../api/record'
import { accountApi } from '../api/account'
import { budgetApi, type BudgetItem } from '../api/budget'
import { ChatWindow } from '../components/ai/ChatWindow'
import { fetchAIConfig } from '../api/chat'

export function HomePage() {
  const { currentBookId, books } = useBookStore()
  const currentBook = books.find((b) => b.id === currentBookId)
  const isMobile = useIsMobile()

  const [summary, setSummary] = useState<RecordSummary | null>(null)
  const [accountCount, setAccountCount] = useState(0)
  const [budgets, setBudgets] = useState<BudgetItem[]>([])
  const [loading, setLoading] = useState(false)
  const [aiEnabled, setAiEnabled] = useState(false)
  const [aiConfigured, setAiConfigured] = useState(false)

  useEffect(() => {
    fetchAIConfig()
      .then((cfg) => {
        setAiEnabled(cfg.enabled)
        setAiConfigured(!!cfg.simpleProviderConfigId)
      })
      .catch(() => { /* ignore */ })
  }, [])

  useEffect(() => {
    if (!currentBookId) return

    setLoading(true)
    const now = new Date()
    const year = now.getFullYear()
    const month = now.getMonth() + 1
    const dateFrom = `${year}-${String(month).padStart(2, '0')}-01`
    const dateTo = `${year}-${String(month).padStart(2, '0')}-${new Date(year, month, 0).getDate()}`

    Promise.all([
      recordApi.summary({ bookId: currentBookId, dateFrom, dateTo }),
      accountApi.list(currentBookId),
      budgetApi.listFixed({ bookId: currentBookId, year, month }),
    ])
      .then(([summaryData, accounts, budgetData]) => {
        setSummary(summaryData)
        setAccountCount(accounts.filter((a) => a.status === 'ACTIVE').length)
        setBudgets(budgetData)
      })
      .catch(() => {
        // ignore errors silently
      })
      .finally(() => setLoading(false))
  }, [currentBookId])

  // 查找超预算
  const warnBudgets = budgets.filter((b) => b.amount > 0 && (b.actualAmount / b.amount) > 0.85)
  const dangerBudgets = budgets.filter((b) => b.amount > 0 && b.actualAmount >= b.amount)

  // 统计卡片数据（桌面大卡 / 移动端单列精简卡共用）
  const netIcon = summary && summary.netIncome >= 0 ? TrendingUp : TrendingDown
  const netColor = summary && summary.netIncome > 0 ? 'text-[#22c55e] bg-[#22c55e]/10' : 'text-[#f97316] bg-[#f97316]/10'
  const statCards = [
    { icon: Wallet, iconColor: 'text-[#3b82f6] bg-[#3b82f6]/10', label: '活跃账户', display: String(accountCount), prefix: '' },
    { icon: ArrowUpCircle, iconColor: 'text-primary bg-primary/10', label: '本月收入', display: summary ? summary.income.toLocaleString() : '0', prefix: '¥' },
    { icon: ArrowDownCircle, iconColor: 'text-[#ef4444] bg-[#ef4444]/10', label: '本月支出', display: summary ? summary.expense.toLocaleString() : '0', prefix: '¥' },
    { icon: netIcon, iconColor: netColor, label: '本月结余', display: summary ? summary.netIncome.toLocaleString() : '0', prefix: '¥' },
  ]

  return (
    <div className="space-y-6">
      {/* 账本信息 */}
      {currentBook ? (
        <div className="flex items-center gap-2.5 px-5 py-3 bg-card border border-border rounded-xl">
          <Book size={18} className="text-primary" />
          <span className="text-sm text-muted-foreground">当前账本：</span>
          <span className="text-sm font-semibold text-primary">{currentBook.name}</span>
        </div>
      ) : (
        <div className="p-5 bg-card border border-border rounded-xl text-center text-sm text-muted-foreground">
          请选择或创建账本开始记账
        </div>
      )}

      {/* 预算预警 */}
      {dangerBudgets.length > 0 && (
        <Alert variant="destructive">
          <AlertTriangle className="h-4 w-4" />
          <AlertDescription>
            {dangerBudgets.map((b) => b.name).join('、')} 已超预算
          </AlertDescription>
        </Alert>
      )}
      {warnBudgets.filter((b) => !dangerBudgets.includes(b)).length > 0 && (
        <Alert>
          <AlertTriangle className="h-4 w-4" />
          <AlertDescription>
            {warnBudgets.filter((b) => !dangerBudgets.includes(b)).map((b) => `${b.name}(${Math.round((b.actualAmount / b.amount) * 100)}%)`).join('、')} 即将超预算
          </AlertDescription>
        </Alert>
      )}

      {/* 统计卡片 */}
      {isMobile ? (
        <div className="flex flex-col gap-2">
          {statCards.map((c) => (
            <Card key={c.label} className="bg-card border-border rounded-xl">
              <CardContent className="flex items-center justify-between p-3">
                <div className="flex items-center gap-2 min-w-0">
                  <div className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${c.iconColor}`}>
                    <c.icon size={16} />
                  </div>
                  <span className="text-sm text-muted-foreground truncate">{c.label}</span>
                </div>
                {loading ? (
                  <Skeleton className="h-6 w-20 ml-3 shrink-0" />
                ) : (
                  <div className="text-lg font-bold tabular-nums ml-3 shrink-0">{c.prefix}{c.display}</div>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(240px,1fr))] gap-5">
          {statCards.map((c) => (
            <Card key={c.label} className="bg-card border-border rounded-2xl">
              <CardContent className="flex flex-row items-start gap-4 p-6">
                <div className={`w-12 h-12 rounded-2xl flex items-center justify-center shrink-0 ${c.iconColor}`}>
                  <c.icon size={22} />
                </div>
                <div>
                  {loading ? (
                    <Skeleton className="h-8 w-24 mb-1" />
                  ) : (
                    <div className="text-[28px] font-bold leading-tight">{c.prefix}{c.display}</div>
                  )}
                  <div className="text-[13px] text-muted-foreground mt-1">{c.label}</div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* AI 聊天 */}
      {currentBookId && aiEnabled && (
        <div>
          <h2 className="text-base font-semibold mb-3">AI 助手</h2>
          {aiConfigured ? (
            <ChatWindow />
          ) : (
            <div className="p-5 bg-card border border-border rounded-xl text-center">
              <Bot size={24} className="mx-auto mb-2 text-muted-foreground" />
              <p className="text-sm text-muted-foreground mb-3">AI 助手尚未配置模型，请先完成供应商配置</p>
              <Link to="/settings" className="inline-flex items-center gap-1.5 text-sm text-primary hover:underline">
                <Settings size={14} />
                前往配置
              </Link>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

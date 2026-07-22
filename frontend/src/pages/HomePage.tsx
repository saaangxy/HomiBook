import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Card, CardContent } from '@/components/ui/card'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Skeleton } from '@/components/ui/skeleton'
import { Book, Wallet, ArrowUpCircle, ArrowDownCircle, TrendingUp, TrendingDown, AlertTriangle, Bot, Settings } from 'lucide-react'
import { useBookStore } from '../stores/book'
import { recordApi, type RecordSummary } from '../api/record'
import { accountApi } from '../api/account'
import { budgetApi, type BudgetItem } from '../api/budget'
import { ChatWindow } from '../components/ai/ChatWindow'
import { fetchAIConfig } from '../api/chat'

export function HomePage() {
  const { currentBookId, books } = useBookStore()
  const currentBook = books.find((b) => b.id === currentBookId)

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
      <div className="grid grid-cols-[repeat(auto-fill,minmax(240px,1fr))] gap-5">
        <Card className="bg-card border-border rounded-2xl">
          <CardContent className="flex flex-row items-start gap-4 p-6">
            <div className="w-12 h-12 rounded-2xl bg-[#3b82f6]/10 text-[#3b82f6] flex items-center justify-center shrink-0">
              <Wallet size={22} />
            </div>
            <div>
              {loading ? (
                <Skeleton className="h-8 w-12 mb-1" />
              ) : (
                <div className="text-[28px] font-bold leading-tight">{accountCount}</div>
              )}
              <div className="text-[13px] text-muted-foreground mt-1">活跃账户</div>
            </div>
          </CardContent>
        </Card>

        <Card className="bg-card border-border rounded-2xl">
          <CardContent className="flex flex-row items-start gap-4 p-6">
            <div className="w-12 h-12 rounded-2xl bg-primary/10 text-primary flex items-center justify-center shrink-0">
              <ArrowUpCircle size={22} />
            </div>
            <div>
              {loading ? (
                <Skeleton className="h-8 w-24 mb-1" />
              ) : (
                <div className="text-[28px] font-bold leading-tight">
                  ¥{summary ? (summary.income / 100).toLocaleString() : '0'}
                </div>
              )}
              <div className="text-[13px] text-muted-foreground mt-1">本月收入</div>
            </div>
          </CardContent>
        </Card>

        <Card className="bg-card border-border rounded-2xl">
          <CardContent className="flex flex-row items-start gap-4 p-6">
            <div className="w-12 h-12 rounded-2xl bg-[#ef4444]/10 text-[#ef4444] flex items-center justify-center shrink-0">
              <ArrowDownCircle size={22} />
            </div>
            <div>
              {loading ? (
                <Skeleton className="h-8 w-24 mb-1" />
              ) : (
                <div className="text-[28px] font-bold leading-tight">
                  ¥{summary ? (summary.expense / 100).toLocaleString() : '0'}
                </div>
              )}
              <div className="text-[13px] text-muted-foreground mt-1">本月支出</div>
            </div>
          </CardContent>
        </Card>

        <Card className="bg-card border-border rounded-2xl">
          <CardContent className="flex flex-row items-start gap-4 p-6">
            <div className={`w-12 h-12 rounded-2xl shrink-0 flex items-center justify-center ${
              summary && summary.netIncome > 0 ? 'bg-[#22c55e]/10 text-[#22c55e]' : 'bg-[#f97316]/10 text-[#f97316]'
            }`}>
              {summary && summary.netIncome >= 0 ? <TrendingUp size={22} /> : <TrendingDown size={22} />}
            </div>
            <div>
              {loading ? (
                <Skeleton className="h-8 w-24 mb-1" />
              ) : (
                <div className="text-[28px] font-bold leading-tight">
                  ¥{summary ? ((summary.netIncome) / 100).toLocaleString() : '0'}
                </div>
              )}
              <div className="text-[13px] text-muted-foreground mt-1">本月结余</div>
            </div>
          </CardContent>
        </Card>
      </div>

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

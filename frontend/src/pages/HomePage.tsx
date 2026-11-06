import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import ReactECharts from 'echarts-for-react'
import { Card, CardContent } from '@/components/ui/card'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Book, Wallet, ArrowUpCircle, ArrowDownCircle, TrendingUp, TrendingDown, AlertTriangle,
  Plus, Upload, CopyMinus, Scale, ChevronRight, Settings2, Repeat, GripVertical, Check,
  ArrowUpDown, LayoutGrid,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '@/components/ui/dialog'
import { recurringApi, type RecurringTransaction } from '../api/recurring'
import { cn } from '@/lib/utils'
import { useBookStore } from '../stores/book'
import { useIsMobile } from '@/hooks/use-mobile'
import { recordApi, type RecordItem, type RecordSummary } from '../api/record'
import { accountApi, type AccountItem } from '../api/account'
import { budgetApi, type BudgetItem } from '../api/budget'

import { RECORD_TYPE_BADGE_CLASS } from '@/lib/record-type'

/** 首页可管理的卡片(顺序即展示顺序) */
const HOME_CARDS = [
  { key: 'bookinfo', label: '当前账本' },
  { key: 'stats', label: '统计卡片' },
  { key: 'quick', label: '快捷操作' },
  { key: 'accounts', label: '账户余额' },
  { key: 'budget', label: '本月预算' },
  { key: 'recurring', label: '固定收支' },
  { key: 'loan', label: '贷款还款' },
  { key: 'trend', label: '近 6 月趋势' },
  { key: 'category', label: '分类分布' },
  { key: 'recent', label: '最近流水' },
] as const

const HOME_CARDS_STORAGE = 'homibook-home-cards'
const HOME_ORDER_STORAGE = 'homibook-home-order'
/** 可拖拽排序的单张卡片 */
const HOME_BLOCKS = ['bookinfo', 'stats', 'quick', 'accounts', 'budget', 'recurring', 'loan', 'trend', 'category', 'recent'] as const


function loadCardOrder(): string[] {
  try {
    const raw = localStorage.getItem(HOME_ORDER_STORAGE)
    if (raw) {
      const parsed = JSON.parse(raw)
      if (Array.isArray(parsed)) {
        const valid = parsed.filter((k) => HOME_BLOCKS.includes(k))
        // 补齐后续新增的块,避免版本升级后丢失
        for (const k of HOME_BLOCKS) if (!valid.includes(k)) valid.push(k)
        return valid
      }
    }
  } catch {
    /* ignore */
  }
  return [...HOME_BLOCKS]
}

function loadVisibleCards(): string[] {
  try {
    const raw = localStorage.getItem(HOME_CARDS_STORAGE)
    if (raw) {
      const parsed = JSON.parse(raw)
      if (Array.isArray(parsed)) return parsed.filter((k) => HOME_CARDS.some((c) => c.key === k))
    }
  } catch {
    /* ignore */
  }
  return HOME_CARDS.map((c) => c.key)
}

/** 日期友好化:今天 / 昨天 / MM-DD(首页最近流水用) */
function formatDay(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '--'
  const today = new Date()
  const startOfToday = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime()
  const startOfThat = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
  const diff = Math.round((startOfToday - startOfThat) / 86400000)
  if (diff === 0) return '今天'
  if (diff === 1) return '昨天'
  return `${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/** 卡片右上角的拖拽锚点:只有按住它才能拖,避免误触卡片内的按钮/链接 */
function DragHandle({ cardKey, onStart, onEnd }: {
  cardKey: string
  onStart: (key: string) => void
  onEnd: () => void
}) {
  return (
    <span
      draggable
      onDragStart={(e) => {
        e.dataTransfer.effectAllowed = 'move'
        e.dataTransfer.setData('text/plain', cardKey)
        onStart(cardKey)
      }}
      onDragEnd={onEnd}
      title="拖动排序"
      className="absolute right-2 top-2 z-10 cursor-move rounded p-0.5 text-muted-foreground/50 transition-colors hover:bg-muted hover:text-foreground"
    >
      <GripVertical size={13} />
    </span>
  )
}

export function HomePage() {
  const { currentBookId, books } = useBookStore()
  const currentBook = books.find((b) => b.id === currentBookId)
  const isMobile = useIsMobile()

  const navigate = useNavigate()

  const [summary, setSummary] = useState<RecordSummary | null>(null)
  const [accountCount, setAccountCount] = useState(0)
  const [budgets, setBudgets] = useState<BudgetItem[]>([])
  const [accounts, setAccounts] = useState<AccountItem[]>([])
  const [recentRecords, setRecentRecords] = useState<RecordItem[]>([])
  const [recurring, setRecurring] = useState<RecurringTransaction[]>([])
  const [trend, setTrend] = useState<Array<{ month: string; income: number; expense: number }>>([])
  const [categoryStats, setCategoryStats] = useState<Array<{ categoryCode: string | null; categoryName: string; amount: number }>>([])
  /** 首页卡片可见性(存 localStorage,默认全开) */
  const [visibleCards, setVisibleCards] = useState<string[]>(() => loadVisibleCards())
  /** 区块顺序(拖拽排序,存 localStorage);块内多张卡片作为整体移动 */
  const [cardOrder, setCardOrder] = useState<string[]>(() => loadCardOrder())
  const [dragKey, setDragKey] = useState<string | null>(null)
  /** 控制台弹窗:卡片显示用「草稿 + 确认」,不即时生效 */
  const [managerOpen, setManagerOpen] = useState(false)
  const [draftVisible, setDraftVisible] = useState<string[]>(() => loadVisibleCards())
  /** 控制台 FAB 是否展开(点击或悬浮展开两个子按钮) */
  const [fabOpen, setFabOpen] = useState(false)
  /** 排序模式:进入后才显示锚点,底部出现保存/重置 */
  const [sortMode, setSortMode] = useState(false)
  /** 进入排序模式时的顺序快照,用于「重置」 */
  const [sortBackup, setSortBackup] = useState<string[] | null>(null)

  const saveOrder = (next: string[]) => {
    try {
      localStorage.setItem(HOME_ORDER_STORAGE, JSON.stringify(next))
    } catch {
      /* ignore */
    }
  }

  /** 卡片右上角锚点:统一生成,避免每处重复写三个属性 */
  const renderHandle = (key: string) =>
    sortMode ? (
      <DragHandle key={`${key}-handle`} cardKey={key} onStart={setDragKey} onEnd={() => setDragKey(null)} />
    ) : null

  /** 拖到另一张卡片上就实时换位(不等松手),这样其余卡片会跟着让位 */
  /** order 不可过渡 → 用浏览器原生 View Transition 包一层,换位时自动播放位移动画 */
  const withViewTransition = (run: () => void) => {
    type DocWithVT = Document & {
      startViewTransition?: (cb: () => void) => { finished: Promise<void> }
    }
    const doc = document as DocWithVT
    if (typeof doc.startViewTransition === 'function') {
      doc.startViewTransition(run)
    } else {
      run()
    }
  }

  const onCardEnter = (key: string) => {
    if (!dragKey || dragKey === key) return
    withViewTransition(() => {
      setCardOrder((prev) => {
        const next = [...prev]
        const from = next.indexOf(dragKey)
        const to = next.indexOf(key)
        if (from < 0 || to < 0) return prev
        next.splice(from, 1)
        next.splice(to, 0, dragKey)
        return next
      })
    })
  }

  /**
   * 排序属性。
   * viewTransitionName 让浏览器在 startViewTransition 期间自动做位移动画(原生 FLIP),
   * 比手动 getBoundingClientRect + transform 更稳,也不违反 react-compiler 的规则。
   */
  const blockProps = (key: string) => ({
    style: {
      order: cardOrder.indexOf(key),
      viewTransitionName: `home-card-${key}`,
    },
    onDragEnter: () => onCardEnter(key),
    onDragOver: (e: React.DragEvent) => e.preventDefault(),
  })


  useEffect(() => {
    try {
      localStorage.setItem(HOME_CARDS_STORAGE, JSON.stringify(visibleCards))
    } catch {
      /* ignore */
    }
  }, [visibleCards])
  // 初始为 true:避免首屏先闪一下 0 再跳真实数据;切账本时不重置(减少一次同步 setState)
  const [loading, setLoading] = useState(true)
  useEffect(() => {
    if (!currentBookId) return

    const now = new Date()
    const year = now.getFullYear()
    const month = now.getMonth() + 1
    const dateFrom = `${year}-${String(month).padStart(2, '0')}-01`
    const dateTo = `${year}-${String(month).padStart(2, '0')}-${new Date(year, month, 0).getDate()}`
    // 近 6 个月(含本月)的趋势起点
    const sixMonthsAgo = `${new Date(year, month - 6, 1).getFullYear()}-${String(new Date(year, month - 6, 1).getMonth() + 1).padStart(2, '0')}-01`

    Promise.all([
      recordApi.summary({ bookId: currentBookId, dateFrom, dateTo }),
      accountApi.list(currentBookId),
      budgetApi.listFixed({ bookId: currentBookId, year, month }),
      recordApi.list({ bookId: currentBookId, page: 1, pageSize: 10 }),
      recurringApi.list(currentBookId),
      recordApi.monthlyTrend({ bookId: currentBookId, dateFrom: sixMonthsAgo, dateTo }),
      recordApi.categorySummary({ bookId: currentBookId, type: 'EXPENSE', dateFrom, dateTo }),
    ])
      .then(([summaryData, accountList, budgetData, recent, recurringList, trendData, categoryData]) => {
        setSummary(summaryData)
        setAccounts(accountList)
        setAccountCount(accountList.filter((a) => a.status === 'ACTIVE').length)
        setBudgets(budgetData)
        setRecentRecords(recent.records)
        setRecurring(recurringList)
        setTrend(trendData)
        setCategoryStats(categoryData)
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
    { icon: ArrowUpCircle, iconColor: 'bg-primary text-primary-foreground', label: '本月收入', display: summary ? summary.income.toLocaleString() : '0', prefix: '¥' },
    { icon: ArrowDownCircle, iconColor: RECORD_TYPE_BADGE_CLASS.EXPENSE, label: '本月支出', display: summary ? summary.expense.toLocaleString() : '0', prefix: '¥' },
    { icon: netIcon, iconColor: netColor, label: '本月结余', display: summary ? summary.netIncome.toLocaleString() : '0', prefix: '¥' },
  ]

  const loans = recurring.filter((r) => r.recurringType === 'LOAN')
  const categoryTotal = categoryStats.reduce((s, c) => s + c.amount, 0)
  const trendMax = Math.max(1, ...trend.map((t) => Math.max(t.income, t.expense)))

  return (
    // 单卡级排序:所有卡片是同一个 grid 的子项,靠 style.order 控制位置
    <div className="grid auto-rows-min grid-cols-1 items-start gap-6 md:grid-cols-2">
      {/* 账本信息(可排序卡片) */}
      {currentBook ? (
        <div
          {...blockProps('bookinfo')}
          className={cn(
            'relative flex items-center gap-2.5 rounded-xl border border-border bg-card px-5 py-3 transition-all md:col-span-2',
            dragKey === 'bookinfo' && 'scale-[1.01] opacity-60 ring-2 ring-primary/40 shadow-xl',
            !visibleCards.includes('bookinfo') && 'hidden',
          )}
        >
          {renderHandle('bookinfo')}
          <Book size={18} className="text-primary" />
          <span className="text-sm text-muted-foreground">当前账本：</span>
          <span className="text-sm font-semibold text-primary">{currentBook.name}</span>
        </div>
      ) : (
        <div
          {...blockProps('bookinfo')}
          className={cn(
            'relative rounded-xl border border-border bg-card p-5 text-center text-sm text-muted-foreground transition-all md:col-span-2',
            dragKey === 'bookinfo' && 'scale-[1.01] opacity-60 ring-2 ring-primary/40 shadow-xl',
            !visibleCards.includes('bookinfo') && 'hidden',
          )}
        >
          {renderHandle('bookinfo')}
          请选择或创建账本开始记账
        </div>
      )}

      {/* 预算预警 */}
      {dangerBudgets.length > 0 && (
        <Alert variant="destructive" className="shrink-0">
          <AlertTriangle className="h-4 w-4" />
          <AlertDescription>
            {dangerBudgets.map((b) => b.name).join('、')} 已超预算
          </AlertDescription>
        </Alert>
      )}
      {warnBudgets.filter((b) => !dangerBudgets.includes(b)).length > 0 && (
        <Alert className="shrink-0">
          <AlertTriangle className="h-4 w-4" />
          <AlertDescription>
            {warnBudgets.filter((b) => !dangerBudgets.includes(b)).map((b) => `${b.name}(${Math.round((b.actualAmount / b.amount) * 100)}%)`).join('、')} 即将超预算
          </AlertDescription>
        </Alert>
      )}

      {/* 统计卡片(可排序) */}
      <div
        {...blockProps('stats')}
        className={cn(
          'relative transition-all md:col-span-2',
          dragKey === 'stats' && 'opacity-60 ring-2 ring-primary/40 shadow-xl',
          !visibleCards.includes('stats') && 'hidden',
        )}
      >
        {renderHandle('stats')}
        {isMobile ? (
        <div className="grid grid-cols-4 gap-2">
          {statCards.map((c) => (
            <Card key={c.label} className="bg-card border-border rounded-xl">
              <CardContent className="flex flex-col items-center gap-1 p-2 min-w-0">
                <div className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${c.iconColor}`}>
                  <c.icon size={16} />
                </div>
                <span className="text-[11px] text-muted-foreground truncate w-full text-center">{c.label}</span>
                {loading ? (
                  <Skeleton className="h-5 w-14" />
                ) : (
                  <div className="text-sm font-bold tabular-nums truncate w-full text-center">{c.prefix}{c.display}</div>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      ) : (
        <div className="shrink-0 grid grid-cols-[repeat(auto-fill,minmax(240px,1fr))] gap-5">
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
      </div>

      {/* 快捷操作 */}
      <div
        {...blockProps('quick')}
        className={cn(
          'relative grid grid-cols-2 gap-3 transition-all md:col-span-2 md:grid-cols-4',
          dragKey === 'quick' && 'opacity-60 ring-2 ring-primary/40 shadow-xl',
          !visibleCards.includes('quick') && 'hidden',
        )}
      >
        {renderHandle('quick')}
        {[
          { icon: Plus, label: '记一笔', action: 'record' },
          { icon: Upload, label: '导入', action: 'import' },
          { icon: CopyMinus, label: '去重', action: 'dedup' },
          { icon: Scale, label: '平账', action: 'offset' },
        ].map((a) => (
          <button
            key={a.action}
            type="button"
            onClick={() => navigate(`/records?action=${a.action}`)}
            className="flex items-center gap-2 rounded-xl border border-border bg-card px-4 py-3 text-sm transition-colors hover:border-primary/40 hover:bg-accent/40"
          >
            <a.icon size={16} className="text-primary" />
            <span>{a.label}</span>
            <ChevronRight size={14} className="ml-auto text-muted-foreground" />
          </button>
        ))}
      </div>

      {/* 账户余额 + 预算进度:容器设为 contents,内部卡片直接参与外层 grid 排序 */}
      <div className={cn('contents', !(visibleCards.includes('accounts') || visibleCards.includes('budget')) && 'hidden')}>
        <Card
          {...blockProps('accounts')}
          className={cn(
            'relative rounded-2xl border border-border bg-card transition-all',
            dragKey === 'accounts' && 'scale-[1.01] opacity-60 ring-2 ring-primary/40 shadow-xl',
            !visibleCards.includes('accounts') && 'hidden',
          )}
        >
          {renderHandle('accounts')}
          <CardContent className="p-4">
            <div className="mb-3 flex items-center justify-between">
              <h3 className="text-sm font-semibold">账户余额</h3>
              <button
                type="button"
                className="flex items-center gap-0.5 text-xs text-muted-foreground hover:text-primary"
                onClick={() => navigate('/accounts')}
              >
                全部 <ChevronRight size={12} />
              </button>
            </div>
            {accounts.length === 0 ? (
              <p className="py-6 text-center text-xs text-muted-foreground">暂无账户</p>
            ) : (
              <div className="space-y-2">
                {accounts.slice(0, 6).map((a) => (
                  <button
                    key={a.id}
                    type="button"
                    onClick={() => navigate('/accounts')}
                    className="flex w-full items-center gap-2 text-sm hover:text-primary"
                  >
                    <span className="truncate">{a.name}</span>
                    <span className={`ml-auto shrink-0 font-medium tabular-nums ${(a.computedBalance ?? 0) < 0 ? 'text-[#f97316]' : ''}`}>
                      ¥{(a.computedBalance ?? 0).toFixed(2)}
                    </span>
                  </button>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <Card
          {...blockProps('budget')}
          className={cn(
            'relative rounded-2xl border border-border bg-card transition-all',
            dragKey === 'budget' && 'scale-[1.01] opacity-60 ring-2 ring-primary/40 shadow-xl',
            !visibleCards.includes('budget') && 'hidden',
          )}
        >
          {renderHandle('budget')}
          <CardContent className="p-4">
            <div className="mb-3 flex items-center justify-between">
              <h3 className="text-sm font-semibold">本月预算</h3>
              <button
                type="button"
                className="flex items-center gap-0.5 text-xs text-muted-foreground hover:text-primary"
                onClick={() => navigate('/budget')}
              >
                全部 <ChevronRight size={12} />
              </button>
            </div>
            {budgets.length === 0 ? (
              <p className="py-6 text-center text-xs text-muted-foreground">本月未设置预算</p>
            ) : (
              <div className="space-y-3">
                {budgets.slice(0, 5).map((b) => {
                  const pct = b.amount > 0 ? Math.min(100, (b.actualAmount / b.amount) * 100) : 0
                  const over = b.amount > 0 && b.actualAmount >= b.amount
                  return (
                    <div key={b.id}>
                      <div className="mb-1 flex items-center justify-between text-xs">
                        <span className="truncate">{b.name}</span>
                        <span className="shrink-0 tabular-nums text-muted-foreground">
                          ¥{b.actualAmount.toFixed(0)} / {b.amount.toFixed(0)}
                        </span>
                      </div>
                      <div className="h-1.5 overflow-hidden rounded-full bg-muted">
                        <div
                          className={`h-full rounded-full ${over ? 'bg-[#ef4444]' : pct > 85 ? 'bg-[#f97316]' : 'bg-primary'}`}
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* 固定收支 */}
      <Card
        {...blockProps('recurring')}
        className={cn(
          'relative rounded-2xl border border-border bg-card transition-all',
          dragKey === 'recurring' && 'scale-[1.01] opacity-60 ring-2 ring-primary/40 shadow-xl',
          !visibleCards.includes('recurring') && 'hidden',
        )}
      >
        {renderHandle('recurring')}
        <CardContent className="p-4">
          <div className="mb-3 flex items-center justify-between">
            <h3 className="flex items-center gap-1.5 text-sm font-semibold">
              <Repeat size={14} className="text-primary" /> 固定收支
            </h3>
            <button
              type="button"
              className="flex items-center gap-0.5 text-xs text-muted-foreground hover:text-primary"
              onClick={() => navigate('/recurring')}
            >
              全部 <ChevronRight size={12} />
            </button>
          </div>
          {recurring.length === 0 ? (
            <p className="py-6 text-center text-xs text-muted-foreground">还没有固定收支规则</p>
          ) : (
            <div className="divide-y divide-border">
              {recurring.slice(0, 5).map((r) => (
                <button
                  key={r.id}
                  type="button"
                  onClick={() => navigate('/recurring')}
                  className="flex w-full items-center gap-3 py-2 text-left text-sm hover:bg-accent/30"
                >
                  <span className="min-w-0 truncate">{r.name}</span>
                  {/* 不再展示 cron 表达式,直接给「下次执行时间」 */}
                  <span className="hidden shrink-0 text-xs text-muted-foreground sm:inline">
                    {r.nextGenerateAt
                      ? `下次 ${new Date(r.nextGenerateAt).toLocaleDateString('zh-CN', { month: '2-digit', day: '2-digit' })}`
                      : r.cronDescription || ''}
                  </span>
                  <span
                    className={cn(
                      'ml-auto shrink-0 font-medium tabular-nums',
                      r.type === 'INCOME' && 'text-[#22c55e]',
                      r.type === 'EXPENSE' && 'text-[#ef4444]',
                      r.type === 'TRANSFER' && 'text-[#3b82f6]',
                    )}
                  >
                    {r.type === 'INCOME' ? '+' : r.type === 'EXPENSE' ? '-' : ''}¥{Number(r.amount).toFixed(2)}
                  </span>
                </button>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* 贷款还款 / 近 6 月趋势 / 分类分布 */}
      <div
        className={cn(
          'contents',
          !(visibleCards.includes('loan') || visibleCards.includes('trend') || visibleCards.includes('category')) && 'hidden',
        )}
      >
        <Card
          {...blockProps('loan')}
          className={cn(
            'relative rounded-2xl border border-border bg-card transition-all',
            dragKey === 'loan' && 'scale-[1.01] opacity-60 ring-2 ring-primary/40 shadow-xl',
            !visibleCards.includes('loan') && 'hidden',
          )}
        >
          {renderHandle('loan')}
          <CardContent className="p-4">
            <div className="mb-3 flex items-center justify-between">
              <h3 className="text-sm font-semibold">贷款还款</h3>
              <button
                type="button"
                className="flex items-center gap-0.5 text-xs text-muted-foreground hover:text-primary"
                onClick={() => navigate('/recurring')}
              >
                全部 <ChevronRight size={12} />
              </button>
            </div>
            {loans.length === 0 ? (
              <p className="py-6 text-center text-xs text-muted-foreground">暂无贷款</p>
            ) : (
              <div className="space-y-2">
                {loans.slice(0, 3).map((r) => (
                  <button
                    key={r.id}
                    type="button"
                    onClick={() => navigate('/recurring')}
                    className="w-full text-left"
                  >
                    <div className="flex items-center gap-2 text-sm">
                      <span className="truncate">{r.name}</span>
                      {/* 贷款每期还款属于支出 → 语义红 */}
                      <span className="ml-auto shrink-0 font-medium tabular-nums text-[#ef4444]">
                        ¥{Number(r.amount).toFixed(2)}<span className="text-[11px] font-normal text-muted-foreground">/期</span>
                      </span>
                    </div>
                    <div className="mt-0.5 flex flex-wrap gap-x-2 text-[11px] text-muted-foreground">
                      <span>总额 ¥{Number(r.loanTotalAmount ?? 0).toFixed(0)}</span>
                      {r.loanRemainingAmount != null && (
                        <span>剩余 ¥{Number(r.loanRemainingAmount).toFixed(0)}</span>
                      )}
                      {r.loanTermMonths != null && <span>{r.loanTermMonths} 期</span>}
                      {r.loanInterestRate != null && (
                        <span>年利率 {(Number(r.loanInterestRate) * 100).toFixed(2)}%</span>
                      )}
                    </div>
                    <div className="text-[11px] text-muted-foreground">
                      {r.nextGenerateAt
                        ? `下次还款 ${new Date(r.nextGenerateAt).toLocaleDateString('zh-CN', { month: '2-digit', day: '2-digit' })}`
                        : r.active ? '未安排下次还款' : '已停用'}
                    </div>
                  </button>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <Card
          {...blockProps('trend')}
          className={cn(
            'relative rounded-2xl border border-border bg-card transition-all',
            dragKey === 'trend' && 'scale-[1.01] opacity-60 ring-2 ring-primary/40 shadow-xl',
            !visibleCards.includes('trend') && 'hidden',
          )}
        >
          {renderHandle('trend')}
          <CardContent className="p-4">
            <div className="mb-3 flex items-center justify-between">
              <h3 className="text-sm font-semibold">近 6 月趋势</h3>
              <span className="flex items-center gap-2 text-[10px] text-muted-foreground">
                <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-sm bg-[#22c55e]" />收入</span>
                <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-sm bg-[#ef4444]" />支出</span>
              </span>
            </div>
            {trend.length === 0 ? (
              <p className="py-6 text-center text-xs text-muted-foreground">暂无数据</p>
            ) : (
              <ReactECharts
                notMerge
                style={{ height: 150 }}
                option={{
                  grid: { left: 6, right: 6, top: 10, bottom: 20 },
                  tooltip: {
                    trigger: 'axis',
                    valueFormatter: (v: unknown) => `¥${Number(v).toFixed(2)}`,
                    textStyle: { fontSize: 11 },
                  },
                  xAxis: {
                    type: 'category',
                    data: trend.map((t) => t.month.slice(5)),
                    axisLine: { show: false },
                    axisTick: { show: false },
                    axisLabel: { fontSize: 10, color: '#94a3b8' },
                  },
                  yAxis: { type: 'value', show: false, max: trendMax },
                  series: [
                    {
                      name: '收入',
                      type: 'line',
                      smooth: true,
                      symbolSize: 4,
                      data: trend.map((t) => t.income),
                      lineStyle: { width: 2 },
                      itemStyle: { color: '#22c55e' },
                      areaStyle: { opacity: 0.08 },
                    },
                    {
                      name: '支出',
                      type: 'line',
                      smooth: true,
                      symbolSize: 4,
                      data: trend.map((t) => t.expense),
                      lineStyle: { width: 2 },
                      itemStyle: { color: '#ef4444' },
                      areaStyle: { opacity: 0.08 },
                    },
                  ],
                }}
              />
            )}
          </CardContent>
        </Card>

        <Card
          {...blockProps('category')}
          className={cn(
            'relative rounded-2xl border border-border bg-card transition-all md:col-span-2',
            dragKey === 'category' && 'scale-[1.01] opacity-60 ring-2 ring-primary/40 shadow-xl',
            !visibleCards.includes('category') && 'hidden',
          )}
        >
          {renderHandle('category')}
          <CardContent className="p-4">
            <div className="mb-3 flex items-center justify-between">
              <h3 className="text-sm font-semibold">分类分布（本月支出）</h3>
              <button
                type="button"
                className="flex items-center gap-0.5 text-xs text-muted-foreground hover:text-primary"
                onClick={() => navigate('/stats')}
              >
                统计 <ChevronRight size={12} />
              </button>
            </div>
            {categoryStats.length === 0 ? (
              <p className="py-6 text-center text-xs text-muted-foreground">本月还没有支出</p>
            ) : (
              <div className="space-y-2">
                {categoryStats
                  .slice()
                  .sort((a, b) => b.amount - a.amount)
                  .slice(0, 5)
                  .map((c) => {
                    const pct = categoryTotal > 0 ? (c.amount / categoryTotal) * 100 : 0
                    return (
                      <div key={`${c.categoryCode ?? 'none'}-${c.categoryName}`}>
                        <div className="mb-1 flex items-center justify-between text-xs">
                          <span className="truncate">{c.categoryName || '未分类'}</span>
                          {/* 分类分布统计的是支出 → 语义红 */}
                          <span className="shrink-0 tabular-nums text-[#ef4444]">
                            ¥{c.amount.toFixed(2)} <span className="text-muted-foreground">· {pct.toFixed(0)}%</span>
                          </span>
                        </div>
                        <div className="h-1.5 overflow-hidden rounded-full bg-muted">
                          <div className="h-full rounded-full bg-primary" style={{ width: `${pct}%` }} />
                        </div>
                      </div>
                    )
                  })}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* 最近流水 */}
      <Card
        {...blockProps('recent')}
        className={cn(
          'relative rounded-2xl border border-border bg-card transition-all md:col-span-2',
          dragKey === 'recent' && 'scale-[1.01] opacity-60 ring-2 ring-primary/40 shadow-xl',
          !visibleCards.includes('recent') && 'hidden',
        )}
      >
        {renderHandle('recent')}
        <CardContent className="p-4">
          <div className="mb-2 flex items-center justify-between">
            <h3 className="text-sm font-semibold">最近流水</h3>
            <button
              type="button"
              className="flex items-center gap-0.5 text-xs text-muted-foreground hover:text-primary"
              onClick={() => navigate('/records')}
            >
              全部 <ChevronRight size={12} />
            </button>
          </div>
          {recentRecords.length === 0 ? (
            <p className="py-6 text-center text-xs text-muted-foreground">还没有流水</p>
          ) : (
            <div className="divide-y divide-border">
              {recentRecords.map((r) => (
                <button
                  key={r.id}
                  type="button"
                  onClick={() => navigate('/records')}
                  className="flex w-full items-center gap-3 py-2 text-left text-sm hover:bg-accent/30"
                >
                  <span className="w-10 shrink-0 text-xs tabular-nums text-muted-foreground">
                    {formatDay(r.date)}
                  </span>
                  {/* 主体:转账只写「转账」,具体从哪个账户到哪个账户交给账户列 */}
                  <span className="min-w-0 flex-1 truncate">
                    {r.type === 'TRANSFER'
                      ? r.remark || '转账'
                      : r.remark || r.categoryCode || r.payer || '—'}
                  </span>
                  {/* 分类 */}
                  <span className="hidden w-16 shrink-0 truncate text-xs text-muted-foreground md:inline">
                    {r.type === 'TRANSFER' ? '—' : (r.categoryCode || '未分类')}
                  </span>
                  {/* 账户:转账显示「转出 → 转入」,给足宽度避免截断 */}
                  <span className="hidden w-44 shrink-0 truncate text-xs text-muted-foreground sm:inline">
                    {r.type === 'TRANSFER'
                      ? `${r.account?.name ?? '账户'} → ${r.toAccount?.name ?? '账户'}`
                      : (r.account?.name || '—')}
                  </span>
                  <span className="hidden w-14 shrink-0 truncate text-xs text-muted-foreground lg:inline">
                    {r.payer || '—'}
                  </span>
                  {/* 语义色:收入绿、支出红、转账蓝(不带正负号);固定宽度右对齐,位数不同也不左右浮动 */}
                  <span
                    className={cn(
                      'w-24 shrink-0 text-right font-medium tabular-nums',
                      r.type === 'INCOME' && 'text-[#22c55e]',
                      r.type === 'EXPENSE' && 'text-[#ef4444]',
                      r.type === 'TRANSFER' && 'text-[#3b82f6]',
                    )}
                  >
                    {r.type === 'INCOME' ? '+' : r.type === 'EXPENSE' ? '-' : ''}
                    ¥{r.amount.toFixed(2)}
                  </span>
                </button>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* 控制台 FAB:点击或悬浮展开「排序」「管理」两个动作 */}
      {/* 固定在右下角;right 取 30px 让 44px 的按钮与 56px 的 AI 按钮中心对齐(24 + (56-44)/2) */}
      <div
        className="fixed bottom-6 right-[30px] z-40 flex flex-col items-end gap-2"
        onMouseEnter={() => setFabOpen(true)}
        onMouseLeave={() => setFabOpen(false)}
      >
        {fabOpen && (
          <>
            <button
              type="button"
              title={sortMode ? '完成排序' : '拖拽排序'}
              onClick={() => {
                if (sortMode) {
                  saveOrder(cardOrder)
                  setSortMode(false)
                  setSortBackup(null)
                } else {
                  setSortBackup(cardOrder)
                  setSortMode(true)
                }
                setFabOpen(false)
              }}
              className={cn(
                'flex h-9 w-9 items-center justify-center rounded-full border shadow-md transition-colors',
                sortMode
                  ? 'border-primary bg-primary text-primary-foreground'
                  : 'border-border bg-card text-sky-500 hover:text-sky-600',
              )}
            >
              <ArrowUpDown size={15} />
            </button>
            <button
              type="button"
              title="卡片管理"
              onClick={() => {
                setDraftVisible(visibleCards)
                setManagerOpen(true)
                setFabOpen(false)
              }}
              className="flex h-9 w-9 items-center justify-center rounded-full border border-border bg-card text-violet-500 shadow-md transition-colors hover:text-violet-600"
            >
              <LayoutGrid size={15} />
            </button>
          </>
        )}
        <button
          type="button"
          onClick={() => setFabOpen((v) => !v)}
          title="控制台"
          aria-label="控制台"
          className="flex h-11 w-11 items-center justify-center rounded-full border border-border bg-card text-muted-foreground shadow-lg transition-colors hover:text-primary"
        >
          <Settings2 size={18} />
        </button>
      </div>

      {/* 排序模式:底部保存 / 重置 */}
      {sortMode && (
        <div className="fixed bottom-6 left-1/2 z-50 flex -translate-x-1/2 items-center gap-2 rounded-full border border-border bg-card px-4 py-2 shadow-xl">
          <span className="hidden text-xs text-muted-foreground sm:inline">拖动卡片右上角锚点排序</span>
          <Button
            variant="ghost"
            size="sm"
            className="h-7 text-xs"
            onClick={() => {
              if (sortBackup) setCardOrder(sortBackup)
            }}
          >
            重置
          </Button>
          <Button
            size="sm"
            className="h-7 text-xs"
            onClick={() => {
              saveOrder(cardOrder)
              setSortMode(false)
              setSortBackup(null)
            }}
          >
            保存
          </Button>
        </div>
      )}

      <Dialog open={managerOpen} onOpenChange={setManagerOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="text-base">卡片管理</DialogTitle>
            <DialogDescription className="text-xs">选择要展示的卡片，确认后生效</DialogDescription>
          </DialogHeader>

          <div className="space-y-0.5 py-1">
            {HOME_CARDS.map((c) => {
              const checked = draftVisible.includes(c.key)
              return (
                <button
                  key={c.key}
                  type="button"
                  onClick={() =>
                    setDraftVisible((prev) =>
                      checked ? prev.filter((k) => k !== c.key) : [...prev, c.key],
                    )
                  }
                  className="flex w-full items-center gap-3 rounded-lg px-2 py-2 text-sm transition-colors hover:bg-accent/50"
                >
                  <span
                    className={cn(
                      'flex h-4 w-4 shrink-0 items-center justify-center rounded border',
                      checked
                        ? 'border-primary bg-primary text-primary-foreground'
                        : 'border-border bg-background',
                    )}
                  >
                    {checked && <Check size={11} />}
                  </span>
                  <span className={cn(!checked && 'text-muted-foreground')}>{c.label}</span>
                </button>
              )
            })}
          </div>

          <DialogFooter className="gap-2">
            <Button variant="outline" size="sm" onClick={() => setManagerOpen(false)}>
              取消
            </Button>
            <Button
              size="sm"
              onClick={() => {
                setVisibleCards(draftVisible)
                setManagerOpen(false)
              }}
            >
              确认
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

import { cn } from '@/lib/utils'
import { markSubmitted, isSubmitted } from '@/lib/ai-submit'
import { getToolDisplayName } from '@/lib/tool-names'
import type { ToolCallEntry, SuggestionOption } from '@/stores/chat'
import { useChatStore, useSessionView, getSessionView } from '@/stores/chat'
import { resolveToolCallStatus } from '@homibook/core'
import { RECORD_TYPE_LABELS, RECORD_TYPE_TEXT_CLASS, RECORD_TYPE_BADGE_CLASS } from '@/lib/record-type'
import { settingsApi } from '@/api/settings'
import { useBookStore } from '@/stores/book'
import { Button } from '@/components/ui/button'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Wrench, CheckCircle2, XCircle, Loader2, HelpCircle, ChevronDown, MessageSquareMore, AlertTriangle, ExternalLink } from 'lucide-react'
import { useState, useEffect, useMemo, useRef } from 'react'
import { ImportPreviewInteractive, type ImportPreviewData } from './ImportPreviewInteractive'
import { ImportConfirmCard } from './ImportConfirmCard'

interface Props {
  toolCall: ToolCallEntry
}

// ---- ConfirmPreview 类型 ----

type ConfirmPreviewType = 'records-table' | 'record-changes' | 'budget-card' | 'generic'

interface PreviewCell {
  text: string
  highlight?: boolean
  color?: 'green' | 'red'
}

interface ConfirmPreview {
  type: ConfirmPreviewType
  title: string
  description?: string
  columns?: string[]
  rows?: PreviewCell[][]
  changes?: {
    id: string
    date: string
    fields: { label: string; before: string; after: string }[]
  }[]
  budgetFields?: { label: string; value: string }[]
  text?: string
}

function parsePreview(preview?: string): ConfirmPreview | null {
  if (!preview) return null
  try {
    return JSON.parse(preview) as ConfirmPreview
  } catch {
    return null
  }
}

// ---- 结构化结果渲染:把 AI 工具返回数据渲染为可读表格/摘要(替代 JSON 倾倒) ----

const CATEGORY_DICT_GROUPS = ['transaction_category_income', 'transaction_category_expense', 'transaction_category_transfer']
let categoryDictCache: Map<string, string> | null = null
let categoryDictPromise: Promise<Map<string, string>> | null = null

function loadCategoryDict(): Promise<Map<string, string>> {
  if (!categoryDictPromise) {
    categoryDictPromise = Promise.all(CATEGORY_DICT_GROUPS.map((g) => settingsApi.getDictionary(g)))
      .then((lists) => {
        const m = new Map<string, string>()
        for (const list of lists) for (const item of list) m.set(item.code, item.label)
        categoryDictCache = m
        return m
      })
      .catch(() => new Map<string, string>())
  }
  return categoryDictPromise
}

/** 分类编码 → 名称(字典未加载完成或无匹配时回退显示编码) */
function useCategoryLabels(): Map<string, string> {
  const [labels, setLabels] = useState<Map<string, string>>(() => categoryDictCache ?? new Map())
  useEffect(() => {
    if (categoryDictCache) return
    let mounted = true
    loadCategoryDict().then((m) => { if (mounted) setLabels(m) })
    return () => { mounted = false }
  }, [])
  return labels
}

function categoryText(labels: Map<string, string>, code?: string | null): string {
  if (!code) return '-'
  return labels.get(code) || code
}

interface ToolRecord {
  type?: string
  amount?: number
  date?: string
  accountName?: string
  categoryCode?: string | null
  payer?: string | null
  remark?: string | null
}

/** 收支类型徽标(中文 + 语义色) */
function RecordTypeBadge({ type }: { type?: string }) {
  const t = type || ''
  return (
    <span className={cn('inline-block px-1.5 rounded text-[10px] leading-4 whitespace-nowrap', RECORD_TYPE_BADGE_CLASS[t] || 'bg-muted text-muted-foreground')}>
      {RECORD_TYPE_LABELS[t] || type || '-'}
    </span>
  )
}

/** 语义色金额(收入 +/支出 -/转账无符号) */
function RecordAmount({ type, amount }: { type?: string; amount?: number }) {
  const t = type || ''
  const sign = type === 'INCOME' ? '+' : type === 'EXPENSE' ? '-' : ''
  return <span className={cn('font-medium whitespace-nowrap', RECORD_TYPE_TEXT_CLASS[t] || '')}>{sign}{(amount ?? 0).toFixed(2)}</span>
}

/** 单条记录摘要(创建/更新结果) */
function RecordSummary({ record, actionLabel, labels }: { record: ToolRecord; actionLabel: string; labels: Map<string, string> }) {
  return (
    <div className="mt-1.5 space-y-1 text-xs">
      <div className="flex items-center gap-2">
        <span className="inline-flex items-center gap-1 text-green-600 font-medium"><CheckCircle2 size={12} />{actionLabel}</span>
        <RecordTypeBadge type={record.type} />
        <RecordAmount type={record.type} amount={record.amount} />
      </div>
      <div className="text-muted-foreground flex flex-wrap gap-x-3 gap-y-0.5">
        <span>{record.date || '-'}</span>
        <span>账户: {record.accountName || '-'}</span>
        <span>分类: {categoryText(labels, record.categoryCode)}</span>
        {record.payer && <span>交易方: {record.payer}</span>}
      </div>
      {record.remark && <div className="text-muted-foreground">备注: {record.remark}</div>}
    </div>
  )
}

/** 记录列表表格(查询/批量创建结果) */
function RecordTable({ records, labels }: { records: ToolRecord[]; labels: Map<string, string> }) {
  return (
    <Table>
      <TableHeader>
        <TableRow className="bg-muted/50 hover:bg-muted/50">
          <TableHead className="text-xs">日期</TableHead>
          <TableHead className="text-xs">类型</TableHead>
          <TableHead className="text-xs text-right">金额</TableHead>
          <TableHead className="text-xs">账户</TableHead>
          <TableHead className="text-xs">分类</TableHead>
          <TableHead className="text-xs">说明</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {records.map((r, i) => (
          <TableRow key={i} className="hover:bg-accent/50">
            <TableCell className="text-xs whitespace-nowrap">{r.date || '-'}</TableCell>
            <TableCell className="text-xs"><RecordTypeBadge type={r.type} /></TableCell>
            <TableCell className="text-xs text-right"><RecordAmount type={r.type} amount={r.amount} /></TableCell>
            <TableCell className="text-xs whitespace-nowrap max-w-24 truncate">{r.accountName || '-'}</TableCell>
            <TableCell className="text-xs whitespace-nowrap max-w-24 truncate">{categoryText(labels, r.categoryCode)}</TableCell>
            <TableCell className="text-xs text-muted-foreground max-w-36 truncate">{r.remark || r.payer || '-'}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  )
}

/** 预算列表表格 */
function BudgetTable({ budgets, labels }: { budgets: any[]; labels: Map<string, string> }) {
  return (
    <Table>
      <TableHeader>
        <TableRow className="bg-muted/50 hover:bg-muted/50">
          <TableHead className="text-xs">名称</TableHead>
          <TableHead className="text-xs">类型</TableHead>
          <TableHead className="text-xs">周期</TableHead>
          <TableHead className="text-xs text-right">金额</TableHead>
          <TableHead className="text-xs text-right">已用</TableHead>
          <TableHead className="text-xs text-right">剩余</TableHead>
          <TableHead className="text-xs text-right">进度</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {budgets.map((b, i) => (
          <TableRow key={i} className="hover:bg-accent/50">
            <TableCell className="text-xs whitespace-nowrap max-w-24 truncate">{b.name || categoryText(labels, b.categoryCode)}</TableCell>
            <TableCell className="text-xs">{b.type === 'FIXED' ? '固定' : '月度'}</TableCell>
            <TableCell className="text-xs whitespace-nowrap">{b.year}年{b.month ? `${b.month}月` : '全年'}</TableCell>
            <TableCell className="text-xs text-right">{(b.amount ?? 0).toFixed(2)}</TableCell>
            <TableCell className="text-xs text-right">{(b.used ?? 0).toFixed(2)}</TableCell>
            <TableCell className={cn('text-xs text-right', (b.remaining ?? 0) < 0 && 'text-red-600')}>{(b.remaining ?? 0).toFixed(2)}</TableCell>
            <TableCell className={cn('text-xs text-right', (b.percentage ?? 0) > 100 && 'text-red-600')}>{b.percentage ?? 0}%</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  )
}

const ACCOUNT_TYPE_LABELS_MAP: Record<string, string> = {
  BANK_DEBIT: '储蓄卡', CREDIT_CARD: '信用卡', ALIPAY: '支付宝', WECHAT: '微信',
  INVESTMENT: '投资', CASH: '现金', RECHARGE_CARD: '充值卡', OTHER: '其他',
}

/** 账户列表表格 */
function AccountTable({ accounts, totalBalance }: { accounts: any[]; totalBalance?: number }) {
  return (
    <div className="space-y-1">
      {totalBalance != null && (
        <div className="text-xs text-muted-foreground">共 {accounts.length} 个账户 · 总余额 <span className="font-medium text-foreground">{totalBalance.toFixed(2)}</span></div>
      )}
      <Table>
        <TableHeader>
          <TableRow className="bg-muted/50 hover:bg-muted/50">
            <TableHead className="text-xs">账户</TableHead>
            <TableHead className="text-xs">类型</TableHead>
            <TableHead className="text-xs text-right">余额</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {accounts.map((a, i) => (
            <TableRow key={i} className="hover:bg-accent/50">
              <TableCell className="text-xs whitespace-nowrap">{a.name}</TableCell>
              <TableCell className="text-xs text-muted-foreground">{ACCOUNT_TYPE_LABELS_MAP[a.type] || a.type}</TableCell>
              <TableCell className={cn('text-xs text-right font-medium', (a.balance ?? 0) < 0 && 'text-red-600')}>{(a.balance ?? 0).toFixed(2)}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  )
}

/** 单条预算摘要(设置预算结果) */
function BudgetSummary({ budget, labels }: { budget: any; labels: Map<string, string> }) {
  return (
    <div className="mt-1.5 space-y-1 text-xs">
      <div className="flex items-center gap-2">
        <span className="inline-flex items-center gap-1 text-green-600 font-medium"><CheckCircle2 size={12} />已设置</span>
        <span className="font-medium">{budget.name || categoryText(labels, budget.categoryCode)}</span>
        <span className="text-muted-foreground">{budget.type === 'FIXED' ? '固定' : '月度'} · {budget.year}年{budget.month ? `${budget.month}月` : '全年'}</span>
      </div>
      <div className="text-muted-foreground">金额: <span className="font-medium text-foreground">{(budget.amount ?? 0).toFixed(2)}</span></div>
    </div>
  )
}

function cellColorClass(color?: 'green' | 'red') {
  if (color === 'green') return 'text-green-600'
  if (color === 'red') return 'text-red-600'
  return ''
}

export function ToolCallCard({ toolCall }: Props) {
  const [expanded, setExpanded] = useState(false)

  const isPreviewImport = toolCall.toolName === 'preview_import'
  const isConfirmImport = toolCall.toolName === 'confirm_import'

  // 只有 mode=preview 时显示交互卡片，analyze 模式等同查询工具直接返回数据
  const args = typeof toolCall.args === 'object' && toolCall.args != null ? toolCall.args as Record<string, unknown> : null

  // 从历史记录加载时 status 可能为 'pending'（旧数据快照），状态推断单一来源在 core
  const { effectiveStatus, effectiveSuggestion, isExpired, expiredMessage } = useMemo(() => resolveToolCallStatus(toolCall), [toolCall])

  const isInteractivePreview = isPreviewImport && args?.mode === 'preview'
  const confirmResult = isConfirmImport && effectiveStatus === 'success' ? ((toolCall.result as any)?.data ?? null) : null
  const isConfirmCard = confirmResult && (confirmResult.mode === 'confirm_preview' || confirmResult.imported != null)

  const [confirmError, setConfirmError] = useState(false)

  const handleConfirm = (approved: boolean) => {
    const { currentBookId } = useBookStore.getState()
    if (!currentBookId) return
    markSubmitted(toolCall.toolCallId)
    setConfirmError(false)
    // 保持 submitted 标记，防止重复提交；块状态变为 pending 后 ConfirmPreviewView 会卸载
    useChatStore.getState().confirmAndContinue(currentBookId, toolCall.toolCallId, approved)
  }

  const showArgs = toolCall.args != null
  const showResult = effectiveStatus === 'success' && toolCall.result != null
  const showError = effectiveStatus === 'error'

  // 结构化结果渲染:按工具类型映射到可读表格/摘要(未知工具回退 JSON dump)
  // summary = 操作结果简报(始终显示);table = 数据表格(展开后显示)
  const labels = useCategoryLabels()
  const structuredResult = useMemo<{ summary?: React.ReactNode; table?: React.ReactNode } | null>(() => {
    if (!showResult || typeof toolCall.result !== 'object' || toolCall.result === null) return null
    const raw = toolCall.result as any
    const rd = raw?.data ?? raw
    switch (toolCall.toolName) {
      case 'create_record':
        return rd?.type ? { summary: <RecordSummary record={rd} actionLabel="已创建" labels={labels} /> } : null
      case 'update_record':
        return rd?.type ? { summary: <RecordSummary record={rd} actionLabel="已更新" labels={labels} /> } : null
      case 'delete_record':
        return rd?.deleted ? { summary: <div className="mt-1.5 flex items-center gap-1 text-xs text-green-600"><CheckCircle2 size={12} />已删除该记录</div> } : null
      case 'query_records':
        return Array.isArray(rd?.records) ? {
          table: (
            <div className="space-y-1">
              <div className="text-xs text-muted-foreground">共 <span className="font-medium text-foreground">{rd.totalCount ?? rd.records.length}</span> 条 · 合计 <span className="font-medium text-foreground">{(rd.totalAmount ?? 0).toFixed(2)}</span>{rd.records.length > 50 && '（仅展示前 50 条）'}</div>
              <RecordTable records={rd.records.slice(0, 50)} labels={labels} />
            </div>
          ),
        } : null
      case 'batch_create_records':
        return Array.isArray(rd?.records) ? {
          table: (
            <div className="space-y-1">
              <div className="text-xs text-muted-foreground">已创建 <span className="font-medium text-foreground">{rd.created ?? rd.records.length}</span> 条记录</div>
              <RecordTable records={rd.records.slice(0, 50)} labels={labels} />
            </div>
          ),
        } : null
      case 'query_budgets':
        return Array.isArray(rd?.budgets) ? { table: <BudgetTable budgets={rd.budgets} labels={labels} /> } : null
      case 'query_accounts':
        return Array.isArray(rd?.accounts) ? { table: <AccountTable accounts={rd.accounts} totalBalance={rd.totalBalance} /> } : null
      case 'query_categories':
        return Array.isArray(rd?.categories) ? {
          table: (
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/50 hover:bg-muted/50">
                  <TableHead className="text-xs">分类</TableHead>
                  <TableHead className="text-xs">类型</TableHead>
                  <TableHead className="text-xs">编码</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rd.categories.map((c: any, i: number) => (
                  <TableRow key={i} className="hover:bg-accent/50">
                    <TableCell className="text-xs">{c.name}</TableCell>
                    <TableCell className="text-xs"><RecordTypeBadge type={c.type} /></TableCell>
                    <TableCell className="text-xs font-mono text-muted-foreground">{c.code}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ),
        } : null
      case 'set_budget':
        return rd?.year != null ? { summary: <BudgetSummary budget={rd} labels={labels} /> } : null
      default:
        return null
    }
  }, [toolCall, labels, showResult])

  // 交互式预览：成功但未完成导入 → 琥珀色
  const isImportPending = isInteractivePreview && effectiveStatus === 'success' && !(toolCall.result as any)?.data?.confirmed

  return (
    <div className={cn(
      'rounded-xl border px-3 py-2 text-xs',
      effectiveStatus === 'pending' && 'border-blue-200 bg-blue-50/50',
      effectiveStatus === 'error' && 'border-red-200 bg-red-50/50',
      effectiveStatus === 'confirming' && 'border-amber-200 bg-amber-50/50',
      isImportPending && 'border-amber-200 bg-amber-50/50',
      effectiveStatus === 'success' && !isImportPending && 'border-green-200 bg-green-50/50',
      effectiveStatus === 'suggesting' && 'border-violet-200 bg-violet-50/50',
      effectiveStatus === 'switching' && 'border-emerald-200 bg-emerald-50/50',
    )}>
      {/* 可点击头部 */}
      <button
        className="flex items-center gap-2 w-full text-left"
        onClick={() => setExpanded(!expanded)}
      >
        {effectiveStatus === 'pending' && <Loader2 size={14} className="animate-spin text-blue-500" />}
        {isImportPending && <HelpCircle size={14} className="text-amber-500" />}
        {effectiveStatus === 'success' && !isImportPending && <CheckCircle2 size={14} className="text-green-500" />}
        {effectiveStatus === 'error' && <XCircle size={14} className="text-red-500" />}
        {effectiveStatus === 'confirming' && <HelpCircle size={14} className="text-amber-500" />}
        {effectiveStatus === 'suggesting' && <MessageSquareMore size={14} className="text-violet-500" />}
        {effectiveStatus === 'switching' && <HelpCircle size={14} className="text-emerald-500" />}
        <Wrench size={14} className="text-muted-foreground" />
        <span className="font-medium">{getToolDisplayName(toolCall.toolName)}</span>
        {toolCall.durationMs != null && (
          <span className="text-muted-foreground ml-auto">{toolCall.durationMs}ms</span>
        )}
        {showArgs && (
          <ChevronDown size={12} className={cn('transition-transform', expanded && 'rotate-180')} />
        )}
      </button>

      {/* 折叠内容：仅参数（交互内容始终可见，与 confirming/suggesting 一致） */}
      {expanded && showArgs && (
        <div className="mt-1.5">
          <span className="text-muted-foreground text-[10px] uppercase tracking-wide">参数</span>
          <pre className="text-xs bg-background rounded p-1.5 max-h-24 overflow-auto mt-0.5">
            {typeof toolCall.args === 'string'
              ? toolCall.args
              : JSON.stringify(toolCall.args, null, 2)}
          </pre>
        </div>
      )}

      {/* 错误信息 —— 始终可见 */}
      {showError && (
        <div className="mt-1.5 text-red-600">
          {typeof toolCall.result === 'object' && (toolCall.result as any)?.error
            ? (toolCall.result as any).error
            : '执行失败'}
        </div>
      )}

      {/* preview_import 交互卡片（带映射时始终可见） */}
      {isInteractivePreview && showResult && (
        <div className="mt-2">
          {(() => {
            const result = toolCall.result as any
            const previewData: ImportPreviewData = result.data ?? result
            const source = (toolCall.args as any)?.source || previewData.source || ''
            const accountBookId = previewData.accountBookId
            return accountBookId
              ? <ImportPreviewInteractive data={previewData} source={source} accountBookId={accountBookId} toolCallId={toolCall.toolCallId} aiArgs={toolCall.args as any} />
              : <FallbackJson data={result} />
          })()}
        </div>
      )}

      {/* confirm_import 交互卡片（展示导入确认预览或导入结果） */}
      {isConfirmCard && showResult && (
        <div className="mt-2">
          <ImportConfirmCard data={confirmResult} toolCallId={toolCall.toolCallId} />
        </div>
      )}

      {/* web_search 结果 */}
      {toolCall.toolName === 'web_search' && showResult && expanded && (
        <div className="mt-1.5 space-y-1.5">
          {(() => {
            const data = (toolCall.result as any)?.data
            if (!data?.results?.length) return <span className="text-muted-foreground">无搜索结果</span>
            return data.results.map((r: any, i: number) => (
              <div key={i} className="border rounded-lg p-2 bg-background">
                <a href={r.url} target="_blank" rel="noopener noreferrer" className="flex items-start gap-1 text-xs font-medium text-blue-600 hover:underline">
                  <ExternalLink size={11} className="mt-0.5 shrink-0" />
                  <span>{r.title}</span>
                </a>
                {r.snippet && <p className="text-[11px] text-muted-foreground mt-1 line-clamp-2">{r.snippet}</p>}
              </div>
            ))
          })()}
        </div>
      )}

      {/* read_webpage 结果 */}
      {toolCall.toolName === 'read_webpage' && showResult && expanded && (
        <div className="mt-1.5 space-y-1.5">
          {(() => {
            const data = (toolCall.result as any)?.data
            if (!data) return <span className="text-muted-foreground">无内容</span>
            return (
              <>
                <a href={data.url} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1 text-xs font-medium text-blue-600 hover:underline">
                  <ExternalLink size={11} className="shrink-0" />
                  <span className="truncate">{data.title || data.url}</span>
                </a>
                <div className="text-[11px] text-muted-foreground bg-background rounded p-2 border max-h-40 overflow-y-auto whitespace-pre-wrap leading-relaxed">
                  {data.content}
                </div>
              </>
            )
          })()}
        </div>
      )}

      {/* 结构化结果:操作简报(始终显示) + 数据表格(展开后显示) */}
      {structuredResult?.summary}
      {structuredResult?.table && expanded && <div className="mt-1.5">{structuredResult.table}</div>}

      {/* 其他工具结果(无结构化渲染时兜底) -- 折叠内 */}
      {!isInteractivePreview && !isConfirmCard && toolCall.toolName !== 'web_search' && toolCall.toolName !== 'read_webpage' && !structuredResult && showResult && expanded && (
        <div className="mt-1.5">
          <span className="text-muted-foreground text-[10px] uppercase tracking-wide">结果</span>
          <div className="mt-0.5 text-muted-foreground">
            {typeof toolCall.result === 'string'
              ? toolCall.result
              : JSON.stringify(toolCall.result, null, 2)}
          </div>
        </div>
      )}

      {/* 历史数据过期提示 —— 始终可见 */}
      {isExpired && (
        <div className={cn(
          'mt-2 flex items-center gap-1.5 text-[11px]',
          effectiveStatus === 'error' ? 'text-red-600' : 'text-amber-600',
        )}>
          <AlertTriangle size={12} />
          <span>{expiredMessage || '此操作在重新加载后已过期，请重新发起请求'}</span>
        </div>
      )}

      {/* 批量确认计数器 */}
      {(effectiveStatus === 'confirming' || effectiveStatus === 'suggesting' || effectiveStatus === 'switching') && <BatchIndicator toolCallId={toolCall.toolCallId} />}

      {/* 确认按钮 —— 始终可见 */}
      {(effectiveStatus === 'confirming' || (isExpired && toolCall.preview)) && (
        <>
          <ConfirmPreviewView preview={toolCall.preview} toolName={toolCall.toolName} onConfirm={handleConfirm} submitted={isSubmitted(toolCall.toolCallId)} />
          {confirmError && (
            <div className="flex items-center gap-1.5 text-red-600 text-xs mt-1">
              <XCircle size={12} />
              <span>此操作已过期，请重新发起请求</span>
            </div>
          )}
        </>
      )}

      {/* 建议选择 UI —— 始终可见 */}
      {effectiveStatus === 'suggesting' && effectiveSuggestion && (
        <SuggestionView
          suggestion={effectiveSuggestion}
          toolCallId={toolCall.toolCallId}
          expired={isExpired}
        />
      )}

      {/* 切换账本 UI —— 始终可见 */}
      {effectiveStatus === 'switching' && (
        <SwitchBookView
          toolCallId={toolCall.toolCallId}
          expired={isExpired}
        />
      )}
    </div>
  )
}

// ---- 确认预览渲染 ----

function ConfirmPreviewView({
  preview: rawPreview,
  toolName,
  onConfirm,
  submitted,
}: {
  preview?: string
  toolName?: string
  onConfirm: (approved: boolean) => void
  submitted: boolean
}) {
  const preview = parsePreview(rawPreview)

  return (
    <div className="mt-2 space-y-2">
      <p className="font-medium text-sm">{preview?.title || '需要确认此操作'}</p>
      {preview?.description && (
        <p className="text-muted-foreground">{preview.description}</p>
      )}

      {/* records-table 类型 */}
      {preview?.type === 'records-table' && preview.columns && preview.rows && (
        <div className="rounded border overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow>
                {preview.columns.map((col) => (
                  <TableHead key={col} className="text-[11px] px-1.5 py-1">{col}</TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {preview.rows.map((row, ri) => (
                <TableRow key={ri}>
                  {row.map((cell, ci) => (
                    <TableCell key={ci} className={cn('px-1.5 py-1 text-[11px]', cellColorClass(cell.color), cell.highlight && 'font-bold')}>
                      {cell.text}
                    </TableCell>
                  ))}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      {/* record-changes 类型 */}
      {preview?.type === 'record-changes' && preview.changes && (
        <div className="space-y-2">
          {preview.changes.map((ch) => (
            <div key={ch.id} className="rounded border overflow-hidden">
              <div className="bg-muted/30 px-2 py-1 text-[11px] text-muted-foreground">
                {ch.date ? `日期: ${ch.date}` : ''}
              </div>
              <table className="w-full text-[11px]">
                <tbody>
                  {ch.fields.map((f) => (
                    <tr key={f.label} className="border-t">
                      <td className="px-2 py-1 text-muted-foreground w-16">{f.label}</td>
                      <td className="px-2 py-1 text-red-500 line-through">{f.before}</td>
                      <td className="px-1 py-1 text-muted-foreground">→</td>
                      <td className="px-2 py-1 text-green-600 font-medium">{f.after}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ))}
        </div>
      )}

      {/* budget-card 类型 */}
      {preview?.type === 'budget-card' && preview.budgetFields && (
        <div className="rounded border p-2 space-y-1">
          {preview.budgetFields.map((f) => (
            <div key={f.label} className="flex gap-2 text-[11px]">
              <span className="text-muted-foreground w-16 shrink-0">{f.label}</span>
              <span className="font-medium">{f.value}</span>
            </div>
          ))}
        </div>
      )}

      {/* generic 或解析失败：JSON 渲染为表格 */}
      {(!preview || preview.type === 'generic') && (
        <GenericPreview raw={rawPreview || ''} toolName={toolName} />
      )}

      <div className="flex gap-2">
        <Button size="sm" variant="default" disabled={submitted} onClick={() => onConfirm(true)}>
          {submitted ? <Loader2 size={12} className="animate-spin mr-1" /> : null}
          {submitted ? '提交中...' : '确认'}
        </Button>
        <Button size="sm" variant="outline" disabled={submitted} onClick={() => onConfirm(false)}>
          拒绝
        </Button>
      </div>
    </div>
  )
}

// ---- 建议选择组件 ----

type QuestionDef = { question: string; field: string; options: (string | SuggestionOption)[]; allowCustom: boolean }

function SuggestionView({
  suggestion,
  toolCallId,
  expired,
}: {
  suggestion: { questions: QuestionDef[] }
  toolCallId: string
  expired?: boolean
}) {
  const { questions } = suggestion
  const [selectedOption, setSelectedOption] = useState<Record<string, string>>({})
  const [customInputs, setCustomInputs] = useState<Record<string, string>>({})
  const [submitted, setSubmitted] = useState(false)
  const submittingRef = useRef(false)

  const getValue = (field: string) => {
    const sel = selectedOption[field]
    if (!sel) return ''
    return sel === '__custom__' ? (customInputs[field] || '').trim() : sel
  }

  const allFilled = questions.every((q) => !!getValue(q.field))

  const handleSubmit = () => {
    if (!allFilled || submittingRef.current || isSubmitted(toolCallId)) return
    const { currentBookId } = useBookStore.getState()
    if (!currentBookId) return
    const values: Record<string, string> = {}
    for (const q of questions) {
      values[q.field] = getValue(q.field)
    }
    markSubmitted(toolCallId)
    submittingRef.current = true
    setSubmitted(true)
    useChatStore.getState().respondToSuggestion(currentBookId, toolCallId, values)
  }

  return (
    <div className="mt-2 space-y-3">
      {questions.map((q, qi) => {
        const sel = selectedOption[q.field] || ''
        const customVal = customInputs[q.field] || ''

        return (
          <div key={q.field}>
            <p className="font-medium text-sm mb-1">
              {questions.length > 1 && <span className="text-muted-foreground">{qi + 1}. </span>}
              {q.question}
            </p>
            <div className="flex flex-wrap gap-1.5">
              {q.options.map((opt) => {
                const label = typeof opt === 'string' ? opt : (opt?.label || opt?.name || opt?.description || JSON.stringify(opt))
                const value = typeof opt === 'string' ? opt : (opt?.value || opt?.code || label)
                return (
                <Button
                  key={value}
                  size="sm"
                  variant={sel === value ? 'default' : 'outline'}
                  className="text-xs h-7"
                  onClick={() => setSelectedOption((prev) => ({ ...prev, [q.field]: value }))}
                >
                  {label}
                </Button>
              )})}
            </div>
            {q.allowCustom && (
              <div className="flex items-center gap-2 mt-1">
                <Button
                  size="sm"
                  variant={sel === '__custom__' ? 'default' : 'outline'}
                  className="text-xs h-7"
                  onClick={() => setSelectedOption((prev) => ({ ...prev, [q.field]: '__custom__' }))}
                >
                  自定义
                </Button>
                {sel === '__custom__' && (
                  <input
                    className="flex-1 border rounded px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-violet-400"
                    placeholder="输入自定义内容..."
                    value={customVal}
                    onChange={(e) => setCustomInputs((prev) => ({ ...prev, [q.field]: e.target.value }))}
                    autoFocus
                  />
                )}
              </div>
            )}
          </div>
        )
      })}
      {expired && (
        <div className="flex items-center gap-1.5 text-amber-600 text-xs">
          <AlertTriangle size={12} />
          <span>此操作在重新加载后已过期，请在聊天输入框中直接回复你的选择</span>
        </div>
      )}
      <div className="flex gap-2">
        <Button
          size="sm"
          variant="default"
          disabled={!allFilled || expired || submitted}
          onClick={handleSubmit}
        >
          提交
        </Button>
        <Button
          size="sm"
          variant="ghost"
          disabled={expired || submitted}
          onClick={() => {
            const { currentBookId } = useBookStore.getState()
            if (currentBookId) {
              useChatStore.getState().respondToSuggestion(currentBookId, toolCallId, null)
            }
          }}
        >
          取消
        </Button>
      </div>
    </div>
  )
}

function SwitchBookView({
  toolCallId,
  expired,
}: {
  toolCallId: string
  expired?: boolean
}) {
  const [bookId, setBookId] = useState<string>('')
  const [submitted, setSubmitted] = useState(false)
  const submittingRef = useRef(false)

  // 从 toolCall result 获取账本列表
  const parentMsg = getSessionView().messages.find(m =>
    m.role === 'assistant' && m.blocks.some(b =>
      b.type === 'tool-call' && b.toolCallId === toolCallId
    )
  )
  const toolBlock = parentMsg?.blocks.find(b => b.type === 'tool-call' && b.toolCallId === toolCallId)
  const books: { id: string; name: string; role: string; memberCount: number; isCurrent: boolean }[] =
    (toolBlock?.type === 'tool-call' ? (toolBlock.result as any)?.books : undefined) || []
  // 已提交(isSubmitted 标记)或决定已暂存(decisionData)后锁定选择,不可再修改
  const locked = submitted || isSubmitted(toolCallId) || (toolBlock?.type === 'tool-call' && toolBlock.decisionData != null)

  const handleSwitch = () => {
    if (locked || !bookId) return
    markSubmitted(toolCallId)
    submittingRef.current = true
    setSubmitted(true)
    const { currentBookId: cid } = useBookStore.getState()
    if (!cid) return
    // 只提交决定；前端账本切换统一在批量提交发起时同步(decideTool)，避免暂存期间前后端状态不一致
    useChatStore.getState().switchBook(cid, toolCallId, bookId)
  }

  return (
    <div className="mt-2 space-y-3">
      <p className="text-sm font-medium">选择要切换的账本：</p>
      <div className="flex flex-wrap gap-2">
        {books.map((book) => (
          <button
            key={book.id}
            className={`px-3 py-2 rounded-lg border text-sm text-left transition-colors ${
              bookId === book.id
                ? 'border-emerald-500 bg-emerald-50 ring-1 ring-emerald-500'
                : book.isCurrent
                  ? 'border-emerald-200 bg-emerald-50/30'
                  : 'border-gray-200 hover:border-emerald-300 bg-white'
            }`}
            onClick={() => setBookId(book.id)}
            disabled={expired || locked}
          >
            <div className="font-medium">{book.name}</div>
            <div className="text-xs text-muted-foreground">
              {book.role === 'owner' ? '归属人' : book.role === 'admin' ? '管理员' : '成员'}
              {book.isCurrent && <span className="text-emerald-600 ml-1">· 当前</span>}
            </div>
            <div className="text-xs text-muted-foreground">{book.memberCount} 位成员</div>
          </button>
        ))}
      </div>
      {locked && !expired && (
        <div className="flex items-center gap-1.5 text-emerald-600 text-xs">
          <CheckCircle2 size={12} />
          <span>已选择目标账本，等待提交处理</span>
        </div>
      )}
      {expired && (
        <div className="flex items-center gap-1.5 text-amber-600 text-xs">
          <AlertTriangle size={12} />
          <span>切换操作已过期，请在聊天输入框中直接说明要切换的账本</span>
        </div>
      )}
      <div className="flex gap-2">
        <Button
          size="sm"
          variant="default"
          disabled={!bookId || expired || locked}
          onClick={handleSwitch}
        >
          {locked ? '已选择' : '切换到此账本'}
        </Button>
      </div>
    </div>
  )
}

function toTableData(raw: string): { keys: string[]; rows: Record<string, string>[] } | null {
  try {
    // generic 类型的确认预览，实际数据在 text 字段中
    const outer = JSON.parse(raw)
    const inner = outer?.text ? (typeof outer.text === 'string' ? JSON.parse(outer.text) : outer.text) : outer

    if (Array.isArray(inner) && inner.length > 0 && typeof inner[0] === 'object' && inner[0] !== null) {
      const keys = Object.keys(inner[0])
      const rows = inner.map((item: any) => {
        const row: Record<string, string> = {}
        for (const k of keys) {
          const v = item[k]
          row[k] = typeof v === 'object' ? JSON.stringify(v) : String(v ?? '')
        }
        return row
      })
      return { keys, rows }
    }
    if (typeof inner === 'object' && inner !== null && !Array.isArray(inner)) {
      const keys = Object.keys(inner)
      const rows = [Object.fromEntries(keys.map(k => [k, typeof inner[k] === 'object' ? JSON.stringify(inner[k]) : String(inner[k] ?? '')]))]
      return { keys, rows }
    }
    return null
  } catch {
    return null
  }
}

function GenericPreview({ raw, toolName }: { raw: string; toolName?: string }) {
  const table = useMemo(() => toTableData(raw), [raw])

  if (!table) {
    return <pre className="text-xs bg-background rounded p-1.5 max-h-24 overflow-auto">{raw}</pre>
  }

  return (
    <div className="rounded border overflow-hidden max-h-48 overflow-auto">
      <Table>
        <TableHeader>
          <TableRow>
            {table.keys.map((key) => (
              <TableHead key={key} className="text-[11px] px-1.5 py-1 whitespace-nowrap">{fieldLabel(key, toolName)}</TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {table.rows.map((row, ri) => (
            <TableRow key={ri}>
              {table.keys.map((key) => (
                <TableCell key={key} className="px-1.5 py-1 text-[11px] max-w-[200px] truncate">
                  {row[key]}
                </TableCell>
              ))}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  )
}

// 字段名称映射（英文 key → 中文描述）
const FIELD_LABELS: Record<string, string> = {
  name: '名称',
  type: '类型',
  amount: '金额',
  date: '日期',
  remark: '备注',
  payer: '交易方',
  tags: '标签',
  cron: '触发时间',
  active: '启用',
  id: 'ID',
  ids: 'ID 列表',
  recurringType: '周期类型',
  accountId: '账户',
  toAccountId: '目标账户',
  categoryCode: '分类编码',
  loanTotalAmount: '贷款总额',
  loanInterestRate: '年利率',
  loanInterestMethod: '还款方式',
  loanStartDate: '开始日期',
  loanTermMonths: '期数',
  currency: '货币',
  initialBalance: '初始余额',
  accountNo: '账号',
  bankName: '银行名称',
  visibility: '可见性',
  status: '状态',
  balanceAfter: '调整后余额',
  year: '年份',
  month: '月份',
  months: '月份列表',
  startDate: '开始日期',
  endDate: '结束日期',
  sourceYear: '源年份',
  sourceMonth: '源月份',
  targetMonths: '目标月份',
  bookId: '账本',
  ownerId: '归属人',
  generateAll: '生成全部',
}

function BatchIndicator({ toolCallId }: { toolCallId: string }) {
  const messages = useSessionView().messages
  const parentMsg = messages.find(m =>
    m.role === 'assistant' && m.blocks.some(b =>
      b.type === 'tool-call' && b.toolCallId === toolCallId
    )
  )
  // 待决定状态:confirming(待确认)/suggesting(待选择)/switching(待选账本)
  const remaining = parentMsg?.blocks.filter(b => b.type === 'tool-call' && ['confirming', 'suggesting', 'switching'].includes(b.status)).length || 0
  if (remaining <= 1) return null
  return (
    <div className="flex items-center gap-1.5 text-xs text-amber-600 mt-1">
      <span>等待全部确认 · 剩余 {remaining} 个</span>
    </div>
  )
}

function fieldLabel(key: string, _toolName?: string): string {
  return FIELD_LABELS[key] || key
}

function FallbackJson({ data }: { data: any }) {
  return <pre className="text-[10px] bg-background rounded p-1.5 max-h-48 overflow-auto">{JSON.stringify(data, null, 2)}</pre>
}

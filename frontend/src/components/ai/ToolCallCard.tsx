import { cn } from '@/lib/utils'
import { getToolDisplayName } from '@/lib/tool-names'
import type { ToolCallEntry, SuggestionOption } from '@/stores/chat'
import { useChatStore } from '@/stores/chat'
import { useBookStore } from '@/stores/book'
import { Button } from '@/components/ui/button'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Wrench, CheckCircle2, XCircle, Loader2, HelpCircle, ChevronDown, MessageSquareMore, AlertTriangle } from 'lucide-react'
import { useState, useMemo, useRef } from 'react'
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

function cellColorClass(color?: 'green' | 'red') {
  if (color === 'green') return 'text-green-600'
  if (color === 'red') return 'text-red-600'
  return ''
}

export function ToolCallCard({ toolCall }: Props) {
  const [confirming, setConfirming] = useState(false)
  const [expanded, setExpanded] = useState(false)

  const isPreviewImport = toolCall.toolName === 'preview_import'
  const isConfirmImport = toolCall.toolName === 'confirm_import'

  // 只有 mode=preview 时显示交互卡片，analyze 模式等同查询工具直接返回数据
  const args = typeof toolCall.args === 'object' && toolCall.args != null ? toolCall.args as Record<string, unknown> : null

  // 从历史记录加载时 status 可能为 'pending'（旧数据快照），根据已有字段推断实际状态
  const { effectiveStatus, effectiveSuggestion, isExpired, expiredMessage } = useMemo(() => {
    if (toolCall.status !== 'pending') {
      return { effectiveStatus: toolCall.status, effectiveSuggestion: toolCall.suggestion, isExpired: false, expiredMessage: undefined as string | undefined }
    }
    // suggest_options 有 questions 参数 → 实际在等待用户选择
    if (toolCall.toolName === 'suggest_options') {
      const questions = (toolCall.args as any)?.questions
      if (questions?.length > 0) {
        return { effectiveStatus: 'suggesting' as const, effectiveSuggestion: { questions }, isExpired: true, expiredMessage: undefined }
      }
    }
    // switch_book 有 result 带 books → 实际在等待用户选择
    if (toolCall.toolName === 'switch_book') {
      const books = (toolCall.result as any)?.books
      if (books?.length > 0) {
        return { effectiveStatus: 'switching' as const, effectiveSuggestion: undefined, isExpired: true, expiredMessage: '切换操作已过期，请重新发起' }
      }
    }
    // 有 result → 实际已执行成功
    if (toolCall.result != null) return { effectiveStatus: 'success' as const, effectiveSuggestion: undefined, isExpired: false, expiredMessage: undefined }
    // 有 preview → 等待确认
    if (toolCall.preview) return { effectiveStatus: 'confirming' as const, effectiveSuggestion: undefined, isExpired: true, expiredMessage: undefined }
    // preview_import 预览模式但没有 result → 预览数据未持久化
    if (toolCall.toolName === 'preview_import' && (toolCall.args as any)?.mode === 'preview') {
      return { effectiveStatus: 'error' as const, effectiveSuggestion: undefined, isExpired: true, expiredMessage: '导入预览数据已过期，请重新上传文件发起导入' }
    }
    // confirm_import 但没有 result → 确认状态未持久化
    if (toolCall.toolName === 'confirm_import') {
      return { effectiveStatus: 'error' as const, effectiveSuggestion: undefined, isExpired: true, expiredMessage: '导入确认已过期，请重新发起导入' }
    }
    return { effectiveStatus: 'pending' as const, effectiveSuggestion: undefined, isExpired: false, expiredMessage: undefined }
  }, [toolCall.status, toolCall.toolName, toolCall.args, toolCall.result, toolCall.preview, toolCall.suggestion])

  const isInteractivePreview = isPreviewImport && args?.mode === 'preview'
  const confirmResult = isConfirmImport && effectiveStatus === 'success' ? ((toolCall.result as any)?.data ?? null) : null
  const isConfirmCard = confirmResult && (confirmResult.mode === 'confirm_preview' || confirmResult.imported != null)

  const [confirmError, setConfirmError] = useState(false)

  const handleConfirm = (approved: boolean) => {
    const { currentBookId } = useBookStore.getState()
    if (!currentBookId) return
    setConfirming(true)
    setConfirmError(false)
    useChatStore.getState().confirmAndContinue(currentBookId, toolCall.toolCallId, approved)
    setConfirming(false)
  }

  const showArgs = toolCall.args != null
  const showResult = effectiveStatus === 'success' && toolCall.result != null
  const showError = effectiveStatus === 'error'

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

      {/* 其他工具结果（含 preview_import 分析模式）—— 折叠内 */}
      {!isInteractivePreview && !isConfirmCard && showResult && expanded && (
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
      {effectiveStatus === 'confirming' && <BatchIndicator toolCallId={toolCall.toolCallId} />}

      {/* 确认按钮 —— 始终可见 */}
      {(effectiveStatus === 'confirming' || (isExpired && toolCall.preview)) && (
        <>
          <ConfirmPreviewView preview={toolCall.preview} toolName={toolCall.toolName} onConfirm={handleConfirm} confirming={confirming} />
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
  confirming,
}: {
  preview?: string
  toolName?: string
  onConfirm: (approved: boolean) => void
  confirming: boolean
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
                ID: {ch.id} | 日期: {ch.date}
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
        <Button size="sm" variant="default" disabled={confirming} onClick={() => onConfirm(true)}>
          确认
        </Button>
        <Button size="sm" variant="outline" disabled={confirming} onClick={() => onConfirm(false)}>
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
  const submittingRef = useRef(false)

  const getValue = (field: string) => {
    const sel = selectedOption[field]
    if (!sel) return ''
    return sel === '__custom__' ? (customInputs[field] || '').trim() : sel
  }

  const allFilled = questions.every((q) => !!getValue(q.field))

  const handleSubmit = () => {
    if (!allFilled || submittingRef.current) return
    const { currentBookId } = useBookStore.getState()
    if (!currentBookId) return
    const values: Record<string, string> = {}
    for (const q of questions) {
      values[q.field] = getValue(q.field)
    }
    submittingRef.current = true
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
          disabled={!allFilled || expired}
          onClick={handleSubmit}
        >
          提交
        </Button>
        <Button
          size="sm"
          variant="ghost"
          disabled={expired}
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
  const submittingRef = useRef(false)

  // 从 toolCall result 获取账本列表
  const parentMsg = useChatStore.getState().messages.find(m =>
    m.role === 'assistant' && m.blocks.some(b =>
      b.type === 'tool-call' && b.toolCallId === toolCallId
    )
  )
  const toolBlock = parentMsg?.blocks.find(b => b.type === 'tool-call' && b.toolCallId === toolCallId)
  const books: { id: string; name: string; role: string; memberCount: number; isCurrent: boolean }[] =
    (toolBlock?.type === 'tool-call' ? (toolBlock.result as any)?.books : undefined) || []

  const handleSwitch = () => {
    if (!bookId || submittingRef.current) return
    submittingRef.current = true
    const { currentBookId: cid } = useBookStore.getState()
    if (!cid) return
    // 更新前端账本状态
    useBookStore.getState().setCurrentBook(bookId)
    // 通知后端切换
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
            disabled={expired}
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
          disabled={!bookId || expired}
          onClick={handleSwitch}
        >
          切换到此账本
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
  const messages = useChatStore(s => s.messages)
  const parentMsg = messages.find(m =>
    m.role === 'assistant' && m.blocks.some(b =>
      b.type === 'tool-call' && b.toolCallId === toolCallId
    )
  )
  const remaining = parentMsg?.blocks.filter(b => b.type === 'tool-call' && b.status === 'confirming').length || 0
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

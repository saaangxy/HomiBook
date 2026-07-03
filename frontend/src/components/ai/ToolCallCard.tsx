import { cn } from '@/lib/utils'
import type { ToolCallEntry } from '@/stores/chat'
import { useChatStore } from '@/stores/chat'
import { useBookStore } from '@/stores/book'
import { Button } from '@/components/ui/button'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Wrench, CheckCircle2, XCircle, Loader2, HelpCircle, ChevronDown, MessageSquareMore, AlertTriangle } from 'lucide-react'
import { useState, useMemo } from 'react'
import { ImportPreviewInteractive, type ImportPreviewData } from './ImportPreviewInteractive'
import { ImportConfirmCard } from './ImportConfirmCard'

interface Props {
  toolCall: ToolCallEntry
}

const toolLabels: Record<string, string> = {
  query_records: '查询流水',
  query_budgets: '查询预算',
  query_accounts: '查询账户',
  get_stats: '统计分析',
  query_categories: '查询分类',
  suggest_options: '补充信息',
  preview_import: '导入预览',
  query_import_mappings: '查询映射',
  save_import_mapping: '保存映射',
  confirm_import: '确认导入',
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
  const [importCompleted, setImportCompleted] = useState(false)

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
  const isImportPending = isInteractivePreview && effectiveStatus === 'success' && !importCompleted

  return (
    <div className={cn(
      'rounded-xl border px-3 py-2 text-xs',
      effectiveStatus === 'pending' && 'border-blue-200 bg-blue-50/50',
      effectiveStatus === 'error' && 'border-red-200 bg-red-50/50',
      effectiveStatus === 'confirming' && 'border-amber-200 bg-amber-50/50',
      isImportPending && 'border-amber-200 bg-amber-50/50',
      effectiveStatus === 'success' && !isImportPending && 'border-green-200 bg-green-50/50',
      effectiveStatus === 'suggesting' && 'border-violet-200 bg-violet-50/50',
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
        <Wrench size={14} className="text-muted-foreground" />
        <span className="font-medium">{toolLabels[toolCall.toolName] || toolCall.toolName}</span>
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
              ? <ImportPreviewInteractive data={previewData} source={source} accountBookId={accountBookId} toolCallId={toolCall.toolCallId} aiArgs={toolCall.args as any} onImportComplete={() => setImportCompleted(true)} />
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

      {/* 确认按钮 —— 始终可见 */}
      {(effectiveStatus === 'confirming' || (isExpired && toolCall.preview)) && (
        <>
          <ConfirmPreviewView preview={toolCall.preview} onConfirm={handleConfirm} confirming={confirming} />
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
    </div>
  )
}

// ---- 确认预览渲染 ----

function ConfirmPreviewView({
  preview: rawPreview,
  onConfirm,
  confirming,
}: {
  preview?: string
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

      {/* generic 或解析失败回退 */}
      {(!preview || preview.type === 'generic') && (
        <pre className="text-xs bg-background rounded p-1.5 max-h-24 overflow-auto">{rawPreview || ''}</pre>
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

type QuestionDef = { question: string; field: string; options: string[]; allowCustom: boolean }

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
  // selectedOption: field → selected option (or '__custom__')
  const [selectedOption, setSelectedOption] = useState<Record<string, string>>({})
  // customInputs: field → custom text
  const [customInputs, setCustomInputs] = useState<Record<string, string>>({})
  const [submitting, setSubmitting] = useState(false)
  const [submitted, setSubmitted] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // 每个 field 的当前值：选项值或自定义输入
  const getValue = (field: string) => {
    const sel = selectedOption[field]
    if (!sel) return ''
    return sel === '__custom__' ? (customInputs[field] || '').trim() : sel
  }

  const allFilled = questions.every((q) => !!getValue(q.field))

  const handleSubmit = async () => {
    if (!allFilled || submitting) return
    const { currentBookId } = useBookStore.getState()
    if (!currentBookId) return
    const values: Record<string, string> = {}
    for (const q of questions) {
      values[q.field] = getValue(q.field)
    }
    setSubmitting(true)
    setError(null)
    try {
      useChatStore.getState().respondToSuggestion(currentBookId, toolCallId, values)
      setSubmitted(true)
    } catch {
      setSubmitting(false)
      setError('此操作已过期，请重新发起请求')
    }
  }

  if (submitted) {
    return (
      <div className="mt-2 space-y-1">
        {questions.map((q) => (
          <div key={q.field} className="flex items-center gap-2 text-green-600 text-xs">
            <CheckCircle2 size={12} />
            <span className="text-muted-foreground">{q.question}</span>
            <span className="font-medium">{getValue(q.field)}</span>
          </div>
        ))}
      </div>
    )
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
              {q.options.map((opt) => (
                <Button
                  key={opt}
                  size="sm"
                  variant={sel === opt ? 'default' : 'outline'}
                  className="text-xs h-7"
                  onClick={() => setSelectedOption((prev) => ({ ...prev, [q.field]: opt }))}
                >
                  {opt}
                </Button>
              ))}
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
      {error && (
        <div className="flex items-center gap-1.5 text-red-600 text-xs">
          <XCircle size={12} />
          <span>{error}</span>
        </div>
      )}
      {expired && !error && (
        <div className="flex items-center gap-1.5 text-amber-600 text-xs">
          <AlertTriangle size={12} />
          <span>此操作在重新加载后已过期，请在聊天输入框中直接回复你的选择</span>
        </div>
      )}
      <div className="flex gap-2">
        <Button
          size="sm"
          variant="default"
          disabled={!allFilled || submitting || expired}
          onClick={handleSubmit}
        >
          {submitting ? <Loader2 size={12} className="animate-spin mr-1" /> : null}
          提交
        </Button>
        <Button
          size="sm"
          variant="ghost"
          disabled={submitting || expired}
          onClick={async () => {
            setError(null)
            try {
              const { currentBookId } = useBookStore.getState()
              if (currentBookId) {
                useChatStore.getState().respondToSuggestion(currentBookId, toolCallId, null)
              }
            } catch {
              setError('此操作已过期，请重新发起请求')
            }
          }}
        >
          取消
        </Button>
      </div>
    </div>
  )
}

function FallbackJson({ data }: { data: any }) {
  return <pre className="text-[10px] bg-background rounded p-1.5 max-h-48 overflow-auto">{JSON.stringify(data, null, 2)}</pre>
}

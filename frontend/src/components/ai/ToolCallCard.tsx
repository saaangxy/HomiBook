import { cn } from '@/lib/utils'
import type { ToolCallEntry } from '@/stores/chat'
import { confirmAction, respondSuggestion } from '@/api/chat'
import { Button } from '@/components/ui/button'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Wrench, CheckCircle2, XCircle, Loader2, HelpCircle, ChevronDown, MessageSquareMore } from 'lucide-react'
import { useState } from 'react'
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
  const isInteractivePreview = isPreviewImport && args?.mode === 'preview'
  const confirmResult = isConfirmImport && toolCall.status === 'success' ? ((toolCall.result as any)?.data ?? null) : null
  const isConfirmCard = confirmResult && (confirmResult.mode === 'confirm_preview' || confirmResult.imported != null)

  const handleConfirm = async (approved: boolean) => {
    setConfirming(true)
    try {
      await confirmAction(toolCall.toolCallId, approved)
    } catch {
      // ignore
    }
    setConfirming(false)
  }

  const showArgs = toolCall.args != null
  const showResult = toolCall.status === 'success' && toolCall.result != null
  const showError = toolCall.status === 'error' && toolCall.result != null

  // 交互式预览：成功但未完成导入 → 琥珀色
  const isImportPending = isInteractivePreview && toolCall.status === 'success' && !importCompleted

  return (
    <div className={cn(
      'rounded-xl border px-3 py-2 text-xs',
      toolCall.status === 'pending' && 'border-blue-200 bg-blue-50/50',
      toolCall.status === 'error' && 'border-red-200 bg-red-50/50',
      toolCall.status === 'confirming' && 'border-amber-200 bg-amber-50/50',
      isImportPending && 'border-amber-200 bg-amber-50/50',
      toolCall.status === 'success' && !isImportPending && 'border-green-200 bg-green-50/50',
      toolCall.status === 'suggesting' && 'border-violet-200 bg-violet-50/50',
    )}>
      {/* 可点击头部 */}
      <button
        className="flex items-center gap-2 w-full text-left"
        onClick={() => setExpanded(!expanded)}
      >
        {toolCall.status === 'pending' && <Loader2 size={14} className="animate-spin text-blue-500" />}
        {isImportPending && <HelpCircle size={14} className="text-amber-500" />}
        {toolCall.status === 'success' && !isImportPending && <CheckCircle2 size={14} className="text-green-500" />}
        {toolCall.status === 'error' && <XCircle size={14} className="text-red-500" />}
        {toolCall.status === 'confirming' && <HelpCircle size={14} className="text-amber-500" />}
        {toolCall.status === 'suggesting' && <MessageSquareMore size={14} className="text-violet-500" />}
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

      {/* 确认按钮 —— 始终可见 */}
      {toolCall.status === 'confirming' && (
        <ConfirmPreviewView preview={toolCall.preview} onConfirm={handleConfirm} confirming={confirming} />
      )}

      {/* 建议选择 UI —— 始终可见 */}
      {toolCall.status === 'suggesting' && toolCall.suggestion && (
        <SuggestionView
          suggestion={toolCall.suggestion}
          toolCallId={toolCall.toolCallId}
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
}: {
  suggestion: { questions: QuestionDef[] }
  toolCallId: string
}) {
  const { questions } = suggestion
  // selectedOption: field → selected option (or '__custom__')
  const [selectedOption, setSelectedOption] = useState<Record<string, string>>({})
  // customInputs: field → custom text
  const [customInputs, setCustomInputs] = useState<Record<string, string>>({})
  const [submitting, setSubmitting] = useState(false)
  const [submitted, setSubmitted] = useState(false)

  // 每个 field 的当前值：选项值或自定义输入
  const getValue = (field: string) => {
    const sel = selectedOption[field]
    if (!sel) return ''
    return sel === '__custom__' ? (customInputs[field] || '').trim() : sel
  }

  const allFilled = questions.every((q) => !!getValue(q.field))

  const handleSubmit = async () => {
    if (!allFilled || submitting) return
    const values: Record<string, string> = {}
    for (const q of questions) {
      values[q.field] = getValue(q.field)
    }
    setSubmitting(true)
    try {
      await respondSuggestion(toolCallId, values)
      setSubmitted(true)
    } catch {
      setSubmitting(false)
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
      <div className="flex gap-2">
        <Button
          size="sm"
          variant="default"
          disabled={!allFilled || submitting}
          onClick={handleSubmit}
        >
          {submitting ? <Loader2 size={12} className="animate-spin mr-1" /> : null}
          提交
        </Button>
        <Button
          size="sm"
          variant="ghost"
          disabled={submitting}
          onClick={() => respondSuggestion(toolCallId, null)}
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

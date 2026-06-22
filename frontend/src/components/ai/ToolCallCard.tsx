import { cn } from '@/lib/utils'
import type { ToolCallEntry } from '@/stores/chat'
import { confirmAction } from '@/api/chat'
import { Button } from '@/components/ui/button'
import { Wrench, CheckCircle2, XCircle, Loader2, HelpCircle, ChevronDown } from 'lucide-react'
import { useState } from 'react'

interface Props {
  toolCall: ToolCallEntry
}

const toolLabels: Record<string, string> = {
  query_records: '查询流水',
  query_budgets: '查询预算',
  query_accounts: '查询账户',
  get_stats: '统计分析',
  query_categories: '查询分类',
}

export function ToolCallCard({ toolCall }: Props) {
  const [confirming, setConfirming] = useState(false)
  const [expanded, setExpanded] = useState(false)

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

  return (
    <div className={cn(
      'rounded-xl border px-3 py-2 text-xs',
      toolCall.status === 'pending' && 'border-blue-200 bg-blue-50/50',
      toolCall.status === 'success' && 'border-green-200 bg-green-50/50',
      toolCall.status === 'error' && 'border-red-200 bg-red-50/50',
      toolCall.status === 'confirming' && 'border-amber-200 bg-amber-50/50',
    )}>
      {/* 可点击头部 */}
      <button
        className="flex items-center gap-2 w-full text-left"
        onClick={() => setExpanded(!expanded)}
      >
        {toolCall.status === 'pending' && <Loader2 size={14} className="animate-spin text-blue-500" />}
        {toolCall.status === 'success' && <CheckCircle2 size={14} className="text-green-500" />}
        {toolCall.status === 'error' && <XCircle size={14} className="text-red-500" />}
        {toolCall.status === 'confirming' && <HelpCircle size={14} className="text-amber-500" />}
        <Wrench size={14} className="text-muted-foreground" />
        <span className="font-medium">{toolLabels[toolCall.toolName] || toolCall.toolName}</span>
        {toolCall.durationMs != null && (
          <span className="text-muted-foreground ml-auto">{toolCall.durationMs}ms</span>
        )}
        {(showArgs || showResult || showError) && (
          <ChevronDown size={12} className={cn('transition-transform', expanded && 'rotate-180')} />
        )}
      </button>

      {/* 折叠内容 */}
      {expanded && (
        <div className="mt-1.5 space-y-1.5">
          {/* 参数 */}
          {showArgs && (
            <div>
              <span className="text-muted-foreground text-[10px] uppercase tracking-wide">参数</span>
              <pre className="text-xs bg-background rounded p-1.5 max-h-24 overflow-auto mt-0.5">
                {typeof toolCall.args === 'string'
                  ? toolCall.args
                  : JSON.stringify(toolCall.args, null, 2)}
              </pre>
            </div>
          )}

          {/* 结果 */}
          {showResult && (
            <div>
              <span className="text-muted-foreground text-[10px] uppercase tracking-wide">结果</span>
              <div className="text-muted-foreground mt-0.5">
                {typeof toolCall.result === 'string'
                  ? toolCall.result
                  : JSON.stringify(toolCall.result, null, 2)}
              </div>
            </div>
          )}

          {/* 错误信息 */}
          {showError && (
            <div className="text-red-600">
              {typeof toolCall.result === 'object' && (toolCall.result as any)?.error
                ? (toolCall.result as any).error
                : '执行失败'}
            </div>
          )}
        </div>
      )}

      {/* 确认按钮 —— 始终可见 */}
      {toolCall.status === 'confirming' && (
        <div className="mt-2 space-y-2">
          <p className="text-muted-foreground">需要确认此操作：</p>
          <pre className="text-xs bg-background rounded p-1.5 max-h-24 overflow-auto">{toolCall.preview}</pre>
          <div className="flex gap-2">
            <Button size="sm" variant="default" disabled={confirming} onClick={() => handleConfirm(true)}>
              确认
            </Button>
            <Button size="sm" variant="outline" disabled={confirming} onClick={() => handleConfirm(false)}>
              拒绝
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}

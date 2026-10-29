import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'

/**
 * 单行省略文本:放不下时鼠标悬停用 Tooltip 展示全文。
 *
 * 弹窗表格里备注/标签/交易方经常被截断,直接 `truncate` 会让用户看不到内容;
 * 这里统一处理(短文本不弹提示,避免每次划过都出现浮层)。
 *
 * 注意:溢出与否取决于容器宽度,无法精确判断,这里按字符数近似 —— 超过 `tipAt` 才挂 Tooltip。
 */
export function EllipsisText({
  text,
  className,
  tipAt = 12,
  empty = '—',
}: {
  text?: string | null
  className?: string
  /** 超过多少个字符才启用 Tooltip */
  tipAt?: number
  /** 空值占位 */
  empty?: string
}) {
  const content = (text ?? '').trim()
  if (!content) return <span className="text-muted-foreground">{empty}</span>

  const node = <span className={cn('block truncate', className)}>{content}</span>
  if (content.length <= tipAt) return node

  return (
    <Tooltip>
      <TooltipTrigger asChild>{node}</TooltipTrigger>
      <TooltipContent className="max-w-[360px] whitespace-pre-wrap break-words text-xs">
        {content}
      </TooltipContent>
    </Tooltip>
  )
}

import { useState, useEffect, useRef } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { cn } from '@/lib/utils'
import type { Message, MessageBlock } from '@/stores/chat'
import { ToolCallCard } from './ToolCallCard'
import { Bot, User, Brain, ChevronDown, Copy, RefreshCw, Pencil, Check, Loader2 } from 'lucide-react'

interface Props {
  message: Message
  onRetry?: () => void
  onEdit?: (text: string) => void
}

/** 获取消息的全部文本内容 */
export function getMessageText(message: Message): string {
  return message.blocks
    .filter((b): b is Extract<MessageBlock, { type: 'text' }> => b.type === 'text')
    .map((b) => b.content)
    .join('\n')
}

export function MessageBubble({ message, onRetry, onEdit }: Props) {
  const isUser = message.role === 'user'
  const [openThinkBlocks, setOpenThinkBlocks] = useState<Set<string>>(new Set())
  const [hover, setHover] = useState(false)
  const [copied, setCopied] = useState(false)
  const manuallyClosed = useRef<Set<string>>(new Set())

  // 流式时自动展开最后一个 thinking block（用户手动关闭过的除外）
  useEffect(() => {
    if (message.isStreaming) {
      const thinkingBlocks = message.blocks.filter(
        (b): b is Extract<MessageBlock, { type: 'thinking' }> => b.type === 'thinking',
      )
      const lastThink = thinkingBlocks[thinkingBlocks.length - 1]
      if (lastThink && !manuallyClosed.current.has(lastThink.id)) {
        setOpenThinkBlocks((prev) => {
          if (prev.has(lastThink.id)) return prev
          return new Set([...prev, lastThink.id])
        })
      }
    }
  }, [message.blocks, message.isStreaming])

  const isStreaming = message.isStreaming
  const isEmpty = !isUser && isStreaming && message.blocks.length === 0

  const toggleThink = (id: string) => {
    setOpenThinkBlocks((prev) => {
      const next = new Set(prev)
      if (next.has(id)) {
        next.delete(id)
        // 记录用户手动关闭，流式期间不再自动展开
        if (isStreaming) manuallyClosed.current.add(id)
      } else {
        next.add(id)
        manuallyClosed.current.delete(id)
      }
      return next
    })
  }

  const handleCopy = async () => {
    const text = getMessageText(message)
    await navigator.clipboard.writeText(text)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <div
      className={cn('flex gap-3 group', isUser ? 'flex-row-reverse' : 'flex-row')}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
    >
      <Avatar className={cn('w-8 h-8 shrink-0 rounded-lg', isUser ? 'bg-primary' : 'bg-muted')}>
        <AvatarFallback className={cn('text-xs', isUser ? 'text-primary-foreground' : 'text-foreground')}>
          {isUser ? <User size={14} /> : <Bot size={14} />}
        </AvatarFallback>
      </Avatar>

      <div className={cn('flex flex-col gap-2 max-w-[75%] min-w-0', isUser ? 'items-end' : 'items-start')}>
        {isUser ? (
          message.blocks.map((block) => (
            <div
              key={block.id}
              className="bg-primary text-primary-foreground rounded-2xl rounded-tr-md px-4 py-2.5 text-sm leading-relaxed whitespace-pre-wrap break-words max-w-full"
            >
              {block.type === 'text' ? block.content : ''}
            </div>
          ))
        ) : (
          <div className="space-y-2 min-w-0 w-full">
            {/* 加载状态：流式但还没有任何 block */}
            {isEmpty && (
              <div className="bg-muted/60 rounded-2xl rounded-tl-md px-4 py-3 text-sm flex items-center gap-2 text-muted-foreground">
                <Loader2 size={14} className="animate-spin" />
                思考中...
              </div>
            )}

            {message.blocks.map((block) => {
              switch (block.type) {
                case 'thinking': {
                  const isOpen = openThinkBlocks.has(block.id)
                  return (
                    <div key={block.id} className="border rounded-lg overflow-hidden text-xs max-w-full">
                      <button
                        className="flex items-center gap-1.5 w-full px-3 py-1.5 text-muted-foreground hover:bg-muted/50 transition-colors"
                        onClick={() => toggleThink(block.id)}
                      >
                        <Brain size={12} />
                        <span>思考过程</span>
                        <ChevronDown size={12} className={cn('ml-auto transition-transform', isOpen && 'rotate-180')} />
                      </button>
                      {isOpen && (
                        <div className="px-3 py-2 border-t whitespace-pre-wrap text-muted-foreground break-words">
                          {block.content}
                        </div>
                      )}
                    </div>
                  )
                }
                case 'text': {
                  return (
                    <div
                      key={block.id}
                      className="bg-muted/60 rounded-2xl rounded-tl-md px-4 py-2.5 text-sm leading-relaxed break-words markdown-body max-w-full overflow-x-auto"
                    >
                      <ReactMarkdown remarkPlugins={[remarkGfm]}>
                        {block.content}
                      </ReactMarkdown>
                    </div>
                  )
                }
                case 'tool-call':
                  return <ToolCallCard key={block.id} toolCall={block} />
                default:
                  return null
              }
            })}

            {/* 操作按钮 —— 仅非流式时显示 */}
            {!isStreaming && hover && (
              <div className="flex items-center gap-1">
                <button
                  className="inline-flex items-center gap-1 px-2 py-1 text-xs text-muted-foreground hover:text-foreground hover:bg-muted rounded transition-colors"
                  onClick={handleCopy}
                >
                  {copied ? <Check size={12} /> : <Copy size={12} />}
                  {copied ? '已复制' : '复制'}
                </button>
                {onRetry && (
                  <button
                    className="inline-flex items-center gap-1 px-2 py-1 text-xs text-muted-foreground hover:text-foreground hover:bg-muted rounded transition-colors"
                    onClick={onRetry}
                  >
                    <RefreshCw size={12} />
                    重试
                  </button>
                )}
              </div>
            )}

            {/* Token 消耗展示 */}
            {!isStreaming && message.usage && (
              <div className="text-xs text-muted-foreground/60">
                Token: ↑{message.usage.inputTokens.toLocaleString()} + ↓{message.usage.outputTokens.toLocaleString()} = {message.usage.totalTokens.toLocaleString()}
                {message.usage.cachedInputTokens != null && message.usage.cachedInputTokens > 0 && (
                  <> | 缓存 {message.usage.cachedInputTokens.toLocaleString()}</>
                )}
              </div>
            )}
          </div>
        )}

        {/* 用户消息操作按钮 */}
        {isUser && !isStreaming && hover && onEdit && (
          <div className="flex items-center gap-1">
            <button
              className="inline-flex items-center gap-1 px-2 py-1 text-xs text-muted-foreground hover:text-foreground hover:bg-muted rounded transition-colors"
              onClick={handleCopy}
            >
              {copied ? <Check size={12} /> : <Copy size={12} />}
              {copied ? '已复制' : '复制'}
            </button>
            <button
              className="inline-flex items-center gap-1 px-2 py-1 text-xs text-muted-foreground hover:text-foreground hover:bg-muted rounded transition-colors"
              onClick={() => onEdit(getMessageText(message))}
            >
              <Pencil size={12} />
              编辑
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

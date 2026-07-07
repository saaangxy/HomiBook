import { useState, useEffect, useRef } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { cn } from '@/lib/utils'
import type { Message, MessageBlock } from '@/stores/chat'
import { useAuthStore } from '@/stores/auth'
import { ToolCallCard } from './ToolCallCard'
import { Bot, Brain, ChevronDown, ChevronLeft, ChevronRight, Copy, RefreshCw, Pencil, Check, Loader2 } from 'lucide-react'
import { Textarea } from '@/components/ui/textarea'
import { Button } from '@/components/ui/button'

interface Props {
  message: Message
  onRetry?: () => void
  onEditSubmit?: (msgId: string, newText: string) => void
  versions?: { id: string; label: string; isActive: boolean }[]
  onSwitchVersion?: (versionId: string) => void
}

/** 获取消息的全部文本内容 */
export function getMessageText(message: Message): string {
  return message.blocks
    .filter((b): b is Extract<MessageBlock, { type: 'text' }> => b.type === 'text')
    .map((b) => b.content)
    .join('\n')
}

export function MessageBubble({ message, onRetry, onEditSubmit, versions, onSwitchVersion }: Props) {
  const user = useAuthStore((s) => s.user)
  const userInitial = (user?.nickname || user?.username || '用')[0]

  const isUser = message.role === 'user'
  const [openThinkBlocks, setOpenThinkBlocks] = useState<Set<string>>(new Set())
  const [copied, setCopied] = useState(false)
  const manuallyClosed = useRef<Set<string>>(new Set())
  const [isEditing, setIsEditing] = useState(false)
  const [editText, setEditText] = useState('')

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

  const handleStartEdit = () => {
    setEditText(getMessageText(message))
    setIsEditing(true)
  }

  const handleCancelEdit = () => {
    setIsEditing(false)
    setEditText('')
  }

  const handleSubmitEdit = () => {
    const trimmed = editText.trim()
    if (trimmed && onEditSubmit) {
      onEditSubmit(message.id, trimmed)
    }
    setIsEditing(false)
    setEditText('')
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
    >
      <Avatar className={cn('w-8 h-8 shrink-0 rounded-lg', isUser ? 'bg-gradient-to-br from-primary to-primary/40' : 'bg-muted')}>
        <AvatarFallback className={cn('text-xs font-medium', isUser ? 'text-primary-foreground bg-transparent' : 'text-foreground')}>
          {isUser ? userInitial : <Bot size={14} />}
        </AvatarFallback>
      </Avatar>

      <div className={cn('flex flex-col gap-2 min-w-0', isUser ? 'items-end' : 'items-start min-w-[60%]', isEditing ? 'w-[60%]' : 'max-w-[75%]')}>
        {isUser ? (
          <>
            {/* 版本切换 */}
            {versions && versions.length > 1 && onSwitchVersion && (() => {
              const curIdx = versions.findIndex((v) => v.isActive)
              const total = versions.length
              return (
                <div className="flex items-center gap-1 mb-1">
                  <button
                    className="p-0.5 text-muted-foreground hover:text-foreground rounded transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                    disabled={curIdx <= 0}
                    onClick={() => onSwitchVersion(versions[curIdx - 1].id)}
                  >
                    <ChevronLeft size={14} />
                  </button>
                  <span className="text-xs text-muted-foreground font-medium min-w-[36px] text-center select-none">
                    {curIdx + 1}/{total}
                  </span>
                  <button
                    className="p-0.5 text-muted-foreground hover:text-foreground rounded transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                    disabled={curIdx >= total - 1}
                    onClick={() => onSwitchVersion(versions[curIdx + 1].id)}
                  >
                    <ChevronRight size={14} />
                  </button>
                </div>
              )
            })()}
            {isEditing ? (
              <>
                <Textarea
                  value={editText}
                  onChange={(e) => setEditText(e.target.value)}
                  className="bg-white border rounded-2xl rounded-tr-md px-4 py-2.5 text-sm w-full resize-none min-h-[60px] leading-relaxed text-foreground placeholder:text-muted-foreground focus-visible:ring-1"
                  placeholder="输入消息..."
                  rows={3}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault()
                      handleSubmitEdit()
                    } else if (e.key === 'Escape') {
                      handleCancelEdit()
                    }
                  }}
                  autoFocus
                />
                <div className="flex items-center justify-end gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-7 px-3 text-xs"
                    onClick={handleCancelEdit}
                  >
                    取消
                  </Button>
                  <Button
                    size="sm"
                    className="h-7 px-3 text-xs"
                    onClick={handleSubmitEdit}
                    disabled={!editText.trim()}
                  >
                    发送
                  </Button>
                </div>
              </>
            ) : (
              message.blocks.map((block) => (
                <div
                  key={block.id}
                  className="bg-primary text-primary-foreground rounded-2xl rounded-tr-md px-4 py-2.5 text-sm leading-relaxed whitespace-pre-wrap break-words max-w-full"
                >
                  {block.type === 'text' ? block.content : ''}
                </div>
              ))
            )}
          </>
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
            {!isStreaming && (
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
        {isUser && !isStreaming && !isEditing && onEditSubmit && (
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
              onClick={handleStartEdit}
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

import { useState, useEffect } from 'react'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { cn } from '@/lib/utils'
import type { Message, MessageBlock } from '@/stores/chat'
import { ToolCallCard } from './ToolCallCard'
import { Bot, User, Brain, ChevronDown } from 'lucide-react'

interface Props {
  message: Message
}

export function MessageBubble({ message }: Props) {
  const isUser = message.role === 'user'
  const [openThinkBlocks, setOpenThinkBlocks] = useState<Set<string>>(new Set())

  // 流式时自动展开最后一个 thinking block
  useEffect(() => {
    if (message.isStreaming) {
      const thinkingBlocks = message.blocks.filter(
        (b): b is Extract<MessageBlock, { type: 'thinking' }> => b.type === 'thinking',
      )
      const lastThink = thinkingBlocks[thinkingBlocks.length - 1]
      if (lastThink) {
        setOpenThinkBlocks((prev) => {
          if (prev.has(lastThink.id)) return prev
          return new Set([...prev, lastThink.id])
        })
      }
    }
  }, [message.blocks, message.isStreaming])

  const lastTextBlockId = [...message.blocks].reverse().find((b) => b.type === 'text')?.id

  const toggleThink = (id: string) => {
    setOpenThinkBlocks((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  return (
    <div className={cn('flex gap-3', isUser ? 'flex-row-reverse' : 'flex-row')}>
      <Avatar className={cn('w-8 h-8 shrink-0 rounded-lg', isUser ? 'bg-primary' : 'bg-muted')}>
        <AvatarFallback className={cn('text-xs', isUser ? 'text-primary-foreground' : 'text-foreground')}>
          {isUser ? <User size={14} /> : <Bot size={14} />}
        </AvatarFallback>
      </Avatar>

      <div className={cn('flex flex-col gap-2 max-w-[80%]', isUser ? 'items-end' : 'items-start')}>
        {isUser ? (
          message.blocks.map((block) => (
            <div
              key={block.id}
              className="bg-primary text-primary-foreground rounded-2xl rounded-tr-md px-4 py-2.5 text-sm leading-relaxed whitespace-pre-wrap break-words"
            >
              {block.type === 'text' ? block.content : ''}
            </div>
          ))
        ) : (
          <div className="space-y-2">
            {message.blocks.map((block) => {
              switch (block.type) {
                case 'thinking': {
                  const isOpen = openThinkBlocks.has(block.id)
                  return (
                    <div key={block.id} className="border rounded-lg overflow-hidden text-xs">
                      <button
                        className="flex items-center gap-1.5 w-full px-3 py-1.5 text-muted-foreground hover:bg-muted/50 transition-colors"
                        onClick={() => toggleThink(block.id)}
                      >
                        <Brain size={12} />
                        <span>思考过程</span>
                        <ChevronDown size={12} className={cn('ml-auto transition-transform', isOpen && 'rotate-180')} />
                      </button>
                      {isOpen && (
                        <div className="px-3 py-2 border-t whitespace-pre-wrap text-muted-foreground">
                          {block.content}
                        </div>
                      )}
                    </div>
                  )
                }
                case 'text': {
                  const isLast = block.id === lastTextBlockId
                  return (
                    <div
                      key={block.id}
                      className="bg-muted/60 rounded-2xl rounded-tl-md px-4 py-2.5 text-sm leading-relaxed whitespace-pre-wrap break-words"
                    >
                      {block.content}
                      {message.isStreaming && isLast && (
                        <span className="inline-block w-1.5 h-4 bg-primary animate-pulse ml-0.5 align-middle" />
                      )}
                    </div>
                  )
                }
                case 'tool-call':
                  return <ToolCallCard key={block.id} toolCall={block} />
                default:
                  return null
              }
            })}
          </div>
        )}
      </div>
    </div>
  )
}

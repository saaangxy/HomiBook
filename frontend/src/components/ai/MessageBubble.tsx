import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { cn } from '@/lib/utils'
import type { Message, ToolCallEntry } from '@/stores/chat'
import { ToolCallCard } from './ToolCallCard'
import { Bot, User } from 'lucide-react'

interface Props {
  message: Message
}

export function MessageBubble({ message }: Props) {
  const isUser = message.role === 'user'

  return (
    <div className={cn('flex gap-3', isUser ? 'flex-row-reverse' : 'flex-row')}>
      <Avatar className={cn('w-8 h-8 shrink-0 rounded-lg', isUser ? 'bg-primary' : 'bg-muted')}>
        <AvatarFallback className={cn('text-xs', isUser ? 'text-primary-foreground' : 'text-foreground')}>
          {isUser ? <User size={14} /> : <Bot size={14} />}
        </AvatarFallback>
      </Avatar>

      <div className={cn('flex flex-col gap-2 max-w-[80%]', isUser ? 'items-end' : 'items-start')}>
        {isUser ? (
          <div className="bg-primary text-primary-foreground rounded-2xl rounded-tr-md px-4 py-2.5 text-sm leading-relaxed whitespace-pre-wrap break-words">
            {message.content}
          </div>
        ) : (
          <div className="space-y-2">
            {message.content && (
              <div className="bg-muted/60 rounded-2xl rounded-tl-md px-4 py-2.5 text-sm leading-relaxed whitespace-pre-wrap break-words">
                {message.content}
                {message.isStreaming && <span className="inline-block w-1.5 h-4 bg-primary animate-pulse ml-0.5 align-middle" />}
              </div>
            )}

            {message.toolCalls?.map((tc) => (
              <ToolCallCard key={tc.toolCallId} toolCall={tc} />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

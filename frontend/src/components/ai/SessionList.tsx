import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import { cn } from '@/lib/utils'
import type { ChatSession } from '@/stores/chat'
import { Plus, MessageSquare, Trash2, Loader2 } from 'lucide-react'

interface Props {
  sessions: ChatSession[]
  currentId: string | null
  streamingSessionIds?: string[]
  onSelect: (id: string) => void
  onCreate: () => void
  onDelete: (id: string) => void
}

export function SessionList({ sessions, currentId, streamingSessionIds, onSelect, onCreate, onDelete }: Props) {
  const today = new Date().toDateString()
  const yesterday = new Date(Date.now() - 86400000).toDateString()

  const grouped = sessions.reduce((acc, s) => {
    const d = new Date(s.updatedAt).toDateString()
    let label: string
    if (d === today) label = '今天'
    else if (d === yesterday) label = '昨天'
    else label = new Date(s.updatedAt).toLocaleDateString('zh-CN')
    if (!acc[label]) acc[label] = []
    acc[label].push(s)
    return acc
  }, {} as Record<string, ChatSession[]>)

  return (
    <div className="flex flex-col h-full">
      <div className="p-3 flex items-center justify-between">
        <span className="text-sm font-semibold text-muted-foreground">会话</span>
        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={onCreate}>
          <Plus size={16} />
        </Button>
      </div>

      <ScrollArea className="flex-1">
        <div className="px-2 pb-2 space-y-3">
          {Object.entries(grouped).map(([label, items]) => (
            <div key={label}>
              <div className="text-[11px] font-medium text-muted-foreground px-2 mb-1">{label}</div>
              {items.map((s) => (
                <div
                  key={s.id}
                  className={cn(
                    'group flex items-center gap-2 px-2 py-1.5 rounded-lg cursor-pointer text-sm transition-colors',
                    s.id === currentId ? 'bg-accent text-accent-foreground' : 'hover:bg-accent/50',
                  )}
                  onClick={() => onSelect(s.id)}
                >
                  {streamingSessionIds?.includes(s.id) ? (
                    <Loader2 size={14} className="shrink-0 text-blue-500 animate-spin" />
                  ) : (
                    <MessageSquare size={14} className="shrink-0 text-muted-foreground" />
                  )}
                  <span className="truncate flex-1">{s.title}</span>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-5 w-5 opacity-0 group-hover:opacity-100 shrink-0"
                    onClick={(e) => { e.stopPropagation(); onDelete(s.id) }}
                  >
                    <Trash2 size={12} />
                  </Button>
                </div>
              ))}
            </div>
          ))}
          {sessions.length === 0 && (
            <div className="text-xs text-muted-foreground text-center py-8">暂无会话</div>
          )}
        </div>
      </ScrollArea>
    </div>
  )
}

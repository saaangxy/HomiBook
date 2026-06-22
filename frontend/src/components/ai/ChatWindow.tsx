import { useEffect, useRef, useState } from 'react'
import { useChatStore } from '@/stores/chat'
import { useBookStore } from '@/stores/book'
import { fetchSessions, fetchMessages, createSession, deleteSession as deleteSessionApi } from '@/api/chat'
import { MessageBubble } from './MessageBubble'
import { SessionList } from './SessionList'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Send, StopCircle } from 'lucide-react'
import { parseContentIntoBlocks, type MessageBlock } from '@/stores/chat'

export function ChatWindow() {
  const [input, setInput] = useState('')
  const scrollRef = useRef<HTMLDivElement>(null)

  const {
    sessions, currentSessionId, messages, isStreaming, error,
    setSessions, setCurrentSession, setMessages, sendMessage, stopStreaming,
  } = useChatStore()

  const { currentBookId } = useBookStore()

  // 初始化加载会话列表
  useEffect(() => {
    loadSessions()
  }, [])

  const loadSessions = async () => {
    try {
      const list = await fetchSessions()
      setSessions(list)
    } catch {
      // ignore
    }
  }

  const handleSelectSession = async (id: string) => {
    setCurrentSession(id)
    try {
      const msgs = await fetchMessages(id)
      const parsed = msgs.map((m) => {
        const blocks: MessageBlock[] = m.role === 'assistant'
          ? parseContentIntoBlocks(m.content || '')
          : [{ id: `hist-0`, type: 'text' as const, content: m.content || '' }]
        return {
          id: m.id,
          role: m.role as 'user' | 'assistant',
          blocks,
        }
      })
      setMessages(parsed.length > 0 ? parsed : [greetingMsg])
    } catch {
      // ignore
    }
  }

  const greetingMsg = {
    id: 'greeting',
    role: 'assistant' as const,
    blocks: [
      {
        id: 'greeting-text',
        type: 'text' as const,
        content: '你好，我是 AI 记账助手。可以问我：本月花了多少？餐饮超预算了吗？帮我分析一下支出趋势。',
      },
    ],
  }

  const handleCreateSession = async () => {
    try {
      const res = await createSession({ accountBookId: currentBookId || undefined })
      const list = await fetchSessions()
      setSessions(list)
      setCurrentSession(res.session.id)
      setMessages([greetingMsg])
    } catch {
      // ignore
    }
  }

  const handleDeleteSession = async (id: string) => {
    try {
      await deleteSessionApi(id)
      setSessions(sessions.filter((s) => s.id !== id))
      if (currentSessionId === id) {
        setCurrentSession(null)
        setMessages([])
      }
    } catch {
      // ignore
    }
  }

  const handleSend = () => {
    const text = input.trim()
    if (!text || !currentBookId || isStreaming) return
    setInput('')

    // 如果没有当前会话，先创建
    if (!currentSessionId) {
      createSession({ accountBookId: currentBookId }).then((res) => {
        setSessions([{ id: res.session.id, title: '新对话', modelProvider: '', modelName: '', updatedAt: new Date().toISOString() }, ...sessions])
        setCurrentSession(res.session.id)
        sendMessage(currentBookId, text)
      })
      return
    }

    sendMessage(currentBookId, text)
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  // 自动滚动到底部
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [messages])

  return (
    <div className="flex h-[600px] rounded-xl border bg-card overflow-hidden">
      {/* 左侧会话列表 */}
      <div className="w-52 border-r shrink-0">
        <SessionList
          sessions={sessions}
          currentId={currentSessionId}
          onSelect={handleSelectSession}
          onCreate={handleCreateSession}
          onDelete={handleDeleteSession}
        />
      </div>

      {/* 右侧聊天区 */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* 消息列表 */}
        <ScrollArea className="flex-1">
          <div ref={scrollRef} className="p-4 space-y-4">
            {messages.map((msg) => (
              <MessageBubble key={msg.id} message={msg} />
            ))}
            {error && (
              <div className="text-center text-red-500 text-sm py-2">{error}</div>
            )}
          </div>
        </ScrollArea>

        {/* 输入区 */}
        <div className="p-3 border-t">
          <div className="flex gap-2 items-end">
            <Textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="输入消息... (Enter 发送，Shift+Enter 换行)"
              rows={2}
              className="min-h-10 resize-none"
              disabled={isStreaming}
            />
            {isStreaming ? (
              <Button variant="outline" size="icon" className="shrink-0" onClick={stopStreaming}>
                <StopCircle size={18} />
              </Button>
            ) : (
              <Button size="icon" className="shrink-0" onClick={handleSend} disabled={!input.trim() || !currentBookId}>
                <Send size={18} />
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

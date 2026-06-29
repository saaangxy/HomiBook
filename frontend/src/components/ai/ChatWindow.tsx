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
    sessions, currentSessionId, messages, allMessages, error,
    setSessions, setCurrentSession, setMessages, sendMessage, retryMessage, selectBranch, stopStreaming,
    saveCurrentToCache, restoreFromCache,
  } = useChatStore()

  const isCurrentStreaming = useChatStore((s) =>
    s.sessionCache[s.currentSessionId ?? '']?.isStreaming ?? false
  )

  const { currentBookId } = useBookStore()

  // 从 sessionCache 提取正在流式的会话 ID（用字符串避免引用不稳定导致无限循环）
  const streamingSessionIdsStr = useChatStore((s) =>
    Object.entries(s.sessionCache)
      .filter(([, cache]) => cache.isStreaming)
      .map(([id]) => id)
      .sort()
      .join(',')
  )
  const streamingSessionIds = streamingSessionIdsStr ? streamingSessionIdsStr.split(',') : []


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
    // 保存当前会话状态到缓存（包括可能正在进行的流式内容）
    saveCurrentToCache()
    setCurrentSession(id)

    // 优先从缓存恢复（保留后台流式进度）
    if (restoreFromCache(id)) return

    try {
      const msgs = await fetchMessages(id)
      const parsed = msgs.map((m) => {
        const blocks: MessageBlock[] = m.role === 'assistant'
          ? parseContentIntoBlocks(m.content || '', m.toolCalls)
          : [{ id: `hist-0`, type: 'text' as const, content: m.content || '' }]
        return {
          id: m.id,
          dbId: m.id,
          role: m.role as 'user' | 'assistant',
          blocks,
          parentMessageId: m.parentMessageId ?? undefined,
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
    saveCurrentToCache()
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

  const handleSend = (text?: string) => {
    const msg = (text || input).trim()
    if (!msg || !currentBookId || isCurrentStreaming) return
    setInput('')

    const parentId = messages.length > 0
      ? messages[messages.length - 1].dbId || messages[messages.length - 1].id
      : undefined

    if (!currentSessionId) {
      createSession({ accountBookId: currentBookId }).then((res) => {
        setSessions([{ id: res.session.id, title: '新对话', modelProvider: '', modelName: '', updatedAt: new Date().toISOString() }, ...sessions])
        setCurrentSession(res.session.id)
        sendMessage(currentBookId, msg, parentId)
      })
      return
    }

    sendMessage(currentBookId, msg, parentId)
  }

  // 编辑消息并提交：取被编辑消息的前一条消息作为 parent，创建新分支
  const handleEditSubmit = (msgId: string, newText: string) => {
    if (!currentBookId || isCurrentStreaming) return
    const idx = messages.findIndex((m) => m.id === msgId)
    const parentId = idx > 0 ? messages[idx - 1].dbId || messages[idx - 1].id : undefined

    if (!currentSessionId) {
      createSession({ accountBookId: currentBookId }).then((res) => {
        setSessions([{ id: res.session.id, title: '新对话', modelProvider: '', modelName: '', updatedAt: new Date().toISOString() }, ...sessions])
        setCurrentSession(res.session.id)
        sendMessage(currentBookId, newText, parentId)
      })
      return
    }

    sendMessage(currentBookId, newText, parentId)
  }

  // 重试：清理本地状态后重新生成
  const handleRetry = (assistantMsgId: string) => {
    if (!currentBookId) return
    const idx = messages.findIndex((m) => m.id === assistantMsgId)
    if (idx <= 0) return
    const prevUserMsg = messages[idx - 1]
    if (prevUserMsg.role !== 'user') return
    const text = prevUserMsg.blocks
      .filter((b) => b.type === 'text')
      .map((b) => b.content)
      .join('\n')
    if (!text) return

    const assistantDbId = messages[idx].dbId || messages[idx].id
    const parentId = idx > 1 ? messages[idx - 2]?.dbId || messages[idx - 2]?.id : undefined

    // 先清理本地状态
    retryMessage(assistantMsgId)
    // 再发送新消息（replaceAssistantDbId 告诉后端删除旧消息）
    sendMessage(currentBookId, text, parentId, assistantDbId)
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
          streamingSessionIds={streamingSessionIds}
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
            {messages.map((msg) => {
              // 检查当前消息所在位置的所有版本（同一 parentMessageId 的消息）
              const allVersions = msg.parentMessageId
                ? allMessages
                    .filter((m) => m.parentMessageId === msg.parentMessageId)
                    .map((m, i) => ({
                      id: m.dbId || m.id,
                      label: `v${i + 1}`,
                      isActive: (m.dbId || m.id) === (msg.dbId || msg.id),
                    }))
                : []
              return (
                <div key={msg.id}>
                  <MessageBubble
                    message={msg}
                    onRetry={msg.role === 'assistant' && msg.id !== 'greeting' && !msg.isCurrentStreaming
                      ? () => handleRetry(msg.id)
                      : undefined}
                    onEditSubmit={msg.role === 'user'
                      ? handleEditSubmit
                      : undefined}
                    versions={allVersions.length > 1 ? allVersions : undefined}
                    onSwitchVersion={(versionId) => {
                      if (msg.parentMessageId) selectBranch(msg.parentMessageId, versionId)
                    }}
                  />
                </div>
              )
            })}
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
              disabled={isCurrentStreaming}
            />
            {isCurrentStreaming ? (
              <Button variant="outline" size="icon" className="shrink-0" onClick={stopStreaming}>
                <StopCircle size={18} />
              </Button>
            ) : (
              <Button size="icon" className="shrink-0" onClick={() => handleSend()} disabled={!input.trim() || !currentBookId}>
                <Send size={18} />
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

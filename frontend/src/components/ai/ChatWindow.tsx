import { useEffect, useRef, useState } from 'react'
import { useChatStore } from '@/stores/chat'
import { useBookStore } from '@/stores/book'
import { fetchSessions, fetchMessages, createSession, updateSession, deleteSession as deleteSessionApi } from '@/api/chat'
import { loadToolNames } from '@/lib/tool-names'
import { importExportApi } from '@/api/import-export'
import { recordApi } from '@/api/record'
import { MessageBubble } from './MessageBubble'
import { SessionList } from './SessionList'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { ScrollArea } from '@/components/ui/scroll-area'
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Send, StopCircle, Upload, Image as ImageIcon, X, Globe } from 'lucide-react'
import { parseContentIntoBlocks } from '@/stores/chat-content-parser'
import { type MessageBlock } from '@/stores/chat'

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

  // ---- 小票图片上传 ----
  const [pendingImages, setPendingImages] = useState<{ file: File; preview: string }[]>([])
  const [uploadingImages, setUploadingImages] = useState(false)
  const imageInputRef = useRef<HTMLInputElement>(null)

  // ---- 网络搜索开关 ----
  const [webSearchEnabled, setWebSearchEnabled] = useState(true)

  const handleImageSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || [])
    if (!files.length) return
    const newImages = files.map((file) => ({
      file,
      preview: URL.createObjectURL(file),
    }))
    setPendingImages((prev) => [...prev, ...newImages])
    if (imageInputRef.current) imageInputRef.current.value = ''
  }

  const removeImage = (index: number) => {
    setPendingImages((prev) => {
      URL.revokeObjectURL(prev[index].preview)
      return prev.filter((_, i) => i !== index)
    })
  }

  // 初始化加载会话列表 + 工具名称缓存
  useEffect(() => {
    loadSessions()
    loadToolNames()
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
          : (m.content?.trim() ? [{ id: `hist-0`, type: 'text' as const, content: m.content }] : [])
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

  const handleSend = async (text?: string) => {
    const msg = (text || input).trim()
    if ((!msg && pendingImages.length === 0) || !currentBookId || isCurrentStreaming) return
    setInput('')

    // 向前找最后一个有 dbId 的消息，避免把临时 msg-* ID 当作 parentId 发给后端
    let parentId: string | undefined
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].dbId) { parentId = messages[i].dbId; break }
    }

    // 上传待发送的小票图片
    let attachments: { id: string; url: string; originalFilename: string }[] | undefined
    let attachmentIds: string[] | undefined
    if (pendingImages.length > 0) {
      setUploadingImages(true)
      try {
        const results = await Promise.all(
          pendingImages.map((img) => recordApi.uploadAttachment(img.file)),
        )
        attachments = results.map((r) => ({ id: r.id, url: r.url, originalFilename: r.originalFilename }))
        attachmentIds = results.map((r) => r.id)
        // 清理预览 URL
        pendingImages.forEach((img) => URL.revokeObjectURL(img.preview))
        setPendingImages([])
      } catch {
        // 上传失败时仍发送消息（无附件）
      }
      setUploadingImages(false)
    }

    if (!currentSessionId) {
      const title = msg.length > 30 ? msg.slice(0, 30) + '...' : msg
      createSession({ accountBookId: currentBookId, title }).then((res) => {
        setSessions([res.session, ...sessions])
        setCurrentSession(res.session.id)
        sendMessage(currentBookId, msg, parentId, undefined, attachmentIds, attachments, webSearchEnabled)
      })
      return
    }

    sendMessage(currentBookId, msg, parentId, undefined, attachmentIds, attachments, webSearchEnabled)

    // 首条消息且有文本时更新会话标题（纯图片由 AI 生成标题）
    if ((!parentId || parentId === 'greeting') && currentSessionId && msg.trim()) {
      const title = msg.length > 30 ? msg.slice(0, 30) + '...' : msg
      updateSession(currentSessionId, { title }).catch(() => {})
      setSessions(sessions.map(s => s.id === currentSessionId ? { ...s, title } : s))
    }
  }

  // 编辑消息并提交：取被编辑消息的前一条消息作为 parent，创建新分支
  const handleEditSubmit = (msgId: string, newText: string) => {
    if (!currentBookId || isCurrentStreaming) return
    const idx = messages.findIndex((m) => m.id === msgId)
    // 向前找最后一个有 dbId 的消息
    let parentId: string | undefined
    for (let i = idx - 1; i >= 0; i--) {
      if (messages[i].dbId) { parentId = messages[i].dbId; break }
    }

    if (!currentSessionId) {
      const title = newText.length > 30 ? newText.slice(0, 30) + '...' : newText
      createSession({ accountBookId: currentBookId, title }).then((res) => {
        setSessions([res.session, ...sessions])
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
    // 向前找最后一个有 dbId 的消息（跳过被重试的助手消息和其前面的用户消息）
    let parentId: string | undefined
    for (let i = idx - 2; i >= 0; i--) {
      if (messages[i].dbId) { parentId = messages[i].dbId; break }
    }

    // 先清理本地状态
    retryMessage(assistantMsgId)
    // 再发送新消息（replaceAssistantDbId 告诉后端删除旧消息）
    sendMessage(currentBookId, text, parentId, assistantDbId)
  }

  // ---- 导入 ----
  const [importing, setImporting] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const pendingSourceRef = useRef<string>('')

  const handleImportClick = (source: string) => {
    pendingSourceRef.current = source
    fileInputRef.current?.click()
  }

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file || !currentBookId) return

    setImporting(true)
    try {
      const res = await importExportApi.uploadTempFile(file)
      const sourceLabel: Record<string, string> = { alipay: '支付宝', wechat: '微信', jd: '京东' }
      const src = pendingSourceRef.current
      const msg = `请导入${sourceLabel[src] || src}账单文件\nfileId: ${res.fileId}\nsource: ${src}\n文件名: ${res.filename}`
      handleSend(msg)
    } catch {
      // ignore
    }
    setImporting(false)
    // 清除 input 以允许重复选择同一文件
    if (fileInputRef.current) fileInputRef.current.value = ''
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
                    onRetry={msg.role === 'assistant' && msg.id !== 'greeting' && !msg.isStreaming
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

        {/* 输入区：主流聊天布局（输入框在上，工具栏在下） */}
        <div className="border-t p-3">
          {/* 已选图片预览 */}
          {pendingImages.length > 0 && (
            <div className="flex gap-2 mb-2 flex-wrap">
              {pendingImages.map((img, i) => (
                <div key={i} className="relative w-16 h-16 rounded-lg overflow-hidden border">
                  <img src={img.preview} alt="" className="w-full h-full object-cover" />
                  <button
                    className="absolute top-0 right-0 w-5 h-5 bg-black/60 rounded-bl-lg flex items-center justify-center"
                    onClick={() => removeImage(i)}
                  >
                    <X size={12} className="text-white" />
                  </button>
                </div>
              ))}
            </div>
          )}
          {/* 隐藏文件上传 */}
          <input
            ref={fileInputRef}
            type="file"
            className="hidden"
            accept=".csv,.xls,.xlsx"
            onChange={handleFileChange}
          />
          <input
            ref={imageInputRef}
            type="file"
            className="hidden"
            accept="image/*"
            multiple
            onChange={handleImageSelect}
          />
          {/* 输入框区域 */}
          <div className="rounded-2xl border bg-background focus-within:border-primary/40 focus-within:ring-1 focus-within:ring-primary/20 transition-colors">
            <Textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="输入消息... (Enter 发送，Shift+Enter 换行)"
              rows={2}
              className="border-0 focus-visible:ring-0 focus-visible:ring-offset-0 resize-none px-4 py-3 min-h-[60px]"
              disabled={isCurrentStreaming || importing || uploadingImages}
            />
            {/* 工具栏：工具按钮在左，发送在右 */}
            <div className="flex items-center justify-between px-3 pb-2">
              <div className="flex items-center gap-1">
                {/* 网络搜索开关 */}
                <button
                  type="button"
                  className={cn(
                    'inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium transition-colors',
                    webSearchEnabled
                      ? 'bg-primary/10 text-primary'
                      : 'text-muted-foreground hover:bg-muted',
                  )}
                  onClick={() => setWebSearchEnabled(v => !v)}
                  title={webSearchEnabled ? '网络搜索已开启' : '网络搜索已关闭'}
                >
                  <Globe size={13} />
                  {webSearchEnabled ? '联网搜索' : '联网搜索'}
                </button>
                {/* 上传小票 */}
                <Button
                  size="icon"
                  variant="ghost"
                  className="h-7 w-7 text-muted-foreground hover:text-foreground"
                  disabled={!currentBookId || importing || uploadingImages}
                  title="上传图片"
                  onClick={() => imageInputRef.current?.click()}
                >
                  <ImageIcon size={16} />
                </Button>
                {/* 导入账单 */}
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button size="icon" variant="ghost" className="h-7 w-7 text-muted-foreground hover:text-foreground" disabled={!currentBookId || importing} title="导入账单">
                      <Upload size={16} />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent side="top" align="start">
                    <DropdownMenuItem onClick={() => handleImportClick('alipay')}>支付宝</DropdownMenuItem>
                    <DropdownMenuItem onClick={() => handleImportClick('wechat')}>微信</DropdownMenuItem>
                    <DropdownMenuItem onClick={() => handleImportClick('jd')}>京东</DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
              {isCurrentStreaming ? (
                <Button variant="ghost" size="sm" className="h-7 px-3 text-muted-foreground stop-btn-streaming" onClick={() => stopStreaming()}>
                  <StopCircle size={15} className="mr-1" />
                  停止
                </Button>
              ) : (
                <Button
                  size="icon"
                  className="h-8 w-8 rounded-full"
                  onClick={() => handleSend()}
                  disabled={(!input.trim() && pendingImages.length === 0) || !currentBookId || importing || uploadingImages}
                  title="发送"
                >
                  <Send size={15} />
                </Button>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

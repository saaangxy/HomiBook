import { useEffect, useRef, useState } from 'react'
import { setStreamPaused, useChatStore, useSessionView } from '@/stores/chat'
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
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel,
  AlertDialogContent, AlertDialogDescription, AlertDialogFooter,
  AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Send, StopCircle, Upload, Paperclip, FileText, X, Globe, Menu, Plus, Loader2 } from 'lucide-react'
import { parseContentIntoBlocks, buildImportMessage } from '@homibook/core'
import { type MessageBlock, type ChatSession } from '@/stores/chat'
import { useIsMobile } from '@/hooks/use-mobile'
import {
  Sheet, SheetContent, SheetHeader, SheetTitle,
} from '@/components/ui/sheet'

/** 单个附件体积上限(与导入向导文案里的 10MB 保持一致) */
const MAX_ATTACH_MB = 10
const MAX_ATTACH_BYTES = MAX_ATTACH_MB * 1024 * 1024

export function ChatWindow() {
  const [input, setInput] = useState('')
  const scrollRef = useRef<HTMLDivElement>(null)
  const isMobile = useIsMobile()
  const [sessionOpen, setSessionOpen] = useState(false)

  const {
    sessions, currentSessionId,
    setSessions, setCurrentSession, sendMessage, retryMessage, selectBranch, stopStreaming,
    setSessionData, setSessionLoading, clearSessionData, hasCachedSession,
  } = useChatStore()
  // 当前会话消息视图(活跃路径按分支选择派生,单一数据源在 sessionCache)
  const { messages, allMessages, loading: messagesLoading } = useSessionView()
  /** 会话列表加载中(首次进入):列表用占位而不是「暂无会话」 */
  const [sessionsLoading, setSessionsLoading] = useState(false)

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

  // ---- 待发送附件(图片显示缩略图,其余显示文件名) ----
  const [pendingFiles, setPendingFiles] = useState<{ file: File; preview?: string }[]>([])
  const [uploadingFiles, setUploadingFiles] = useState(false)
  // 拖拽文件到聊天框时的整块高亮
  const [dragOver, setDragOver] = useState(false)
  // 体积超限 / 上传失败等提示
  const [attachError, setAttachError] = useState('')
  const attachInputRef = useRef<HTMLInputElement>(null)

  // ---- 网络搜索开关 ----
  const [webSearchEnabled, setWebSearchEnabled] = useState(true)

  /**
   * 统一的「加入待发送内容」入口:选择 / 粘贴 / 拖拽共用。
   * 只做体积校验后挂进待发送列表 —— **不在这里发任何请求**(拖进来 ≠ 要发)。
   * csv/excel 是不是账单,在点「发送」时才由服务端识别,见 handleSend。
   */
  const addFiles = (files: File[]) => {
    if (files.length === 0) return
    const oversized = files.filter((f) => f.size > MAX_ATTACH_BYTES)
    const rest = files.filter((f) => f.size <= MAX_ATTACH_BYTES)
    setAttachError(oversized.length > 0 ? `${oversized.map((f) => f.name).join('、')} 超过 ${MAX_ATTACH_MB}MB，已跳过` : '')
    if (rest.length === 0) return
    setPendingFiles((prev) => [
      ...prev,
      ...rest.map((file) => ({
        file,
        preview: file.type.startsWith('image/') ? URL.createObjectURL(file) : undefined,
      })),
    ])
  }

  const handleAttachSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    addFiles(Array.from(e.target.files || []))
    e.target.value = '' // 允许重复选同一文件
  }

  /** 粘贴(截图直接 Ctrl+V):只认图片,纯文本粘贴走默认行为 */
  const handlePaste = (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const dt = e.clipboardData
    if (!dt) return
    // files 与 items 指向**同一批**文件,不能相加(会一张变两张);只有 files 为空时才回退 items
    const fromFiles = Array.from(dt.files || [])
    const files = fromFiles.length > 0
      ? fromFiles
      : Array.from(dt.items || [])
        .filter((it) => it.kind === 'file')
        .map((it) => it.getAsFile())
        .filter((f): f is File => !!f)
    const images = files.filter((f) => f.type.startsWith('image/'))
    if (images.length === 0) return
    e.preventDefault() // 有图就别把剪贴板里的文本也塞进输入框
    addFiles(images)
  }

  /** 拖拽文件到聊天框(整个窗口都是放置区) */
  const handleDragOver = (e: React.DragEvent) => {
    if (!currentBookId || isCurrentStreaming) return
    if (!Array.from(e.dataTransfer?.types || []).includes('Files')) return
    e.preventDefault()
    e.dataTransfer.dropEffect = 'copy'
    setDragOver(true)
  }
  const handleDragLeave = (e: React.DragEvent) => {
    // 进入子元素同样会触发 dragleave:只有真正离开容器才收起提示
    if (e.currentTarget.contains(e.relatedTarget as Node)) return
    setDragOver(false)
  }
  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault()
    setDragOver(false)
    if (!currentBookId || isCurrentStreaming) return
    addFiles(Array.from(e.dataTransfer?.files || []))
  }

  const removeFile = (index: number) => {
    setPendingFiles((prev) => {
      if (prev[index]?.preview) URL.revokeObjectURL(prev[index].preview as string)
      return prev.filter((_, i) => i !== index)
    })
  }

  // 初始化加载会话列表 + 工具名称缓存
  useEffect(() => {
    loadSessions()
    loadToolNames()
  }, [])

  const loadSessions = async () => {
    setSessionsLoading(true)
    try {
      const list = await fetchSessions()
      setSessions(list)
    } catch {
      // ignore
    } finally {
      setSessionsLoading(false)
    }
  }

  const handleSelectSession = async (id: string) => {
    setCurrentSession(id)

    // 优先从缓存恢复（保留后台流式进度）
    if (hasCachedSession(id)) return

    // 标记加载:聊天区显示占位,而不是切过去先白屏一下
    setSessionLoading(id, true)
    try {
      const msgs = await fetchMessages(id)
      const parsed = msgs.map((m) => {
        const blocks: MessageBlock[] = m.role === 'assistant'
          ? parseContentIntoBlocks(m.content || '', m.toolCalls)
          : (m.content?.trim() ? [{ id: `hist-0`, type: 'text' as const, content: m.content }] : [])
        // 推理模型的思考内容(独立字段):置顶为 thinking 块
        if (m.role === 'assistant' && m.reasoningContent) {
          blocks.unshift({ id: `hist-thinking-${m.id}`, type: 'thinking' as const, content: m.reasoningContent })
        }
        return {
          id: m.id,
          dbId: m.id,
          role: m.role as 'user' | 'assistant',
          blocks,
          parentMessageId: m.parentMessageId ?? undefined,
          // 恢复用户消息附件(服务端 URL,刷新/冷启动后仍可回显)
          ...(m.attachments?.length ? { attachments: m.attachments } : {}),
          // 历史回显也带上用量与注入信息(此前只映射附件,刷新后 Token 行与注入提示会消失)
          ...(m.usage ? { usage: m.usage } : {}),
          ...(m.injections?.length ? { injections: m.injections } : {}),
        }
      })
      setSessionData(id, parsed.length > 0 ? parsed : [greetingMsg])
    } catch {
      // 拉取失败:清掉占位条目,否则下次切回来会被 hasCachedSession 当成「已缓存」而不再拉取
      clearSessionData(id)
    } finally {
      // 失败也要撤 loading,否则聊天区永远停在占位上(条目已被清掉时是 no-op,见 store 内守卫)
      setSessionLoading(id, false)
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
      setSessionData(res.session.id, [greetingMsg])
    } catch {
      // ignore
    }
  }

  /** 待确认删除的会话:删除不可恢复,点垃圾桶先弹确认(对齐移动端抽屉) */
  const [deleteTarget, setDeleteTarget] = useState<ChatSession | null>(null)
  const askDeleteSession = (id: string) => setDeleteTarget(sessions.find((s) => s.id === id) ?? null)
  const confirmDeleteSession = async () => {
    const target = deleteTarget
    setDeleteTarget(null)
    if (target) await handleDeleteSession(target.id)
  }

  const handleDeleteSession = async (id: string) => {
    try {
      await deleteSessionApi(id)
      setSessions(sessions.filter((s) => s.id !== id))
      if (currentSessionId === id) {
        setCurrentSession(null)
        clearSessionData(id)
      }
    } catch {
      // ignore
    }
  }

  const handleSend = async (
    text?: string,
    preset?: { attachmentIds: string[]; attachments: { id: string; url: string; originalFilename: string }[] },
  ) => {
    const msg = (text || input).trim()
    const hasPreset = !!preset?.attachmentIds?.length
    if ((!msg && pendingFiles.length === 0 && !hasPreset) || !currentBookId || isCurrentStreaming) return
    setInput('')

    // 向前找最后一个有 dbId 的消息，避免把临时 msg-* ID 当作 parentId 发给后端
    let parentId: string | undefined
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].dbId) { parentId = messages[i].dbId; break }
    }

    // 附件一律当普通附件发出(模型只对图片做视觉直读,其余进附件清单)。
    // preset 是已经在别处上传好的附件(工具栏「导入账单」入口:账单文件先落成附件,再把 attachmentId 交给 AI)。
    let attachments: { id: string; url: string; originalFilename: string }[] | undefined = preset?.attachments
    let attachmentIds: string[] | undefined = preset?.attachmentIds
    if (pendingFiles.length > 0) {
      setUploadingFiles(true)
      try {
        const results = await Promise.all(
          pendingFiles.map((it) => recordApi.uploadAttachment(it.file)),
        )
        attachments = [...(attachments ?? []), ...results.map((r) => ({ id: r.id, url: r.url, originalFilename: r.originalFilename }))]
        attachmentIds = [...(attachmentIds ?? []), ...results.map((r) => r.id)]
        // 清理预览 URL
        pendingFiles.forEach((it) => { if (it.preview) URL.revokeObjectURL(it.preview) })
        setPendingFiles([])
      } catch {
        // 上传失败时仍发送消息（无附件）
      }
      setUploadingFiles(false)
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
      const res = await importExportApi.uploadImportFile(file)
      // 账单文件本身就是一个附件:把 attachmentId 一起发出去,AI 从附件清单取 id 调 preview_import。
      // 消息里只留一句自然语言请求(见 core buildImportMessage),不再往文本里编码任何 id。
      handleSend(buildImportMessage({ source: pendingSourceRef.current }), {
        attachmentIds: [res.attachmentId],
        attachments: [{ id: res.attachmentId, url: res.url, originalFilename: res.filename }],
      })
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

  // 按住消息列表/输入区工具行期间暂停流式增量刷新(见 stores/chat 顶部「流式增量刷新调度」):
  // 流式每 50ms 就会改变消息高度,DOM 位移会让 mousedown/mouseup 落在不同元素上 → click 丢失。
  // 恢复挂在 window 上:指针可能在容器外抬起,只监听容器内的 pointerup 会导致永久暂停。
  useEffect(() => {
    const resume = () => setStreamPaused(false)
    window.addEventListener('pointerup', resume)
    window.addEventListener('pointercancel', resume)
    return () => {
      window.removeEventListener('pointerup', resume)
      window.removeEventListener('pointercancel', resume)
    }
  }, [])

  return (
    // 高度交给父容器(flex-1 吃掉剩余空间)：不要设 min-h —— 有 overflow-hidden 的 flex 项
    // 自动最小尺寸本就是 0，设了 min-h 反而会把页面撑出滚动条（撑满应当是"当前屏幕内"）
    <div
      className="relative flex flex-1 rounded-xl border bg-card overflow-hidden"
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {/* 拖拽文件到聊天框:整块高亮提示(pointer-events-none 让 drop 仍落在容器上) */}
      {dragOver && (
        <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center rounded-xl border-2 border-dashed border-primary bg-primary/10">
          <div className="flex items-center gap-2 rounded-lg bg-card px-3 py-1.5 text-sm font-medium shadow-sm">
            <Paperclip size={16} className="text-primary" />
            松开即可添加附件
          </div>
        </div>
      )}
      {/* 桌面端左侧会话列表 */}
      {!isMobile && (
        <div className="w-52 border-r shrink-0">
          <SessionList
            sessions={sessions}
            currentId={currentSessionId}
            streamingSessionIds={streamingSessionIds}
            loading={sessionsLoading}
            onSelect={handleSelectSession}
            onCreate={handleCreateSession}
            onDelete={askDeleteSession}
          />
        </div>
      )}

      {/* 移动端会话抽屉 */}
      {isMobile && (
        <Sheet open={sessionOpen} onOpenChange={setSessionOpen}>
          <SheetContent side="left" className="w-72 p-0 [&>button]:hidden">
            <SheetHeader className="sr-only">
              <SheetTitle>会话列表</SheetTitle>
            </SheetHeader>
            <SessionList
              sessions={sessions}
              currentId={currentSessionId}
              streamingSessionIds={streamingSessionIds}
              loading={sessionsLoading}
              onSelect={(id) => { handleSelectSession(id); setSessionOpen(false) }}
              onCreate={() => { handleCreateSession(); setSessionOpen(false) }}
              onDelete={askDeleteSession}
            />
          </SheetContent>
        </Sheet>
      )}

      {/* 右侧聊天区 */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* 移动端顶部工具行 */}
        {isMobile && (
          <div className="flex items-center gap-2 border-b px-3 py-2 shrink-0">
            <Button variant="outline" size="icon" className="h-8 w-8" onClick={() => setSessionOpen(true)}>
              <Menu size={16} />
            </Button>
            <span className="text-sm font-medium flex-1 truncate">AI 助手</span>
            <Button variant="ghost" size="icon" className="h-8 w-8" onClick={handleCreateSession}>
              <Plus size={16} />
            </Button>
          </div>
        )}
        {/* 消息列表 */}
        <ScrollArea className="flex-1">
          <div ref={scrollRef} className="p-4 space-y-4" onPointerDown={() => setStreamPaused(true)}>
            {/* 历史消息加载中:切会话时先占位,避免先白屏一下再整块出现 */}
            {messagesLoading && messages.length === 0 && (
              <div className="flex items-center justify-center gap-2 py-16 text-sm text-muted-foreground">
                <Loader2 size={16} className="animate-spin" />
                正在加载聊天记录...
              </div>
            )}
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
          </div>
        </ScrollArea>

        {/* 输入区：主流聊天布局（输入框在上，工具栏在下） */}
        <div className="border-t p-3">
          {/* 已选附件(图片显示缩略图,其余显示文件名) */}
          {pendingFiles.length > 0 && (
            <div className="flex gap-2 mb-2 flex-wrap">
              {pendingFiles.map((item, i) => (
                <div key={i} className="relative">
                  {item.preview ? (
                    <div className="w-16 h-16 rounded-lg overflow-hidden border">
                      <img src={item.preview} alt="" className="w-full h-full object-cover" />
                    </div>
                  ) : (
                    <div className="h-16 max-w-[168px] rounded-lg border bg-muted/40 px-2 flex items-center gap-1.5">
                      <FileText size={14} className="text-muted-foreground shrink-0" />
                      <span className="text-xs truncate" title={item.file.name}>{item.file.name}</span>
                    </div>
                  )}
                  <button
                    className="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full bg-black/70 flex items-center justify-center"
                    onClick={() => removeFile(i)}
                    title="移除"
                  >
                    <X size={12} className="text-white" />
                  </button>
                </div>
              ))}
            </div>
          )}
          {attachError && <p className="text-xs text-red-500 mb-2">{attachError}</p>}
          {/* 隐藏文件上传(工具栏「导入账单」下拉:用户已显式指定来源,选完即发起导入) */}
          <input
            ref={fileInputRef}
            type="file"
            className="hidden"
            accept=".csv,.xls,.xlsx"
            onChange={handleFileChange}
          />
          {/* 任意文件(不限制类型):一律作为普通附件发送,不做账单识别 */}
          <input
            ref={attachInputRef}
            type="file"
            className="hidden"
            multiple
            onChange={handleAttachSelect}
          />
          {/* 输入框区域 */}
          <div className="rounded-2xl border bg-background focus-within:border-primary/40 focus-within:ring-1 focus-within:ring-primary/20 transition-colors">
            <Textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              onPaste={handlePaste}
              placeholder="输入消息... (Enter 发送，Shift+Enter 换行，可直接粘贴或拖拽文件)"
              rows={2}
              className="border-0 focus-visible:ring-0 focus-visible:ring-offset-0 resize-none px-4 py-3 min-h-[60px]"
              disabled={isCurrentStreaming || importing || uploadingFiles}
            />
            {/* 工具栏：工具按钮在左，发送在右（按住期间暂停流式刷新，避免按钮被 DOM 位移吞掉） */}
            <div className="flex items-center justify-between px-3 pb-2" onPointerDown={() => setStreamPaused(true)}>
              <div className="flex items-center gap-1">
                {/* 网络搜索开关 */}
                <button
                  type="button"
                  className={cn(
                    'inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium transition-colors',
                    webSearchEnabled
                      ? 'bg-primary text-primary-foreground shadow-sm'
                      : 'text-muted-foreground hover:bg-muted',
                  )}
                  onClick={() => setWebSearchEnabled(v => !v)}
                  title={webSearchEnabled ? '网络搜索已开启' : '网络搜索已关闭'}
                >
                  <Globe size={13} />
                  联网搜索
                </button>
                {/* 上传附件(任意文件;csv/excel 自动识别是否账单) */}
                <Button
                  size="icon"
                  variant="ghost"
                  className="h-7 w-7 text-muted-foreground hover:text-foreground"
                  disabled={!currentBookId || importing || uploadingFiles}
                  title={`上传附件（${MAX_ATTACH_MB}MB 以内，也可直接粘贴或拖拽）`}
                  onClick={() => attachInputRef.current?.click()}
                >
                  <Paperclip size={16} />
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
                  disabled={(!input.trim() && pendingFiles.length === 0) || !currentBookId || importing || uploadingFiles}
                  title="发送"
                >
                  <Send size={15} />
                </Button>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* 删除会话二次确认(聊天记录不可恢复;与移动端抽屉内的确认弹窗对齐) */}
      <AlertDialog open={!!deleteTarget} onOpenChange={() => setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>删除会话</AlertDialogTitle>
            <AlertDialogDescription>
              确定要删除「{deleteTarget?.title || '新对话'}」吗？该会话的聊天记录会一并删除，且不可恢复。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction className="bg-[#ef4444] hover:bg-[#dc2626]" onClick={confirmDeleteSession}>
              删除
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

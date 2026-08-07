import { create } from 'zustand'
import type { SSEEvent } from '../api/chat'
import { sendMessageStream, confirmActionStream, respondSuggestionStream, switchBookStream } from '../api/chat'
import { processTextDelta, type DeltaState } from './chat-content-parser'
import { buildActivePath, collectDescendantIds } from './chat-branch-utils'

// ---- 消息块类型 ----

export type MessageBlock =
  | { id: string; type: 'thinking'; content: string }
  | { id: string; type: 'text'; content: string }
  | ({ id: string; type: 'tool-call' } & ToolCallEntry)

export interface Message {
  id: string
  dbId?: string
  parentMessageId?: string
  role: 'user' | 'assistant'
  blocks: MessageBlock[]
  isStreaming?: boolean
  attachments?: { id: string; url: string; originalFilename: string }[]
  usage?: {
    inputTokens: number
    outputTokens: number
    totalTokens: number
    cachedInputTokens?: number
  }
}

export interface SuggestionOption {
  label?: string
  name?: string
  value?: string
  code?: string
  description?: string
}

export interface ToolCallEntry {
  toolCallId: string
  toolName: string
  args?: unknown
  result?: unknown
  durationMs?: number
  status: 'pending' | 'success' | 'error' | 'confirming' | 'suggesting' | 'switching'
  preview?: string
  suggestion?: { questions: { question: string; field: string; options: (string | SuggestionOption)[]; allowCustom: boolean }[] }
}

export interface ChatSession {
  id: string
  title: string
  modelProvider: string
  modelName: string
  updatedAt: string
}

interface SessionCache {
  messages: Message[]
  allMessages: Message[]
  branchSelections: Record<string, string>
  isStreaming: boolean
  streamingMessageId: string | null
}

interface ChatState {
  sessions: ChatSession[]
  currentSessionId: string | null
  messages: Message[]
  allMessages: Message[]
  branchSelections: Record<string, string>
  error: string | null
  abortControllers: Record<string, AbortController>
  sessionCache: Record<string, SessionCache>

  setSessions: (sessions: ChatSession[]) => void
  setCurrentSession: (sessionId: string | null) => void
  setMessages: (messages: Message[]) => void
  setError: (error: string | null) => void

  sendMessage: (accountBookId: string, message: string, parentMessageId?: string, replaceAssistantDbId?: string, attachmentIds?: string[], attachments?: { id: string; url: string; originalFilename: string }[], enableWebSearch?: boolean) => void
  confirmAndContinue: (accountBookId: string, toolCallId: string, approved: boolean, data?: Record<string, unknown>) => void
  respondToSuggestion: (accountBookId: string, toolCallId: string, values: Record<string, string> | null) => void
  switchBook: (accountBookId: string, toolCallId: string, bookId: string) => void
  retryMessage: (assistantMsgId: string) => void
  selectBranch: (parentMessageId: string, childMessageId: string) => void
  stopStreaming: (sessionId?: string) => void

  addMessage: (msg: Message) => void
  updateStreamMessage: (sessionId: string, messageId: string, updater: (msg: Message) => Message) => void
  saveCurrentToCache: () => void
  restoreFromCache: (sessionId: string) => boolean
}

let msgIdCounter = 0
function nextId() {
  return `msg-${Date.now()}-${++msgIdCounter}`
}

// ---- 共享 SSE 事件处理工厂 ----

type SSEStreamContext = {
  sid: string
  assistantMsgId: string
  parentMsgId?: string
  shouldGenerateTitle?: boolean
  get: () => ChatState
  set: (partial: Partial<ChatState> | ((s: ChatState) => Partial<ChatState>)) => void
  thinkState: { value: DeltaState }
  blockIdCounter: { value: number }
}

function makeSSEHandler(
  ctx: SSEStreamContext,
  onFinish: (event: Extract<SSEEvent, { type: 'finish' }>) => void,
) {
  const updateMsg = (updater: (msg: Message) => Message) => {
    ctx.get().updateStreamMessage(ctx.sid, ctx.assistantMsgId, updater)
  }

  // 更新 tool-result：同时更新当前消息和父消息（initialSSEEvents 场景），
  // 其中一个找不到对应 block 时自然成为 no-op
  const updateToolResult = (updater: (msg: Message) => Message) => {
    ctx.get().updateStreamMessage(ctx.sid, ctx.assistantMsgId, updater)
    if (ctx.parentMsgId) {
      ctx.get().updateStreamMessage(ctx.sid, ctx.parentMsgId, updater)
    }
  }

  const handleEvent = (event: SSEEvent) => {
    switch (event.type) {
      case 'text-delta':
        updateMsg((msg) => {
          const blocks = [...msg.blocks]
          ctx.thinkState.value = processTextDelta(event.delta, ctx.thinkState.value, blocks, ctx.blockIdCounter)
          return { ...msg, blocks }
        })
        break

      case 'tool-call':
        updateMsg((msg) => ({
          ...msg,
          blocks: [
            ...msg.blocks,
            {
              id: `block-${++ctx.blockIdCounter.value}`,
              type: 'tool-call' as const,
              toolCallId: event.toolCallId,
              toolName: event.toolName,
              args: event.args,
              status: 'pending' as const,
            },
          ],
        }))
        break

      case 'tool-result':
        updateToolResult((msg) => ({
          ...msg,
          blocks: msg.blocks.map((b) => {
            if (b.type === 'tool-call' && b.toolCallId === event.toolCallId) {
              if (event.merge?.action === 'append') {
                const existing = (b as any).result || {}
                const existingData = existing.data || {}
                const incomingData = (event.result as any)?.data || {}
                const mergedData: any = { ...existingData }
                for (const key of Object.keys(incomingData)) {
                  if (key === 'records' && Array.isArray(mergedData[key])) {
                    mergedData[key] = [...mergedData[key], ...incomingData[key]]
                  }
                }
                return { ...b, result: { ...existing, data: mergedData }, status: event.status as 'success' | 'error' }
              }
              return {
                ...b,
                result: event.result ?? (event.error ? { error: event.error } : undefined),
                durationMs: event.durationMs,
                status: (event.status === 'success' ? 'success' : 'error') as 'success' | 'error',
              }
            }
            return b
          }),
        }))
        break

      case 'tool-confirm-required':
        updateMsg((msg) => ({
          ...msg,
          blocks: msg.blocks.map((b) =>
            b.type === 'tool-call' && b.toolCallId === event.toolCallId
              ? { ...b, status: 'confirming' as const, preview: event.preview }
              : b,
          ),
        }))
        break

      case 'tool-suggest-required':
        updateMsg((msg) => ({
          ...msg,
          blocks: msg.blocks.map((b) =>
            b.type === 'tool-call' && b.toolCallId === event.toolCallId
              ? { ...b, status: 'suggesting' as const, suggestion: { questions: event.questions } }
              : b,
          ),
        }))
        break

      case 'tool-switch-book':
        updateMsg((msg) => ({
          ...msg,
          blocks: msg.blocks.map((b) =>
            b.type === 'tool-call' && b.toolCallId === event.toolCallId
              ? { ...b, status: 'switching' as const, result: { books: event.books, currentBookId: event.currentBookId } }
              : b,
          ),
        }))
        break

      case 'finish':
        updateMsg((msg) => {
          const usage = event.usage as Message['usage']
          return { ...msg, usage }
        })
        onFinish(event)
        break

      case 'error':
        updateMsg((msg) => ({
          ...msg,
          isStreaming: false,
          blocks: msg.blocks.length === 0
            ? [{ id: `block-${++ctx.blockIdCounter.value}`, type: 'text' as const, content: `错误: ${event.message}` }]
            : msg.blocks,
        }))
        ctx.set((s) => {
          const newCache = { ...s.sessionCache }
          const newAbortControllers = { ...s.abortControllers }
          delete newAbortControllers[ctx.sid]
          if (s.currentSessionId !== ctx.sid) {
            const cache = s.sessionCache[ctx.sid]
            if (cache) {
              newCache[ctx.sid] = { ...cache, isStreaming: false, streamingMessageId: null }
            }
            return { sessionCache: newCache, abortControllers: newAbortControllers, error: event.message }
          }
          newCache[ctx.sid] = { ...newCache[ctx.sid], isStreaming: false, streamingMessageId: null }
          return { sessionCache: newCache, abortControllers: newAbortControllers, error: event.message }
        })
        break
    }
  }

  const handleDone = () => {
    updateMsg((msg) => ({ ...msg, isStreaming: false }))
    ctx.set((s) => {
      const newAbortControllers = { ...s.abortControllers }
      delete newAbortControllers[ctx.sid]
      const newCache = { ...s.sessionCache }
      if (newCache[ctx.sid]) {
        newCache[ctx.sid] = { ...newCache[ctx.sid], isStreaming: false, streamingMessageId: null }
      }
      return { sessionCache: newCache, abortControllers: newAbortControllers }
    })

    const refreshSessions = () => {
      import('../api/chat').then(({ fetchSessions }) => {
        fetchSessions().then((sessions) => {
          ctx.set((s) => ({ sessions, currentSessionId: s.currentSessionId }))
        })
      })
    }

    // 第二轮对话完成后，或首条消息为纯图片（无文本）时，异步生成标题
    if (ctx.shouldGenerateTitle) {
      import('../api/chat').then(({ generateSessionTitle }) => {
        generateSessionTitle(ctx.sid).then(() => refreshSessions()).catch(() => refreshSessions())
      })
    } else {
      refreshSessions()
    }
  }

  return { handleEvent, handleDone }
}

// ---- Store ----

export const useChatStore = create<ChatState>()((set, get) => {
  // ---- 共享：创建续写助手消息并启动 SSE 流 ----
  function startContinuationStream(
    parentDbId: string,
    parentId: string,
    streamStarter: (handleEvent: (e: SSEEvent) => void, handleDone: () => void) => AbortController,
  ) {
    const state = get()
    const sid = state.currentSessionId!
    if (state.sessionCache[sid]?.isStreaming || state.abortControllers[sid]) return

    const continuationMsg: Message = {
      id: nextId(),
      role: 'assistant',
      blocks: [],
      isStreaming: true,
      parentMessageId: parentDbId,
    }
    const continuationMsgId = continuationMsg.id

    set((s) => {
      const newAllMessages = [...s.allMessages, continuationMsg]
      const newSelections = { ...s.branchSelections }
      newSelections[parentDbId] = continuationMsg.id
      const newCache = { ...s.sessionCache }
      newCache[sid] = {
        messages: buildActivePath(newAllMessages, newSelections),
        allMessages: newAllMessages,
        branchSelections: newSelections,
        isStreaming: true,
        streamingMessageId: continuationMsgId,
      }
      return {
        messages: buildActivePath(newAllMessages, newSelections),
        allMessages: newAllMessages,
        branchSelections: newSelections,
        sessionCache: newCache,
        error: null,
      }
    })

    const ctx: SSEStreamContext = {
      sid, assistantMsgId: continuationMsgId, parentMsgId: parentId,
      get, set,
      thinkState: { value: 'text' },
      blockIdCounter: { value: 0 },
    }

    const { handleEvent, handleDone } = makeSSEHandler(ctx, (event) => {
      set((s) => {
        const allMsgs = [...s.allMessages]
        const msgs = [...s.messages]
        const newSelections = { ...s.branchSelections }

        const asstAllIdx = allMsgs.findIndex((m) => m.id === continuationMsgId)
        if (asstAllIdx >= 0) {
          allMsgs[asstAllIdx] = { ...allMsgs[asstAllIdx], dbId: event.assistantMessageId, parentMessageId: event.userMessageId }
          const asstMsgIdx = msgs.findIndex((m) => m.id === continuationMsgId)
          if (asstMsgIdx >= 0) msgs[asstMsgIdx] = { ...msgs[asstMsgIdx], dbId: event.assistantMessageId, parentMessageId: event.userMessageId }
        }
        newSelections[event.userMessageId] = event.assistantMessageId

        const newCache = { ...s.sessionCache }
        newCache[sid] = { ...newCache[sid], isStreaming: false, streamingMessageId: null, messages: msgs, allMessages: allMsgs, branchSelections: newSelections }
        const newAbortControllers = { ...s.abortControllers }
        delete newAbortControllers[sid]
        return { messages: msgs, allMessages: allMsgs, branchSelections: newSelections, sessionCache: newCache, abortControllers: newAbortControllers }
      })
    })

    const controller = streamStarter(handleEvent, handleDone)
    set((s) => ({ abortControllers: { ...s.abortControllers, [sid]: controller } }))
  }

  return {
  sessions: [],
  currentSessionId: null,
  messages: [],
  allMessages: [],
  branchSelections: {},
  error: null,
  abortControllers: {},
  sessionCache: {},

  setSessions: (sessions) => set({ sessions }),
  setCurrentSession: (sessionId) => set({ currentSessionId: sessionId }),
  setMessages: (allMsgs) => {
    // 首次加载历史消息时，自动选择每个分支点的最新版本
    const selections: Record<string, string> = {}
    const childrenMap = new Map<string, Message[]>()
    for (const m of allMsgs) {
      const pid = m.parentMessageId
      if (pid) {
        if (!childrenMap.has(pid)) childrenMap.set(pid, [])
        childrenMap.get(pid)!.push(m)
      }
    }
    for (const [pid, children] of childrenMap) {
      if (children.length > 1) {
        selections[pid] = children[children.length - 1].dbId || children[children.length - 1].id
      }
    }
    set({
      allMessages: allMsgs,
      branchSelections: selections,
      messages: buildActivePath(allMsgs, selections),
    })
  },
  setError: (error) => set({ error }),

  addMessage: (msg) =>
    set((s) => ({
      allMessages: [...s.allMessages, msg],
      messages: [...s.messages, msg],
    })),

  updateStreamMessage: (sessionId, messageId, updater) =>
    set((s) => {
      // 后台流式：更新缓存中的消息
      if (s.currentSessionId !== sessionId) {
        const cache = s.sessionCache[sessionId]
        if (!cache) return {}
        const newCache = { ...s.sessionCache }
        const sessionData = { ...cache, allMessages: [...cache.allMessages], messages: [...cache.messages] }
        const allIdx = sessionData.allMessages.findIndex((m) => m.id === messageId)
        if (allIdx >= 0) sessionData.allMessages[allIdx] = updater(sessionData.allMessages[allIdx])
        const msgIdx = sessionData.messages.findIndex((m) => m.id === messageId)
        if (msgIdx >= 0) sessionData.messages[msgIdx] = updater(sessionData.messages[msgIdx])
        newCache[sessionId] = sessionData
        return { sessionCache: newCache }
      }

      // 前台流式：更新可见消息
      const msgs = [...s.messages]
      const allMsgs = [...s.allMessages]
      const allIdx = allMsgs.findIndex((m) => m.id === messageId)
      if (allIdx >= 0) allMsgs[allIdx] = updater(allMsgs[allIdx])
      const msgIdx = msgs.findIndex((m) => m.id === messageId)
      if (msgIdx >= 0) msgs[msgIdx] = updater(msgs[msgIdx])
      return { messages: msgs, allMessages: allMsgs }
    }),

  sendMessage: (accountBookId, message, parentMessageId, replaceAssistantDbId, attachmentIds, attachments, enableWebSearch) => {
    const state = get()
    const sid = state.currentSessionId
    if (!sid) return
    if (state.sessionCache[sid]?.isStreaming || state.abortControllers[sid]) return

    const userMsg: Message = {
      id: nextId(),
      role: 'user',
      blocks: message.trim() ? [{ id: nextId(), type: 'text', content: message }] : [],
      parentMessageId,
      attachments: attachments || undefined,
    }
    const assistantMsg: Message = {
      id: nextId(),
      role: 'assistant',
      blocks: [],
      isStreaming: true,
      parentMessageId: userMsg.id, // 临时关联，finish 时替换为 DB ID
    }
    const assistantMsgId = assistantMsg.id

    set((s) => {
      const newAllMessages = [...s.allMessages, userMsg, assistantMsg]
      const newSelections = { ...s.branchSelections }
      if (parentMessageId) {
        newSelections[parentMessageId] = userMsg.id
      }
      const newCache = { ...s.sessionCache }
      newCache[sid] = {
        messages: buildActivePath(newAllMessages, newSelections),
        allMessages: newAllMessages,
        branchSelections: newSelections,
        isStreaming: true,
        streamingMessageId: assistantMsgId,
      }
      return {
        messages: buildActivePath(newAllMessages, newSelections),
        allMessages: newAllMessages,
        branchSelections: newSelections,
        sessionCache: newCache,
        error: null,
      }
    })

    const existingUserMsgCount = state.allMessages.filter(m => m.role === 'user').length
    // 第二轮对话，或首轮无文本（纯图片）时需要 AI 生成标题
    const shouldGenerateTitle = existingUserMsgCount === 1 || (existingUserMsgCount === 0 && !message.trim())

    const ctx: SSEStreamContext = {
      sid, assistantMsgId,
      get, set,
      shouldGenerateTitle,
      thinkState: { value: 'text' },
      blockIdCounter: { value: 0 },
    }

    const { handleEvent, handleDone } = makeSSEHandler(ctx, (event) => {
      set((s) => {
        // 后台流式：更新缓存
        if (s.currentSessionId !== sid) {
          const cache = s.sessionCache[sid]
          if (!cache) return {}
          const newCache = { ...s.sessionCache }
          const sessionData = { ...cache, allMessages: [...cache.allMessages], messages: [...cache.messages], branchSelections: { ...cache.branchSelections } }

          const asstAllIdx = sessionData.allMessages.findIndex((m) => m.id === assistantMsgId)
          if (asstAllIdx >= 0) {
            const asst = sessionData.allMessages[asstAllIdx]
            const userTempId = asst.parentMessageId
            sessionData.allMessages[asstAllIdx] = { ...asst, dbId: event.assistantMessageId, parentMessageId: event.userMessageId, usage: event.usage as Message['usage'], isStreaming: false }
            const asstMsgIdx = sessionData.messages.findIndex((m) => m.id === assistantMsgId)
            if (asstMsgIdx >= 0) sessionData.messages[asstMsgIdx] = { ...sessionData.messages[asstMsgIdx], dbId: event.assistantMessageId, parentMessageId: event.userMessageId, usage: event.usage as Message['usage'], isStreaming: false }
            if (userTempId) {
              const userAllIdx = sessionData.allMessages.findIndex((m) => m.id === userTempId)
              if (userAllIdx >= 0 && !sessionData.allMessages[userAllIdx].dbId) {
                sessionData.allMessages[userAllIdx] = { ...sessionData.allMessages[userAllIdx], dbId: event.userMessageId }
                const userMsgIdx = sessionData.messages.findIndex((m) => m.id === userTempId)
                if (userMsgIdx >= 0) sessionData.messages[userMsgIdx] = { ...sessionData.messages[userMsgIdx], dbId: event.userMessageId }
                for (const key of Object.keys(sessionData.branchSelections)) {
                  if (sessionData.branchSelections[key] === userTempId) sessionData.branchSelections[key] = event.userMessageId
                }
              }
            }
          }
          sessionData.isStreaming = false
          sessionData.streamingMessageId = null
          newCache[sid] = sessionData
          const newAbortControllers = { ...s.abortControllers }
          delete newAbortControllers[sid]
          return { sessionCache: newCache, abortControllers: newAbortControllers }
        }

        // 前台流式：更新可见消息
        const allMsgs = [...s.allMessages]
        const msgs = [...s.messages]
        const newSelections = { ...s.branchSelections }

        const asstAllIdx = allMsgs.findIndex((m) => m.id === assistantMsgId)
        if (asstAllIdx >= 0) {
          const asst = allMsgs[asstAllIdx]
          const userTempId = asst.parentMessageId

          allMsgs[asstAllIdx] = { ...asst, dbId: event.assistantMessageId, parentMessageId: event.userMessageId }
          const asstMsgIdx = msgs.findIndex((m) => m.id === assistantMsgId)
          if (asstMsgIdx >= 0) msgs[asstMsgIdx] = { ...msgs[asstMsgIdx], dbId: event.assistantMessageId, parentMessageId: event.userMessageId }

          if (userTempId) {
            const userAllIdx = allMsgs.findIndex((m) => m.id === userTempId)
            if (userAllIdx >= 0 && !allMsgs[userAllIdx].dbId) {
              allMsgs[userAllIdx] = { ...allMsgs[userAllIdx], dbId: event.userMessageId }
              const userMsgIdx = msgs.findIndex((m) => m.id === userTempId)
              if (userMsgIdx >= 0) msgs[userMsgIdx] = { ...msgs[userMsgIdx], dbId: event.userMessageId }

              for (const key of Object.keys(newSelections)) {
                if (newSelections[key] === userTempId) {
                  newSelections[key] = event.userMessageId
                }
              }
            }
          }
        }
        const newCache = { ...s.sessionCache }
        newCache[sid] = { ...newCache[sid], isStreaming: false, streamingMessageId: null, messages: msgs, allMessages: allMsgs, branchSelections: newSelections }
        const newAbortControllers = { ...s.abortControllers }
        delete newAbortControllers[sid]
        return { messages: msgs, allMessages: allMsgs, branchSelections: newSelections, sessionCache: newCache, abortControllers: newAbortControllers }
      })
    })

    const controller = sendMessageStream(
      { sessionId: sid, accountBookId, message, parentMessageId, replaceAssistantDbId, attachmentIds, enableWebSearch },
      handleEvent,
      handleDone,
    )

    set((s) => ({ abortControllers: { ...s.abortControllers, [sid]: controller } }))
  },

  confirmAndContinue: (accountBookId, toolCallId, approved, data) => {
    const state = get()
    const sid = state.currentSessionId
    if (!sid) return

    const parentMsg = state.messages.find(m =>
      m.role === 'assistant' && m.blocks.some(b =>
        b.type === 'tool-call' && b.toolCallId === toolCallId
      )
    )
    const parentDbId = parentMsg?.dbId
    if (!parentDbId) return
    const parentId = parentMsg!.id

    // 标记当前块为已决定（清除 preview 避免 effectiveStatus 误判为过期确认）
    // approved 时保留旧 result，避免 SSE tool-result 到达前被误判为"数据已过期"
    const newDecidedStatus = approved ? 'pending' as const : 'error' as const
    get().updateStreamMessage(sid, parentId, (msg) => ({
      ...msg,
      blocks: msg.blocks.map((b) =>
        b.type === 'tool-call' && b.toolCallId === toolCallId
          ? { ...b, status: newDecidedStatus, preview: undefined, ...(approved ? {} : { result: { error: '用户拒绝了此操作' } as any }) }
          : b,
      ),
    }))

    // 检查同一消息中所有确认块是否都已决定
    // 只收集需要确认的块（confirming=待确认 / pending=刚确认 / error=刚拒绝），
    // 排除 status='success' 的纯查询工具（如 preview_import 的 analyze 模式），避免误入 decisions
    const updatedMsg = get().messages.find(m => m.id === parentId)
    const allConfirming = (updatedMsg?.blocks.filter(b =>
      b.type === 'tool-call' && (b.status === 'confirming' || b.status === 'pending' || b.status === 'error')
    ) || []) as Extract<MessageBlock, { type: 'tool-call' }>[]
    const stillConfirming = allConfirming.filter(b => b.status === 'confirming')

    if (stillConfirming.length > 0) return // 等待其他块决定

    // 全部决定，收集 decisions
    const decisions = allConfirming.map(b => ({
      toolCallId: b.toolCallId,
      approved: b.status !== 'error',
      ...(data ? { data } : {}),
    }))

    startContinuationStream(
      parentDbId, parentId,
      (handleEvent, handleDone) => confirmActionStream(
        { decisions, accountBookId, sessionId: sid },
        handleEvent, handleDone,
      ),
    )
  },

  respondToSuggestion: (accountBookId, toolCallId, values) => {
    const state = get()
    const sid = state.currentSessionId
    if (!sid) return

    const parentMsg = state.messages.find(m =>
      m.role === 'assistant' && m.blocks.some(b =>
        b.type === 'tool-call' && b.toolCallId === toolCallId
      )
    )
    const parentDbId = parentMsg?.dbId
    if (!parentDbId) return
    const parentId = parentMsg!.id

    // 取消选择：本地更新状态（fire-and-forget）
    if (values === null) {
      get().updateStreamMessage(sid, parentId, (msg) => ({
        ...msg,
        blocks: msg.blocks.map((b) =>
          b.type === 'tool-call' && b.toolCallId === toolCallId
            ? { ...b, status: 'error' as const, result: { error: '用户取消了选择' } }
            : b,
        ),
      }))
      respondSuggestionStream({ toolCallId, values: null, accountBookId, sessionId: sid }, () => {}, () => {})
      return
    }

    startContinuationStream(
      parentDbId, parentId,
      (handleEvent, handleDone) => respondSuggestionStream(
        { toolCallId, values, accountBookId, sessionId: sid },
        handleEvent, handleDone,
      ),
    )
  },

  switchBook: (toolCallId, bookId) => {
    const state = get()
    const sid = state.currentSessionId
    if (!sid) return

    const parentMsg = state.messages.find(m =>
      m.role === 'assistant' && m.blocks.some(b =>
        b.type === 'tool-call' && b.toolCallId === toolCallId
      )
    )
    const parentDbId = parentMsg?.dbId
    if (!parentDbId) return
    const parentId = parentMsg!.id

    startContinuationStream(
      parentDbId, parentId,
      (handleEvent, handleDone) => switchBookStream(
        { toolCallId, bookId },
        handleEvent, handleDone,
      ),
    )
  },

  retryMessage: (assistantMsgId) => {
    const state = get()
    const sid = state.currentSessionId
    if (sid && state.sessionCache[sid]?.isStreaming) return

    const idx = state.messages.findIndex((m) => m.id === assistantMsgId)
    if (idx <= 0) return
    const prevUserMsg = state.messages[idx - 1]
    if (prevUserMsg.role !== 'user') return

    const text = prevUserMsg.blocks
      .filter((b) => b.type === 'text')
      .map((b) => b.content)
      .join('\n')
    if (!text) return

    const assistantDbId = state.messages[idx].dbId || state.messages[idx].id

    // 从 allMessages 中删除被替换的助手消息及其所有后代
    const descendantIds = collectDescendantIds(state.allMessages, assistantDbId)
    const newAllMessages = state.allMessages.filter(
      (m) => !descendantIds.has(m.dbId || m.id) && (m.dbId || m.id) !== assistantDbId,
    )
    // 也删除原用户消息
    const userMsgId = prevUserMsg.dbId || prevUserMsg.id
    const filteredAllMessages = newAllMessages.filter((m) => (m.dbId || m.id) !== userMsgId)

    // 截断活跃路径
    const newMessages = state.messages.slice(0, idx - 1)

    set({
      messages: newMessages,
      allMessages: filteredAllMessages,
    })

    // 注意：实际发送由 ChatWindow.handleRetry 调用 sendMessage 完成
  },

  selectBranch: (parentId, childId) => {
    set((s) => {
      const newSelections = { ...s.branchSelections, [parentId]: childId }
      return {
        branchSelections: newSelections,
        messages: buildActivePath(s.allMessages, newSelections),
      }
    })
  },

  stopStreaming: (sessionId) => {
    const sid = sessionId || get().currentSessionId
    if (!sid) return
    const controller = get().abortControllers[sid]
    if (controller) {
      controller.abort()
      set((s) => {
        const newAbortControllers = { ...s.abortControllers }
        delete newAbortControllers[sid]
        const newCache = { ...s.sessionCache }
        if (newCache[sid]) {
          newCache[sid] = { ...newCache[sid], isStreaming: false, streamingMessageId: null }
        }
        return { sessionCache: newCache, abortControllers: newAbortControllers }
      })
    }
  },

  saveCurrentToCache: () => {
    const { currentSessionId, messages, allMessages, branchSelections, sessionCache } = get()
    if (!currentSessionId) return
    // 流状态已在 sessionCache 中正确维护，直接沿用
    const existing = sessionCache[currentSessionId]
    set((s) => ({
      sessionCache: {
        ...s.sessionCache,
        [currentSessionId]: {
          messages: [...messages],
          allMessages: [...allMessages],
          branchSelections: { ...branchSelections },
          isStreaming: existing?.isStreaming ?? false,
          streamingMessageId: existing?.streamingMessageId ?? null,
        },
      },
    }))
  },

  restoreFromCache: (sessionId: string) => {
    const cache = get().sessionCache[sessionId]
    if (!cache) return false
    set({
      messages: cache.messages,
      allMessages: cache.allMessages,
      branchSelections: cache.branchSelections,
    })
    return true
  },
  }
})

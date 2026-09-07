import { useMemo } from 'react'
import { create } from 'zustand'
import {
  buildActivePath,
  collectDescendantIds,
  processTextDelta,
  type DeltaState,
  type Message,
  type MessageBlock,
  type SuggestionOption,
  type ToolCallEntry,
} from '@homibook/core'
import type { SSEEvent } from '../api/chat'
import { sendMessageStream, confirmActionStream } from '../api/chat'

// ---- 消息块类型 ----
// 权威定义在 @homibook/core(与 mobile 共享),此处 re-export 供组件引用
export type { Message, MessageBlock, SuggestionOption, ToolCallEntry }

export interface ChatSession {
  id: string
  title: string
  modelProvider: string
  modelName: string
  updatedAt: string
}

/**
 * 单会话持久态(权威):allMessages 为全部消息,活跃路径按 branchSelections 派生。
 * 当前会话视图由 useSessionView / getSessionView 派生,不设顶层副本 —— 切换会话无需保存/恢复。
 */
interface SessionData {
  allMessages: Message[]
  branchSelections: Record<string, string>
  isStreaming: boolean
  streamingMessageId: string | null
}

interface ChatState {
  sessions: ChatSession[]
  currentSessionId: string | null
  sessionCache: Record<string, SessionData>
  error: string | null
  abortControllers: Record<string, AbortController>

  setSessions: (sessions: ChatSession[]) => void
  setCurrentSession: (sessionId: string | null) => void
  setError: (error: string | null) => void

  /** 兼容接口:写入会话全量消息(自动重建分支选择),取代原 setMessages */
  setSessionData: (sessionId: string, allMessages: Message[]) => void
  /** 兼容接口:清空指定会话数据 */
  clearSessionData: (sessionId: string) => void
  /** 兼容查询:会话是否有本地缓存(有则切换时不必重新拉取) */
  hasCachedSession: (sessionId: string) => boolean

  sendMessage: (accountBookId: string, message: string, parentMessageId?: string, replaceAssistantDbId?: string, attachmentIds?: string[], attachments?: { id: string; url: string; originalFilename: string }[], enableWebSearch?: boolean) => void
  confirmAndContinue: (accountBookId: string, toolCallId: string, approved: boolean, data?: Record<string, unknown>) => void
  respondToSuggestion: (accountBookId: string, toolCallId: string, values: Record<string, string> | null) => void
  switchBook: (accountBookId: string, toolCallId: string, bookId: string) => void
  retryMessage: (assistantMsgId: string) => void
  selectBranch: (parentMessageId: string, childMessageId: string) => void
  stopStreaming: (sessionId?: string) => void

  updateStreamMessage: (sessionId: string, messageId: string, updater: (msg: Message) => Message) => void
}

let msgIdCounter = 0
function nextId() {
  return `msg-${Date.now()}-${++msgIdCounter}`
}

const EMPTY_SESSION: SessionData = { allMessages: [], branchSelections: {}, isStreaming: false, streamingMessageId: null }

type SetState = (partial: Partial<ChatState> | ((s: ChatState) => Partial<ChatState>)) => void
type GetState = () => ChatState

// ---- 共享:当前会话视图与统一写入口 ----

/** 当前会话视图(活跃路径 + 全量 + 分支选择),store 内部逻辑共用 */
function viewOf(data: SessionData) {
  return {
    messages: buildActivePath(data.allMessages, data.branchSelections),
    allMessages: data.allMessages,
    branchSelections: data.branchSelections,
  }
}

/** 统一写入口:不可变更新指定会话的数据切片 */
function patchSession(set: SetState, sid: string, fn: (d: SessionData) => Partial<SessionData>) {
  set((s) => {
    const current = s.sessionCache[sid] ?? EMPTY_SESSION
    return { sessionCache: { ...s.sessionCache, [sid]: { ...current, ...fn(current) } } }
  })
}

/** 清理会话的流式状态并移除中止控制器(流结束/出错/手动停止共用) */
function clearStreaming(set: SetState, sid: string) {
  set((s) => {
    const newAbortControllers = { ...s.abortControllers }
    delete newAbortControllers[sid]
    const newCache = { ...s.sessionCache }
    if (newCache[sid]) newCache[sid] = { ...newCache[sid], isStreaming: false, streamingMessageId: null }
    return { sessionCache: newCache, abortControllers: newAbortControllers }
  })
}

/** 把临时消息追加进会话(可选:登记分支选择 parentId → childId)并进入流式状态 */
function appendStreamingMessages(
  set: SetState,
  sid: string,
  msgs: Message[],
  streamingMessageId: string,
  select?: { parentId: string; childId: string },
) {
  patchSession(set, sid, (d) => {
    const allMessages = [...d.allMessages, ...msgs]
    let branchSelections = d.branchSelections
    if (select) {
      branchSelections = { ...branchSelections, [select.parentId]: select.childId }
    }
    return { allMessages, branchSelections, isStreaming: true, streamingMessageId }
  })
  set({ error: null })
}

// ---- 共享 SSE 事件处理工厂 ----

type SSEStreamContext = {
  sid: string
  assistantMsgId: string
  parentMsgId?: string
  shouldGenerateTitle?: boolean
  get: GetState
  set: SetState
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
        clearStreaming(ctx.set, ctx.sid)
        ctx.set({ error: event.message })
        break
    }
  }

  const handleDone = () => {
    updateMsg((msg) => ({ ...msg, isStreaming: false }))
    clearStreaming(ctx.set, ctx.sid)

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

/**
 * finish 后的统一收尾:把临时 id 替换为数据库 id(assistant + 尚无 dbId 的 user),
 * 同步 branchSelections 中指向旧临时 id 的选择,并清理流式状态。
 * sendMessage / 确认续流共用此唯一实现。
 */
function applyFinishPatch(
  set: SetState,
  sid: string,
  assistantMsgId: string,
  event: Extract<SSEEvent, { type: 'finish' }>,
  opts?: { selectNewBranch?: boolean },
) {
  patchSession(set, sid, (d) => {
    const allMessages = [...d.allMessages]
    let branchSelections = d.branchSelections
    const asstIdx = allMessages.findIndex((m) => m.id === assistantMsgId)
    if (asstIdx >= 0) {
      const asst = allMessages[asstIdx]
      const userTempId = asst.parentMessageId
      allMessages[asstIdx] = { ...asst, dbId: event.assistantMessageId, parentMessageId: event.userMessageId, isStreaming: false }
      if (userTempId) {
        const userIdx = allMessages.findIndex((m) => m.id === userTempId)
        if (userIdx >= 0 && !allMessages[userIdx].dbId) {
          allMessages[userIdx] = { ...allMessages[userIdx], dbId: event.userMessageId }
          const replaced: Record<string, string> = {}
          for (const [k, v] of Object.entries(branchSelections)) {
            replaced[k] = v === userTempId ? event.userMessageId : v
          }
          branchSelections = replaced
        }
      }
    }
    if (opts?.selectNewBranch) {
      branchSelections = { ...branchSelections, [event.userMessageId]: event.assistantMessageId }
    }
    return { allMessages, branchSelections }
  })
  clearStreaming(set, sid)
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

    appendStreamingMessages(set, sid, [continuationMsg], continuationMsgId, { parentId: parentDbId, childId: continuationMsgId })

    const ctx: SSEStreamContext = {
      sid, assistantMsgId: continuationMsgId, parentMsgId: parentId,
      get, set,
      thinkState: { value: 'text' },
      blockIdCounter: { value: 0 },
    }

    const { handleEvent, handleDone } = makeSSEHandler(ctx, (event) => {
      // 续流完成:登记新分支选择(原实现特有),id 替换与流式清理走统一收尾
      applyFinishPatch(set, sid, continuationMsgId, event, { selectNewBranch: true })
    })

    const controller = streamStarter(handleEvent, handleDone)
    set((s) => ({ abortControllers: { ...s.abortControllers, [sid]: controller } }))
  }

  /**
   * 工具决定的统一入口（覆盖全部工具：普通确认/导入/建议选项/切换账本）。
   * 同一 assistant 消息内存在待决定块（confirming/suggesting/switching）时等待，
   * 全部决定后把 decisions（含各自暂存的 decisionData）统一提交给 /confirm 续流。
   */
  function decideTool(
    accountBookId: string,
    toolCallId: string,
    approved: boolean,
    data?: Record<string, unknown>,
  ) {
    const sid = get().currentSessionId
    if (!sid) return

    const view = viewOf(get().sessionCache[sid] ?? EMPTY_SESSION)
    const parentMsg = view.messages.find(m =>
      m.role === 'assistant' && m.blocks.some(b =>
        b.type === 'tool-call' && b.toolCallId === toolCallId
      )
    )
    const parentDbId = parentMsg?.dbId
    if (!parentDbId) return
    const parentId = parentMsg!.id

    // 标记当前块为已决定：批准 → pending（保留旧 result，避免 SSE tool-result 到达前被误判为"数据已过期"）
    // 并暂存 decisionData，提交时各 decision 携带自己的 data
    get().updateStreamMessage(sid, parentId, (msg) => ({
      ...msg,
      blocks: msg.blocks.map((b) =>
        b.type === 'tool-call' && b.toolCallId === toolCallId
          ? {
              ...b,
              status: approved ? 'pending' as const : 'error' as const,
              preview: undefined,
              decisionData: data,
              ...(approved ? {} : { result: { error: '用户拒绝了此操作' } as any }),
            }
          : b,
      ),
    }))

    // 待决定块仍在 → 等待（confirming/suggesting/switching = 等待用户决定）
    const updatedView = viewOf(get().sessionCache[sid] ?? EMPTY_SESSION)
    const updatedMsg = updatedView.messages.find(m => m.id === parentId)
    const awaiting = (updatedMsg?.blocks.filter(b =>
      b.type === 'tool-call' && (b.status === 'confirming' || b.status === 'suggesting' || b.status === 'switching')
    ) || []) as Extract<MessageBlock, { type: 'tool-call' }>[]
    if (awaiting.length > 0) return

    // 全部决定，收集已决定块（pending=刚批准 / error=刚拒绝），各 decision 带自己的 decisionData
    const decidedBlocks = (updatedMsg?.blocks.filter(b =>
      b.type === 'tool-call' && (b.status === 'pending' || b.status === 'error')
    ) || []) as Extract<MessageBlock, { type: 'tool-call' }>[]
    if (decidedBlocks.length === 0) return

    const decisions = decidedBlocks.map(b => ({
      toolCallId: b.toolCallId,
      approved: b.status !== 'error',
      ...(b.decisionData ? { data: b.decisionData } : {}),
    }))

    startContinuationStream(
      parentDbId, parentId,
      (handleEvent, handleDone) => confirmActionStream(
        { decisions, accountBookId, sessionId: sid },
        handleEvent, handleDone,
      ),
    )
  }

  return {
  sessions: [],
  currentSessionId: null,
  sessionCache: {},
  error: null,
  abortControllers: {},

  setSessions: (sessions) => set({ sessions }),
  setCurrentSession: (sessionId) => set({ currentSessionId: sessionId }),
  setError: (error) => set({ error }),

  setSessionData: (sessionId, allMessages) => {
    // 首次加载历史消息时，自动选择每个分支点的最新版本
    const selections: Record<string, string> = {}
    const childrenMap = new Map<string, Message[]>()
    for (const m of allMessages) {
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
    set((s) => ({
      sessionCache: { ...s.sessionCache, [sessionId]: { allMessages, branchSelections: selections, isStreaming: false, streamingMessageId: null } },
    }))
  },

  clearSessionData: (sessionId) => {
    set((s) => {
      const newCache = { ...s.sessionCache }
      delete newCache[sessionId]
      return { sessionCache: newCache }
    })
  },

  hasCachedSession: (sessionId) => !!get().sessionCache[sessionId],

  updateStreamMessage: (sessionId, messageId, updater) =>
    set((s) => {
      const cache = s.sessionCache[sessionId]
      if (!cache) return {}
      const allMessages = [...cache.allMessages]
      const idx = allMessages.findIndex((m) => m.id === messageId)
      if (idx < 0) return {}
      allMessages[idx] = updater(allMessages[idx])
      return { sessionCache: { ...s.sessionCache, [sessionId]: { ...cache, allMessages } } }
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

    appendStreamingMessages(set, sid, [userMsg, assistantMsg], assistantMsgId, parentMessageId ? { parentId: parentMessageId, childId: userMsg.id } : undefined)

    const existingUserMsgCount = state.sessionCache[sid]?.allMessages.filter(m => m.role === 'user').length ?? 0
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
      applyFinishPatch(set, sid, assistantMsgId, event)
    })

    const controller = sendMessageStream(
      { sessionId: sid, accountBookId, message, parentMessageId, replaceAssistantDbId, attachmentIds, enableWebSearch },
      handleEvent,
      handleDone,
    )

    set((s) => ({ abortControllers: { ...s.abortControllers, [sid]: controller } }))
  },

  confirmAndContinue: (accountBookId, toolCallId, approved, data) => {
    decideTool(accountBookId, toolCallId, approved, data)
  },

  respondToSuggestion: (accountBookId, toolCallId, values) => {
    // 取消 = 拒绝决定；选择 = 批准并携带 values，统一走 /confirm 批量决策
    decideTool(accountBookId, toolCallId, values !== null, values !== null ? { values } : undefined)
  },

  switchBook: (accountBookId, toolCallId, bookId) => {
    decideTool(accountBookId, toolCallId, true, { bookId })
  },

  retryMessage: (assistantMsgId) => {
    const state = get()
    const sid = state.currentSessionId
    if (!sid || state.sessionCache[sid]?.isStreaming) return

    const view = viewOf(state.sessionCache[sid] ?? EMPTY_SESSION)
    const idx = view.messages.findIndex((m) => m.id === assistantMsgId)
    if (idx <= 0) return
    const prevUserMsg = view.messages[idx - 1]
    if (prevUserMsg.role !== 'user') return

    const text = prevUserMsg.blocks
      .filter((b) => b.type === 'text')
      .map((b) => b.content)
      .join('\n')
    if (!text) return

    const assistantDbId = view.messages[idx].dbId || view.messages[idx].id

    // 从 allMessages 中删除被替换的助手消息及其所有后代,也删除原用户消息
    const descendantIds = collectDescendantIds(view.allMessages, assistantDbId)
    const newAllMessages = view.allMessages.filter(
      (m) => !descendantIds.has(m.dbId || m.id) && (m.dbId || m.id) !== assistantDbId,
    )
    const userMsgId = prevUserMsg.dbId || prevUserMsg.id
    const filteredAllMessages = newAllMessages.filter((m) => (m.dbId || m.id) !== userMsgId)

    patchSession(set, sid, () => ({ allMessages: filteredAllMessages }))

    // 注意：实际发送由 ChatWindow.handleRetry 调用 sendMessage 完成
  },

  selectBranch: (parentId, childId) => {
    const sid = get().currentSessionId
    if (!sid) return
    patchSession(set, sid, (d) => ({ branchSelections: { ...d.branchSelections, [parentId]: childId } }))
  },

  stopStreaming: (sessionId) => {
    const sid = sessionId || get().currentSessionId
    if (!sid) return
    const controller = get().abortControllers[sid]
    if (controller) {
      controller.abort()
      clearStreaming(set, sid)
    }
  },
  }
})

/** 当前会话视图:messages 为按分支选择派生的活跃路径(allMessages 为权威全量)。组件响应式消费 */
export function useSessionView() {
  const sid = useChatStore((s) => s.currentSessionId)
  const data = useChatStore((s) => (sid ? s.sessionCache[sid] : undefined))
  return useMemo(
    () => (data ? viewOf(data) : { messages: [], allMessages: [], branchSelections: {} }),
    [data],
  )
}

/** 非 hook 场景(getState 式)读取当前会话视图 */
export function getSessionView() {
  const s = useChatStore.getState()
  const data = s.currentSessionId ? s.sessionCache[s.currentSessionId] : undefined
  return data ? viewOf(data) : { messages: [], allMessages: [], branchSelections: {} }
}

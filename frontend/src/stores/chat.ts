import { create } from 'zustand'
import type { SSEEvent } from '../api/chat'
import { sendMessageStream } from '../api/chat'

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
  usage?: {
    inputTokens: number
    outputTokens: number
    totalTokens: number
    cachedInputTokens?: number
  }
}

export interface ToolCallEntry {
  toolCallId: string
  toolName: string
  args?: unknown
  result?: unknown
  durationMs?: number
  status: 'pending' | 'success' | 'error' | 'confirming' | 'suggesting'
  preview?: string
  suggestion?: { questions: { question: string; field: string; options: string[]; allowCustom: boolean }[] }
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
  isStreaming: boolean
  streamingMessageId: string | null
  streamSessionId: string | null
  error: string | null
  abortController: AbortController | null
  sessionCache: Record<string, SessionCache>

  setSessions: (sessions: ChatSession[]) => void
  setCurrentSession: (sessionId: string | null) => void
  setMessages: (messages: Message[]) => void
  setError: (error: string | null) => void

  sendMessage: (accountBookId: string, message: string, parentMessageId?: string, replaceAssistantDbId?: string) => void
  retryMessage: (assistantMsgId: string) => void
  selectBranch: (parentMessageId: string, childMessageId: string) => void
  stopStreaming: () => void

  addMessage: (msg: Message) => void
  updateLastAssistant: (updater: (msg: Message) => Message) => void
  saveCurrentToCache: () => void
  restoreFromCache: (sessionId: string) => boolean
}

let msgIdCounter = 0
function nextId() {
  return `msg-${Date.now()}-${++msgIdCounter}`
}

// ---- 辅助函数 ----

/** 从历史消息原始字符串解析出 blocks，同时过滤XML 标签。按 textOffset 交错插入工具调用 */
export function parseContentIntoBlocks(raw: string, storedToolCalls?: string): MessageBlock[] {
  // 解析存储的工具调用
  interface StoredToolCall extends ToolCallEntry {
    textOffset: number
  }
  let toolCalls: StoredToolCall[] = []
  if (storedToolCalls) {
    try {
      toolCalls = JSON.parse(storedToolCalls)
      toolCalls.sort((a, b) => a.textOffset - b.textOffset)
    } catch { /* JSON 解析失败则忽略 */ }
  }

  const blocks: MessageBlock[] = []
  let idCounter = 0
  let lastOffset = 0

  for (const tc of toolCalls) {
    // 解析此工具调用之前的文本段
    const segment = raw.slice(lastOffset, tc.textOffset)
    const { blocks: segBlocks, nextId } = parseTextSegment(segment, idCounter)
    idCounter = nextId
    for (const b of segBlocks) blocks.push(b)

    // 插入工具调用 block（去除 textOffset 字段）
    const { textOffset: _, ...entry } = tc
    blocks.push({ id: `hist-${idCounter++}`, type: 'tool-call' as const, ...entry })

    lastOffset = tc.textOffset
  }

  // 解析剩余文本
  const remaining = raw.slice(lastOffset)
  const { blocks: segBlocks } = parseTextSegment(remaining, idCounter)
  for (const b of segBlocks) blocks.push(b)

  return blocks
}

/** 解析一段文本：提取 <think> 块 */
function parseTextSegment(
  text: string,
  startId: number,
): { blocks: MessageBlock[]; nextId: number } {
  const blocks: MessageBlock[] = []
  let idCounter = startId
  const regex = /<think>([\s\S]*?)<\/think>/g
  let lastIndex = 0
  let match: RegExpExecArray | null

  while ((match = regex.exec(text)) !== null) {
    const textBefore = text.slice(lastIndex, match.index)
    if (textBefore.trim()) blocks.push({ id: `hist-${idCounter++}`, type: 'text', content: textBefore })
    const thinkContent = match[1].trim()
    if (thinkContent) blocks.push({ id: `hist-${idCounter++}`, type: 'thinking', content: thinkContent })
    lastIndex = match.index + match[0].length
  }

  const textAfter = text.slice(lastIndex)
  if (textAfter.trim()) blocks.push({ id: `hist-${idCounter++}`, type: 'text', content: textAfter })

  return { blocks, nextId: idCounter }
}

/** 追加文本到最后一个同类型 block，或创建新 block。兜底去除可能遗漏的 think 标签 */
function appendTextToBlocks(
  blocks: MessageBlock[],
  type: 'text' | 'thinking',
  content: string,
  idCounter: { value: number },
) {
  if (!content) return
  // 兜底：去除任何可能泄漏的 think 标签
  const clean = content.replace(/<\/?think>/g, '')
  if (!clean) return
  const last = blocks[blocks.length - 1]
  if (last && last.type === type) {
    blocks[blocks.length - 1] = {
      ...last,
      content: (last as { content: string }).content + clean,
    } as MessageBlock
  } else if (clean.trim()) {
    blocks.push({ id: `block-${++idCounter.value}`, type, content: clean } as MessageBlock)
  }
}

/** text-delta 状态机：仅处理 <think>/</think> 边界。tool-call 由 SSE 事件层处理 */
type DeltaState = 'text' | 'thinking'

function processTextDelta(
  delta: string,
  thinkState: DeltaState,
  blocks: MessageBlock[],
  idCounter: { value: number },
): DeltaState {
  let state = thinkState
  let remaining = delta

  while (remaining.length > 0) {
    if (state === 'thinking') {
      const closeIdx = remaining.indexOf('</think>')

      if (closeIdx === -1) {
        appendTextToBlocks(blocks, 'thinking', remaining, idCounter)
        remaining = ''
      } else {
        if (closeIdx > 0) appendTextToBlocks(blocks, 'thinking', remaining.slice(0, closeIdx), idCounter)
        remaining = remaining.slice(closeIdx + 8) // skip </think>
        state = 'text'
      }
    } else {
      // state === 'text'：同时检查 <think> 和 </think>，取先出现的
      const openIdx = remaining.indexOf('<think>')
      const closeIdx = remaining.indexOf('</think>')

      if (openIdx === -1 && closeIdx === -1) {
        appendTextToBlocks(blocks, 'text', remaining, idCounter)
        remaining = ''
      } else if (closeIdx !== -1 && (openIdx === -1 || closeIdx < openIdx)) {
        // </think> 先出现 → 错过了开始标签，前方内容是思考内容
        if (closeIdx > 0) appendTextToBlocks(blocks, 'thinking', remaining.slice(0, closeIdx), idCounter)
        remaining = remaining.slice(closeIdx + 8)
        state = 'text'
      } else {
        // <think> 先出现 → 正常进入思考状态
        if (openIdx > 0) appendTextToBlocks(blocks, 'text', remaining.slice(0, openIdx), idCounter)
        remaining = remaining.slice(openIdx + 7) // skip <think>
        state = 'thinking'
      }
    }
  }
  return state
}

// ---- 分支管理 ----

/** 从 allMessages + branchSelections 构建当前活跃路径 */
function buildActivePath(allMessages: Message[], branchSelections: Record<string, string>): Message[] {
  const path: Message[] = []
  if (allMessages.length === 0) return path

  // id → message 映射（同时支持 dbId 和临时 id）
  const byId = new Map<string, Message>()
  for (const m of allMessages) {
    byId.set(m.id, m)
    if (m.dbId) byId.set(m.dbId, m)
  }

  // 找根消息（parentMessageId 为 null 或父节点不在集合中）
  let current = allMessages.find((m) => !m.parentMessageId || !byId.has(m.parentMessageId))
  while (current) {
    path.push(current)
    const currentId = current.dbId || current.id

    // 查找子消息
    const children = allMessages.filter((m) => m.parentMessageId === currentId)
    if (children.length === 0) break

    // 按分支选择或默认选最后一个（最新）
    const selectedId = branchSelections[currentId]
    current = selectedId
      ? children.find((c) => (c.dbId || c.id) === selectedId) || children[children.length - 1]
      : children[children.length - 1]
  }

  return path
}

/** 递归获取某消息的所有子孙 ID */
function collectDescendantIds(allMessages: Message[], startDbId: string): Set<string> {
  const ids = new Set<string>()
  let frontier = [startDbId]
  while (frontier.length > 0) {
    const next: string[] = []
    for (const id of frontier) {
      ids.add(id)
      for (const m of allMessages) {
        const childId = m.dbId || m.id
        if (m.parentMessageId === id && !ids.has(childId)) {
          next.push(childId)
        }
      }
    }
    frontier = next
  }
  return ids
}

// ---- Store ----

export const useChatStore = create<ChatState>()((set, get) => ({
  sessions: [],
  currentSessionId: null,
  messages: [],
  allMessages: [],
  branchSelections: {},
  isStreaming: false,
  streamingMessageId: null,
  streamSessionId: null,
  error: null,
  abortController: null,
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

  updateLastAssistant: (updater) =>
    set((s) => {
      const streamId = s.streamingMessageId
      if (!streamId) return {}

      // 后台流式：更新缓存中的消息
      if (s.currentSessionId !== s.streamSessionId && s.streamSessionId) {
        const cache = s.sessionCache[s.streamSessionId]
        if (!cache) return {}
        const newCache = { ...s.sessionCache }
        const sessionData = { ...cache, allMessages: [...cache.allMessages], messages: [...cache.messages] }
        const allIdx = sessionData.allMessages.findIndex((m) => m.id === streamId)
        if (allIdx >= 0) sessionData.allMessages[allIdx] = updater(sessionData.allMessages[allIdx])
        const msgIdx = sessionData.messages.findIndex((m) => m.id === streamId)
        if (msgIdx >= 0) sessionData.messages[msgIdx] = updater(sessionData.messages[msgIdx])
        newCache[s.streamSessionId] = sessionData
        return { sessionCache: newCache }
      }

      // 前台流式：更新可见消息
      const msgs = [...s.messages]
      const allMsgs = [...s.allMessages]
      const allIdx = allMsgs.findIndex((m) => m.id === streamId)
      if (allIdx >= 0) allMsgs[allIdx] = updater(allMsgs[allIdx])
      const msgIdx = msgs.findIndex((m) => m.id === streamId)
      if (msgIdx >= 0) msgs[msgIdx] = updater(msgs[msgIdx])
      return { messages: msgs, allMessages: allMsgs }
    }),

  sendMessage: (accountBookId, message, parentMessageId, replaceAssistantDbId) => {
    const state = get()
    if (state.isStreaming) return

    const userMsg: Message = {
      id: nextId(),
      role: 'user',
      blocks: [{ id: nextId(), type: 'text', content: message }],
      parentMessageId,
    }
    const assistantMsg: Message = {
      id: nextId(),
      role: 'assistant',
      blocks: [],
      isStreaming: true,
      parentMessageId: userMsg.id, // 临时关联，finish 时替换为 DB ID
    }

    set((s) => {
      const newAllMessages = [...s.allMessages, userMsg, assistantMsg]
      const newSelections = { ...s.branchSelections }
      // 编辑时自动切换到新版本分支
      if (parentMessageId) {
        newSelections[parentMessageId] = userMsg.id
      }
      return {
        messages: buildActivePath(newAllMessages, newSelections),
        allMessages: newAllMessages,
        branchSelections: newSelections,
        isStreaming: true,
        streamingMessageId: assistantMsg.id,
        streamSessionId: s.currentSessionId,
        error: null,
      }
    })

    // text-delta 状态机状态（在闭包中保持）
    let thinkState: DeltaState = 'text'
    const blockIdCounter = { value: 0 }

    const controller = sendMessageStream(
      {
        sessionId: state.currentSessionId || undefined,
        accountBookId,
        message,
        parentMessageId,
        replaceAssistantDbId,
      },
      (event: SSEEvent) => {
        const currentState = get()
        switch (event.type) {
          case 'text-delta':
            currentState.updateLastAssistant((msg) => {
              const blocks = [...msg.blocks]
              thinkState = processTextDelta(event.delta, thinkState, blocks, blockIdCounter)
              return { ...msg, blocks }
            })
            break

          case 'tool-call':
            currentState.updateLastAssistant((msg) => ({
              ...msg,
              blocks: [
                ...msg.blocks,
                {
                  id: `block-${++blockIdCounter.value}`,
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
            currentState.updateLastAssistant((msg) => ({
              ...msg,
              blocks: msg.blocks.map((b) =>
                b.type === 'tool-call' && b.toolCallId === event.toolCallId
                  ? {
                      ...b,
                      result: event.result,
                      durationMs: event.durationMs,
                      status: (event.status === 'success' ? 'success' : 'error') as 'success' | 'error',
                    }
                  : b,
              ),
            }))
            break

          case 'tool-confirm-required':
            // 更新已有的 tool-call block，不创建新的
            currentState.updateLastAssistant((msg) => ({
              ...msg,
              blocks: msg.blocks.map((b) =>
                b.type === 'tool-call' && b.toolCallId === event.toolCallId
                  ? { ...b, status: 'confirming' as const, preview: event.preview }
                  : b,
              ),
            }))
            break

          case 'tool-suggest-required':
            currentState.updateLastAssistant((msg) => ({
              ...msg,
              blocks: msg.blocks.map((b) =>
                b.type === 'tool-call' && b.toolCallId === event.toolCallId
                  ? {
                      ...b,
                      status: 'suggesting' as const,
                      suggestion: { questions: event.questions },
                    }
                  : b,
              ),
            }))
            break

          case 'finish':
            set((s) => {
              const streamId = s.streamingMessageId
              if (!streamId) return {}

              // 后台流式：更新缓存
              if (s.currentSessionId !== s.streamSessionId && s.streamSessionId) {
                const cache = s.sessionCache[s.streamSessionId]
                if (!cache) return {}
                const newCache = { ...s.sessionCache }
                const sessionData = { ...cache, allMessages: [...cache.allMessages], messages: [...cache.messages], branchSelections: { ...cache.branchSelections } }

                const asstAllIdx = sessionData.allMessages.findIndex((m) => m.id === streamId)
                if (asstAllIdx >= 0) {
                  const asst = sessionData.allMessages[asstAllIdx]
                  const userTempId = asst.parentMessageId
                  sessionData.allMessages[asstAllIdx] = { ...asst, dbId: event.assistantMessageId, parentMessageId: event.userMessageId, usage: event.usage as Message['usage'], isStreaming: false }
                  const asstMsgIdx = sessionData.messages.findIndex((m) => m.id === streamId)
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
                newCache[s.streamSessionId] = sessionData
                return { sessionCache: newCache }
              }

              // 前台流式：更新可见消息
              const allMsgs = [...s.allMessages]
              const msgs = [...s.messages]
              const newSelections = { ...s.branchSelections }

              const asstAllIdx = allMsgs.findIndex((m) => m.id === streamId)
              if (asstAllIdx >= 0) {
                const asst = allMsgs[asstAllIdx]
                const userTempId = asst.parentMessageId

                allMsgs[asstAllIdx] = { ...asst, dbId: event.assistantMessageId, parentMessageId: event.userMessageId }
                const asstMsgIdx = msgs.findIndex((m) => m.id === streamId)
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
              return { messages: msgs, allMessages: allMsgs, branchSelections: newSelections }
            })
            currentState.updateLastAssistant((msg) => {
              const usage = event.usage as Message['usage']
              return { ...msg, usage }
            })
            break

          case 'error':
            currentState.updateLastAssistant((msg) => ({
              ...msg,
              isStreaming: false,
              blocks: msg.blocks.length === 0
                ? [{ id: `block-${++blockIdCounter.value}`, type: 'text' as const, content: `错误: ${event.message}` }]
                : msg.blocks,
            }))
            set((s) => {
              // 后台流式：清除缓存中的流状态
              if (s.currentSessionId !== s.streamSessionId && s.streamSessionId) {
                const cache = s.sessionCache[s.streamSessionId]
                if (cache) {
                  const newCache = { ...s.sessionCache }
                  newCache[s.streamSessionId] = { ...cache, isStreaming: false, streamingMessageId: null }
                  return { sessionCache: newCache, isStreaming: false, streamingMessageId: null, streamSessionId: null, error: event.message }
                }
              }
              return { isStreaming: false, streamingMessageId: null, streamSessionId: null, error: event.message }
            })
            break
        }
      },
      () => {
        const finalState = get()
        finalState.updateLastAssistant((msg) => ({ ...msg, isStreaming: false }))

        const streamSid = finalState.streamSessionId
        const activeSid = finalState.currentSessionId

        // 只更新流所属会话的标题
        if (streamSid) {
          import('../api/chat').then(({ fetchSessions }) => {
            fetchSessions().then((sessions) => {
              set({ sessions, currentSessionId: activeSid })
            })
          })
        }

        // 后台流完成：清除缓存中的流状态
        if (streamSid && streamSid !== activeSid) {
          set((s) => {
            const cache = s.sessionCache[streamSid]
            if (!cache) return { isStreaming: false, streamingMessageId: null, streamSessionId: null, abortController: null }
            const newCache = { ...s.sessionCache }
            newCache[streamSid] = { ...cache, isStreaming: false, streamingMessageId: null }
            return { sessionCache: newCache, isStreaming: false, streamingMessageId: null, streamSessionId: null, abortController: null }
          })
        } else {
          set({ isStreaming: false, streamingMessageId: null, streamSessionId: null, abortController: null })
        }
      },
    )

    set({ abortController: controller })
  },

  // 清理被重试的消息及其后代（本地状态），返回 { text, parentId, assistantDbId } 供 ChatWindow 调用 sendMessage
  retryMessage: (assistantMsgId) => {
    const state = get()
    if (state.isStreaming) return

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

  stopStreaming: () => {
    const { abortController } = get()
    if (abortController) {
      abortController.abort()
      set({ isStreaming: false, streamingMessageId: null, streamSessionId: null, abortController: null })
    }
  },

  saveCurrentToCache: () => {
    const { currentSessionId, messages, allMessages, branchSelections, isStreaming, streamingMessageId } = get()
    if (!currentSessionId) return
    set((s) => ({
      sessionCache: {
        ...s.sessionCache,
        [currentSessionId]: { messages: [...messages], allMessages: [...allMessages], branchSelections: { ...branchSelections }, isStreaming, streamingMessageId },
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
      isStreaming: cache.isStreaming,
      streamingMessageId: cache.streamingMessageId,
    })
    return true
  },
}))

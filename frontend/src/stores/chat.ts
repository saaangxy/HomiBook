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
  status: 'pending' | 'success' | 'error' | 'confirming'
  preview?: string
}

export interface ChatSession {
  id: string
  title: string
  modelProvider: string
  modelName: string
  updatedAt: string
}

interface ChatState {
  sessions: ChatSession[]
  currentSessionId: string | null
  messages: Message[]
  isStreaming: boolean
  error: string | null
  abortController: AbortController | null

  setSessions: (sessions: ChatSession[]) => void
  setCurrentSession: (sessionId: string | null) => void
  setMessages: (messages: Message[]) => void
  setError: (error: string | null) => void

  sendMessage: (accountBookId: string, message: string) => void
  stopStreaming: () => void

  addMessage: (msg: Message) => void
  updateLastAssistant: (updater: (msg: Message) => Message) => void
}

let msgIdCounter = 0
function nextId() {
  return `msg-${Date.now()}-${++msgIdCounter}`
}

// ---- 辅助函数 ----

/** 从历史消息原始字符串解析出 blocks，同时过滤 <tool_call> XML 标签。按 textOffset 交错插入工具调用 */
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
  const { blocks: segBlocks, nextId } = parseTextSegment(remaining, idCounter)
  for (const b of segBlocks) blocks.push(b)

  return blocks
}

/** 解析一段文本：剥离 <tool_call> 标签、提取 <think> 块 */
function parseTextSegment(
  text: string,
  startId: number,
): { blocks: MessageBlock[]; nextId: number } {
  const cleaned = text.replace(/<tool_call>[\s\S]*?<\/tool_call>/g, '')
  const blocks: MessageBlock[] = []
  let idCounter = startId
  const regex = /<think>([\s\S]*?)<\/think>/g
  let lastIndex = 0
  let match: RegExpExecArray | null

  while ((match = regex.exec(cleaned)) !== null) {
    const textBefore = cleaned.slice(lastIndex, match.index)
    if (textBefore.trim()) blocks.push({ id: `hist-${idCounter++}`, type: 'text', content: textBefore })
    const thinkContent = match[1].trim()
    if (thinkContent) blocks.push({ id: `hist-${idCounter++}`, type: 'thinking', content: thinkContent })
    lastIndex = match.index + match[0].length
  }

  const textAfter = cleaned.slice(lastIndex)
  if (textAfter.trim()) blocks.push({ id: `hist-${idCounter++}`, type: 'text', content: textAfter })

  return { blocks, nextId: idCounter }
}

/** 追加文本到最后一个同类型 block，或创建新 block */
function appendTextToBlocks(
  blocks: MessageBlock[],
  type: 'text' | 'thinking',
  content: string,
  idCounter: { value: number },
) {
  if (!content) return
  const last = blocks[blocks.length - 1]
  if (last && last.type === type) {
    blocks[blocks.length - 1] = {
      ...last,
      content: (last as { content: string }).content + content,
    } as MessageBlock
  } else if (content.trim()) {
    blocks.push({ id: `block-${++idCounter.value}`, type, content } as MessageBlock)
  }
}

/** text-delta 状态机：处理 <think>/</think> 和 <tool_call>/</tool_call> 边界 */
type DeltaState = 'text' | 'thinking' | 'tool_call'

function processTextDelta(
  delta: string,
  thinkState: DeltaState,
  blocks: MessageBlock[],
  idCounter: { value: number },
): DeltaState {
  let state = thinkState
  let remaining = delta

  while (remaining.length > 0) {
    if (state === 'tool_call') {
      const idx = remaining.indexOf('</tool_call>')
      if (idx === -1) {
        // 丢弃所有内容直到找到 </tool_call>
        remaining = ''
      } else {
        remaining = remaining.slice(idx + 12) // skip </tool_call>
        state = 'text'
      }
    } else if (state === 'text') {
      const thinkIdx = remaining.indexOf('<think>')
      const toolIdx = remaining.indexOf('<tool_call>')
      const firstIdx =
        thinkIdx === -1 ? toolIdx
        : toolIdx === -1 ? thinkIdx
        : Math.min(thinkIdx, toolIdx)

      if (firstIdx === -1) {
        appendTextToBlocks(blocks, 'text', remaining, idCounter)
        remaining = ''
      } else {
        if (firstIdx > 0) appendTextToBlocks(blocks, 'text', remaining.slice(0, firstIdx), idCounter)
        if (firstIdx === thinkIdx) {
          remaining = remaining.slice(firstIdx + 7) // skip <think>
          state = 'thinking'
        } else {
          remaining = remaining.slice(firstIdx + 11) // skip <tool_call>
          state = 'tool_call'
        }
      }
    } else {
      // state === 'thinking'
      const idx = remaining.indexOf('</think>')
      if (idx === -1) {
        appendTextToBlocks(blocks, 'thinking', remaining, idCounter)
        remaining = ''
      } else {
        if (idx > 0) appendTextToBlocks(blocks, 'thinking', remaining.slice(0, idx), idCounter)
        remaining = remaining.slice(idx + 8) // skip </think>
        state = 'text'
      }
    }
  }
  return state
}

// ---- Store ----

export const useChatStore = create<ChatState>()((set, get) => ({
  sessions: [],
  currentSessionId: null,
  messages: [],
  isStreaming: false,
  error: null,
  abortController: null,

  setSessions: (sessions) => set({ sessions }),
  setCurrentSession: (sessionId) => set({ currentSessionId: sessionId }),
  setMessages: (messages) => set({ messages }),
  setError: (error) => set({ error }),

  addMessage: (msg) => set((s) => ({ messages: [...s.messages, msg] })),

  updateLastAssistant: (updater) =>
    set((s) => {
      const msgs = [...s.messages]
      const lastIdx = msgs.length - 1
      if (lastIdx >= 0 && msgs[lastIdx].role === 'assistant') {
        msgs[lastIdx] = updater(msgs[lastIdx])
      }
      return { messages: msgs }
    }),

  sendMessage: (accountBookId, message) => {
    const state = get()
    if (state.isStreaming) return

    const userMsg: Message = {
      id: nextId(),
      role: 'user',
      blocks: [{ id: nextId(), type: 'text', content: message }],
    }
    const assistantMsg: Message = {
      id: nextId(),
      role: 'assistant',
      blocks: [],
      isStreaming: true,
    }

    set({ messages: [...state.messages, userMsg, assistantMsg], isStreaming: true, error: null })

    // text-delta 状态机状态（在闭包中保持）
    let thinkState: DeltaState = 'text'
    const blockIdCounter = { value: 0 }

    const controller = sendMessageStream(
      {
        sessionId: state.currentSessionId || undefined,
        accountBookId,
        message,
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
            // 模型在文本中使用 <tool_call> 但可能不闭合 — 重置状态，后续文本正常展示
            thinkState = 'text'
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

          case 'finish':
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
            set({ isStreaming: false, error: event.message })
            break
        }
      },
      () => {
        const finalState = get()
        finalState.updateLastAssistant((msg) => ({ ...msg, isStreaming: false }))

        const { currentSessionId } = finalState
        if (currentSessionId) {
          import('../api/chat').then(({ fetchSessions }) => {
            fetchSessions().then((sessions) => {
              set({ sessions, currentSessionId: currentSessionId })
            })
          })
        }

        set({ isStreaming: false, abortController: null })
      },
    )

    set({ abortController: controller })
  },

  stopStreaming: () => {
    const { abortController } = get()
    if (abortController) {
      abortController.abort()
      set({ isStreaming: false, abortController: null })
    }
  },
}))

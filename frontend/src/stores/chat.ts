import { create } from 'zustand'
import type { SSEEvent } from '../api/chat'
import { sendMessageStream } from '../api/chat'

export interface Message {
  id: string
  role: 'user' | 'assistant'
  content: string
  thinking?: string
  toolCalls?: ToolCallEntry[]
  isStreaming?: boolean
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

function parseThinking(content: string): { thinking: string; text: string } {
  const thinkMatch = content.match(/<think>([\s\S]*?)<\/think>/)
  if (!thinkMatch) return { thinking: '', text: content }
  const thinking = thinkMatch[1].trim()
  const text = content.replace(/<think>[\s\S]*?<\/think>\n*/, '')
  return { thinking, text }
}

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

    // 添加用户消息
    const userMsg: Message = { id: nextId(), role: 'user', content: message }
    const assistantMsg: Message = { id: nextId(), role: 'assistant', content: '', isStreaming: true, toolCalls: [] }

    set({ messages: [...state.messages, userMsg, assistantMsg], isStreaming: true, error: null })

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
              const raw = msg.content + event.delta
              const { thinking, text } = parseThinking(raw)
              return { ...msg, content: text, thinking }
            })
            break

          case 'tool-call':
            currentState.updateLastAssistant((msg) => ({
              ...msg,
              toolCalls: [
                ...(msg.toolCalls || []),
                { toolCallId: event.toolCallId, toolName: event.toolName, args: event.args, status: 'pending' },
              ],
            }))
            break

          case 'tool-result':
            currentState.updateLastAssistant((msg) => ({
              ...msg,
              toolCalls: (msg.toolCalls || []).map((tc) =>
                tc.toolCallId === event.toolCallId
                  ? { ...tc, result: event.result, durationMs: event.durationMs, status: event.status === 'success' ? 'success' : 'error' }
                  : tc,
              ),
            }))
            break

          case 'tool-confirm-required':
            currentState.updateLastAssistant((msg) => ({
              ...msg,
              toolCalls: [
                ...(msg.toolCalls || []),
                { toolCallId: event.toolCallId, toolName: event.toolName, preview: event.preview, status: 'confirming' },
              ],
            }))
            break

          case 'error':
            currentState.updateLastAssistant((msg) => ({ ...msg, content: msg.content || `错误: ${event.message}`, isStreaming: false }))
            set({ isStreaming: false, error: event.message })
            break
        }
      },
      () => {
        const finalState = get()
        finalState.updateLastAssistant((msg) => ({ ...msg, isStreaming: false }))

        // If session was just created, update sessions list
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

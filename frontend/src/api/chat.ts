import { api } from './http'

interface SuggestionOption {
  label?: string
  name?: string
  value?: string
  code?: string
  description?: string
}

const BASE = '/api/chat'

export interface ChatSession {
  id: string
  title: string
  modelProvider: string
  modelName: string
  updatedAt: string
}

export interface ChatMessage {
  id: string
  role: 'user' | 'assistant' | 'system'
  content: string
  toolCalls?: string
  modelProvider?: string
  modelName?: string
  parentMessageId?: string | null
  createdAt: string
}

export interface ProviderInfo {
  value: string
  label: string
  defaultModels: string[]
  defaultBaseURL: string
}

export interface UserAIConfig {
  enabled: boolean
  simpleProviderConfigId: string | null
  simpleModel: string
  complexProviderConfigId: string | null
  complexModel: string
  autoConfirmCreate: boolean
  language: string
  temperature: number
  maxTokens: number
  maxSteps: number
  visionProviderConfigId: string | null
  visionModel: string
  disabledTools: string[]
}

export interface UserProviderConfig {
  id: string
  userId: string
  name: string
  provider: string
  apiKey: string
  baseURL: string
  models: string
  temperature: number | null
  maxTokens: number | null
  contextWindow: number | null
  sortOrder: number
  createdAt: string
  updatedAt: string
}

// SSE 事件类型
export type SSEEvent =
  | { type: 'text-delta'; delta: string }
  | { type: 'tool-call'; toolCallId: string; toolName: string; args: unknown }
  | { type: 'tool-result'; toolCallId: string; toolName: string; result: unknown; durationMs: number; status: string; error?: string; merge?: { action?: 'append'; batch?: number; total: number } }
  | { type: 'tool-confirm-required'; toolCallId: string; toolName: string; preview: string }
  | { type: 'tool-suggest-required'; toolCallId: string; toolName: string; questions: { question: string; field: string; options: (string | SuggestionOption)[]; allowCustom: boolean }[] }
  | { type: 'tool-switch-book'; toolCallId: string; books: BookOption[]; currentBookId: string }
  | { type: 'finish'; usage?: unknown; userMessageId: string; assistantMessageId: string; pendingConfirmation?: { toolCallId: string; toolName: string }; pendingConfirmations?: { toolCallId: string; toolName: string }[]; pendingSuggestion?: { toolCallId: string }; pendingSwitchBook?: { toolCallId: string } }
  | { type: 'error'; message: string }

export interface BookOption {
  id: string
  name: string
  role: string
  memberCount: number
  isCurrent: boolean
}

// GET APIs
export async function fetchSessions() {
  const res = await api.get<{ sessions: ChatSession[] }>(`${BASE}/sessions`)
  return res.sessions
}

export async function fetchMessages(sessionId: string) {
  const res = await api.get<{ messages: ChatMessage[] }>(`${BASE}/sessions/${sessionId}/messages`)
  return res.messages
}

export async function fetchAIConfig() {
  return api.get<UserAIConfig>(`${BASE}/ai-config`)
}

export async function fetchProviders() {
  const res = await api.get<{ providers: ProviderInfo[] }>(`${BASE}/providers`)
  return res.providers
}

export interface ToolInfo {
  name: string
  description: string
  requireConfirm: boolean
}

export async function fetchTools() {
  const res = await api.get<{ groups: { label: string; tools: ToolInfo[] }[] }>(`${BASE}/tools`)
  return res.groups
}

// ---- 记忆管理 ----

export interface UserMemory {
  id: string
  content: string
  memoryType: string
  importance: number
  createdAt: string
  updatedAt: string
  accessCount: number
}

export async function fetchMemories() {
  const res = await api.get<{ memories: UserMemory[] }>(`${BASE}/memories`)
  return res.memories
}

export async function deleteMemory(id: string) {
  return api.delete(`${BASE}/memories/${id}`)
}

export async function updateMemory(id: string, data: { content?: string; importance?: number }) {
  return api.patch(`${BASE}/memories/${id}`, data)
}

export async function fetchProviderModels(provider: string, baseURL?: string, apiKey?: string, configId?: string) {
  const params = new URLSearchParams({ provider })
  if (baseURL) params.set('baseURL', baseURL)
  if (apiKey) params.set('apiKey', apiKey)
  if (configId) params.set('configId', configId)
  return api.get<{ models: string[] }>(`${BASE}/providers/models?${params}`)
}

// MUTATE APIs
export async function createSession(data?: { title?: string; modelProvider?: string; modelName?: string; accountBookId?: string }) {
  return api.post<{ session: ChatSession }>(`${BASE}/sessions`, data || {})
}

export async function updateSession(id: string, data: { title?: string; modelProvider?: string; modelName?: string; status?: string }) {
  return api.patch(`${BASE}/sessions/${id}`, data)
}

export async function generateSessionTitle(sessionId: string) {
  const res = await api.post<{ title: string }>(`${BASE}/sessions/${sessionId}/generate-title`,{})
  return res.title
}

export async function deleteSession(id: string) {
  return api.delete(`${BASE}/sessions/${id}`)
}

export function confirmActionStream(
  params: { decisions: { toolCallId: string; approved: boolean; data?: Record<string, unknown> }[]; accountBookId: string; sessionId?: string },
  onEvent: (event: SSEEvent) => void,
  onDone: () => void,
): AbortController {
  const controller = new AbortController()
  const token = getToken()

  fetch(`${BASE}/confirm`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(params),
    signal: controller.signal,
  })
    .then(async (response) => {
      if (!response.ok) {
        const err = await response.json().catch(() => ({ message: '请求失败' }))
        onEvent({ type: 'error', message: err.message || `HTTP ${response.status}` })
        onDone()
        return
      }

      const contentType = response.headers.get('Content-Type') || ''
      if (contentType.includes('text/event-stream')) {
        parseSSEStream(response, onEvent, onDone, controller.signal)
      } else {
        onDone()
      }
    })
    .catch((err) => {
      if (err.name !== 'AbortError') {
        onEvent({ type: 'error', message: err.message || '网络错误' })
      }
      onDone()
    })

  return controller
}

export function respondSuggestionStream(
  params: { toolCallId: string; values: Record<string, string> | null; accountBookId: string; sessionId?: string },
  onEvent: (event: SSEEvent) => void,
  onDone: () => void,
): AbortController {
  const controller = new AbortController()
  const token = getToken()

  fetch(`${BASE}/respond-suggestion`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(params),
    signal: controller.signal,
  })
    .then(async (response) => {
      if (!response.ok) {
        const err = await response.json().catch(() => ({ message: '请求失败' }))
        onEvent({ type: 'error', message: err.message || `HTTP ${response.status}` })
        onDone()
        return
      }

      const contentType = response.headers.get('Content-Type') || ''
      if (contentType.includes('text/event-stream')) {
        parseSSEStream(response, onEvent, onDone, controller.signal)
      } else {
        try {
          const json = await response.json()
          if (json.acknowledged) {
            onEvent({ type: 'tool-result', toolCallId: params.toolCallId, toolName: '', result: { error: '用户取消了选择' }, durationMs: 0, status: 'error' })
          }
        } catch { /* ignore */ }
        onDone()
      }
    })
    .catch((err) => {
      if (err.name !== 'AbortError') {
        onEvent({ type: 'error', message: err.message || '网络错误' })
      }
      onDone()
    })

  return controller
}

export function switchBookStream(
  params: { toolCallId: string; bookId: string },
  onEvent: (event: SSEEvent) => void,
  onDone: () => void,
): AbortController {
  const controller = new AbortController()
  const token = getToken()

  fetch(`${BASE}/switch-book`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(params),
    signal: controller.signal,
  })
    .then(async (response) => {
      if (!response.ok) {
        const err = await response.json().catch(() => ({ message: '切换失败' }))
        onEvent({ type: 'error', message: err.message || `HTTP ${response.status}` })
        onDone()
        return
      }

      const contentType = response.headers.get('Content-Type') || ''
      if (contentType.includes('text/event-stream')) {
        parseSSEStream(response, onEvent, onDone, controller.signal)
      } else {
        onDone()
      }
    })
    .catch((err) => {
      if (err.name !== 'AbortError') {
        onEvent({ type: 'error', message: err.message || '网络错误' })
      }
      onDone()
    })

  return controller
}

export async function updateAIConfig(data: Partial<UserAIConfig>) {
  return api.put(`${BASE}/ai-config`, data)
}

// Provider config CRUD
export async function fetchProviderConfigs() {
  return api.get<UserProviderConfig[]>(`${BASE}/provider-configs`)
}

export async function createProviderConfig(data: Partial<UserProviderConfig>) {
  return api.post<UserProviderConfig>(`${BASE}/provider-configs`, data)
}

export async function updateProviderConfig(id: string, data: Partial<UserProviderConfig>) {
  return api.put<UserProviderConfig>(`${BASE}/provider-configs/${id}`, data)
}

export async function deleteProviderConfig(id: string) {
  return api.delete(`${BASE}/provider-configs/${id}`)
}

export async function copyProviderConfig(id: string) {
  return api.post<UserProviderConfig>(`${BASE}/provider-configs/${id}/copy`, {})
}

// Provider baseURL management
export async function fetchProviderBaseURL(provider: string) {
  return api.get<{ baseURL: string; isCustom: boolean }>(`${BASE}/providers/baseurl?provider=${encodeURIComponent(provider)}`)
}

export async function saveProviderBaseURL(provider: string, baseURL: string) {
  return api.post<{ success: boolean; baseURL: string; isCustom: boolean }>(`${BASE}/providers/baseurl`, { provider, baseURL })
}

export async function testProviderConnection(data: { provider: string; apiKey: string; baseURL: string; model?: string; configId?: string }) {
  return api.post<{ success: boolean; message: string; models?: string[] }>(`${BASE}/providers/test`, data)
}

// 共享 SSE 流解析
async function parseSSEStream(
  response: Response,
  onEvent: (event: SSEEvent) => void,
  onDone: () => void,
  signal?: AbortSignal,
) {
  const reader = response.body?.getReader()
  if (!reader) {
    onEvent({ type: 'error', message: '无法读取响应流' })
    onDone()
    return
  }

  const decoder = new TextDecoder()
  let buffer = ''

  try {
    while (true) {
      if (signal?.aborted) break
      const { done, value } = await reader.read()
      if (done) break

      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split('\n')
      buffer = lines.pop() || ''

      let eventType = ''
      for (const line of lines) {
        if (line.startsWith('event: ')) {
          eventType = line.slice(7).trim()
        } else if (line.startsWith('data: ')) {
          const data = line.slice(6)
          try {
            const parsed = JSON.parse(data)
            onEvent({ type: eventType as SSEEvent['type'], ...parsed })
          } catch (e) {
            console.error('[SSE] JSON parse failed for event:', eventType, 'error:', e, 'dataLen:', data.length, 'dataPreview:', data.slice(0, 200))
          }
          eventType = ''
        }
      }
    }
  } catch (err: any) {
    if (err.name !== 'AbortError') {
      onEvent({ type: 'error', message: err.message || '网络错误' })
    }
  }

  onDone()
}

// SSE 流式发送消息
export function sendMessageStream(
  params: { sessionId?: string; accountBookId: string; message: string; parentMessageId?: string; replaceAssistantDbId?: string; attachmentIds?: string[] },
  onEvent: (event: SSEEvent) => void,
  onDone: () => void,
): AbortController {
  const controller = new AbortController()
  const token = getToken()

  fetch(`${BASE}/send`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(params),
    signal: controller.signal,
  })
    .then(async (response) => {
      if (!response.ok) {
        const err = await response.json().catch(() => ({ message: '请求失败' }))
        onEvent({ type: 'error', message: err.message || `HTTP ${response.status}` })
        onDone()
        return
      }
      await parseSSEStream(response, onEvent, onDone, controller.signal)
    })
    .catch((err) => {
      if (err.name !== 'AbortError') {
        onEvent({ type: 'error', message: err.message || '网络错误' })
      }
      onDone()
    })

  return controller
}

function getToken(): string | null {
  try {
    const raw = localStorage.getItem('auth-storage')
    if (!raw) return null
    const parsed = JSON.parse(raw)
    return parsed?.state?.token || null
  } catch {
    return null
  }
}

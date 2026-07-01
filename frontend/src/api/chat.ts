import { api } from './http'

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

export interface UserPreferences {
  simpleProviderConfigId: string | null
  simpleModel: string
  complexProviderConfigId: string | null
  complexModel: string
  autoConfirmCreate: boolean
  language: string
  temperature: number
  maxTokens: number
  maxSteps: number
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
  | { type: 'tool-suggest-required'; toolCallId: string; toolName: string; questions: { question: string; field: string; options: string[]; allowCustom: boolean }[] }
  | { type: 'finish'; usage: unknown; userMessageId: string; assistantMessageId: string }
  | { type: 'error'; message: string }

// GET APIs
export async function fetchSessions() {
  const res = await api.get<{ sessions: ChatSession[] }>(`${BASE}/sessions`)
  return res.sessions
}

export async function fetchMessages(sessionId: string) {
  const res = await api.get<{ messages: ChatMessage[] }>(`${BASE}/sessions/${sessionId}/messages`)
  return res.messages
}

export async function fetchPreferences() {
  return api.get<UserPreferences>(`${BASE}/preferences`)
}

export async function fetchProviders() {
  const res = await api.get<{ providers: ProviderInfo[] }>(`${BASE}/providers`)
  return res.providers
}

export async function fetchProviderModels(provider: string, baseURL?: string) {
  const params = new URLSearchParams({ provider })
  if (baseURL) params.set('baseURL', baseURL)
  return api.get<{ models: string[] }>(`${BASE}/providers/models?${params}`)
}

export async function fetchPendingConfirmations() {
  const res = await api.get<{ pending: { toolCallId: string; toolName: string; preview: string }[] }>(`${BASE}/pending-confirmations`)
  return res.pending
}

// MUTATE APIs
export async function createSession(data?: { title?: string; modelProvider?: string; modelName?: string; accountBookId?: string }) {
  return api.post<{ session: ChatSession }>(`${BASE}/sessions`, data || {})
}

export async function updateSession(id: string, data: { title?: string; modelProvider?: string; modelName?: string; status?: string }) {
  return api.patch(`${BASE}/sessions/${id}`, data)
}

export async function deleteSession(id: string) {
  return api.delete(`${BASE}/sessions/${id}`)
}

export async function confirmAction(toolCallId: string, approved: boolean, data?: {
  fileId?: string
  accountResolutions?: { sourceAccountName: string; action: 'existing' | 'create'; targetAccountId?: string; targetAccountName?: string; accountType?: string }[]
  categoryResolutions?: { sourceCategory: string; targetCategoryCode: string; recordType?: string; payerContains?: string; descriptionContains?: string }[]
  unrecognizedResolutions?: { rowIndex: number; type: string; accountId: string; categoryCode: string }[]
  ownerId?: string
}) {
  return api.post<{ success: boolean }>(`${BASE}/confirm`, { toolCallId, approved, data })
}

export async function respondSuggestion(toolCallId: string, values: Record<string, string> | null) {
  return api.post<{ success: boolean; values: Record<string, string> | null }>(`${BASE}/respond-suggestion`, { toolCallId, values })
}

export async function updatePreferences(data: Partial<UserPreferences>) {
  return api.put(`${BASE}/preferences`, data)
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

// Provider API key management
export async function fetchProviderKeyStatus() {
  return api.get<Record<string, boolean>>(`${BASE}/providers/status`)
}

export async function saveProviderKey(provider: string, apiKey: string) {
  return api.post<{ success: boolean; provider: string; configured: boolean }>(`${BASE}/providers/key`, { provider, apiKey })
}

export async function deleteProviderKey(provider: string) {
  return api.delete(`${BASE}/providers/key?provider=${encodeURIComponent(provider)}`)
}

// Provider baseURL management
export async function fetchProviderBaseURL(provider: string) {
  return api.get<{ baseURL: string; isCustom: boolean }>(`${BASE}/providers/baseurl?provider=${encodeURIComponent(provider)}`)
}

export async function saveProviderBaseURL(provider: string, baseURL: string) {
  return api.post<{ success: boolean; baseURL: string; isCustom: boolean }>(`${BASE}/providers/baseurl`, { provider, baseURL })
}

// SSE 流式发送消息
export function sendMessageStream(
  params: { sessionId?: string; accountBookId: string; message: string; parentMessageId?: string; replaceAssistantDbId?: string },
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

      const reader = response.body?.getReader()
      if (!reader) {
        onEvent({ type: 'error', message: '无法读取响应流' })
        onDone()
        return
      }

      const decoder = new TextDecoder()
      let buffer = ''

      while (true) {
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

      onDone()
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

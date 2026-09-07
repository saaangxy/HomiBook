import { api } from './http'
import { consumeSSEStream } from '@homibook/core'
import type { ChatSSEEvent } from '@homibook/core'

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
  /** 用户消息关联的附件(仅带附件的消息返回) */
  attachments?: { id: string; url: string; originalFilename: string }[]
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
  testStatus: string // 'untested' | 'pass' | 'fail'
  lastTestedAt: string | null
  sortOrder: number
  createdAt: string
  updatedAt: string
}

// SSE 事件类型(权威定义在 @homibook/core,与 mobile 共享)
export type SSEEvent = ChatSSEEvent

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
  displayName: string
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
        await consumeSSEStream(response, (frame) => onEvent(sseToChatEvent(frame)), controller.signal)
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

// ---- 搜索引擎配置 ----
export async function fetchSearchEngine() {
  const res = await api.get<{ engine: string }>(`${BASE}/search-engine`)
  return res.engine
}

export async function updateSearchEngine(engine: string) {
  return api.post<{ success: boolean; engine: string }>(`${BASE}/search-engine`, { engine })
}

// SSE 事件帧 → 聊天事件(core consumeSSEStream 负责分帧/多行 data/[DONE],与 mobile 同源)
function sseToChatEvent(frame: { event: string; data: unknown }): SSEEvent {
  return { type: frame.event as SSEEvent['type'], ...(frame.data as object) } as SSEEvent
}

// SSE 流式发送消息
export function sendMessageStream(
  params: { sessionId?: string; accountBookId: string; message: string; parentMessageId?: string; replaceAssistantDbId?: string; attachmentIds?: string[]; enableWebSearch?: boolean },
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
      await consumeSSEStream(response, (frame) => onEvent(sseToChatEvent(frame)), controller.signal)
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

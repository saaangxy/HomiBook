import { consumeSSEStream, type ChatSSEEvent } from '@homibook/core';
import { getBaseUrl, getCredential } from './http';

// AI 聊天数据访问层 —— 完整复刻 web 端 frontend/src/api/chat.ts
// 流式接口:sendMessageStream / confirmActionStream / respondSuggestionStream / switchBookStream
// 普通接口:sessions / messages / ai-config / providers / tools / memories / provider-configs 等

export interface ChatSession {
  id: string;
  title: string;
  modelProvider: string;
  modelName: string;
  updatedAt: string;
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  toolCalls?: string;
  modelProvider?: string;
  modelName?: string;
  parentMessageId?: string | null;
  createdAt: string;
  usage?: {
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
    cachedInputTokens?: number;
  };
}

export type SSEEvent = ChatSSEEvent;

export interface BookOption {
  id: string;
  name: string;
  role: string;
  memberCount: number;
  isCurrent: boolean;
}

const BASE = '/api/chat';

// ── fetch 基础 ──
async function authHeaders(extra?: Record<string, string>): Promise<Record<string, string>> {
  const cred = await getCredential();
  return {
    'Content-Type': 'application/json',
    ...(cred ? { Authorization: `Bearer ${cred.value}` } : {}),
    ...extra,
  };
}

// ── GET ──
export async function fetchSessions(): Promise<ChatSession[]> {
  const res = await httpJson<{ sessions: ChatSession[] }>('GET', `${BASE}/sessions`);
  return res.sessions;
}

export async function fetchMessages(sessionId: string): Promise<ChatMessage[]> {
  const res = await httpJson<{ messages: ChatMessage[] }>('GET', `${BASE}/sessions/${sessionId}/messages`);
  return res.messages;
}

export async function createSession(data?: { title?: string; modelProvider?: string; modelName?: string; accountBookId?: string }): Promise<ChatSession> {
  const res = await httpJson<{ session: ChatSession }>('POST', `${BASE}/sessions`, data || {});
  return res.session;
}

export async function updateSession(id: string, data: { title?: string; modelProvider?: string; modelName?: string; status?: string }): Promise<void> {
  await httpJson('PATCH', `${BASE}/sessions/${id}`, data);
}

export async function generateSessionTitle(sessionId: string): Promise<string> {
  const res = await httpJson<{ title: string }>('POST', `${BASE}/sessions/${sessionId}/generate-title`, {});
  return res.title;
}

export async function deleteSession(id: string): Promise<void> {
  await httpJson('DELETE', `${BASE}/sessions/${id}`);
}

// ── 通用 JSON 请求 ──
async function httpJson<T = unknown>(method: string, path: string, body?: unknown): Promise<T> {
  const baseUrl = getBaseUrl();
  const headers = await authHeaders();
  const res = await fetch(`${baseUrl}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ message: `HTTP ${res.status}` }));
    throw new Error(err.message || `HTTP ${res.status}`);
  }
  if (res.status === 204) return undefined as T;
  return res.json();
}

// ── SSE 流式请求(共用) ──
async function streamRequest(
  path: string,
  body: unknown,
  onEvent: (event: SSEEvent) => void,
  onDone: () => void,
  signal?: AbortSignal,
): Promise<void> {
  const baseUrl = getBaseUrl();
  const cred = await getCredential();
  if (!baseUrl || !cred) {
    onEvent({ type: 'error', message: '请先配置服务器并登录' });
    onDone();
    return;
  }
  try {
    const res = await fetch(`${baseUrl}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${cred.value}`, Accept: 'text/event-stream' },
      body: JSON.stringify(body),
      signal,
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ message: '请求失败' }));
      onEvent({ type: 'error', message: err.message || `HTTP ${res.status}` });
      onDone();
      return;
    }
    const contentType = res.headers.get('Content-Type') || '';
    if (contentType.includes('text/event-stream')) {
      await consumeSSEStream(res, (frame) => {
        // 事件名 + data 顶层展开组成 ChatSSEEvent(对齐后端 SSEEvent)
        const evt = { type: frame.event, ...(frame.data as object) } as unknown as SSEEvent;
        onEvent(evt);
      }, signal);
    } else {
      try {
        const json = await res.json();
        // 非流式(如取消建议)特殊处理
        if (json.acknowledged) {
          onEvent({ type: 'tool-result', toolCallId: '', toolName: '', result: { error: '用户取消了选择' }, durationMs: 0, status: 'error' });
        }
      } catch {
        // ignore
      }
    }
    onDone();
  } catch (e: any) {
    if (e?.name !== 'AbortError') {
      onEvent({ type: 'error', message: e?.message || '网络错误' });
    }
    onDone();
  }
}

export interface SendMessageParams {
  sessionId?: string;
  accountBookId: string;
  message: string;
  parentMessageId?: string;
  replaceAssistantDbId?: string;
  attachmentIds?: string[];
  enableWebSearch?: boolean;
}

// ── 兼容接口:RecordModal 简化 AI 会话仍使用(完整 AI 页将走 zustand store) ──
export interface ChatStreamCallbacks {
  onDelta: (delta: string) => void;
  onToolCall: (tc: { toolCallId: string; toolName: string; args?: unknown }) => void;
  onFinish: () => void;
  onError: (message: string) => void;
}

export async function sendChatMessage(
  bookId: string,
  message: string,
  cb: ChatStreamCallbacks,
  signal?: AbortSignal,
): Promise<void> {
  await sendMessageStream(
    { accountBookId: bookId, message },
    (evt) => {
      switch (evt.type) {
        case 'text-delta':
          cb.onDelta(evt.delta ?? '');
          break;
        case 'tool-call':
          cb.onToolCall({ toolCallId: evt.toolCallId, toolName: evt.toolName, args: evt.args });
          break;
        case 'error':
          cb.onError(evt.message ?? 'AI 服务异常');
          break;
        case 'finish':
          cb.onFinish();
          break;
        default:
          break;
      }
    },
    () => cb.onFinish(),
    signal,
  );
}

export async function sendMessageStream(
  params: SendMessageParams,
  onEvent: (event: SSEEvent) => void,
  onDone: () => void,
  signal?: AbortSignal,
): Promise<void> {
  await streamRequest(`${BASE}/send`, params, onEvent, onDone, signal);
}

export async function confirmActionStream(
  params: { decisions: { toolCallId: string; approved: boolean; data?: Record<string, unknown> }[]; accountBookId: string; sessionId?: string },
  onEvent: (event: SSEEvent) => void,
  onDone: () => void,
  signal?: AbortSignal,
): Promise<void> {
  await streamRequest(`${BASE}/confirm`, params, onEvent, onDone, signal);
}

export async function respondSuggestionStream(
  params: { toolCallId: string; values: Record<string, string> | null; accountBookId: string; sessionId?: string },
  onEvent: (event: SSEEvent) => void,
  onDone: () => void,
  signal?: AbortSignal,
): Promise<void> {
  await streamRequest(`${BASE}/respond-suggestion`, params, onEvent, onDone, signal);
}

export async function switchBookStream(
  params: { toolCallId: string; bookId: string },
  onEvent: (event: SSEEvent) => void,
  onDone: () => void,
  signal?: AbortSignal,
): Promise<void> {
  await streamRequest(`${BASE}/switch-book`, params, onEvent, onDone, signal);
}

// ── 小票图片上传(POST /api/records/upload,multipart) ──
export interface UploadResult {
  id: string;
  url: string;
  fullUrl: string;
  originalFilename: string;
}

export async function uploadImage(uri: string, fileName: string, mimeType: string): Promise<UploadResult> {
  const baseUrl = getBaseUrl();
  const cred = await getCredential();
  if (!baseUrl || !cred) throw new Error('请先配置服务器并登录');
  const form = new FormData();
  // RN FormData:文件对象
  (form as any).append('file', { uri, name: fileName, type: mimeType } as any);
  const res = await fetch(`${baseUrl}/api/records/upload`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${cred.value}` },
    body: form,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ message: '上传失败' }));
    throw new Error(err.message || `上传失败(${res.status})`);
  }
  return res.json();
}

// ── 账单导入(对接 /api/records/import/*) ──
export async function uploadImportFile(uri: string, fileName: string): Promise<{ fileId: string; fileName: string; originalName: string; rows: number; errors: string[] }> {
  const baseUrl = getBaseUrl();
  const cred = await getCredential();
  if (!baseUrl || !cred) throw new Error('请先配置服务器并登录');
  const form = new FormData();
  (form as any).append('file', { uri, name: fileName, type: 'text/csv' } as any);
  const res = await fetch(`${baseUrl}/api/records/import/upload`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${cred.value}` },
    body: form,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ message: '导入上传失败' }));
    throw new Error(err.message || `导入上传失败(${res.status})`);
  }
  return res.json();
}

export async function analyzeImportCsv(bookId: string, params: { filePath?: string; fileName?: string; mappings?: Record<string, string>; currency?: string }): Promise<unknown> {
  return httpJson('POST', `/api/records/import/csv/analyze`, { accountBookId: bookId, ...params });
}

export async function previewImport(bookId: string, params: Record<string, unknown>): Promise<unknown> {
  return httpJson('POST', `/api/records/import/preview`, { accountBookId: bookId, ...params });
}

export async function confirmImport(bookId: string, params: Record<string, unknown>): Promise<unknown> {
  return httpJson('POST', `/api/records/import`, { accountBookId: bookId, ...params });
}

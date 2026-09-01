import { consumeSSEStream, type ChatSSEEvent } from '@homibook/core';
import { getBaseUrl, getCredential, uploadFileNative } from './http';

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
  /** 用户消息关联的附件(仅带附件的消息返回) */
  attachments?: { id: string; url: string; originalFilename: string }[];
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

// ── 小票图片上传(POST /api/records/upload,multipart) ──
export interface UploadResult {
  id: string;
  url: string;
  fullUrl: string;
  originalFilename: string;
}

export async function uploadImage(uri: string, fileName: string, mimeType: string): Promise<UploadResult> {
  const baseUrl = getBaseUrl();
  if (!baseUrl) throw new Error('请先配置服务器并登录');
  return uploadFileNative<UploadResult>(`${baseUrl}/api/records/upload`, uri, mimeType);
}

// ── 账单导入(对接 /api/records/import/*) ──
// 上传临时文件供 preview_import 工具使用;后端返回 { fileId, filename, size }
export async function uploadImportFile(uri: string, fileName: string): Promise<{ fileId: string; filename: string; size: number }> {
  const baseUrl = getBaseUrl();
  if (!baseUrl) throw new Error('请先配置服务器并登录');
  // 按扩展名推断类型(表格类账单常为 csv/xlsx)
  const lower = fileName.toLowerCase();
  const mime = lower.endsWith('.xlsx')
    ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    : lower.endsWith('.xls') ? 'application/vnd.ms-excel' : 'text/csv';
  return uploadFileNative(`${baseUrl}/api/records/import/upload`, uri, mime);
}

export async function analyzeImportCsv(bookId: string, params: { filePath?: string; fileName?: string; mappings?: Record<string, string>; currency?: string }): Promise<unknown> {
  return httpJson('POST', `/api/records/import/csv/analyze`, { accountBookId: bookId, ...params });
}

// ── 工具显示名称(web tool-names 同款:接口缓存 + 静态表兜底) ──
const STATIC_TOOL_NAMES: Record<string, string> = {
  create_record: '记一笔',
  batch_create_records: '批量记账',
  update_record: '修改流水',
  delete_record: '删除流水',
  query_records: '查询流水',
  query_summary: '收支统计',
  query_budgets: '查询预算',
  create_budget: '创建预算',
  batch_create_budgets: '批量创建预算',
  update_budget: '修改预算',
  delete_budget: '删除预算',
  query_recurring: '查询固定收支',
  create_recurring: '创建固定收支',
  query_accounts: '查询账户',
  create_account: '创建账户',
  adjust_balance: '余额调整',
  web_search: '联网搜索',
  read_webpage: '读取网页',
  suggest_options: '补充信息',
  switch_book: '切换账本',
  preview_import: '导入预览',
  confirm_import: '确认导入',
};

let toolNamesCache: Record<string, string> | null = null;
let toolNamesLoading: Promise<void> | null = null;

/** 预加载工具名称(GET /api/chat/tools,首次后缓存) */
export function loadToolNames(): Promise<void> {
  if (toolNamesCache) return Promise.resolve();
  if (toolNamesLoading) return toolNamesLoading;
  toolNamesLoading = httpJson<{ groups?: { tools?: { name: string; displayName: string }[] }[] }>('GET', `${BASE}/tools`)
    .then((res) => {
      const cache: Record<string, string> = {};
      for (const g of res.groups ?? []) {
        for (const t of g.tools ?? []) cache[t.name] = t.displayName;
      }
      toolNamesCache = cache;
    })
    .catch(() => {});
  return toolNamesLoading;
}

/** 同步获取工具显示名称:接口缓存 → 静态表 → 原始名 */
export function getToolDisplayName(toolName: string): string {
  return toolNamesCache?.[toolName] ?? STATIC_TOOL_NAMES[toolName] ?? toolName;
}

export async function previewImport(bookId: string, params: Record<string, unknown>): Promise<unknown> {
  return httpJson('POST', `/api/records/import/preview`, { accountBookId: bookId, ...params });
}

export async function confirmImport(bookId: string, params: Record<string, unknown>): Promise<unknown> {
  return httpJson('POST', `/api/records/import`, { accountBookId: bookId, ...params });
}

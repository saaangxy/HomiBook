import { consumeSSEStream, type ChatSSEEvent } from '@homibook/core';
import { http, getBaseUrl, getCredential, uploadFileNative } from './http';

// AI 聊天数据访问层:会话/消息 CRUD、SSE 流式请求、消息附件上传、工具显示名称缓存。
// 普通 JSON 请求统一走 http(超时 + 401 拦截 + ApiError);SSE 流式因需渐进读取保留独立 fetch。
// 账单文件上传/解析/预览/确认统一在 services/import.ts(同端点勿在此重复实现)。

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

// ── 会话/消息 CRUD ──
export async function fetchSessions(): Promise<ChatSession[]> {
  const res = await http.get<{ sessions: ChatSession[] }>(`${BASE}/sessions`);
  return res.sessions;
}

export async function fetchMessages(sessionId: string): Promise<ChatMessage[]> {
  const res = await http.get<{ messages: ChatMessage[] }>(`${BASE}/sessions/${sessionId}/messages`);
  return res.messages;
}

export async function createSession(data?: { title?: string; modelProvider?: string; modelName?: string; accountBookId?: string }): Promise<ChatSession> {
  const res = await http.post<{ session: ChatSession }>(`${BASE}/sessions`, data || {});
  return res.session;
}

export async function updateSession(id: string, data: { title?: string; modelProvider?: string; modelName?: string; status?: string }): Promise<void> {
  await http.patch(`${BASE}/sessions/${id}`, data);
}

export async function generateSessionTitle(sessionId: string): Promise<string> {
  const res = await http.post<{ title: string }>(`${BASE}/sessions/${sessionId}/generate-title`, {});
  return res.title;
}

export async function deleteSession(id: string): Promise<void> {
  await http.delete(`${BASE}/sessions/${id}`);
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
  toolNamesLoading = http.get<{ groups?: { tools?: { name: string; displayName: string }[] }[] }>(`${BASE}/tools`)
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

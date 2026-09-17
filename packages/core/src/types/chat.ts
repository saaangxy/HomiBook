/** AI 聊天领域类型(权威,对齐后端 /api/chat/* SSE 协议) */

export type ChatRole = 'user' | 'assistant';

export interface ChatMessage {
  id: string;
  role: ChatRole;
  content: string;
  parentMessageId: string | null;
  createdAt: string;
  /** 用户消息关联的附件(历史会话回显;仅带附件的消息返回) */
  attachments?: { id: string; url: string; originalFilename: string }[];
  /** 该轮模型用量(仅助手消息有;含缓存命中量) */
  usage?: MessageUsage;
  /** 挂在「用户消息」上的上下文注入记录(日期/记忆/技能/附件清单) */
  injections?: ChatInjection[];
}

/** 模型用量(含前缀缓存命中量,用于展示命中率) */
export interface MessageUsage {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  /** 命中前缀缓存的输入 token 数(DeepSeek 的 prompt_cache_hit_tokens / OpenAI 的 cached_tokens) */
  cachedInputTokens?: number;
}

/** 上下文注入的展示摘要 */
export interface InjectionSummary {
  /** 注入的日期(YYYY-MM-DD);本轮未注入日期则为 null */
  date: string | null;
  /** 注入的记忆条目(形如 "[习惯] 每月餐饮约2000元") */
  memories: string[];
  /** 注入的技能标题 */
  skills: string[];
  /** 是否随本轮带上了附件清单 */
  hasAttachments: boolean;
  /** 原始注入文本(展开时展示) */
  raw: string;
}

export interface ChatInjection {
  id: string;
  /** 所属用户消息 id(前端按它挂到对应消息下方) */
  parentMessageId: string | null;
  createdAt: string;
  summary: InjectionSummary;
}

export interface ChatSession {
  id: string;
  title: string;
  createdAt: string;
}

// ── 前端(web/mobile)共享的消息块模型 ──

export type MessageBlock =
  | { id: string; type: 'thinking'; content: string }
  | { id: string; type: 'text'; content: string }
  | ({ id: string; type: 'tool-call' } & ToolCallEntry);

export interface ToolCallEntry {
  toolCallId: string;
  toolName: string;
  args?: unknown;
  result?: unknown;
  durationMs?: number;
  status: 'pending' | 'success' | 'error' | 'confirming' | 'suggesting' | 'switching';
  preview?: string;
  suggestion?: { questions: { question: string; field: string; options: (string | SuggestionOption)[]; allowCustom: boolean }[] };
  /** 用户决定时暂存的附加数据（多工具并行时随 decisions 一起提交，仅作用于本工具） */
  decisionData?: Record<string, unknown>;
}

export interface SuggestionOption {
  label?: string;
  name?: string;
  value?: string;
  code?: string;
  description?: string;
}

export interface Message {
  id: string;
  dbId?: string;
  parentMessageId?: string;
  role: ChatRole;
  blocks: MessageBlock[];
  isStreaming?: boolean;
  attachments?: { id: string; url: string; originalFilename: string }[];
  usage?: MessageUsage;
  /** 本轮注入的上下文(日期/记忆/技能/附件清单),展示在用户消息下方 */
  injections?: ChatInjection[];
}

// ── SSE 事件(后端 /api/chat/send 流式,对齐 web 端 api/chat.ts 的 SSEEvent) ──

export interface ToolCallEvent {
  toolCallId: string;
  toolName: string;
  args: unknown;
}

export interface ToolResultEvent {
  toolCallId: string;
  toolName: string;
  result?: unknown;
  error?: string;
  status: string;
  durationMs: number;
  merge?: { action?: 'append'; batch?: number; total: number };
}

export interface ToolConfirmRequiredEvent {
  toolCallId: string;
  toolName: string;
  preview: string;
}

export interface ToolSuggestRequiredEvent {
  toolCallId: string;
  toolName: string;
  questions: { question: string; field: string; options: (string | SuggestionOption)[]; allowCustom: boolean }[];
}

export interface ToolSwitchBookEvent {
  toolCallId: string;
  books: { id: string; name: string; role: string; memberCount: number; isCurrent: boolean }[];
  currentBookId: string;
}

/** 本轮上下文注入(日期/记忆/技能/附件清单)已落库,前端据此在用户消息下实时展示 */
export interface ContextInjectedEvent {
  userMessageId: string;
  injection: ChatInjection;
}

export interface FinishEvent {
  usage?: unknown;
  assistantMessageId: string;
  userMessageId: string;
  pendingConfirmation?: { toolCallId: string; toolName: string };
  pendingConfirmations?: { toolCallId: string; toolName: string }[];
  pendingSuggestion?: { toolCallId: string };
  pendingSwitchBook?: { toolCallId: string };
}

export type ChatSSEEvent =
  | { type: 'text-delta'; delta: string }
  | { type: 'reasoning-delta'; delta: string }
  | { type: 'tool-call' } & ToolCallEvent
  | ({ type: 'tool-result' } & ToolResultEvent)
  | ({ type: 'tool-confirm-required' } & ToolConfirmRequiredEvent)
  | ({ type: 'tool-suggest-required' } & ToolSuggestRequiredEvent)
  | ({ type: 'tool-switch-book' } & ToolSwitchBookEvent)
  | ({ type: 'context-injected' } & ContextInjectedEvent)
  | { type: 'error'; message: string }
  | ({ type: 'finish' } & FinishEvent);

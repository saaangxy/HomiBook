import { useMemo } from 'react';
import { create } from 'zustand';
import { buildActivePath, collectDescendantIds, parseContentIntoBlocks, processTextDelta, type DeltaState } from '@homibook/core';
import type { Message, MessageBlock, ToolCallEntry } from '@homibook/core';
import {
  confirmActionStream,
  createSession,
  deleteSession,
  fetchMessages,
  fetchSessions,
  generateSessionTitle,
  sendMessageStream,
  updateSession,
  type SSEEvent,
} from '@/services/chat';

// AI 聊天状态(zustand + core 共享解析)。
// 数据模型:sessionCache[sid] 为唯一状态源(allMessages 权威 + branchSelections),
// 当前会话的活跃路径 messages 一律由 buildActivePath 派生(useSessionView / viewOf),
// 切换会话无需保存/恢复 —— 消灭顶层与 cache 的双状态源互抄。

export type { Message, MessageBlock, ToolCallEntry };
export type { SuggestionOption } from '@homibook/core';

export interface ChatSession {
  id: string;
  title: string;
  modelProvider: string;
  modelName: string;
  updatedAt: string;
}

/** 单会话持久态(权威):allMessages 为全部消息,活跃路径按 branchSelections 派生 */
interface SessionData {
  allMessages: Message[];
  branchSelections: Record<string, string>;
  isStreaming: boolean;
  streamingMessageId: string | null;
}

interface ChatState {
  sessions: ChatSession[];
  currentSessionId: string | null;
  sessionCache: Record<string, SessionData>;
  error: string | null;
  abortControllers: Record<string, AbortController>;

  setError: (error: string | null) => void;

  loadSessions: () => Promise<void>;
  openSession: (sessionId: string) => Promise<void>;
  newSession: (accountBookId?: string) => Promise<ChatSession | null>;
  loadMessages: (sessionId: string) => Promise<void>;
  deleteSession: (sessionId: string) => Promise<void>;
  renameSession: (sessionId: string, title: string) => Promise<void>;

  sendMessage: (accountBookId: string, message: string, parentMessageId?: string, replaceAssistantDbId?: string, attachmentIds?: string[], enableWebSearch?: boolean, localAttachments?: Message['attachments']) => void;
  confirmAndContinue: (accountBookId: string, toolCallId: string, approved: boolean, data?: Record<string, unknown>) => void;
  respondToSuggestion: (accountBookId: string, toolCallId: string, values: Record<string, string> | null) => void;
  switchBook: (accountBookId: string, toolCallId: string, bookId: string) => void;
  retryMessage: (assistantMsgId: string) => void;
  selectBranch: (parentMessageId: string, childMessageId: string) => void;
  stopStreaming: (sessionId?: string) => void;

  updateStreamMessage: (sessionId: string, messageId: string, updater: (msg: Message) => Message) => void;
}

let msgIdCounter = 0;
function nextId() {
  return `msg-${Date.now()}-${++msgIdCounter}`;
}

const EMPTY_SESSION: SessionData = { allMessages: [], branchSelections: {}, isStreaming: false, streamingMessageId: null };

type SetState = (partial: Partial<ChatState> | ((s: ChatState) => Partial<ChatState>)) => void;
type GetState = () => ChatState;

/** 当前会话视图(活跃路径 + 全量 + 分支选择),供 store 内部逻辑与组件 hook 共用 */
function viewOf(data: SessionData) {
  return {
    messages: buildActivePath(data.allMessages, data.branchSelections),
    allMessages: data.allMessages,
    branchSelections: data.branchSelections,
  };
}

/** 统一写入口:不可变更新指定会话的数据切片 */
function patchSession(set: SetState, sid: string, fn: (d: SessionData) => Partial<SessionData>) {
  set((s) => {
    const current = s.sessionCache[sid] ?? EMPTY_SESSION;
    return { sessionCache: { ...s.sessionCache, [sid]: { ...current, ...fn(current) } } };
  });
}

/** 清理会话的流式状态并移除中止控制器(流结束/出错/手动停止共用) */
function clearStreaming(set: SetState, sid: string) {
  set((s) => {
    const newAbortControllers = { ...s.abortControllers };
    delete newAbortControllers[sid];
    const newCache = { ...s.sessionCache };
    if (newCache[sid]) newCache[sid] = { ...newCache[sid], isStreaming: false, streamingMessageId: null };
    return { sessionCache: newCache, abortControllers: newAbortControllers };
  });
}

/** 把临时消息追加进会话(可选:登记分支选择 parentId → childId)并进入流式状态 */
function appendStreamingMessages(
  set: SetState,
  sid: string,
  msgs: Message[],
  streamingMessageId: string,
  select?: { parentId: string; childId: string },
) {
  patchSession(set, sid, (d) => {
    const allMessages = [...d.allMessages, ...msgs];
    let branchSelections = d.branchSelections;
    if (select) {
      branchSelections = { ...branchSelections, [select.parentId]: select.childId };
    }
    return { allMessages, branchSelections, isStreaming: true, streamingMessageId };
  });
  set({ error: null });
}

type SSEStreamContext = {
  sid: string;
  assistantMsgId: string;
  parentMsgId?: string;
  shouldGenerateTitle?: boolean;
  get: GetState;
  set: SetState;
  thinkState: { value: DeltaState };
  blockIdCounter: { value: number };
};

function makeSSEHandler(ctx: SSEStreamContext, onFinish: (event: Extract<SSEEvent, { type: 'finish' }>) => void) {
  const updateMsg = (updater: (msg: Message) => Message) => {
    ctx.get().updateStreamMessage(ctx.sid, ctx.assistantMsgId, updater);
  };
  const updateToolResult = (updater: (msg: Message) => Message) => {
    ctx.get().updateStreamMessage(ctx.sid, ctx.assistantMsgId, updater);
    if (ctx.parentMsgId) {
      ctx.get().updateStreamMessage(ctx.sid, ctx.parentMsgId, updater);
    }
  };

  const handleEvent = (event: SSEEvent) => {
    switch (event.type) {
      case 'text-delta':
        updateMsg((msg) => {
          const blocks = [...msg.blocks];
          ctx.thinkState.value = processTextDelta(event.delta, ctx.thinkState.value, blocks, ctx.blockIdCounter);
          return { ...msg, blocks };
        });
        break;
      case 'tool-call':
        updateMsg((msg) => ({
          ...msg,
          blocks: [
            ...msg.blocks,
            {
              id: `block-${++ctx.blockIdCounter.value}`,
              type: 'tool-call' as const,
              toolCallId: event.toolCallId,
              toolName: event.toolName,
              args: event.args,
              status: 'pending' as const,
            },
          ],
        }));
        break;
      case 'tool-result':
        updateToolResult((msg) => ({
          ...msg,
          blocks: msg.blocks.map((b) => {
            if (b.type === 'tool-call' && b.toolCallId === event.toolCallId) {
              if (event.merge?.action === 'append') {
                const existing = (b as any).result || {};
                const existingData = existing.data || {};
                const incomingData = (event.result as any)?.data || {};
                const mergedData: any = { ...existingData };
                for (const key of Object.keys(incomingData)) {
                  if (key === 'records' && Array.isArray(mergedData[key])) {
                    mergedData[key] = [...mergedData[key], ...incomingData[key]];
                  }
                }
                return { ...b, result: { ...existing, data: mergedData }, status: event.status as 'success' | 'error' };
              }
              return {
                ...b,
                result: event.result ?? (event.error ? { error: event.error } : undefined),
                durationMs: event.durationMs,
                status: (event.status === 'success' ? 'success' : 'error') as 'success' | 'error',
              };
            }
            return b;
          }),
        }));
        break;
      case 'tool-confirm-required':
        updateMsg((msg) => ({
          ...msg,
          blocks: msg.blocks.map((b) =>
            b.type === 'tool-call' && b.toolCallId === event.toolCallId
              ? { ...b, status: 'confirming' as const, preview: event.preview }
              : b,
          ),
        }));
        break;
      case 'tool-suggest-required':
        updateMsg((msg) => ({
          ...msg,
          blocks: msg.blocks.map((b) =>
            b.type === 'tool-call' && b.toolCallId === event.toolCallId
              ? { ...b, status: 'suggesting' as const, suggestion: { questions: event.questions } }
              : b,
          ),
        }));
        break;
      case 'tool-switch-book':
        updateMsg((msg) => ({
          ...msg,
          blocks: msg.blocks.map((b) =>
            b.type === 'tool-call' && b.toolCallId === event.toolCallId
              ? { ...b, status: 'switching' as const, result: { books: event.books, currentBookId: event.currentBookId } }
              : b,
          ),
        }));
        break;
      case 'finish':
        updateMsg((msg) => ({ ...msg, usage: event.usage as Message['usage'] }));
        onFinish(event);
        break;
      case 'error':
        updateMsg((msg) => ({
          ...msg,
          isStreaming: false,
          blocks: msg.blocks.length === 0
            ? [{ id: `block-${++ctx.blockIdCounter.value}`, type: 'text' as const, content: `错误: ${event.message}` }]
            : msg.blocks,
        }));
        clearStreaming(ctx.set, ctx.sid);
        ctx.set({ error: event.message });
        break;
    }
  };

  const handleDone = () => {
    clearStreaming(ctx.set, ctx.sid);

    const refreshSessions = () => {
      fetchSessions().then((sessions) => {
        ctx.set((s) => ({ sessions, currentSessionId: s.currentSessionId }));
      });
    };
    if (ctx.shouldGenerateTitle) {
      generateSessionTitle(ctx.sid).then(refreshSessions).catch(refreshSessions);
    } else {
      refreshSessions();
    }
  };

  return { handleEvent, handleDone };
}

/**
 * finish 后的统一收尾:把临时 id 替换为数据库 id(assistant + 尚无 dbId 的 user),
 * 同步 branchSelections 中指向旧临时 id 的选择,并清理流式状态。
 * sendMessage / 确认续流共用此唯一实现。
 */
function applyFinishPatch(
  set: SetState,
  sid: string,
  assistantMsgId: string,
  event: Extract<SSEEvent, { type: 'finish' }>,
  opts?: { selectNewBranch?: boolean },
) {
  patchSession(set, sid, (d) => {
    const allMessages = [...d.allMessages];
    let branchSelections = d.branchSelections;
    const asstIdx = allMessages.findIndex((m) => m.id === assistantMsgId);
    if (asstIdx >= 0) {
      const asst = allMessages[asstIdx];
      const userTempId = asst.parentMessageId;
      allMessages[asstIdx] = { ...asst, dbId: event.assistantMessageId, parentMessageId: event.userMessageId, isStreaming: false };
      if (userTempId) {
        const userIdx = allMessages.findIndex((m) => m.id === userTempId);
        if (userIdx >= 0 && !allMessages[userIdx].dbId) {
          allMessages[userIdx] = { ...allMessages[userIdx], dbId: event.userMessageId };
          const replaced: Record<string, string> = {};
          for (const [k, v] of Object.entries(branchSelections)) {
            replaced[k] = v === userTempId ? event.userMessageId : v;
          }
          branchSelections = replaced;
        }
      }
    }
    if (opts?.selectNewBranch) {
      branchSelections = { ...branchSelections, [event.userMessageId]: event.assistantMessageId };
    }
    return { allMessages, branchSelections };
  });
  clearStreaming(set, sid);
}

function startContinuationStream(
  set: SetState,
  get: GetState,
  parentDbId: string,
  parentId: string,
  streamStarter: (handleEvent: (e: SSEEvent) => void, handleDone: () => void, signal?: AbortSignal) => void,
) {
  const state = get();
  const sid = state.currentSessionId!;
  if (state.sessionCache[sid]?.isStreaming || state.abortControllers[sid]) return;
  const controller = new AbortController();

  const continuationMsg: Message = {
    id: nextId(),
    role: 'assistant',
    blocks: [],
    isStreaming: true,
    parentMessageId: parentDbId,
  };
  const continuationMsgId = continuationMsg.id;

  appendStreamingMessages(set, sid, [continuationMsg], continuationMsgId, { parentId: parentDbId, childId: continuationMsgId });

  // 注册中止控制器,供「停止」按钮中断流式请求(完成/出错时在 handler 内清除)
  set((s) => ({ abortControllers: { ...s.abortControllers, [sid]: controller } }));

  const ctx: SSEStreamContext = {
    sid, assistantMsgId: continuationMsgId, parentMsgId: parentId,
    get, set,
    thinkState: { value: 'text' },
    blockIdCounter: { value: 0 },
  };

  const { handleEvent, handleDone } = makeSSEHandler(ctx, (event) => {
    // 续流完成:登记新分支选择(原实现特有),id 替换与流式清理走统一收尾
    applyFinishPatch(set, sid, continuationMsgId, event, { selectNewBranch: true });
  });

  streamStarter(handleEvent, handleDone, controller.signal);
}

/**
 * 工具决定的统一入口（覆盖全部工具：普通确认/导入/建议选项/切换账本）。
 * 同一 assistant 消息内存在待决定块（confirming/suggesting/switching）时等待，
 * 全部决定后把 decisions（含各自暂存的 decisionData）统一提交给 /confirm 续流。
 */
function decideTool(
  set: SetState,
  get: GetState,
  accountBookId: string,
  toolCallId: string,
  approved: boolean,
  data?: Record<string, unknown>,
) {
  const sid = get().currentSessionId;
  if (!sid) return;

  const view = viewOf(get().sessionCache[sid] ?? EMPTY_SESSION);
  const parentMsg = view.messages.find((m) => m.role === 'assistant' && m.blocks.some((b) => b.type === 'tool-call' && b.toolCallId === toolCallId));
  const parentDbId = parentMsg?.dbId;
  if (!parentDbId) return;
  const parentId = parentMsg!.id;

  // 标记当前块为已决定：批准 → pending（保留旧 result，避免 SSE tool-result 到达前被误判为"数据已过期"）
  // 并暂存 decisionData，提交时各 decision 携带自己的 data
  get().updateStreamMessage(sid, parentId, (msg) => ({
    ...msg,
    blocks: msg.blocks.map((b) =>
      b.type === 'tool-call' && b.toolCallId === toolCallId
        ? {
            ...b,
            status: approved ? ('pending' as const) : ('error' as const),
            preview: undefined,
            decisionData: data,
            ...(approved ? {} : { result: { error: '用户拒绝了此操作' } as any }),
          }
        : b,
    ),
  }));

  // 待决定块仍在 → 等待（confirming/suggesting/switching = 等待用户决定）
  const updated = viewOf(get().sessionCache[sid] ?? EMPTY_SESSION);
  const updatedMsg = updated.messages.find((m) => m.id === parentId);
  const awaiting = (updatedMsg?.blocks.filter((b) => b.type === 'tool-call' && (b.status === 'confirming' || b.status === 'suggesting' || b.status === 'switching')) || []) as Extract<MessageBlock, { type: 'tool-call' }>[];
  if (awaiting.length > 0) return;

  // 全部决定，收集已决定块（pending=刚批准 / error=刚拒绝），各 decision 带自己的 decisionData
  const decidedBlocks = (updatedMsg?.blocks.filter((b) => b.type === 'tool-call' && (b.status === 'pending' || b.status === 'error')) || []) as Extract<MessageBlock, { type: 'tool-call' }>[];
  if (decidedBlocks.length === 0) return;

  const decisions = decidedBlocks.map((b) => ({
    toolCallId: b.toolCallId,
    approved: b.status !== 'error',
    ...(b.decisionData ? { data: b.decisionData } : {}),
  }));

  startContinuationStream(
    set, get, parentDbId, parentId,
    (handleEvent, handleDone, signal) => confirmActionStream({ decisions, accountBookId, sessionId: sid }, handleEvent, handleDone, signal),
  );
}

export const useChatStore = create<ChatState>()((set, get) => ({
  sessions: [],
  currentSessionId: null,
  sessionCache: {},
  error: null,
  abortControllers: {},

  setError: (error) => set({ error }),

  loadSessions: async () => {
    try {
      const sessions = await fetchSessions();
      set({ sessions });
    } catch {
      // ignore
    }
  },

  openSession: async (sessionId) => {
    set({ currentSessionId: sessionId });
    if (get().sessionCache[sessionId]) return; // 已有缓存,直接呈现
    await get().loadMessages(sessionId);
  },

  newSession: async (accountBookId) => {
    try {
      const session = await createSession(accountBookId ? { accountBookId } : undefined);
      set((s) => ({
        sessions: [session, ...s.sessions],
        currentSessionId: session.id,
        sessionCache: { ...s.sessionCache, [session.id]: { allMessages: [], branchSelections: {}, isStreaming: false, streamingMessageId: null } },
      }));
      return session;
    } catch {
      return null;
    }
  },

  loadMessages: async (sessionId) => {
    try {
      const msgs = await fetchMessages(sessionId);
      // 后端 ChatMessage -> Message(用 core parseContentIntoBlocks 解析 thinking/tool-call 块)
      const messages: Message[] = msgs.map((m) => {
        const blocks = parseContentIntoBlocks(m.content, m.toolCalls);
        return {
          id: nextId(),
          dbId: m.id,
          parentMessageId: m.parentMessageId ?? undefined,
          role: m.role === 'user' ? 'user' : 'assistant',
          blocks,
          // 恢复用户消息附件(服务端相对 URL,渲染时经 resolveFileUrl 转绝对地址)
          ...(m.attachments?.length ? { attachments: m.attachments } : {}),
          usage: m.role === 'assistant' ? m.usage : undefined,
        };
      });
      // 重建分支选择:同一父消息多个子分支时默认选中最后一条
      const selections: Record<string, string> = {};
      const childrenMap = new Map<string, Message[]>();
      for (const m of messages) {
        if (m.parentMessageId) {
          if (!childrenMap.has(m.parentMessageId)) childrenMap.set(m.parentMessageId, []);
          childrenMap.get(m.parentMessageId)!.push(m);
        }
      }
      for (const [pid, children] of childrenMap) {
        if (children.length > 1) selections[pid] = children[children.length - 1].dbId || children[children.length - 1].id;
      }
      set((s) => ({
        currentSessionId: sessionId,
        sessionCache: { ...s.sessionCache, [sessionId]: { allMessages: messages, branchSelections: selections, isStreaming: false, streamingMessageId: null } },
      }));
    } catch {
      // ignore
    }
  },

  deleteSession: async (sessionId) => {
    try {
      await deleteSession(sessionId);
      set((s) => {
        const newCache = { ...s.sessionCache };
        delete newCache[sessionId];
        return {
          sessions: s.sessions.filter((x) => x.id !== sessionId),
          sessionCache: newCache,
          ...(s.currentSessionId === sessionId ? { currentSessionId: null } : {}),
        };
      });
    } catch {
      // ignore
    }
  },

  renameSession: async (sessionId, title) => {
    try {
      await updateSession(sessionId, { title });
      set((s) => ({ sessions: s.sessions.map((x) => (x.id === sessionId ? { ...x, title } : x)) }));
    } catch {
      // ignore
    }
  },

  updateStreamMessage: (sessionId, messageId, updater) =>
    set((s) => {
      const cache = s.sessionCache[sessionId];
      if (!cache) return {};
      const allMessages = [...cache.allMessages];
      const idx = allMessages.findIndex((m) => m.id === messageId);
      if (idx < 0) return {};
      allMessages[idx] = updater(allMessages[idx]);
      return { sessionCache: { ...s.sessionCache, [sessionId]: { ...cache, allMessages } } };
    }),

  sendMessage: (accountBookId, message, parentMessageId, replaceAssistantDbId, attachmentIds, enableWebSearch, localAttachments) => {
    const state = get();
    const sid = state.currentSessionId;
    if (!sid) return;
    if (state.sessionCache[sid]?.isStreaming || state.abortControllers[sid]) return;

    const userMsg: Message = {
      id: nextId(),
      role: 'user',
      blocks: message.trim() ? [{ id: nextId(), type: 'text', content: message }] : [],
      // 本地回显已上传附件,发送后气泡内立即可见(服务端返回后由 dbId 合并)
      ...(localAttachments?.length ? { attachments: localAttachments } : {}),
      parentMessageId,
    };
    const assistantMsg: Message = {
      id: nextId(),
      role: 'assistant',
      blocks: [],
      isStreaming: true,
      parentMessageId: userMsg.id,
    };
    const assistantMsgId = assistantMsg.id;

    appendStreamingMessages(set, sid, [userMsg, assistantMsg], assistantMsgId, parentMessageId ? { parentId: parentMessageId, childId: userMsg.id } : undefined);

    const existingUserMsgCount = state.sessionCache[sid]?.allMessages.filter((m) => m.role === 'user').length ?? 0;
    const shouldGenerateTitle = existingUserMsgCount === 1 || (existingUserMsgCount === 0 && !message.trim());

    // 注册中止控制器,供「停止」按钮中断流式请求
    const controller = new AbortController();
    set((s) => ({ abortControllers: { ...s.abortControllers, [sid]: controller } }));

    const ctx: SSEStreamContext = {
      sid, assistantMsgId, get, set, shouldGenerateTitle,
      thinkState: { value: 'text' },
      blockIdCounter: { value: 0 },
    };

    const { handleEvent, handleDone } = makeSSEHandler(ctx, (event) => {
      applyFinishPatch(set, sid, assistantMsgId, event);
    });

    sendMessageStream(
      { sessionId: sid, accountBookId, message, parentMessageId, replaceAssistantDbId, attachmentIds, enableWebSearch },
      handleEvent,
      handleDone,
      controller.signal,
    );
  },

  confirmAndContinue: (accountBookId, toolCallId, approved, data) => {
    decideTool(set, get, accountBookId, toolCallId, approved, data);
  },

  respondToSuggestion: (accountBookId, toolCallId, values) => {
    // 取消 = 拒绝决定；选择 = 批准并携带 values，统一走 /confirm 批量决策
    decideTool(set, get, accountBookId, toolCallId, values !== null, values !== null ? { values } : undefined);
  },

  switchBook: (accountBookId, toolCallId, bookId) => {
    decideTool(set, get, accountBookId, toolCallId, true, { bookId });
  },

  retryMessage: (assistantMsgId) => {
    const state = get();
    const sid = state.currentSessionId;
    if (!sid || state.sessionCache[sid]?.isStreaming) return;
    const view = viewOf(state.sessionCache[sid] ?? EMPTY_SESSION);
    const idx = view.messages.findIndex((m) => m.id === assistantMsgId);
    if (idx <= 0) return;
    const prevUserMsg = view.messages[idx - 1];
    if (prevUserMsg.role !== 'user') return;
    const text = prevUserMsg.blocks.filter((b) => b.type === 'text').map((b) => b.content).join('\n');
    if (!text) return;
    const assistantDbId = view.messages[idx].dbId || view.messages[idx].id;
    const descendantIds = collectDescendantIds(view.allMessages, assistantDbId);
    const kept = view.allMessages.filter((m) => !descendantIds.has(m.dbId || m.id) && (m.dbId || m.id) !== assistantDbId);
    const userMsgId = prevUserMsg.dbId || prevUserMsg.id;
    const filteredAllMessages = kept.filter((m) => (m.dbId || m.id) !== userMsgId);
    patchSession(set, sid, () => ({ allMessages: filteredAllMessages }));
  },

  selectBranch: (parentId, childId) => {
    const sid = get().currentSessionId;
    if (!sid) return;
    patchSession(set, sid, (d) => ({ branchSelections: { ...d.branchSelections, [parentId]: childId } }));
  },

  stopStreaming: (sessionId) => {
    const sid = sessionId || get().currentSessionId;
    if (!sid) return;
    const controller = get().abortControllers[sid];
    if (controller) {
      controller.abort();
      clearStreaming(set, sid);
    }
  },
}));

/** 当前会话视图:messages 为按分支选择派生的活跃路径(allMessages 为权威全量) */
export function useSessionView() {
  const sid = useChatStore((s) => s.currentSessionId);
  const data = useChatStore((s) => (sid ? s.sessionCache[sid] : undefined));
  return useMemo(
    () => (data ? viewOf(data) : { messages: [], allMessages: [], branchSelections: {} }),
    [data],
  );
}

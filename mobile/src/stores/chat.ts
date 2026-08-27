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
  respondSuggestionStream,
  sendMessageStream,
  switchBookStream,
  updateSession,
  type SSEEvent,
} from '@/services/chat';

// 完整复刻 web 端 frontend/src/stores/chat.ts(zustand + core 共享解析)

export type { Message, MessageBlock, ToolCallEntry };
export type { SuggestionOption } from '@homibook/core';

export interface ChatSession {
  id: string;
  title: string;
  modelProvider: string;
  modelName: string;
  updatedAt: string;
}

interface SessionCache {
  messages: Message[];
  allMessages: Message[];
  branchSelections: Record<string, string>;
  isStreaming: boolean;
  streamingMessageId: string | null;
}

interface ChatState {
  sessions: ChatSession[];
  currentSessionId: string | null;
  messages: Message[];
  allMessages: Message[];
  branchSelections: Record<string, string>;
  error: string | null;
  abortControllers: Record<string, AbortController>;
  sessionCache: Record<string, SessionCache>;

  setSessions: (sessions: ChatSession[]) => void;
  setCurrentSession: (sessionId: string | null) => void;
  setMessages: (messages: Message[]) => void;
  setError: (error: string | null) => void;

  loadSessions: () => Promise<void>;
  openSession: (sessionId: string) => Promise<void>;
  newSession: (accountBookId?: string) => Promise<ChatSession | null>;
  loadMessages: (sessionId: string) => Promise<void>;
  deleteSession: (sessionId: string) => Promise<void>;
  renameSession: (sessionId: string, title: string) => Promise<void>;

  sendMessage: (accountBookId: string, message: string, parentMessageId?: string, replaceAssistantDbId?: string, attachmentIds?: string[], enableWebSearch?: boolean) => void;
  confirmAndContinue: (accountBookId: string, toolCallId: string, approved: boolean, data?: Record<string, unknown>) => void;
  respondToSuggestion: (accountBookId: string, toolCallId: string, values: Record<string, string> | null) => void;
  switchBook: (toolCallId: string, bookId: string) => void;
  retryMessage: (assistantMsgId: string) => void;
  selectBranch: (parentMessageId: string, childMessageId: string) => void;
  stopStreaming: (sessionId?: string) => void;

  addMessage: (msg: Message) => void;
  updateStreamMessage: (sessionId: string, messageId: string, updater: (msg: Message) => Message) => void;
  saveCurrentToCache: () => void;
  restoreFromCache: (sessionId: string) => boolean;
}

let msgIdCounter = 0;
function nextId() {
  return `msg-${Date.now()}-${++msgIdCounter}`;
}

type SSEStreamContext = {
  sid: string;
  assistantMsgId: string;
  parentMsgId?: string;
  shouldGenerateTitle?: boolean;
  get: () => ChatState;
  set: (partial: Partial<ChatState> | ((s: ChatState) => Partial<ChatState>)) => void;
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
        ctx.set((s) => {
          const newCache = { ...s.sessionCache };
          const newAbortControllers = { ...s.abortControllers };
          delete newAbortControllers[ctx.sid];
          if (s.currentSessionId !== ctx.sid) {
            const cache = s.sessionCache[ctx.sid];
            if (cache) newCache[ctx.sid] = { ...cache, isStreaming: false, streamingMessageId: null };
            return { sessionCache: newCache, abortControllers: newAbortControllers, error: event.message };
          }
          newCache[ctx.sid] = { ...newCache[ctx.sid], isStreaming: false, streamingMessageId: null };
          return { sessionCache: newCache, abortControllers: newAbortControllers, error: event.message };
        });
        break;
    }
  };

  const handleDone = () => {
    updateMsg((msg) => ({ ...msg, isStreaming: false }));
    ctx.set((s) => {
      const newAbortControllers = { ...s.abortControllers };
      delete newAbortControllers[ctx.sid];
      const newCache = { ...s.sessionCache };
      if (newCache[ctx.sid]) newCache[ctx.sid] = { ...newCache[ctx.sid], isStreaming: false, streamingMessageId: null };
      return { sessionCache: newCache, abortControllers: newAbortControllers };
    });

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

function startContinuationStream(
  set: (p: Partial<ChatState> | ((s: ChatState) => Partial<ChatState>)) => void,
  get: () => ChatState,
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

  set((s) => {
    const newAllMessages = [...s.allMessages, continuationMsg];
    const newSelections = { ...s.branchSelections };
    newSelections[parentDbId] = continuationMsg.id;
    const newCache = { ...s.sessionCache };
    newCache[sid] = {
      messages: buildActivePath(newAllMessages, newSelections),
      allMessages: newAllMessages,
      branchSelections: newSelections,
      isStreaming: true,
      streamingMessageId: continuationMsgId,
    };
    return { messages: buildActivePath(newAllMessages, newSelections), allMessages: newAllMessages, branchSelections: newSelections, sessionCache: newCache, error: null };
  });

  // 注册中止控制器,供「停止」按钮中断流式请求(完成/出错时在 handler 内清除)
  set((s) => ({ abortControllers: { ...s.abortControllers, [sid]: controller } }));

  const ctx: SSEStreamContext = {
    sid, assistantMsgId: continuationMsgId, parentMsgId: parentId,
    get, set,
    thinkState: { value: 'text' },
    blockIdCounter: { value: 0 },
  };

  const { handleEvent, handleDone } = makeSSEHandler(ctx, (event) => {
    set((s) => {
      const allMsgs = [...s.allMessages];
      const msgs = [...s.messages];
      const newSelections = { ...s.branchSelections };
      const asstAllIdx = allMsgs.findIndex((m) => m.id === continuationMsgId);
      if (asstAllIdx >= 0) {
        allMsgs[asstAllIdx] = { ...allMsgs[asstAllIdx], dbId: event.assistantMessageId, parentMessageId: event.userMessageId };
        const asstMsgIdx = msgs.findIndex((m) => m.id === continuationMsgId);
        if (asstMsgIdx >= 0) msgs[asstMsgIdx] = { ...msgs[asstMsgIdx], dbId: event.assistantMessageId, parentMessageId: event.userMessageId };
      }
      newSelections[event.userMessageId] = event.assistantMessageId;
      const newCache = { ...s.sessionCache };
      newCache[sid] = { ...newCache[sid], isStreaming: false, streamingMessageId: null, messages: msgs, allMessages: allMsgs, branchSelections: newSelections };
      const newAbortControllers = { ...s.abortControllers };
      delete newAbortControllers[sid];
      return { messages: msgs, allMessages: allMsgs, branchSelections: newSelections, sessionCache: newCache, abortControllers: newAbortControllers };
    });
  });

  streamStarter(handleEvent, handleDone, controller.signal);
}

export const useChatStore = create<ChatState>()((set, get) => ({
  sessions: [],
  currentSessionId: null,
  messages: [],
  allMessages: [],
  branchSelections: {},
  error: null,
  abortControllers: {},
  sessionCache: {},

  setSessions: (sessions) => set({ sessions }),
  setCurrentSession: (sessionId) => set({ currentSessionId: sessionId }),
  setMessages: (allMsgs) => {
    const selections: Record<string, string> = {};
    const childrenMap = new Map<string, Message[]>();
    for (const m of allMsgs) {
      const pid = m.parentMessageId;
      if (pid) {
        if (!childrenMap.has(pid)) childrenMap.set(pid, []);
        childrenMap.get(pid)!.push(m);
      }
    }
    for (const [pid, children] of childrenMap) {
      if (children.length > 1) selections[pid] = children[children.length - 1].dbId || children[children.length - 1].id;
    }
    set({ allMessages: allMsgs, branchSelections: selections, messages: buildActivePath(allMsgs, selections) });
  },
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
    if (get().restoreFromCache(sessionId)) return;
    await get().loadMessages(sessionId);
  },

  newSession: async (accountBookId) => {
    try {
      const session = await createSession(accountBookId ? { accountBookId } : undefined);
      set((s) => ({
        sessions: [session, ...s.sessions],
        currentSessionId: session.id,
        messages: [],
        allMessages: [],
        branchSelections: {},
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
          usage: m.role === 'assistant' ? m.usage : undefined,
        };
      });
      set({ currentSessionId: sessionId });
      get().setMessages(messages);
    } catch {
      // ignore
    }
  },

  deleteSession: async (sessionId) => {
    try {
      await deleteSession(sessionId);
      set((s) => ({ sessions: s.sessions.filter((x) => x.id !== sessionId) }));
      if (get().currentSessionId === sessionId) set({ currentSessionId: null, messages: [], allMessages: [], branchSelections: {} });
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

  addMessage: (msg) =>
    set((s) => ({ allMessages: [...s.allMessages, msg], messages: [...s.messages, msg] })),

  updateStreamMessage: (sessionId, messageId, updater) =>
    set((s) => {
      if (s.currentSessionId !== sessionId) {
        const cache = s.sessionCache[sessionId];
        if (!cache) return {};
        const newCache = { ...s.sessionCache };
        const sessionData = { ...cache, allMessages: [...cache.allMessages], messages: [...cache.messages] };
        const allIdx = sessionData.allMessages.findIndex((m) => m.id === messageId);
        if (allIdx >= 0) sessionData.allMessages[allIdx] = updater(sessionData.allMessages[allIdx]);
        const msgIdx = sessionData.messages.findIndex((m) => m.id === messageId);
        if (msgIdx >= 0) sessionData.messages[msgIdx] = updater(sessionData.messages[msgIdx]);
        newCache[sessionId] = sessionData;
        return { sessionCache: newCache };
      }
      const msgs = [...s.messages];
      const allMsgs = [...s.allMessages];
      const allIdx = allMsgs.findIndex((m) => m.id === messageId);
      if (allIdx >= 0) allMsgs[allIdx] = updater(allMsgs[allIdx]);
      const msgIdx = msgs.findIndex((m) => m.id === messageId);
      if (msgIdx >= 0) msgs[msgIdx] = updater(msgs[msgIdx]);
      return { messages: msgs, allMessages: allMsgs };
    }),

  sendMessage: (accountBookId, message, parentMessageId, replaceAssistantDbId, attachmentIds, enableWebSearch) => {
    const state = get();
    const sid = state.currentSessionId;
    if (!sid) return;
    if (state.sessionCache[sid]?.isStreaming || state.abortControllers[sid]) return;

    const userMsg: Message = {
      id: nextId(),
      role: 'user',
      blocks: message.trim() ? [{ id: nextId(), type: 'text', content: message }] : [],
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

    set((s) => {
      const newAllMessages = [...s.allMessages, userMsg, assistantMsg];
      const newSelections = { ...s.branchSelections };
      if (parentMessageId) newSelections[parentMessageId] = userMsg.id;
      const newCache = { ...s.sessionCache };
      newCache[sid] = {
        messages: buildActivePath(newAllMessages, newSelections),
        allMessages: newAllMessages,
        branchSelections: newSelections,
        isStreaming: true,
        streamingMessageId: assistantMsgId,
      };
      return { messages: buildActivePath(newAllMessages, newSelections), allMessages: newAllMessages, branchSelections: newSelections, sessionCache: newCache, error: null };
    });

    const existingUserMsgCount = state.allMessages.filter((m) => m.role === 'user').length;
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
      set((s) => {
        if (s.currentSessionId !== sid) {
          const cache = s.sessionCache[sid];
          if (!cache) return {};
          const newCache = { ...s.sessionCache };
          const sessionData = { ...cache, allMessages: [...cache.allMessages], messages: [...cache.messages], branchSelections: { ...cache.branchSelections } };
          const asstAllIdx = sessionData.allMessages.findIndex((m) => m.id === assistantMsgId);
          if (asstAllIdx >= 0) {
            const asst = sessionData.allMessages[asstAllIdx];
            const userTempId = asst.parentMessageId;
            sessionData.allMessages[asstAllIdx] = { ...asst, dbId: event.assistantMessageId, parentMessageId: event.userMessageId, usage: event.usage as Message['usage'], isStreaming: false };
            const asstMsgIdx = sessionData.messages.findIndex((m) => m.id === assistantMsgId);
            if (asstMsgIdx >= 0) sessionData.messages[asstMsgIdx] = { ...sessionData.messages[asstMsgIdx], dbId: event.assistantMessageId, parentMessageId: event.userMessageId, usage: event.usage as Message['usage'], isStreaming: false };
            if (userTempId) {
              const userAllIdx = sessionData.allMessages.findIndex((m) => m.id === userTempId);
              if (userAllIdx >= 0 && !sessionData.allMessages[userAllIdx].dbId) {
                sessionData.allMessages[userAllIdx] = { ...sessionData.allMessages[userAllIdx], dbId: event.userMessageId };
                const userMsgIdx = sessionData.messages.findIndex((m) => m.id === userTempId);
                if (userMsgIdx >= 0) sessionData.messages[userMsgIdx] = { ...sessionData.messages[userMsgIdx], dbId: event.userMessageId };
                for (const key of Object.keys(sessionData.branchSelections)) {
                  if (sessionData.branchSelections[key] === userTempId) sessionData.branchSelections[key] = event.userMessageId;
                }
              }
            }
          }
          sessionData.isStreaming = false;
          sessionData.streamingMessageId = null;
          newCache[sid] = sessionData;
          const newAbortControllers = { ...s.abortControllers };
          delete newAbortControllers[sid];
          return { sessionCache: newCache, abortControllers: newAbortControllers };
        }

        const allMsgs = [...s.allMessages];
        const msgs = [...s.messages];
        const newSelections = { ...s.branchSelections };
        const asstAllIdx = allMsgs.findIndex((m) => m.id === assistantMsgId);
        if (asstAllIdx >= 0) {
          const asst = allMsgs[asstAllIdx];
          const userTempId = asst.parentMessageId;
          allMsgs[asstAllIdx] = { ...asst, dbId: event.assistantMessageId, parentMessageId: event.userMessageId };
          const asstMsgIdx = msgs.findIndex((m) => m.id === assistantMsgId);
          if (asstMsgIdx >= 0) msgs[asstMsgIdx] = { ...msgs[asstMsgIdx], dbId: event.assistantMessageId, parentMessageId: event.userMessageId };
          if (userTempId) {
            const userAllIdx = allMsgs.findIndex((m) => m.id === userTempId);
            if (userAllIdx >= 0 && !allMsgs[userAllIdx].dbId) {
              allMsgs[userAllIdx] = { ...allMsgs[userAllIdx], dbId: event.userMessageId };
              const userMsgIdx = msgs.findIndex((m) => m.id === userTempId);
              if (userMsgIdx >= 0) msgs[userMsgIdx] = { ...msgs[userMsgIdx], dbId: event.userMessageId };
              for (const key of Object.keys(newSelections)) {
                if (newSelections[key] === userTempId) newSelections[key] = event.userMessageId;
              }
            }
          }
        }
        const newCache = { ...s.sessionCache };
        newCache[sid] = { ...newCache[sid], isStreaming: false, streamingMessageId: null, messages: msgs, allMessages: allMsgs, branchSelections: newSelections };
        const newAbortControllers = { ...s.abortControllers };
        delete newAbortControllers[sid];
        return { messages: msgs, allMessages: allMsgs, branchSelections: newSelections, sessionCache: newCache, abortControllers: newAbortControllers };
      });
    });

    sendMessageStream(
      { sessionId: sid, accountBookId, message, parentMessageId, replaceAssistantDbId, attachmentIds, enableWebSearch },
      handleEvent,
      handleDone,
      controller.signal,
    );
  },

  confirmAndContinue: (accountBookId, toolCallId, approved, data) => {
    const state = get();
    const sid = state.currentSessionId;
    if (!sid) return;
    const parentMsg = state.messages.find((m) => m.role === 'assistant' && m.blocks.some((b) => b.type === 'tool-call' && b.toolCallId === toolCallId));
    const parentDbId = parentMsg?.dbId;
    if (!parentDbId) return;
    const parentId = parentMsg!.id;
    const newDecidedStatus = approved ? 'pending' as const : 'error' as const;
    get().updateStreamMessage(sid, parentId, (msg) => ({
      ...msg,
      blocks: msg.blocks.map((b) =>
        b.type === 'tool-call' && b.toolCallId === toolCallId
          ? { ...b, status: newDecidedStatus, preview: undefined, ...(approved ? {} : { result: { error: '用户拒绝了此操作' } as any }) }
          : b,
      ),
    }));
    const updatedMsg = get().messages.find((m) => m.id === parentId);
    const allConfirming = (updatedMsg?.blocks.filter((b) => b.type === 'tool-call' && (b.status === 'confirming' || b.status === 'pending' || b.status === 'error')) || []) as Extract<MessageBlock, { type: 'tool-call' }>[];
    const stillConfirming = allConfirming.filter((b) => b.status === 'confirming');
    if (stillConfirming.length > 0) return;
    const decisions = allConfirming.map((b) => ({ toolCallId: b.toolCallId, approved: b.status !== 'error', ...(data ? { data } : {}) }));
    startContinuationStream(
      set, get, parentDbId, parentId,
      (handleEvent, handleDone, signal) => confirmActionStream({ decisions, accountBookId, sessionId: sid }, handleEvent, handleDone, signal),
    );
  },

  respondToSuggestion: (accountBookId, toolCallId, values) => {
    const state = get();
    const sid = state.currentSessionId;
    if (!sid) return;
    const parentMsg = state.messages.find((m) => m.role === 'assistant' && m.blocks.some((b) => b.type === 'tool-call' && b.toolCallId === toolCallId));
    const parentDbId = parentMsg?.dbId;
    if (!parentDbId) return;
    const parentId = parentMsg!.id;
    if (values === null) {
      get().updateStreamMessage(sid, parentId, (msg) => ({
        ...msg,
        blocks: msg.blocks.map((b) =>
          b.type === 'tool-call' && b.toolCallId === toolCallId
            ? { ...b, status: 'error' as const, result: { error: '用户取消了选择' } }
            : b,
        ),
      }));
      respondSuggestionStream({ toolCallId, values: null, accountBookId, sessionId: sid }, () => {}, () => {});
      return;
    }
    startContinuationStream(
      set, get, parentDbId, parentId,
      (handleEvent, handleDone, signal) => respondSuggestionStream({ toolCallId, values, accountBookId, sessionId: sid }, handleEvent, handleDone, signal),
    );
  },

  switchBook: (toolCallId, bookId) => {
    const state = get();
    const sid = state.currentSessionId;
    if (!sid) return;
    const parentMsg = state.messages.find((m) => m.role === 'assistant' && m.blocks.some((b) => b.type === 'tool-call' && b.toolCallId === toolCallId));
    const parentDbId = parentMsg?.dbId;
    if (!parentDbId) return;
    const parentId = parentMsg!.id;
    startContinuationStream(
      set, get, parentDbId, parentId,
      (handleEvent, handleDone, signal) => switchBookStream({ toolCallId, bookId }, handleEvent, handleDone, signal),
    );
  },

  retryMessage: (assistantMsgId) => {
    const state = get();
    const sid = state.currentSessionId;
    if (sid && state.sessionCache[sid]?.isStreaming) return;
    const idx = state.messages.findIndex((m) => m.id === assistantMsgId);
    if (idx <= 0) return;
    const prevUserMsg = state.messages[idx - 1];
    if (prevUserMsg.role !== 'user') return;
    const text = prevUserMsg.blocks.filter((b) => b.type === 'text').map((b) => b.content).join('\n');
    if (!text) return;
    const assistantDbId = state.messages[idx].dbId || state.messages[idx].id;
    const descendantIds = collectDescendantIds(state.allMessages, assistantDbId);
    const newAllMessages = state.allMessages.filter((m) => !descendantIds.has(m.dbId || m.id) && (m.dbId || m.id) !== assistantDbId);
    const userMsgId = prevUserMsg.dbId || prevUserMsg.id;
    const filteredAllMessages = newAllMessages.filter((m) => (m.dbId || m.id) !== userMsgId);
    const newMessages = state.messages.slice(0, idx - 1);
    set({ messages: newMessages, allMessages: filteredAllMessages });
  },

  selectBranch: (parentId, childId) => {
    set((s) => {
      const newSelections = { ...s.branchSelections, [parentId]: childId };
      return { branchSelections: newSelections, messages: buildActivePath(s.allMessages, newSelections) };
    });
  },

  stopStreaming: (sessionId) => {
    const sid = sessionId || get().currentSessionId;
    if (!sid) return;
    const controller = get().abortControllers[sid];
    if (controller) {
      controller.abort();
      set((s) => {
        const newAbortControllers = { ...s.abortControllers };
        delete newAbortControllers[sid];
        const newCache = { ...s.sessionCache };
        if (newCache[sid]) newCache[sid] = { ...newCache[sid], isStreaming: false, streamingMessageId: null };
        return { sessionCache: newCache, abortControllers: newAbortControllers };
      });
    }
  },

  saveCurrentToCache: () => {
    const { currentSessionId, messages, allMessages, branchSelections, sessionCache } = get();
    if (!currentSessionId) return;
    const existing = sessionCache[currentSessionId];
    set((s) => ({
      sessionCache: {
        ...s.sessionCache,
        [currentSessionId]: {
          messages: [...messages],
          allMessages: [...allMessages],
          branchSelections: { ...branchSelections },
          isStreaming: existing?.isStreaming ?? false,
          streamingMessageId: existing?.streamingMessageId ?? null,
        },
      },
    }));
  },

  restoreFromCache: (sessionId: string) => {
    const cache = get().sessionCache[sessionId];
    if (!cache) return false;
    set({ messages: cache.messages, allMessages: cache.allMessages, branchSelections: cache.branchSelections });
    return true;
  },
}));

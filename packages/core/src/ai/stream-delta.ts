import type { ChatSSEEvent, MessageBlock } from '../types/chat.js';

/**
 * 流式增量的刷新调度（web / mobile 共用）。
 *
 * SSE 的每个 text/reasoning delta 都直接写 store → 整棵消息树（含全部历史 Markdown）重渲染一次。
 * 实测每秒可达上百帧：除了白白烧 CPU，还会让消息区布局持续位移
 * —— web 上 mousedown/mouseup 落到不同元素，click 目标变成共同祖先，卡片/按钮「点不动」；
 * 移动端按压中途收到 ACTION_CANCEL，onPress 被吞。
 *
 * 对策：
 * ① 同一窗口内的文本增量合并为一次提交；
 * ② 按住聊天区域期间暂停刷新，松手补一次。
 */

/** 增量合并窗口（毫秒） */
export const DELTA_FLUSH_MS = 50;

export type DeltaEvent =
  | Extract<ChatSSEEvent, { type: 'text-delta' }>
  | Extract<ChatSSEEvent, { type: 'reasoning-delta' }>;

/** 是否为可合并的文本增量事件（工具调用/结束/错误结构事件必须立即处理，不能等窗口） */
export function isDeltaEvent(event: ChatSSEEvent): event is DeltaEvent {
  return event.type === 'text-delta' || event.type === 'reasoning-delta';
}

/** 活跃流的补刷函数（暂停解除时立即执行，不再等窗口） */
const pendingFlushers = new Set<() => void>();
let streamPaused = false;

/** 注册一个补刷函数，返回注销函数（流结束时调用） */
export function registerDeltaFlusher(flush: () => void): () => void {
  pendingFlushers.add(flush);
  return () => {
    pendingFlushers.delete(flush);
  };
}

/** 当前是否处于暂停刷新状态（调度方据此决定是否排下一帧） */
export function isStreamPaused(): boolean {
  return streamPaused;
}

/** 按住聊天区域（消息列表/输入区工具行）期间暂停流式刷新 / 松手恢复并补刷 */
export function setStreamPaused(paused: boolean): void {
  if (streamPaused === paused) return;
  streamPaused = paused;
  if (paused || pendingFlushers.size === 0) return;
  // 延后一个事件循环再补刷：避免在按压释放的同一 tick 里重排布局，干扰 click / onPress 判定
  setTimeout(() => {
    if (streamPaused) return;
    for (const flush of [...pendingFlushers]) flush();
  }, 0);
}

/** 把流式 reasoning delta 追加到 thinking 块（与末块合并，否则新建） */
export function appendThinkingToBlocks(
  blocks: MessageBlock[],
  content: string,
  idCounter: { value: number },
): void {
  if (!content) return;
  const last = blocks[blocks.length - 1];
  if (last && last.type === 'thinking') {
    blocks[blocks.length - 1] = { ...last, content: last.content + content };
  } else if (content.trim()) {
    blocks.push({ id: `block-${++idCounter.value}`, type: 'thinking', content });
  }
}

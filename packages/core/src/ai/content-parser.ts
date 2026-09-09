/**
 * AI 消息块解析 —— 纯 TS,三端共享(web/mobile)。
 * 解析历史消息的 <think> 块与 storedToolCalls,以及 SSE 流式 text-delta 的分块。
 */
import type { MessageBlock, ToolCallEntry } from '../types/index.js';

// ---- 解析历史消息 ----

interface StoredToolCall extends ToolCallEntry {
  textOffset: number;
}

export function parseContentIntoBlocks(raw: string, storedToolCalls?: string): MessageBlock[] {
  let toolCalls: StoredToolCall[] = [];
  if (storedToolCalls) {
    try {
      toolCalls = JSON.parse(storedToolCalls);
      toolCalls.sort((a, b) => a.textOffset - b.textOffset);
    } catch {
      // JSON 解析失败则忽略
    }
  }

  const blocks: MessageBlock[] = [];
  let idCounter = 0;
  let lastOffset = 0;

  for (const tc of toolCalls) {
    const segment = raw.slice(lastOffset, tc.textOffset);
    const { blocks: segBlocks, nextId } = parseTextSegment(segment, idCounter);
    idCounter = nextId;
    for (const b of segBlocks) blocks.push(b);

    const { textOffset: _o, ...entry } = tc;
    blocks.push({ id: `hist-${idCounter++}`, type: 'tool-call', ...entry });

    lastOffset = tc.textOffset;
  }

  const remaining = raw.slice(lastOffset);
  const { blocks: segBlocks } = parseTextSegment(remaining, idCounter);
  for (const b of segBlocks) blocks.push(b);

  return blocks;
}

function parseTextSegment(text: string, startId: number): { blocks: MessageBlock[]; nextId: number } {
  const blocks: MessageBlock[] = [];
  let idCounter = startId;
  const regex = /<think>([\s\S]*?)<\/think>/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(text)) !== null) {
    const textBefore = text.slice(lastIndex, match.index);
    if (textBefore.trim()) blocks.push({ id: `hist-${idCounter++}`, type: 'text', content: textBefore });
    const thinkContent = match[1].trim();
    if (thinkContent) blocks.push({ id: `hist-${idCounter++}`, type: 'thinking', content: thinkContent });
    lastIndex = match.index + match[0].length;
  }

  const textAfter = text.slice(lastIndex);
  if (textAfter.trim()) blocks.push({ id: `hist-${idCounter++}`, type: 'text', content: textAfter });

  return { blocks, nextId: idCounter };
}

// ---- SSE 流解析 ----

const THINK_OPEN = '<think>';
const THINK_CLOSE = '</think>';

export interface DeltaState {
  mode: 'text' | 'thinking';
  /** 上一 delta 尾部疑似标签前缀(如 "<th")的暂存,待与下一 delta 拼接后判定,防止标签跨分块被当文本泄漏 */
  pending: string;
}

/**
 * 处理单个 text-delta。SSE 按模型 token 分块,think 标签可能跨 delta 分割
 * (如 "<th" + "ink>"),必须把尾部疑似标签前缀暂存到 state.pending,与下一 delta 拼接后再判定。
 */
export function processTextDelta(
  delta: string,
  state: DeltaState,
  blocks: MessageBlock[],
  idCounter: { value: number },
): DeltaState {
  let working = state.pending + delta;
  let mode = state.mode;
  let pending = '';

  let guard = 0;
  while (working.length > 0 && guard++ < 1000) {
    if (mode === 'thinking') {
      const closeIdx = working.indexOf(THINK_CLOSE);
      if (closeIdx === -1) {
        const hold = partialTagHold(working, THINK_CLOSE);
        if (hold > 0) {
          appendTextToBlocks(blocks, 'thinking', working.slice(0, working.length - hold), idCounter);
          pending = working.slice(working.length - hold);
        } else {
          appendTextToBlocks(blocks, 'thinking', working, idCounter);
        }
        working = '';
      } else {
        if (closeIdx > 0) appendTextToBlocks(blocks, 'thinking', working.slice(0, closeIdx), idCounter);
        working = working.slice(closeIdx + THINK_CLOSE.length);
        mode = 'text';
      }
    } else {
      const openIdx = working.indexOf(THINK_OPEN);
      const closeIdx = working.indexOf(THINK_CLOSE);
      if (openIdx === -1 && closeIdx === -1) {
        const hold = partialTagHold(working, THINK_OPEN, THINK_CLOSE);
        if (hold > 0) {
          appendTextToBlocks(blocks, 'text', working.slice(0, working.length - hold), idCounter);
          pending = working.slice(working.length - hold);
        } else {
          appendTextToBlocks(blocks, 'text', working, idCounter);
        }
        working = '';
      } else if (closeIdx !== -1 && (openIdx === -1 || closeIdx < openIdx)) {
        // 游离闭标签(模型输出错乱):消费掉,前段保持 text 分类
        if (closeIdx > 0) appendTextToBlocks(blocks, 'text', working.slice(0, closeIdx), idCounter);
        working = working.slice(closeIdx + THINK_CLOSE.length);
      } else {
        if (openIdx > 0) appendTextToBlocks(blocks, 'text', working.slice(0, openIdx), idCounter);
        working = working.slice(openIdx + THINK_OPEN.length);
        mode = 'thinking';
      }
    }
  }
  return { mode, pending };
}

/** 检测 text 尾部是否恰好是某个标签的真前缀(如 "<th"),返回最长匹配长度 */
function partialTagHold(text: string, ...tags: string[]): number {
  let hold = 0;
  for (const tag of tags) {
    const max = Math.min(text.length, tag.length - 1);
    for (let k = max; k > hold; k--) {
      if (text.endsWith(tag.slice(0, k))) {
        hold = k;
        break;
      }
    }
  }
  return hold;
}

function appendTextToBlocks(
  blocks: MessageBlock[],
  type: 'text' | 'thinking',
  content: string,
  idCounter: { value: number },
) {
  if (!content) return;
  const clean = content.replace(/<\/?think>/g, '');
  if (!clean) return;
  const last = blocks[blocks.length - 1];
  if (last && last.type === type) {
    blocks[blocks.length - 1] = {
      ...last,
      content: (last as { content: string }).content + clean,
    } as MessageBlock;
  } else if (clean.trim()) {
    blocks.push({ id: `block-${++idCounter.value}`, type, content: clean } as MessageBlock);
  }
}

import { describe, expect, it, vi } from 'vitest';
import {
  DELTA_FLUSH_MS,
  appendThinkingToBlocks,
  isDeltaEvent,
  isStreamPaused,
  registerDeltaFlusher,
  setStreamPaused,
} from '../src';
import type { ChatSSEEvent, MessageBlock } from '../src';

const flushFrame = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('isDeltaEvent', () => {
  it('文本增量与思考增量属于可合并事件', () => {
    expect(isDeltaEvent({ type: 'text-delta', delta: 'a' } as ChatSSEEvent)).toBe(true);
    expect(isDeltaEvent({ type: 'reasoning-delta', delta: 'b' } as ChatSSEEvent)).toBe(true);
  });

  it('结构性事件必须立即处理', () => {
    expect(isDeltaEvent({ type: 'finish' } as ChatSSEEvent)).toBe(false);
    expect(isDeltaEvent({ type: 'tool-call' } as unknown as ChatSSEEvent)).toBe(false);
  });

  it('合并窗口为正数', () => {
    expect(DELTA_FLUSH_MS).toBeGreaterThan(0);
  });
});

describe('appendThinkingToBlocks', () => {
  it('末块为 thinking 时合并内容', () => {
    const blocks: MessageBlock[] = [{ id: 'b1', type: 'thinking', content: '思考' }];
    appendThinkingToBlocks(blocks, '中', { value: 0 });
    expect(blocks).toHaveLength(1);
    expect(blocks[0]).toMatchObject({ type: 'thinking', content: '思考中' });
  });

  it('末块不是 thinking 时新建块并递增计数器', () => {
    const counter = { value: 0 };
    const blocks: MessageBlock[] = [{ id: 't1', type: 'text', content: '正文' }];
    appendThinkingToBlocks(blocks, '思路', counter);
    expect(blocks).toHaveLength(2);
    expect(blocks[1]).toMatchObject({ id: 'block-1', type: 'thinking', content: '思路' });
    expect(counter.value).toBe(1);
  });

  it('空白内容不新建块', () => {
    const blocks: MessageBlock[] = [];
    appendThinkingToBlocks(blocks, '   ', { value: 0 });
    expect(blocks).toHaveLength(0);
  });
});

describe('setStreamPaused', () => {
  it('暂停期间不补刷，恢复后补刷一次；注销后不再回调', async () => {
    const flush = vi.fn();
    const unregister = registerDeltaFlusher(flush);

    setStreamPaused(true);
    expect(isStreamPaused()).toBe(true);
    await flushFrame();
    expect(flush).not.toHaveBeenCalled();

    setStreamPaused(false);
    await flushFrame();
    expect(flush).toHaveBeenCalledTimes(1);

    unregister();
    setStreamPaused(true);
    setStreamPaused(false);
    await flushFrame();
    expect(flush).toHaveBeenCalledTimes(1);
  });
});

import { describe, expect, it, vi } from 'vitest';
import { consumeSSEStream, parseSSEStream } from '../src/ai/sse.js';
import type { SSEFrame, SseReadableStream } from '../src/ai/sse.js';

describe('parseSSEStream', () => {
  it('解析 event + data JSON 帧', () => {
    const frames: SSEFrame[] = [];
    parseSSEStream('event: text-delta\ndata: {"type":"text-delta","delta":"你好"}', (f) => frames.push(f));
    expect(frames).toEqual([{ event: 'text-delta', data: { type: 'text-delta', delta: '你好' } }]);
  });

  it('未声明 event 时默认 message', () => {
    const frames: SSEFrame[] = [];
    parseSSEStream('data: {"a":1}', (f) => frames.push(f));
    expect(frames).toEqual([{ event: 'message', data: { a: 1 } }]);
  });

  it('[DONE] 帧被跳过', () => {
    const frames: SSEFrame[] = [];
    parseSSEStream('data: [DONE]', (f) => frames.push(f));
    expect(frames).toHaveLength(0);
  });

  it('非 JSON data 被忽略(不抛错)', () => {
    const frames: SSEFrame[] = [];
    expect(() => parseSSEStream('data: not-json', (f) => frames.push(f))).not.toThrow();
    expect(frames).toHaveLength(0);
  });

  it('多帧以空行分隔', () => {
    const frames: SSEFrame[] = [];
    parseSSEStream(
      'event: a\ndata: {"x":1}\n\nevent: b\ndata: {"x":2}\n\n',
      (f) => frames.push(f),
    );
    expect(frames.map((f) => f.event)).toEqual(['a', 'b']);
  });

  it('多行 data 以换行拼接', () => {
    const frames: SSEFrame[] = [];
    parseSSEStream('event: big\ndata: {"a":\ndata: 1}', (f) => frames.push(f));
    expect(frames).toEqual([{ event: 'big', data: { a: 1 } }]);
  });

  it('event/data 冒号后空格可选', () => {
    const frames: SSEFrame[] = [];
    parseSSEStream('event:finish\ndata:{"ok":true}', (f) => frames.push(f));
    expect(frames).toEqual([{ event: 'finish', data: { ok: true } }]);
  });

  it('无关行被忽略', () => {
    const frames: SSEFrame[] = [];
    parseSSEStream(': comment\nid: 42\nevent: e\ndata: {}', (f) => frames.push(f));
    expect(frames).toEqual([{ event: 'e', data: {} }]);
  });
});

/** 构造分块输出的模拟可读流 */
function fakeStream(chunks: string[]): SseReadableStream {
  const encoder = new TextEncoder();
  let i = 0;
  return {
    getReader() {
      return {
        async read(): Promise<{ done: boolean; value?: Uint8Array }> {
          if (i < chunks.length) return { done: false, value: encoder.encode(chunks[i++]) };
          return { done: true, value: undefined };
        },
      };
    },
  };
}

describe('consumeSSEStream', () => {
  it('按帧回调', async () => {
    const onFrame = vi.fn();
    await consumeSSEStream(
      { body: fakeStream(['event: a\ndata: {"x":1}\n\nevent: b\ndata: {"x":2}\n\n']) },
      onFrame,
    );
    expect(onFrame).toHaveBeenCalledTimes(2);
    expect(onFrame).toHaveBeenNthCalledWith(1, { event: 'a', data: { x: 1 } });
    expect(onFrame).toHaveBeenNthCalledWith(2, { event: 'b', data: { x: 2 } });
  });

  it('帧跨 chunk 分割时缓冲到完整再解析', async () => {
    const onFrame = vi.fn();
    await consumeSSEStream(
      { body: fakeStream(['event: a\ndata: {"x"', ':1}\n\nevent: b\ndata: {"x":2}\n\n']) },
      onFrame,
    );
    expect(onFrame).toHaveBeenCalledTimes(2);
    expect(onFrame).toHaveBeenNthCalledWith(1, { event: 'a', data: { x: 1 } });
  });

  it('流结尾的无空行残留帧也会被解析', async () => {
    const onFrame = vi.fn();
    await consumeSSEStream({ body: fakeStream(['event: tail\ndata: {"z":3}']) }, onFrame);
    expect(onFrame).toHaveBeenCalledWith({ event: 'tail', data: { z: 3 } });
  });

  it('body 为空直接结束', async () => {
    const onFrame = vi.fn();
    await consumeSSEStream({ body: null }, onFrame);
    expect(onFrame).not.toHaveBeenCalled();
  });

  it('空 chunk 流不产生帧', async () => {
    const onFrame = vi.fn();
    await consumeSSEStream({ body: fakeStream([]) }, onFrame);
    expect(onFrame).not.toHaveBeenCalled();
  });
});

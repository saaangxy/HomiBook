import { describe, expect, it } from 'vitest';
import { parseContentIntoBlocks, processTextDelta } from '../src/ai/content-parser.js';
import type { MessageBlock } from '../src/types/index.js';

// 用 unicode 转义构造 think 标签,避免字面量被工具链吞掉
const OPEN = '\u003cthink\u003e';
const CLOSE = '\u003c/think\u003e';

describe('parseContentIntoBlocks', () => {
  it('纯文本 → 单个 text 块', () => {
    expect(parseContentIntoBlocks('你好')).toEqual([{ id: 'hist-0', type: 'text', content: '你好' }]);
  });

  it('think 标签拆分为 text / thinking / text', () => {
    const blocks = parseContentIntoBlocks(`前${OPEN}思考中${CLOSE}后`);
    expect(blocks.map((b) => [b.type, b.content])).toEqual([
      ['text', '前'],
      ['thinking', '思考中'],
      ['text', '后'],
    ]);
  });

  it('空 think 内容不产生块(前后文本为两个独立 text 块)', () => {
    const blocks = parseContentIntoBlocks(`前${OPEN}${CLOSE}后`);
    expect(blocks.map((b) => b.type)).toEqual(['text', 'text']);
  });

  it('仅 think 内容', () => {
    const blocks = parseContentIntoBlocks(`${OPEN}推理${CLOSE}`);
    expect(blocks).toEqual([{ id: 'hist-0', type: 'thinking', content: '推理' }]);
  });

  it('storedToolCalls 按偏移插入 tool-call 块', () => {
    const raw = 'abc';
    const stored = JSON.stringify([{ textOffset: 1, toolCallId: 't1', toolName: 'query_records', status: 'success' }]);
    const blocks = parseContentIntoBlocks(raw, stored);
    expect(blocks.map((b) => b.type)).toEqual(['text', 'tool-call', 'text']);
    expect((blocks[0] as { content: string }).content).toBe('a');
    const tool = blocks[1] as { type: string; toolCallId: string; toolName: string };
    expect(tool.toolCallId).toBe('t1');
    expect(tool.toolName).toBe('query_records');
    expect((blocks[2] as { content: string }).content).toBe('bc');
  });

  it('多个 toolCalls 未按序传入时按 textOffset 排序', () => {
    const raw = 'x'.repeat(30);
    const stored = JSON.stringify([
      { textOffset: 20, toolCallId: 't2', toolName: 'b', status: 'pending' },
      { textOffset: 5, toolCallId: 't1', toolName: 'a', status: 'pending' },
    ]);
    const blocks = parseContentIntoBlocks(raw, stored);
    expect(blocks.map((b) => b.type)).toEqual(['text', 'tool-call', 'text', 'tool-call', 'text']);
    expect((blocks[1] as { toolCallId: string }).toolCallId).toBe('t1');
    expect((blocks[3] as { toolCallId: string }).toolCallId).toBe('t2');
    // 两个 tool 之间的文本段 = [5, 20)
    expect((blocks[2] as { content: string }).content).toBe('x'.repeat(15));
  });

  it('storedToolCalls 非法 JSON 时忽略,按纯文本解析', () => {
    const blocks = parseContentIntoBlocks('hello', 'not-json');
    expect(blocks).toEqual([{ id: 'hist-0', type: 'text', content: 'hello' }]);
  });

  it('tool-call 块保留 entry 全部字段', () => {
    const stored = JSON.stringify([
      { textOffset: 0, toolCallId: 't9', toolName: 'create_record', status: 'confirming', preview: 'record-changes', durationMs: 12 },
    ]);
    const blocks = parseContentIntoBlocks('rest', stored);
    const tool = blocks[0] as Record<string, unknown>;
    expect(tool['toolCallId']).toBe('t9');
    expect(tool['status']).toBe('confirming');
    expect(tool['preview']).toBe('record-changes');
    expect(tool['durationMs']).toBe(12);
    // textOffset 为内部字段,不进入块
    expect(tool['textOffset']).toBeUndefined();
  });

  it('文本与 think 混合并保留块 id 自增序', () => {
    const blocks = parseContentIntoBlocks(`a${OPEN}b${CLOSE}c`);
    expect(blocks.map((b) => b.id)).toEqual(['hist-0', 'hist-1', 'hist-2']);
  });
});

describe('processTextDelta', () => {
  const newCounter = () => ({ value: 0 });

  it('text 状态纯文本 → 追加 text 块,状态不变', () => {
    const blocks: MessageBlock[] = [];
    const state = processTextDelta('你好', 'text', blocks, newCounter());
    expect(state).toBe('text');
    expect(blocks).toEqual([{ id: 'block-1', type: 'text', content: '你好' }]);
  });

  it('连续 delta 合并到同一 text 块', () => {
    const blocks: MessageBlock[] = [];
    const counter = newCounter();
    processTextDelta('你', 'text', blocks, counter);
    processTextDelta('好', 'text', blocks, counter);
    expect(blocks).toHaveLength(1);
    expect((blocks[0] as { content: string }).content).toBe('你好');
  });

  it('开标签进入 thinking 状态', () => {
    const blocks: MessageBlock[] = [];
    const state = processTextDelta(`A${OPEN}B`, 'text', blocks, newCounter());
    expect(state).toBe('thinking');
    expect(blocks.map((b) => [b.type, b.content])).toEqual([
      ['text', 'A'],
      ['thinking', 'B'],
    ]);
  });

  it('闭标签回到 text 状态', () => {
    const blocks: MessageBlock[] = [];
    const state = processTextDelta(`C${CLOSE}`, 'thinking', blocks, newCounter());
    expect(state).toBe('text');
    expect(blocks).toEqual([{ id: 'block-1', type: 'thinking', content: 'C' }]);
  });

  it('单个 delta 内完整开闭标签', () => {
    const blocks: MessageBlock[] = [];
    const state = processTextDelta(`A${OPEN}B${CLOSE}D`, 'text', blocks, newCounter());
    expect(state).toBe('text');
    expect(blocks.map((b) => [b.type, b.content])).toEqual([
      ['text', 'A'],
      ['thinking', 'B'],
      ['text', 'D'],
    ]);
  });

  it('thinking 状态持续无闭标签 → 全部进入 thinking', () => {
    const blocks: MessageBlock[] = [];
    const state = processTextDelta('继续思考', 'thinking', blocks, newCounter());
    expect(state).toBe('thinking');
    expect(blocks).toEqual([{ id: 'block-1', type: 'thinking', content: '继续思考' }]);
  });

  it('text 状态出现游离闭标签 → 被消费,状态保持 text', () => {
    const blocks: MessageBlock[] = [];
    const state = processTextDelta(`${CLOSE}abc`, 'text', blocks, newCounter());
    expect(state).toBe('text');
    expect(blocks).toEqual([{ id: 'block-1', type: 'text', content: 'abc' }]);
  });

  it('thinking 状态内残留的开标签被清洗', () => {
    const blocks: MessageBlock[] = [];
    processTextDelta(`a${OPEN}b`, 'thinking', blocks, newCounter());
    expect(blocks).toEqual([{ id: 'block-1', type: 'thinking', content: 'ab' }]);
  });

  it('空 delta 不改变状态与块', () => {
    const blocks: MessageBlock[] = [];
    const state = processTextDelta('', 'thinking', blocks, newCounter());
    expect(state).toBe('thinking');
    expect(blocks).toHaveLength(0);
  });

  it('纯空白内容不创建新块,但会合并进同类型已有块', () => {
    const blocks: MessageBlock[] = [{ id: 'block-1', type: 'text', content: 'a' }];
    processTextDelta(' ', 'text', blocks, newCounter());
    expect((blocks[0] as { content: string }).content).toBe('a ');

    const empty: MessageBlock[] = [];
    processTextDelta(' ', 'text', empty, newCounter());
    expect(empty).toHaveLength(0);
  });
});

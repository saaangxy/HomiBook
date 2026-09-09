import { describe, expect, it } from 'vitest';
import { resolveToolCallStatus } from '../src/ai/tool-status.js';
import type { ToolCallEntry } from '../src/types/index.js';

/** 构造 ToolCallEntry,默认 pending 状态 */
const tc = (partial: Partial<ToolCallEntry> & Pick<ToolCallEntry, 'toolName'>): ToolCallEntry => ({
  toolCallId: 'tc-1',
  status: 'pending',
  ...partial,
});

describe('resolveToolCallStatus', () => {
  it('非 pending 状态直接透传且不过期', () => {
    const entry = tc({ toolName: 'query_records', status: 'success', result: { total: 1 } });
    expect(resolveToolCallStatus(entry)).toEqual({
      effectiveStatus: 'success',
      effectiveSuggestion: undefined,
      isExpired: false,
      expiredMessage: undefined,
    });
  });

  it('非 pending 状态透传已有 suggestion', () => {
    const suggestion = { questions: [] };
    const entry = tc({ toolName: 'suggest_options', status: 'error', suggestion });
    expect(resolveToolCallStatus(entry).effectiveSuggestion).toBe(suggestion);
  });

  it('suggest_options 带 questions → suggesting,历史重载视为过期', () => {
    const entry = tc({
      toolName: 'suggest_options',
      args: { questions: [{ question: '选哪个', field: 'type', options: ['收入', '支出'], allowCustom: false }] },
    });
    const r = resolveToolCallStatus(entry);
    expect(r.effectiveStatus).toBe('suggesting');
    expect(r.effectiveSuggestion?.questions).toHaveLength(1);
    expect(r.isExpired).toBe(true);
    expect(r.expiredMessage).toBeUndefined();
  });

  it('suggest_options 已决定(decisionData 暂存) → 不再视为过期(2026-09-08 回归)', () => {
    const entry = tc({
      toolName: 'suggest_options',
      args: { questions: [{ question: 'q', field: 'f', options: ['a'], allowCustom: false }] },
      decisionData: { selected: 'a' },
    });
    const r = resolveToolCallStatus(entry);
    expect(r.effectiveStatus).toBe('suggesting');
    expect(r.isExpired).toBe(false);
  });

  it('suggest_options 无 questions 时走后续分支(有 result → success)', () => {
    const entry = tc({ toolName: 'suggest_options', args: {}, result: { ok: true } });
    expect(resolveToolCallStatus(entry).effectiveStatus).toBe('success');
  });

  it('switch_book 有 result.books → switching;历史重载过期并带文案', () => {
    const entry = tc({
      toolName: 'switch_book',
      result: { books: [{ id: 'b1', name: '家庭账本', role: 'OWNER', memberCount: 1, isCurrent: false }] },
    });
    const r = resolveToolCallStatus(entry);
    expect(r.effectiveStatus).toBe('switching');
    expect(r.isExpired).toBe(true);
    expect(r.expiredMessage).toBe('切换操作已过期，请重新发起');
  });

  it('switch_book 已决定(decisionData) → 不过期且无过期文案', () => {
    const entry = tc({
      toolName: 'switch_book',
      result: { books: [{ id: 'b1', name: 'x', role: 'OWNER', memberCount: 1, isCurrent: false }] },
      decisionData: { bookId: 'b1' },
    });
    const r = resolveToolCallStatus(entry);
    expect(r.effectiveStatus).toBe('switching');
    expect(r.isExpired).toBe(false);
    expect(r.expiredMessage).toBeUndefined();
  });

  it('switch_book 有 result 但无 books → success', () => {
    const entry = tc({ toolName: 'switch_book', result: { currentBookId: 'b1' } });
    expect(resolveToolCallStatus(entry).effectiveStatus).toBe('success');
  });

  it('pending + result → success', () => {
    const entry = tc({ toolName: 'create_record', result: { id: 'r1' } });
    const r = resolveToolCallStatus(entry);
    expect(r.effectiveStatus).toBe('success');
    expect(r.isExpired).toBe(false);
  });

  it('pending + preview → confirming 且历史重载过期', () => {
    const entry = tc({ toolName: 'create_record', preview: 'records-table' });
    const r = resolveToolCallStatus(entry);
    expect(r.effectiveStatus).toBe('confirming');
    expect(r.isExpired).toBe(true);
    expect(r.expiredMessage).toBeUndefined();
  });

  it('preview_import 预览模式无 result → error + 过期文案', () => {
    const entry = tc({ toolName: 'preview_import', args: { mode: 'preview' } });
    const r = resolveToolCallStatus(entry);
    expect(r.effectiveStatus).toBe('error');
    expect(r.expiredMessage).toBe('导入预览数据已过期，请重新上传文件发起导入');
  });

  it('confirm_import 无 result → error + 过期文案', () => {
    const entry = tc({ toolName: 'confirm_import', args: {} });
    const r = resolveToolCallStatus(entry);
    expect(r.effectiveStatus).toBe('error');
    expect(r.expiredMessage).toBe('导入确认已过期，请重新发起导入');
  });

  it('普通 pending 工具无 result/preview → 维持 pending', () => {
    const entry = tc({ toolName: 'query_records', args: {} });
    const r = resolveToolCallStatus(entry);
    expect(r.effectiveStatus).toBe('pending');
    expect(r.isExpired).toBe(false);
  });
});

import { describe, expect, it } from 'vitest';
import { isAwaitingUserAction, resolveToolCallStatus } from '../src/ai/tool-status.js';
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

describe('isAwaitingUserAction(同一条消息里是否还有等用户点的卡)', () => {
  it('preview_import 只有 mode=preview 才算等用户点', () => {
    const preview = tc({ toolName: 'preview_import', args: { mode: 'preview' }, status: 'success', result: { data: {} } });
    expect(isAwaitingUserAction(preview)).toBe(true);

    // 导入流程第一步是 mode=analyze(查询),UI 不渲染卡片也没有按钮 ——
    // 若把它算作「待点」,用户点完所有卡片也不会提交 decisions(实测踩过)
    const analyze = tc({ toolName: 'preview_import', args: { mode: 'analyze' }, status: 'success', result: { data: {} } });
    expect(isAwaitingUserAction(analyze)).toBe(false);
    // args 缺失(旧数据)→ 不作为卡片拦住提交
    expect(isAwaitingUserAction(tc({ toolName: 'preview_import', status: 'success', result: { data: {} } }))).toBe(false);
  });

  it('confirm_import 只有 confirm_preview 才算等用户点(执行完的回执不算)', () => {
    const card = tc({ toolName: 'confirm_import', status: 'success', result: { data: { mode: 'confirm_preview' } } });
    expect(isAwaitingUserAction(card)).toBe(true);

    const receipt = tc({ toolName: 'confirm_import', status: 'success', result: { data: { imported: 12, accountsCreated: 0 } } });
    expect(isAwaitingUserAction(receipt)).toBe(false);
  });

  it('点过(decided)/ 已确认(confirmed)/ 状态不是成功态的卡不再等', () => {
    const base: Partial<ToolCallEntry> & Pick<ToolCallEntry, 'toolName'> =
      { toolName: 'preview_import', args: { mode: 'preview' }, status: 'success', result: { data: {} } };
    expect(isAwaitingUserAction(tc({ ...base, decided: true }))).toBe(false);
    expect(isAwaitingUserAction(tc({ ...base, status: 'error' }))).toBe(false);
    expect(isAwaitingUserAction(tc({ ...base, result: { data: { confirmed: true } } }))).toBe(false);
  });

  it('历史快照(原始 status=pending 但有 result)仍算等用户点 —— 判定必须按 UI 的真实状态', () => {
    // 会话从历史加载时块的原始 status 可能仍是 pending，而 UI 用 resolveToolCallStatus 判成 success
    // 并把卡片渲染出来。若读原始 status，这种卡会被漏掉 →「等待全部确认 · 剩余 N 个」永远不显示。
    const snapshot = tc({ toolName: 'preview_import', args: { mode: 'preview' }, status: 'pending', result: { data: {} } });
    expect(resolveToolCallStatus(snapshot).effectiveStatus).toBe('success');
    expect(isAwaitingUserAction(snapshot)).toBe(true);
  });

  it('preview_import 没有 result 的历史快照 → 不渲染卡片，也不算等用户点', () => {
    const expired = tc({ toolName: 'preview_import', args: { mode: 'preview' }, status: 'pending' });
    expect(resolveToolCallStatus(expired).effectiveStatus).toBe('error');
    expect(isAwaitingUserAction(expired)).toBe(false);
  });

  it('中间态(待确认/待选择/待选账本)仍算等用户操作', () => {
    for (const status of ['confirming', 'suggesting', 'switching'] as const) {
      expect(isAwaitingUserAction(tc({ toolName: 'create_record', status }))).toBe(true);
    }
  });

  it('普通工具成功不算等用户点', () => {
    expect(isAwaitingUserAction(tc({ toolName: 'query_accounts', status: 'success', result: { data: {} } }))).toBe(false);
    expect(isAwaitingUserAction(tc({ toolName: 'create_record', status: 'success' }))).toBe(false);
  });
});

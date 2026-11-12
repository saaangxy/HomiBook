import { describe, expect, it } from 'vitest';
import { buildActivePath, collectDescendantIds, planRetryRemoval } from '../src';
import type { Message } from '../src';

const msg = (id: string, parent?: string, dbId?: string): Message => ({
  id,
  dbId,
  parentMessageId: parent,
  role: 'user',
  blocks: [],
});

describe('buildActivePath', () => {
  it('空消息列表返回空路径', () => {
    expect(buildActivePath([], {})).toEqual([]);
  });

  it('沿线性链走到叶子', () => {
    const m1 = msg('m1');
    const m2 = msg('m2', 'm1');
    const m3 = msg('m3', 'm2');
    expect(buildActivePath([m1, m2, m3], {})).toEqual([m1, m2, m3]);
  });

  it('多分支时默认取最后一个子节点', () => {
    const root = msg('r');
    const c1 = msg('c1', 'r');
    const c2 = msg('c2', 'r');
    expect(buildActivePath([root, c1, c2], {})).toEqual([root, c2]);
  });

  it('branchSelections 指定选中分支', () => {
    const root = msg('r');
    const c1 = msg('c1', 'r');
    const c2 = msg('c2', 'r');
    expect(buildActivePath([root, c1, c2], { r: 'c1' })).toEqual([root, c1]);
  });

  it('branchSelections 指向不存在的子节点时回退最后一个', () => {
    const root = msg('r');
    const c1 = msg('c1', 'r');
    const c2 = msg('c2', 'r');
    expect(buildActivePath([root, c1, c2], { r: 'ghost' })).toEqual([root, c2]);
  });

  it('父链使用 dbId 亦可通行', () => {
    const m1 = msg('i1', undefined, 'd1');
    const m2 = msg('i2', 'd1', 'd2');
    expect(buildActivePath([m1, m2], {})).toEqual([m1, m2]);
  });

  it('parentMessageId 指向不存在的消息 → 该消息视为根', () => {
    const orphan = msg('o', 'ghost');
    const child = msg('c', 'o');
    expect(buildActivePath([orphan, child], {})).toEqual([orphan, child]);
  });

  it('多个无父消息:第一个作为根,其余按孤儿回退追加', () => {
    const m1 = msg('m1');
    const m2 = msg('m2');
    expect(buildActivePath([m1, m2], {})).toEqual([m1, m2]);
  });

  it('断链孤儿消息按原顺序追加到路径尾部', () => {
    const root = msg('r');
    const child = msg('c', 'r');
    const broken = msg('b', 'ghost');
    const path = buildActivePath([root, child, broken], {});
    expect(path).toEqual([root, child, broken]);
  });

  it('多根场景:本地 greeting 后无父消息的临时链完整渲染(首个提问不丢回复)', () => {
    // 模拟 web 端:会话含本地 greeting(无 dbId),首次提问 user/assistant 均为临时消息且无 parent
    const greeting = msg('greeting');
    const user = msg('u1');
    const assistant = msg('a1', 'u1');
    const path = buildActivePath([greeting, user, assistant], {});
    expect(path).toEqual([greeting, user, assistant]);
  });

  it('断链孤儿带子链时整链渲染', () => {
    const root = msg('r');
    const child = msg('c', 'r');
    const broken = msg('b', 'ghost');
    const brokenChild = msg('bc', 'b');
    const path = buildActivePath([root, child, broken, brokenChild], {});
    expect(path).toEqual([root, child, broken, brokenChild]);
  });

  it('选中分支后继续沿该分支向下', () => {
    const root = msg('r');
    const a = msg('a', 'r');
    const a1 = msg('a1', 'a');
    const b = msg('b', 'r');
    const b1 = msg('b1', 'b');
    expect(buildActivePath([root, a, a1, b, b1], { r: 'a' })).toEqual([root, a, a1]);
  });
});

describe('collectDescendantIds', () => {
  const r = msg('r');
  const a = msg('a', 'r');
  const b = msg('b', 'a');
  const c = msg('c', 'r');
  const d = msg('d', 'b');
  const all = [r, a, b, c, d];

  it('收集全部后代(含起点)', () => {
    expect(collectDescendantIds(all, 'r')).toEqual(new Set(['r', 'a', 'b', 'c', 'd']));
  });

  it('只收集指定子树的子孙', () => {
    expect(collectDescendantIds(all, 'a')).toEqual(new Set(['a', 'b', 'd']));
  });

  it('叶子节点仅含自身', () => {
    expect(collectDescendantIds(all, 'd')).toEqual(new Set(['d']));
  });

  it('以 dbId 作为父引用时能被遍历到', () => {
    const parent = msg('p', undefined, 'pd');
    const child = msg('ch', 'pd');
    expect(collectDescendantIds([parent, child], 'pd')).toEqual(new Set(['pd', 'ch']));
  });
});

describe('planRetryRemoval', () => {
  const withText = (m: Message, role: 'user' | 'assistant', text: string): Message => ({
    ...m,
    role,
    blocks: [{ id: `${m.id}-t`, type: 'text', content: text }],
  });

  const build = (): Message[] => [
    withText(msg('u1', undefined, 'u1d'), 'user', '第一问'),
    withText(msg('a1', 'u1d', 'a1d'), 'assistant', '答一'),
    withText(msg('u2', undefined, 'u2d'), 'user', '第二问'),
    withText(msg('a2', 'u2d', 'a2d'), 'assistant', '答二'),
  ];

  it('删除目标助手消息及其后代，同时删除原用户消息', () => {
    const plan = planRetryRemoval(build(), {}, 'a2');
    expect(plan).not.toBeNull();
    expect(plan!.text).toBe('第二问');
    expect(plan!.keptMessages.map((m) => m.id)).toEqual(['u1', 'a1']);
  });

  it('索引为 0 的助手消息不可重试', () => {
    expect(planRetryRemoval([withText(msg('a1'), 'assistant', '答')], {}, 'a1')).toBeNull();
  });

  it('前一条不是用户消息时不可重试', () => {
    const messages = [withText(msg('a1'), 'assistant', '答一'), withText(msg('a2'), 'assistant', '答二')];
    expect(planRetryRemoval(messages, {}, 'a2')).toBeNull();
  });
});

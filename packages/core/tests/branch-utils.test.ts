import { describe, expect, it } from 'vitest';
import { buildActivePath, collectDescendantIds } from '../src/ai/branch-utils.js';
import type { Message } from '../src/types/index.js';

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

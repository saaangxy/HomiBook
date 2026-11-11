import { describe, expect, it } from 'vitest';
import { pickDeletableAttachments } from '../src/services/attachment-orphan.js';

const att = (id: string) => ({ id, path: `/api/uploads/${id}.png` });

describe('pickDeletableAttachments', () => {
  it('仍挂在其他流水上的附件不删（多对多共享）', () => {
    const out = pickDeletableAttachments([att('a'), att('b')], ['b'], []);
    expect(out.map((x) => x.id)).toEqual(['a']);
  });

  it('被聊天消息引用的附件不删', () => {
    const out = pickDeletableAttachments([att('a'), att('b')], [], ['a']);
    expect(out.map((x) => x.id)).toEqual(['b']);
  });

  it('只从候选里挑，不引入外部附件', () => {
    const out = pickDeletableAttachments([att('a')], ['other'], ['another']);
    expect(out.map((x) => x.id)).toEqual(['a']);
  });

  it('同时被流水与聊天引用时不删', () => {
    expect(pickDeletableAttachments([att('a')], ['a'], ['a'])).toEqual([]);
  });

  it('空候选返回空', () => {
    expect(pickDeletableAttachments([], ['a'], ['b'])).toEqual([]);
  });
});

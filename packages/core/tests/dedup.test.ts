import { describe, expect, it } from 'vitest';
import {
  buildDuplicateKey,
  parseDuplicateGroupKey,
  DEFAULT_DEDUP_MATCH_FIELDS,
  DEDUP_EMPTY_PAYER,
  DUPLICATE_MERGE_REMARK_MAX,
  DUPLICATE_MERGE_TYPE_MISMATCH,
  mergeDuplicateRemarks,
  mergeDuplicateTags,
  planDuplicateMerge,
  planDuplicateMergeBatch,
  summarizeDuplicateMerge,
} from '../src/dedup.js';
import type { DedupKeyRecord, DedupMatchFields, DuplicateMergeRecord } from '../src/dedup.js';

const rec: DedupKeyRecord = {
  date: '2024-01-15T02:30:00.000Z',
  type: 'EXPENSE',
  accountId: 'acc1',
  payer: '张三',
  amount: 12.5,
  ownerId: 'owner1',
};

const ALL_ON: DedupMatchFields = {
  date: 'exact',
  type: true,
  accountId: true,
  payer: true,
  amount: true,
  ownerId: true,
};

describe('buildDuplicateKey · 分钟精度', () => {
  // 场景:同一笔在短信 / 通知 / 导入里各来一条,时间戳常相差几秒 ——
  // 精确到秒会漏判,同日又太宽,「同一分钟」正好卡住同一笔
  const MINUTE: DedupMatchFields = { ...ALL_ON, date: 'minute' };
  const at = (iso: string): DedupKeyRecord => ({ ...rec, date: iso });

  it('同一分钟内不同秒 → 同一组', () => {
    expect(buildDuplicateKey(at('2024-01-15T02:30:05.000Z'), MINUTE)).toBe(
      buildDuplicateKey(at('2024-01-15T02:30:58.000Z'), MINUTE),
    );
  });

  it('跨分钟 → 不同组(比「同日」精)', () => {
    expect(buildDuplicateKey(at('2024-01-15T02:30:59.000Z'), MINUTE)).not.toBe(
      buildDuplicateKey(at('2024-01-15T02:31:00.000Z'), MINUTE),
    );
  });

  it('组 key 展示为 YYYY-MM-DD HH:mm(不带秒与 T)', () => {
    const key = buildDuplicateKey(at('2024-01-15T02:30:05.000Z'), MINUTE);
    expect(parseDuplicateGroupKey(key, MINUTE)[0]).toBe('日期: 2024-01-15 02:30');
  });
});

describe('buildDuplicateKey', () => {
  it('默认字段(date 默认「同分钟」,ownerId 关闭)', () => {
    expect(buildDuplicateKey(rec, DEFAULT_DEDUP_MATCH_FIELDS)).toBe(
      '2024-01-15T02:30||EXPENSE||acc1||张三||12.50',
    );
  });

  it('全字段开启(date 精确到秒,含归属人)', () => {
    expect(buildDuplicateKey(rec, ALL_ON)).toBe(
      '2024-01-15T02:30:00.000Z||EXPENSE||acc1||张三||12.50||owner1',
    );
  });

  it('date 为 null 时不含日期段', () => {
    const f = { ...ALL_ON, date: null };
    expect(buildDuplicateKey(rec, f)).toBe('EXPENSE||acc1||张三||12.50||owner1');
  });

  it('交易方为空时使用占位值', () => {
    const f = { ...ALL_ON, date: null };
    expect(buildDuplicateKey({ ...rec, payer: null }, f)).toContain(`||${DEDUP_EMPTY_PAYER}||`);
    expect(buildDuplicateKey({ ...rec, payer: '' }, f)).toContain(`||${DEDUP_EMPTY_PAYER}||`);
  });

  it('金额固定两位小数', () => {
    const f = { ...ALL_ON, date: null };
    expect(buildDuplicateKey({ ...rec, amount: 12 }, f)).toContain('||12.00||');
    expect(buildDuplicateKey({ ...rec, amount: 12.456 }, f)).toContain('||12.46||');
  });

  it('Date 对象与 ISO 字符串生成相同 key', () => {
    expect(buildDuplicateKey({ ...rec, date: new Date('2024-01-15T02:30:00.000Z') }, ALL_ON)).toBe(
      buildDuplicateKey(rec, ALL_ON),
    );
  });

  it('全部字段关闭时为空串', () => {
    const f: DedupMatchFields = {
      date: null, type: false, accountId: false, payer: false, amount: false, ownerId: false,
    };
    expect(buildDuplicateKey(rec, f)).toBe('');
  });
});

describe('parseDuplicateGroupKey', () => {
  it('默认字段 roundtrip:标签顺序与字段一致', () => {
    const key = buildDuplicateKey(rec, DEFAULT_DEDUP_MATCH_FIELDS);
    expect(parseDuplicateGroupKey(key, DEFAULT_DEDUP_MATCH_FIELDS)).toEqual([
      '日期: 2024-01-15 02:30',
      '类型: 支出',
      '账户: acc1',
      '交易方: 张三',
      '金额: 12.50',
    ]);
  });

  it('账户/归属人优先显示名称映射', () => {
    const key = buildDuplicateKey(rec, ALL_ON);
    const labels = parseDuplicateGroupKey(key, ALL_ON, {
      accountDisplay: new Map([['acc1', '微信 · 张三']]),
      ownerNames: new Map([['owner1', '张三']]),
    });
    expect(labels).toContain('账户: 微信 · 张三');
    expect(labels).toContain('归属人: 张三');
  });

  it('精确日期默认格式化为 YYYY-MM-DD HH:mm:ss', () => {
    const labels = parseDuplicateGroupKey(buildDuplicateKey(rec, ALL_ON), ALL_ON);
    expect(labels[0]).toBe('日期: 2024-01-15 02:30:00');
  });

  it('自定义日期格式化函数', () => {
    const labels = parseDuplicateGroupKey(buildDuplicateKey(rec, ALL_ON), ALL_ON, {
      formatDateTime: (iso) => iso.slice(0, 10),
    });
    expect(labels[0]).toBe('日期: 2024-01-15');
  });

  it('空交易方显示(空)', () => {
    const f = { ...ALL_ON, date: null };
    const key = buildDuplicateKey({ ...rec, payer: null }, f);
    expect(parseDuplicateGroupKey(key, f)).toContain('交易方: (空)');
  });

  it('未知类型回退显示原文', () => {
    const f = { ...DEFAULT_DEDUP_MATCH_FIELDS, date: null };
    const key = buildDuplicateKey({ ...rec, type: 'REFUND' }, f);
    expect(parseDuplicateGroupKey(key, f)).toContain('类型: REFUND');
  });

  it('字段开关与标签数量一致(roundtrip 性质)', () => {
    const combos: DedupMatchFields[] = [
      DEFAULT_DEDUP_MATCH_FIELDS,
      ALL_ON,
      { ...ALL_ON, date: null, payer: false, amount: false },
    ];
    for (const f of combos) {
      const key = buildDuplicateKey(rec, f);
      const enabled = Object.values(f).filter(Boolean).length;
      expect(parseDuplicateGroupKey(key, f)).toHaveLength(enabled);
    }
  });
});

// ── 重复组合并 ──

/** 构造组内记录:调用顺序即组顺序,**第一条是保留记录** */
const mergeRec = (id: string, over: Partial<DuplicateMergeRecord> = {}): DuplicateMergeRecord => ({
  id,
  accountId: 'acc1',
  type: 'EXPENSE',
  categoryCode: null,
  payer: null,
  remark: null,
  tags: [],
  attachments: [],
  ...over,
});

describe('mergeDuplicateRemarks / mergeDuplicateTags', () => {
  it('备注拼接:非空、去重、保持顺序(保留记录在前)', () => {
    expect(mergeDuplicateRemarks(['午餐', null, '聚餐', '午餐', '  '])).toBe('午餐 / 聚餐');
  });

  it('全空 → null', () => {
    expect(mergeDuplicateRemarks([null, undefined, ''])).toBeNull();
  });

  it(`超 ${DUPLICATE_MERGE_REMARK_MAX} 字截断`, () => {
    const long = '长'.repeat(300);
    expect(mergeDuplicateRemarks([long, `${long}后缀`])).toHaveLength(DUPLICATE_MERGE_REMARK_MAX);
  });

  it('标签并集保序去重', () => {
    expect(mergeDuplicateTags([['固定收支'], ['经营', '固定收支'], []])).toEqual(['固定收支', '经营']);
  });
});

describe('planDuplicateMerge · 空值补齐与冲突', () => {
  it('保留记录分类为空且组内只有一个候选 → 自动补齐,不打扰用户', () => {
    const plan = planDuplicateMerge([mergeRec('a'), mergeRec('b', { categoryCode: '餐饮' })]);
    expect(plan.patch.categoryCode).toBe('餐饮');
    expect(plan.autoFilled.some((f) => f.field === 'categoryCode' && f.fromId === 'b')).toBe(true);
    expect(plan.conflicts).toHaveLength(0);
    expect(plan.needsReview).toBe(false);
  });

  it('≥2 个不同非空值 → 冲突,默认值为保留记录的值', () => {
    const plan = planDuplicateMerge([
      mergeRec('a', { categoryCode: '餐饮' }),
      mergeRec('b', { categoryCode: '交通' }),
      mergeRec('c', { categoryCode: '餐饮' }),
    ]);
    const conflict = plan.conflicts.find((c) => c.field === 'categoryCode');
    expect(conflict?.default).toBe('餐饮');
    expect(conflict?.options).toEqual([
      { value: '餐饮', count: 2, recordIds: ['a', 'c'] },
      { value: '交通', count: 1, recordIds: ['b'] },
    ]);
    expect(plan.needsReview).toBe(true);
    // 不传 choices 时：用默认值(第一条) → 这一列不需要写
    expect(plan.patch.categoryCode).toBeUndefined();
  });

  it('用户选了组内存在的其它值 → 写入 patch', () => {
    const plan = planDuplicateMerge(
      [mergeRec('a', { categoryCode: '餐饮' }), mergeRec('b', { categoryCode: '交通' })],
      { categoryCode: '交通' },
    );
    expect(plan.patch.categoryCode).toBe('交通');
  });

  it('用户选了组内不存在的值 → 忽略并回退默认(防伪造)', () => {
    const plan = planDuplicateMerge(
      [mergeRec('a', { categoryCode: '餐饮' }), mergeRec('b', { categoryCode: '交通' })],
      { categoryCode: '伪造分类' },
    );
    expect(plan.patch.categoryCode).toBeUndefined();
  });

  it('分类可显式选择「不填」:即使组内没人留空也能清空', () => {
    const plan = planDuplicateMerge(
      [mergeRec('a', { categoryCode: '餐饮' }), mergeRec('b', { categoryCode: '交通' })],
      { categoryCode: null },
    );
    expect(plan.patch.categoryCode).toBeNull();
  });

  it('组内有空值时,「空」作为候选出现在 options 里', () => {
    const plan = planDuplicateMerge([
      mergeRec('a', { categoryCode: '餐饮' }),
      mergeRec('b', { categoryCode: '交通' }),
      mergeRec('c', { categoryCode: null }),
    ]);
    expect(plan.conflicts[0].options).toEqual([
      { value: '餐饮', count: 1, recordIds: ['a'] },
      { value: '交通', count: 1, recordIds: ['b'] },
      { value: null, count: 1, recordIds: ['c'] },
    ]);
  });

  it('账户不可清空(必填字段):传 null 被忽略,回退默认', () => {
    const plan = planDuplicateMerge(
      [mergeRec('a', { accountId: 'acc1' }), mergeRec('b', { accountId: 'acc2' })],
      { accountId: null },
    );
    expect(plan.patch.accountId).toBeUndefined();
  });

  it('账户冲突:默认第一条,选择后写入', () => {
    const records = [mergeRec('a'), mergeRec('b', { accountId: 'acc2' })];
    expect(planDuplicateMerge(records).patch.accountId).toBeUndefined();
    expect(planDuplicateMerge(records, { accountId: 'acc2' }).patch.accountId).toBe('acc2');
  });

  it('账户一致 → 无冲突、不写 patch', () => {
    const plan = planDuplicateMerge([mergeRec('a'), mergeRec('b')]);
    expect(plan.conflicts).toHaveLength(0);
    expect(plan.patch.accountId).toBeUndefined();
  });
});

describe('planDuplicateMerge · 备注 / 标签 / 附件 / 交易方', () => {
  it('备注默认拼接(保留记录在前)', () => {
    const plan = planDuplicateMerge([mergeRec('a', { remark: '午餐' }), mergeRec('b', { remark: '聚餐' })]);
    expect(plan.patch.remark).toBe('午餐 / 聚餐');
    expect(plan.remark).toBe('午餐 / 聚餐');
  });

  it('备注完全相同 → 不写 patch,也不报「自动合并」', () => {
    const plan = planDuplicateMerge([mergeRec('a', { remark: '午餐' }), mergeRec('b', { remark: '午餐' })]);
    expect(plan.patch.remark).toBeUndefined();
    expect(plan.autoFilled.some((f) => f.field === 'remark')).toBe(false);
  });

  it('第一条无备注 → 直接取后续的备注', () => {
    expect(planDuplicateMerge([mergeRec('a'), mergeRec('b', { remark: '聚餐' })]).patch.remark).toBe('聚餐');
  });

  it('remarkFrom 指定只用某一条的备注', () => {
    const plan = planDuplicateMerge(
      [mergeRec('a', { remark: '午餐' }), mergeRec('b', { remark: '聚餐' })],
      { remarkFrom: 'b' },
    );
    expect(plan.patch.remark).toBe('聚餐');
  });

  it('remarkText(结果面板直接编辑)优先于 remarkFrom 与拼接,且不算「自动补齐」', () => {
    const plan = planDuplicateMerge(
      [mergeRec('a', { remark: '午餐' }), mergeRec('b', { remark: '聚餐' })],
      { remarkFrom: 'b', remarkText: '  午餐+聚餐  ' },
    );
    expect(plan.patch.remark).toBe('午餐+聚餐');
    expect(plan.autoFilled.some((f) => f.field === 'remark')).toBe(false);
  });

  it('remarkText 传空串 = 显式清空备注', () => {
    const plan = planDuplicateMerge([mergeRec('a', { remark: '午餐' }), mergeRec('b')], { remarkText: '' });
    expect(plan.patch.remark).toBeNull();
  });

  it('payerText 直接编辑优先于「空则填」;空串不覆盖原值', () => {
    const records = [mergeRec('a'), mergeRec('b', { payer: '便利蜂' })];
    const plan = planDuplicateMerge(records, { payerText: '便利店' });
    expect(plan.patch.payer).toBe('便利店');
    expect(plan.autoFilled.some((f) => f.field === 'payer')).toBe(false);
    // 空串 = 清空:第一条本来就没有交易方 → 不产生变更
    expect(planDuplicateMerge(records, { payerText: '' }).patch.payer).toBeUndefined();
  });

  it('交易方为空则填,不同则保留第一条(不弹窗)', () => {
    expect(planDuplicateMerge([mergeRec('a'), mergeRec('b', { payer: '便利蜂' })]).patch.payer).toBe('便利蜂');
    expect(
      planDuplicateMerge([mergeRec('a', { payer: 'A' }), mergeRec('b', { payer: 'B' })]).patch.payer,
    ).toBeUndefined();
  });

  it('标签取并集,附件记录迁移来源', () => {
    const plan = planDuplicateMerge([
      mergeRec('a', { tags: ['固定收支'], attachments: [{ id: 'f1' }] }),
      mergeRec('b', { tags: ['经营'], attachments: [{ id: 'f2' }, { id: 'f3' }] }),
    ]);
    expect(plan.patch.tags).toEqual(['固定收支', '经营']);
    expect(plan.attachmentSourceIds).toEqual(['b']);
    expect(plan.autoFilled.find((f) => f.field === 'attachments')?.detail).toContain('2');
  });

  it('其余记录没有附件 → 无迁移来源', () => {
    const plan = planDuplicateMerge([mergeRec('a', { attachments: [{ id: 'f1' }] }), mergeRec('b')]);
    expect(plan.attachmentSourceIds).toEqual([]);
  });
});

describe('planDuplicateMerge · 拒绝合并', () => {
  it('方向不一致 → blocked,且不给出任何字段变更', () => {
    const plan = planDuplicateMerge([mergeRec('a', { type: 'EXPENSE' }), mergeRec('b', { type: 'INCOME' })]);
    expect(plan.blocked).toBe(DUPLICATE_MERGE_TYPE_MISMATCH);
    expect(plan.patch).toEqual({});
    expect(plan.mergeIds).toEqual(['b']);
    expect(plan.conflicts).toHaveLength(0);
  });

  it('少于两条 → blocked(空数组也不崩)', () => {
    expect(planDuplicateMerge([mergeRec('a')]).blocked).toBeTruthy();
    const empty = planDuplicateMerge([]);
    expect(empty.blocked).toBeTruthy();
    expect(empty.keepId).toBe('');
  });
});

describe('planDuplicateMergeBatch', () => {
  const clean = [mergeRec('a'), mergeRec('b')];
  const conflict = [mergeRec('c', { categoryCode: '餐饮' }), mergeRec('d', { categoryCode: '交通' })];
  const mixed = [mergeRec('e', { type: 'EXPENSE' }), mergeRec('f', { type: 'INCOME' })];

  it('聚合 needsReview / blocked,统计口径排除被拒绝的组', () => {
    const batch = planDuplicateMergeBatch([{ records: clean }, { records: conflict }, { records: mixed }]);
    expect(batch.plans).toHaveLength(3);
    expect(batch.needsReview).toBe(true);
    expect(batch.blocked).toEqual([{ keepId: 'e', reason: DUPLICATE_MERGE_TYPE_MISMATCH }]);
    expect(summarizeDuplicateMerge(batch)).toEqual({ groups: 2, mergedRecords: 2, attachments: 0 });
  });

  it('全部无冲突 → needsReview false(可一键批量提交)', () => {
    const batch = planDuplicateMergeBatch([{ records: clean }, { records: [mergeRec('g'), mergeRec('h')] }]);
    expect(batch.needsReview).toBe(false);
    expect(batch.blocked).toEqual([]);
  });
});

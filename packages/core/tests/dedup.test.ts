import { describe, expect, it } from 'vitest';
import {
  buildDuplicateKey,
  parseDuplicateGroupKey,
  DEFAULT_DEDUP_MATCH_FIELDS,
  DEDUP_EMPTY_PAYER,
} from '../src/dedup.js';
import type { DedupKeyRecord, DedupMatchFields } from '../src/dedup.js';

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

describe('buildDuplicateKey', () => {
  it('默认字段(date 精度,ownerId 关闭)', () => {
    expect(buildDuplicateKey(rec, DEFAULT_DEDUP_MATCH_FIELDS)).toBe(
      '2024-01-15||EXPENSE||acc1||张三||12.50',
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
      '日期: 2024-01-15',
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

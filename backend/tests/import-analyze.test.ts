import { describe, expect, it } from 'vitest';
import { buildAccountUnmatchedRecords, buildCategorySamples } from '../src/services/import/analyze-samples.js';
import type { ParsedRow } from '../src/services/import/shared.js';

const row = (over: Partial<ParsedRow> & { rowIndex: number }): ParsedRow => ({
  date: '2026-09-01 10:00:00',
  type: 'EXPENSE',
  amount: 10,
  accountName: '招行',
  categoryCode: null,
  payer: null,
  remark: '',
  ...over,
} as ParsedRow);

describe('buildAccountUnmatchedRecords', () => {
  it('挑出账户未匹配的行(含转账目标名未匹配)', () => {
    const rows: ParsedRow[] = [
      row({ rowIndex: 1, accountName: '招行' }),
      row({ rowIndex: 2, accountName: '支付宝' }),
      row({ rowIndex: 3, accountName: '支付宝', type: 'TRANSFER', toAccountName: '微信零钱' }),
    ];
    const out = buildAccountUnmatchedRecords(rows, new Set(['招行', '微信零钱']));
    expect(out.map(r => r.rowIndex)).toEqual([1, 3]);
  });

  it('行数超过上限时截断', () => {
    const rows = Array.from({ length: 10 }, (_, i) => row({ rowIndex: i + 1, accountName: '招行' }));
    expect(buildAccountUnmatchedRecords(rows, new Set(['招行']), 3)).toHaveLength(3);
  });

  it('可选字段回退为空值,不出现 undefined', () => {
    const out = buildAccountUnmatchedRecords([row({ rowIndex: 1, payer: undefined, remark: undefined })], new Set(['招行']));
    expect(out[0].payer).toBeNull();
    expect(out[0].remark).toBe('');
    expect(out[0].toAccountName).toBeNull();
  });
});

describe('buildCategorySamples', () => {
  it('按源分类聚合,样本截取前 N 条并带总数', () => {
    const rows: ParsedRow[] = [
      ...Array.from({ length: 7 }, (_, i) => row({ rowIndex: i + 1, categoryCode: '餐饮美食', payer: `商户${i}` })),
      row({ rowIndex: 8, categoryCode: '服饰装扮' }),
    ];
    const out = buildCategorySamples(rows, ['餐饮美食', '服饰装扮'], 5);
    expect(out).toHaveLength(2);
    expect(out[0]).toMatchObject({ sourceCategory: '餐饮美食', total: 7 });
    expect(out[0].samples).toHaveLength(5);
    expect(out[0].samples[0]).toMatchObject({ payer: '商户0', type: 'EXPENSE', amount: 10 });
    expect(out[1]).toMatchObject({ sourceCategory: '服饰装扮', total: 1 });
  });

  it('没有该分类的行时 total 为 0、样本为空', () => {
    const out = buildCategorySamples([], ['不存在']);
    expect(out[0]).toEqual({ sourceCategory: '不存在', total: 0, samples: [] });
  });

  it('只统计属于该源分类的行', () => {
    const rows: ParsedRow[] = [
      row({ rowIndex: 1, categoryCode: 'A' }),
      row({ rowIndex: 2, categoryCode: 'B' }),
      row({ rowIndex: 3, categoryCode: null }),
    ];
    expect(buildCategorySamples(rows, ['A'])[0].total).toBe(1);
  });
});

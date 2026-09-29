import { describe, expect, it } from 'vitest';
import { applyUnrecognizedResolutions } from '../src/services/import/apply-decisions.js';
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

describe('applyUnrecognizedResolutions', () => {
  it('正常行原样保留,未识别行按处置补上类型/账户', () => {
    const rows: ParsedRow[] = [
      row({ rowIndex: 1 }),
      row({ rowIndex: 2, type: 'UNKNOWN' }),
    ];
    const { resolved, unresolvedRowIndexes } = applyUnrecognizedResolutions(rows, [
      { rowIndex: 2, type: 'EXPENSE', accountId: 'acc-1', categoryCode: 'food' },
    ]);
    expect(unresolvedRowIndexes).toEqual([]);
    expect(resolved).toHaveLength(2);
    expect(resolved[1]).toMatchObject({ type: 'EXPENSE', accountId: 'acc-1', categoryCode: 'food', mappedCategoryCode: 'food' });
  });

  it('未处置 / 缺账户 / 转账缺转入 → 计入 unresolvedRowIndexes', () => {
    const rows: ParsedRow[] = [
      row({ rowIndex: 1, type: 'UNKNOWN' }),
      row({ rowIndex: 2, type: 'UNKNOWN' }),
      row({ rowIndex: 3, type: 'UNKNOWN' }),
    ];
    const { resolved, unresolvedRowIndexes } = applyUnrecognizedResolutions(rows, [
      { rowIndex: 2, type: 'EXPENSE' },                                  // 缺账户
      { rowIndex: 3, type: 'TRANSFER', accountId: 'acc-1' },              // 缺转入
    ]);
    expect(resolved).toHaveLength(0);
    expect(unresolvedRowIndexes).toEqual([1, 2, 3]);
  });

  it('转账两端都给全 → 视为已处置', () => {
    const { resolved, unresolvedRowIndexes } = applyUnrecognizedResolutions(
      [row({ rowIndex: 5, type: 'UNKNOWN' })],
      [{ rowIndex: 5, type: 'TRANSFER', accountId: 'acc-1', toAccountId: 'acc-2' }],
    );
    expect(unresolvedRowIndexes).toEqual([]);
    expect(resolved[0]).toMatchObject({ type: 'TRANSFER', accountId: 'acc-1', toAccountId: 'acc-2' });
  });

  it('未传处置时,全部未识别行计入待跳过', () => {
    const { resolved, unresolvedRowIndexes } = applyUnrecognizedResolutions([row({ rowIndex: 9, type: 'UNKNOWN' })], undefined);
    expect(resolved).toHaveLength(0);
    expect(unresolvedRowIndexes).toEqual([9]);
  });

  it('不修改传入的原始行对象(纯函数)', () => {
    const original = row({ rowIndex: 1, type: 'UNKNOWN' });
    applyUnrecognizedResolutions([original], [{ rowIndex: 1, type: 'EXPENSE', accountId: 'acc-1' }]);
    expect(original.type).toBe('UNKNOWN');
    expect(original.accountId).toBeUndefined();
  });
});

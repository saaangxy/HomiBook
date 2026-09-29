import { describe, expect, it } from 'vitest';
import { buildValidAccountRefs, collectPreviewBlocking, findUnknownCategoryCodes, formatDictOptions, shouldMarkCategoryUnmatched, validateImportRecords } from '../src/services/import/blocking.js';

describe('collectPreviewBlocking', () => {
  it('三组清单 → 阻断项,账户类标记为必然失败', () => {
    const items = collectPreviewBlocking({
      unmatchedAccounts: [{ csvName: '招行' }],
      unmatchedCategories: [{ sourceCategory: '餐饮美食' }],
      unrecognizedRecords: [{ rowIndex: 7 }],
    });
    expect(items).toHaveLength(3);
    expect(items[0]).toMatchObject({ kind: 'account', ref: '招行', willFailAtImport: true });
    expect(items[1]).toMatchObject({ kind: 'category', ref: '餐饮美食', willFailAtImport: false });
    expect(items[2]).toMatchObject({ kind: 'unrecognized', ref: '7', willFailAtImport: false });
  });

  it('三组清单都空 → 无阻断项', () => {
    expect(
      collectPreviewBlocking({ unmatchedAccounts: [], unmatchedCategories: [], unrecognizedRecords: [] }),
    ).toEqual([]);
  });

  it('reason 带上原始名,便于用户定位', () => {
    const items = collectPreviewBlocking({
      unmatchedAccounts: [{ csvName: '农业银行储蓄卡' }],
      unmatchedCategories: [],
      unrecognizedRecords: [],
    });
    expect(items[0].reason).toContain('农业银行储蓄卡');
  });
});

describe('validateImportRecords', () => {
  const validAccountIds = new Set(['acc-1', 'acc-2']);
  const validCategoryCodes = new Set(['food', 'salary']);
  const base = { type: 'EXPENSE', accountId: 'acc-1' };

  it('全部合法 → 无阻断', () => {
    const items = validateImportRecords({
      records: [
        { ...base, categoryCode: 'food' },
        { type: 'TRANSFER', accountId: 'acc-1', toAccountId: 'acc-2', rowIndex: 2 },
      ],
      validAccountIds,
      validCategoryCodes,
    });
    expect(items).toEqual([]);
  });

  it('账户不存在 → 阻断且标记必然失败', () => {
    const items = validateImportRecords({
      records: [{ ...base, accountId: 'nope' }],
      validAccountIds,
      validCategoryCodes,
    });
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ kind: 'account', willFailAtImport: true });
  });

  it('转账缺转入账户 / 转入账户无效 → 阻断', () => {
    const missing = validateImportRecords({
      records: [{ type: 'TRANSFER', accountId: 'acc-1', rowIndex: 3 }],
      validAccountIds,
      validCategoryCodes,
    });
    expect(missing[0].reason).toContain('转入账户');

    const invalid = validateImportRecords({
      records: [{ type: 'TRANSFER', accountId: 'acc-1', toAccountId: 'x', rowIndex: 3 }],
      validAccountIds,
      validCategoryCodes,
    });
    expect(invalid[0]).toMatchObject({ kind: 'account', willFailAtImport: true });
  });

  it('分类不在字典 → 宽松模式放过,严格模式阻断(但标记非必然失败)', () => {
    const input = {
      records: [{ ...base, categoryCode: 'ghost', rowIndex: 5 }],
      validAccountIds,
      validCategoryCodes,
    };
    expect(validateImportRecords({ ...input, strict: false })).toEqual([]);
    const strict = validateImportRecords({ ...input, strict: true });
    expect(strict).toHaveLength(1);
    expect(strict[0]).toMatchObject({ kind: 'category', willFailAtImport: false });
  });

  it('分类码为空(可选字段)不阻断', () => {
    expect(
      validateImportRecords({ records: [{ ...base, categoryCode: null }], validAccountIds, validCategoryCodes }),
    ).toEqual([]);
  });
});

describe('buildValidAccountRefs', () => {
  it('合并已有账户 id 与本次将创建的账户(目标名 + csvName 片段)', () => {
    const refs = buildValidAccountRefs(['acc-1'], [
      { csvName: '招商银行储蓄卡(9467), 招商银行储蓄卡(9467)&现金抵价券', name: '招商银行储蓄卡(9467)' },
    ]);
    expect(refs.has('acc-1')).toBe(true);
    expect(refs.has('招商银行储蓄卡(9467)')).toBe(true);
    expect(refs.has('招商银行储蓄卡(9467)&现金抵价券')).toBe(true);
    expect(refs.has('不存在')).toBe(false);
  });

  it('csvName 为空的片段被忽略', () => {
    const refs = buildValidAccountRefs([], [{ csvName: '', name: '现金' }]);
    expect([...refs]).toEqual(['现金']);
  });
});

describe('shouldMarkCategoryUnmatched', () => {
  it('已映射 / 无分类 / 类型未识别的行都不计入', () => {
    expect(shouldMarkCategoryUnmatched({ categoryCode: '生活服务', mappedCategoryCode: 'x', type: 'EXPENSE' })).toBe(false);
    expect(shouldMarkCategoryUnmatched({ categoryCode: '', mappedCategoryCode: null, type: 'EXPENSE' })).toBe(false);
    expect(shouldMarkCategoryUnmatched({ categoryCode: null, mappedCategoryCode: null, type: 'EXPENSE' })).toBe(false);
    // 类型未识别的行由「未识别行处置」负责,不参与「未映射分类」判定
    expect(shouldMarkCategoryUnmatched({ categoryCode: '交通出行', mappedCategoryCode: null, type: 'UNKNOWN' })).toBe(false);
  });

  it('有分类且未映射且类型已识别 → 计入', () => {
    expect(shouldMarkCategoryUnmatched({ categoryCode: '生活服务', mappedCategoryCode: null, type: 'EXPENSE' })).toBe(true);
  });
});

describe('findUnknownCategoryCodes', () => {
  it('去重保序,只挑字典里没有的', () => {
    const valid = new Set(['food', 'salary']);
    expect(findUnknownCategoryCodes(['food', '娱乐', 'salary', '娱乐', '餐饮'], valid)).toEqual(['娱乐', '餐饮']);
  });

  it('空值 / undefined 被忽略', () => {
    expect(findUnknownCategoryCodes([undefined, '', null, 'x'], new Set())).toEqual(['x']);
  });

  it('全部合法 → 空数组', () => {
    expect(findUnknownCategoryCodes(['food'], new Set(['food']))).toEqual([]);
  });
});

describe('formatDictOptions', () => {
  it('label(code) 用「、」连接', () => {
    expect(formatDictOptions([{ code: 'food', label: '餐饮' }, { code: 'salary', label: '工资' }]))
      .toBe('餐饮(food)、工资(salary)');
  });

  it('超出限量时补总数提示', () => {
    const many = Array.from({ length: 5 }, (_, i) => ({ code: `c${i}`, label: `L${i}` }));
    expect(formatDictOptions(many, 2)).toBe('L0(c0)、L1(c1) 等 5 项');
  });
});

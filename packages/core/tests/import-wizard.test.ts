import { describe, expect, it } from 'vitest';
import {
  applyUnrecognizedAccountDefaults,
  buildCategoryResolutionKey,
  collectPendingAccountNames,
  deriveUnrecognizedAccount,
  findBestCategoryResolution,
  initCategoryResolutionDrafts,
  initCategoryResolutionEntries,
  initUnrecognizedResolutionDrafts,
  isCategoryCodeValidForType,
  parseCategoryResolutionKey,
  toAccountResolutionPayload,
  toCategoryResolutionEntries,
  toCategoryResolutionPayload,
  toUnrecognizedResolutionPayload,
  type CategoryResolutionEntry,
  type AccountResolution,
} from '../src';

describe('复合键', () => {
  it('两段键：源分类 + 收支类型', () => {
    expect(buildCategoryResolutionKey('餐饮', 'EXPENSE')).toBe('餐饮::EXPENSE');
  });

  it('手动复制项追加 ::e{id} 后缀', () => {
    expect(buildCategoryResolutionKey('餐饮', 'EXPENSE', 3)).toBe('餐饮::EXPENSE::e3');
  });

  it('解析时忽略手动复制的后缀段', () => {
    expect(parseCategoryResolutionKey('餐饮::EXPENSE::e3')).toEqual({ sourceCategory: '餐饮', recordType: 'EXPENSE' });
    expect(parseCategoryResolutionKey('餐饮::EXPENSE')).toEqual({ sourceCategory: '餐饮', recordType: 'EXPENSE' });
  });

  it('缺少类型段时 recordType 为 undefined', () => {
    expect(parseCategoryResolutionKey('餐饮')).toEqual({ sourceCategory: '餐饮', recordType: undefined });
  });
});

describe('initCategoryResolutionDrafts', () => {
  const unmatched = [
    { sourceCategory: '餐饮', types: ['EXPENSE', 'TRANSFER'], suggestedCode: 'FOOD' },
    { sourceCategory: '工资', types: ['INCOME'] },
  ];

  it('每个「源分类 × 类型」一条，带建议分类', () => {
    const drafts = initCategoryResolutionDrafts(unmatched, { saveByDefault: false });
    expect(Object.keys(drafts)).toEqual(['餐饮::EXPENSE', '餐饮::TRANSFER', '工资::INCOME']);
    expect(drafts['餐饮::EXPENSE']).toEqual({
      targetCode: 'FOOD', save: false, payerContains: '', descriptionContains: '',
    });
    expect(drafts['工资::INCOME'].targetCode).toBe('');
  });

  it('saveByDefault 原样透传（不设内部默认值）', () => {
    expect(initCategoryResolutionDrafts(unmatched, { saveByDefault: true })['餐饮::EXPENSE'].save).toBe(true);
  });

  it('传 dictItems 时，跨收支类型的建议值不预填（否则服务端会判未映射）', () => {
    const dictItems = [
      { code: '红包', group: 'transaction_category_income' },
      { code: '保险', group: 'transaction_category_expense' },
      { code: '信用借还', group: 'transaction_category_transfer' },
    ];
    const drafts = initCategoryResolutionDrafts(
      [{ sourceCategory: '转账红包', types: ['EXPENSE', 'INCOME'], suggestedCode: '红包' }],
      { saveByDefault: false, dictItems },
    );
    expect(drafts['转账红包::EXPENSE'].targetCode).toBe('');
    expect(drafts['转账红包::INCOME'].targetCode).toBe('红包');
  });

  it('传 dictItems 时，同类型的建议值保留', () => {
    const dictItems = [{ code: '保险', group: 'transaction_category_expense' }];
    const drafts = initCategoryResolutionDrafts(
      [{ sourceCategory: '保险', types: ['EXPENSE'], suggestedCode: '保险' }],
      { saveByDefault: false, dictItems },
    );
    expect(drafts['保险::EXPENSE'].targetCode).toBe('保险');
  });
});

describe('initCategoryResolutionEntries（AI 预览卡）', () => {
  const dictItems = [
    { code: '人情往来', group: 'transaction_category_expense' },
    { code: '转账', group: 'transaction_category_transfer' },
  ];

  it('UNKNOWN 类型不建条目（这些行走「需手动处理」）', () => {
    const entries = initCategoryResolutionEntries([
      { sourceCategory: '转账', types: ['UNKNOWN', 'EXPENSE'], suggestedCode: '人情往来' },
    ], { saveByDefault: true, dictItems });
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ sourceCategory: '转账', recordType: 'EXPENSE', targetCode: '人情往来' });
  });

  it('全是 UNKNOWN 时完全不建（否则 recordType=UNKNOWN 永远匹配不上）', () => {
    expect(initCategoryResolutionEntries([
      { sourceCategory: '转账', types: ['UNKNOWN'], suggestedCode: '人情往来' },
    ], { saveByDefault: true, dictItems })).toHaveLength(0);
  });

  it('aiRecordType 优先于 types', () => {
    const entries = initCategoryResolutionEntries([
      { sourceCategory: '转账', types: ['EXPENSE'], aiRecordType: 'TRANSFER', suggestedCode: '转账' },
    ], { saveByDefault: true, dictItems });
    expect(entries).toHaveLength(1);
    expect(entries[0].recordType).toBe('TRANSFER');
  });

  it('多类型展开，跨组建议值置空', () => {
    const entries = initCategoryResolutionEntries([
      { sourceCategory: '群收款', types: ['EXPENSE', 'TRANSFER'], suggestedCode: '人情往来' },
    ], { saveByDefault: true, dictItems });
    expect(entries.map((e) => [e.recordType, e.targetCode])).toEqual([
      ['EXPENSE', '人情往来'],
      ['TRANSFER', ''],
    ]);
  });

  it('saveByDefault 透传', () => {
    const [entry] = initCategoryResolutionEntries([
      { sourceCategory: '群收款', types: ['EXPENSE'], suggestedCode: '' },
    ], { saveByDefault: false, dictItems });
    expect(entry.save).toBe(false);
  });
});

describe('isCategoryCodeValidForType', () => {
  const dictItems = [
    { code: '红包', group: 'transaction_category_income' },
    { code: '保险', group: 'transaction_category_expense' },
    { code: '信用借还', group: 'transaction_category_transfer' },
  ];

  it('按收支类型匹配字典组', () => {
    expect(isCategoryCodeValidForType('保险', 'EXPENSE', dictItems)).toBe(true);
    expect(isCategoryCodeValidForType('保险', 'INCOME', dictItems)).toBe(false);
    expect(isCategoryCodeValidForType('红包', 'INCOME', dictItems)).toBe(true);
    expect(isCategoryCodeValidForType('信用借还', 'TRANSFER', dictItems)).toBe(true);
  });

  it('类型未知或编码为空一律不合法', () => {
    expect(isCategoryCodeValidForType('保险', 'UNKNOWN', dictItems)).toBe(false);
    expect(isCategoryCodeValidForType('', 'EXPENSE', dictItems)).toBe(false);
    expect(isCategoryCodeValidForType(null, 'EXPENSE', dictItems)).toBe(false);
  });
});

describe('initUnrecognizedResolutionDrafts', () => {
  it('按 rowIndex 建空处置', () => {
    const drafts = initUnrecognizedResolutionDrafts([{ rowIndex: 24 }, { rowIndex: 31 }]);
    expect(drafts[24]).toEqual({ type: '', accountId: '', categoryCode: '', toAccountId: '' });
    expect(Object.keys(drafts)).toEqual(['24', '31']);
  });
});

describe('toAccountResolutionPayload', () => {
  const state: Record<string, AccountResolution> = {
    支付宝: { action: 'existing', accountId: 'a1' },
    微信: { action: 'create', name: '微信零钱', type: 'WECHAT' },
    现金: { action: 'existing', accountId: '' },
    待定: { action: 'create', name: '', type: 'OTHER' },
  };

  it('按 action 拆字段，缺失的填 undefined', () => {
    const out = toAccountResolutionPayload(state);
    expect(out).toHaveLength(4);
    expect(out[0]).toEqual({
      sourceAccountName: '支付宝', action: 'existing', targetAccountId: 'a1',
      targetAccountName: undefined, accountType: undefined,
    });
    expect(out[1]).toEqual({
      sourceAccountName: '微信', action: 'create', targetAccountId: undefined,
      targetAccountName: '微信零钱', accountType: 'WECHAT',
    });
  });

  it('onlyComplete 过滤掉没有 accountId / name+type 的项', () => {
    const out = toAccountResolutionPayload(state, { onlyComplete: true });
    expect(out.map((r) => r.sourceAccountName)).toEqual(['支付宝', '微信']);
  });
});

describe('分类决议投影', () => {
  const entries: CategoryResolutionEntry[] = [
    { sourceCategory: '餐饮', recordType: 'EXPENSE', targetCode: 'FOOD', save: true, payerContains: '', descriptionContains: '' },
    { sourceCategory: '餐饮', recordType: 'EXPENSE', targetCode: 'FOOD', save: false, payerContains: '美团', descriptionContains: '' },
    { sourceCategory: '工资', recordType: 'INCOME', targetCode: '', save: true, payerContains: '', descriptionContains: '' },
  ];

  it('从复合键 Record 解析成扁平条目', () => {
    const drafts = initCategoryResolutionDrafts([{ sourceCategory: '餐饮', types: ['EXPENSE'] }], { saveByDefault: false });
    const list = toCategoryResolutionEntries(drafts);
    expect(list).toEqual([{
      sourceCategory: '餐饮', recordType: 'EXPENSE', targetCode: '', save: false, payerContains: '', descriptionContains: '',
    }]);
  });

  it('空 targetCode 不提交；空串归一为 undefined', () => {
    const out = toCategoryResolutionPayload(entries);
    expect(out).toHaveLength(2);
    expect(out[0]).toEqual({
      sourceCategory: '餐饮', targetCategoryCode: 'FOOD', recordType: 'EXPENSE',
      payerContains: undefined, descriptionContains: undefined,
    });
  });

  it('onlySaved 只提交勾了「保存规则」的项', () => {
    const out = toCategoryResolutionPayload(entries, { onlySaved: true });
    expect(out).toHaveLength(1);
    expect(out[0].payerContains).toBeUndefined();
  });

  it('同一 sourceCategory 的多条决议都保留（按类型拆分）', () => {
    const out = toCategoryResolutionPayload([
      { sourceCategory: '餐饮', recordType: 'EXPENSE', targetCode: 'FOOD', save: true, payerContains: '', descriptionContains: '' },
      { sourceCategory: '餐饮', recordType: 'TRANSFER', targetCode: 'TRANSFER', save: true, payerContains: '', descriptionContains: '' },
    ]);
    expect(out).toHaveLength(2);
  });
});

describe('toUnrecognizedResolutionPayload', () => {
  const state = {
    24: { type: 'EXPENSE', accountId: 'a1', categoryCode: 'FOOD', toAccountId: '' },
    31: { type: 'TRANSFER', accountId: 'a1', categoryCode: '', toAccountId: '' },
    32: { type: '', accountId: '', categoryCode: '', toAccountId: '' },
  };

  it('默认全量提交（空处置由服务端裁决）', () => {
    expect(toUnrecognizedResolutionPayload(state)).toHaveLength(3);
  });

  it('onlyComplete 排除空处置与缺转入账户的转账', () => {
    const out = toUnrecognizedResolutionPayload(state, { onlyComplete: true });
    expect(out.map((r) => r.rowIndex)).toEqual([24]);
  });

  it('非转账行不提交 toAccountId；categoryCode 空串保留', () => {
    const [expense] = toUnrecognizedResolutionPayload({ 24: state[24] });
    expect(expense.toAccountId).toBeUndefined();
    const [transfer] = toUnrecognizedResolutionPayload({ 31: { ...state[31], toAccountId: 'a2' } });
    expect(transfer.toAccountId).toBe('a2');
    expect(transfer.categoryCode).toBe('');
  });
});

describe('findBestCategoryResolution', () => {
  const base = { save: true, payerContains: '', descriptionContains: '' };
  const entries: CategoryResolutionEntry[] = [
    { ...base, sourceCategory: '餐饮', recordType: 'EXPENSE', targetCode: 'FOOD' },
    { ...base, sourceCategory: '餐饮', recordType: 'EXPENSE', targetCode: 'MEITUAN', payerContains: '美团' },
    { ...base, sourceCategory: '餐饮', recordType: 'EXPENSE', targetCode: 'COFFEE', payerContains: '美团', descriptionContains: '咖啡' },
  ];

  it('交易方命中(+2) 优先于无条件(0)', () => {
    expect(findBestCategoryResolution(entries, {
      sourceCategory: '餐饮', recordType: 'EXPENSE', payer: '美团外卖', remark: '',
    })).toBe('MEITUAN');
  });

  it('交易方 + 说明同时命中(+3) 得分最高', () => {
    expect(findBestCategoryResolution(entries, {
      sourceCategory: '餐饮', recordType: 'EXPENSE', payer: '美团外卖', remark: '冰咖啡',
    })).toBe('COFFEE');
  });

  it('没有条目命中条件时回退到无条件条目', () => {
    expect(findBestCategoryResolution(entries, {
      sourceCategory: '餐饮', recordType: 'EXPENSE', payer: '饿了么', remark: '',
    })).toBe('FOOD');
  });

  it('类型不匹配或没有无条件条目时返回 null', () => {
    expect(findBestCategoryResolution(entries, {
      sourceCategory: '餐饮', recordType: 'INCOME', payer: '美团', remark: '',
    })).toBeNull();
    expect(findBestCategoryResolution([entries[1]], {
      sourceCategory: '餐饮', recordType: 'EXPENSE', payer: '饿了么', remark: '',
    })).toBeNull();
  });

  it('未选目标分类的条目不参与匹配', () => {
    expect(findBestCategoryResolution([
      { ...base, sourceCategory: '餐饮', recordType: 'EXPENSE', targetCode: '', payerContains: '美团' },
    ], { sourceCategory: '餐饮', recordType: 'EXPENSE', payer: '美团', remark: '' })).toBeNull();
  });
});

describe('未识别行的默认账户（上方账户映射）', () => {
  const resolutions: Record<string, AccountResolution> = {
    '招商银行': { action: 'create', name: '招行储蓄卡', type: 'SAVINGS' },
    '支付宝余额': { action: 'existing', accountId: 'acc-1' },
    '微信零钱': { action: 'create', name: '现金', type: 'CASH', isDefault: true },
  };

  it('按源账户名推导：新建账户用目标名，已有账户用 id', () => {
    expect(deriveUnrecognizedAccount('招商银行', resolutions)).toEqual({ value: '招行储蓄卡', action: 'create', newAccountName: '招行储蓄卡' });
    expect(deriveUnrecognizedAccount('支付宝余额', resolutions)).toEqual({ value: 'acc-1', action: 'existing' });
  });

  it('源账户没有映射 / 名称为空时返回 null', () => {
    expect(deriveUnrecognizedAccount('未知卡', resolutions)).toBeNull();
    expect(deriveUnrecognizedAccount('', resolutions)).toBeNull();
    expect(deriveUnrecognizedAccount(null, resolutions)).toBeNull();
  });

  it('候选建议（isDefault）同样可被带入', () => {
    expect(deriveUnrecognizedAccount('微信零钱', resolutions)?.value).toBe('现金');
  });

  it('待新建账户名去重，并排除与已有账户同名的项', () => {
    expect(collectPendingAccountNames(resolutions, ['现金'])).toEqual(['招行储蓄卡']);
    expect(collectPendingAccountNames(resolutions, [])).toEqual(['招行储蓄卡', '现金']);
  });

  it('合并默认值：未手选的行按上方映射带入，手选的行保持', () => {
    const drafts = initUnrecognizedResolutionDrafts([{ rowIndex: 1 }, { rowIndex: 2 }, { rowIndex: 3 }]);
    drafts[2] = { ...drafts[2], accountId: 'manual', accountTouched: true };
    // 没有 accountTouched 的预置值只是默认值(如 AI 卡预填首个账户),应被上方映射覆盖
    drafts[3] = { ...drafts[3], accountId: 'preset' };
    const rows = [
      { rowIndex: 1, accountName: '招商银行' },
      { rowIndex: 2, accountName: '支付宝余额' },
      { rowIndex: 3, accountName: '支付宝余额' },
      { rowIndex: 4, accountName: '未知卡' },
    ];
    const merged = applyUnrecognizedAccountDefaults(drafts, rows, resolutions);
    expect(merged[1].accountId).toBe('招行储蓄卡');
    expect(merged[2].accountId).toBe('manual');
    expect(merged[3].accountId).toBe('acc-1');
    // 没有映射的行保持原值(无预置时为空，仍由用户手选)
    expect(merged[4].accountId).toBe('');
  });

  it('合并后的结果可直接投影成提交载荷（不携带 accountTouched）', () => {
    const drafts = initUnrecognizedResolutionDrafts([{ rowIndex: 1 }]);
    drafts[1] = { ...drafts[1], type: 'EXPENSE', categoryCode: 'FOOD' };
    const merged = applyUnrecognizedAccountDefaults(drafts, [{ rowIndex: 1, accountName: '招商银行' }], resolutions);
    const payload = toUnrecognizedResolutionPayload(merged);
    expect(payload).toEqual([{ rowIndex: 1, type: 'EXPENSE', accountId: '招行储蓄卡', categoryCode: 'FOOD', toAccountId: undefined }]);
  });
});

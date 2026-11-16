import { describe, expect, it } from 'vitest';
import {
  buildCategoryResolutionKey,
  findBestCategoryResolution,
  initCategoryResolutionDrafts,
  initUnrecognizedResolutionDrafts,
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

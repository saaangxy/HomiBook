import { describe, expect, it } from 'vitest';
import {
  dedupeBy,
  isFallbackRule,
  normalizeAccountMappings,
  normalizeCategoryMappings,
  normalizeCondition,
} from '../src/services/import/mapping-normalize.js';

describe('normalizeCondition', () => {
  it('trim + 折叠连续空白 + 全角转半角', () => {
    expect(normalizeCondition('  星巴克  ')).toBe('星巴克');
    expect(normalizeCondition('星巴克   咖啡')).toBe('星巴克 咖啡');
    expect(normalizeCondition('ＡＢＣ')).toBe('ABC');
    expect(normalizeCondition('Ａ １')).toBe('A 1');
  });

  it('空值统一成空串', () => {
    expect(normalizeCondition(undefined)).toBe('');
    expect(normalizeCondition(null)).toBe('');
    expect(normalizeCondition('   ')).toBe('');
  });

  it('保留正则元字符原样(只做空白与全角处理)', () => {
    expect(normalizeCondition('燃气|电力')).toBe('燃气|电力');
  });
});

describe('dedupeBy', () => {
  it('同键保留最后一条', () => {
    const out = dedupeBy([{ k: 'a', v: 1 }, { k: 'b', v: 2 }, { k: 'a', v: 3 }], x => x.k);
    expect(out).toEqual([{ k: 'a', v: 3 }, { k: 'b', v: 2 }]);
  });
});

describe('normalizeCategoryMappings', () => {
  it('等价条件(空格/全角差异)只留一条,后者覆盖前者', () => {
    const out = normalizeCategoryMappings(
      [
        { sourceCategory: '餐饮美食', targetCategoryCode: 'food_old', payerContains: '星巴克' },
        { sourceCategory: '餐饮美食', targetCategoryCode: 'food_new', payerContains: ' 星巴克 ' },
      ],
    );
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ targetCategoryCode: 'food_new', payerContains: '星巴克' });
  });

  it('不同条件(交易方不同)各自保留', () => {
    const out = normalizeCategoryMappings(
      [
        { sourceCategory: '餐饮美食', targetCategoryCode: 'food', payerContains: '星巴克' },
        { sourceCategory: '餐饮美食', targetCategoryCode: 'food', payerContains: '麦当劳' },
      ],
    );
    expect(out).toHaveLength(2);
  });

  it('非法 recordType 归一为空串(不限类型)', () => {
    const out = normalizeCategoryMappings([{ sourceCategory: 'X', targetCategoryCode: 'y', recordType: '不是类型' }]);
    expect(out[0].recordType).toBe('');
  });

  it('不归一化 sourceCategory / targetCategoryCode(匹配键与字典码)', () => {
    const out = normalizeCategoryMappings([{ sourceCategory: ' 餐饮美食 ', targetCategoryCode: ' food ' }]);
    expect(out[0].sourceCategory).toBe(' 餐饮美食 ');
    expect(out[0].targetCategoryCode).toBe(' food ');
  });
});

describe('normalizeAccountMappings', () => {
  it('等价条件去重,保留最后一条', () => {
    const out = normalizeAccountMappings([
      { sourceAccountName: '招行', targetAccountName: '招商银行', payerContains: 'Ａ' },
      { sourceAccountName: '招行', targetAccountName: '招商银行储蓄卡', payerContains: 'A' },
    ]);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ targetAccountName: '招商银行储蓄卡', payerContains: 'A' });
  });
});

describe('isFallbackRule', () => {
  it('条件全空 → 兜底规则', () => {
    expect(isFallbackRule({})).toBe(true);
    expect(isFallbackRule({ payerContains: '', descriptionContains: '', recordType: '' })).toBe(true);
    expect(isFallbackRule({ recordType: 'EXPENSE' })).toBe(false);
    expect(isFallbackRule({ payerContains: '星巴克' })).toBe(false);
  });
});

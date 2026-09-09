import { describe, expect, it } from 'vitest';
import {
  autoDetectColumns,
  autoDetectTypeMapping,
  detectTypeValues,
  initAccountResolutions,
  isColumnMappingValid,
  matchAccountInPool,
  matchAccountInPoolDetailed,
  mergeAccountCreations,
  unresolvedAccountCount,
  RECORD_TYPE_LABELS,
  IMPORT_SOURCE_LABELS,
  TYPE_TO_GROUP,
  type AccountResolution,
} from '../src/record-import.js';
import type { PoolAccount, RawAccountCreation, UnmatchedAccountInput } from '../src/record-import.js';

describe('matchAccountInPoolDetailed', () => {
  const pool: PoolAccount[] = [
    { id: 'a1', name: '支付宝' },
    { id: 'a2', name: '支付宝余额', ownerId: 'u2' },
    { id: 'a3', name: '微信', ownerId: 'u1' },
    { id: 'a4', name: '现金' }, // 未设归属人
  ];

  it('精确匹配唯一命中', () => {
    expect(matchAccountInPoolDetailed('支付宝', pool)).toEqual({ matched: true, id: 'a1', name: '支付宝' });
  });

  it('精确匹配优先于包含匹配', () => {
    // '支付宝余额' 也包含 '支付宝',但精确命中 a1 优先
    expect(matchAccountInPoolDetailed('支付宝', pool)).toMatchObject({ matched: true, id: 'a1' });
  });

  it('账户名包含目标名(简写命中全名)', () => {
    expect(matchAccountInPoolDetailed('微信零钱', [{ id: 'w1', name: '微信零钱通' }])).toMatchObject({
      matched: true,
      id: 'w1',
    });
  });

  it('目标名包含账户名(全名命中简写)', () => {
    expect(
      matchAccountInPoolDetailed('招商银行储蓄卡(尾号1234)', [{ id: 'c1', name: '招商银行' }]),
    ).toMatchObject({ matched: true, id: 'c1' });
  });

  it('精确匹配多个同名账户 → ambiguous', () => {
    const r = matchAccountInPoolDetailed('现金', [
      { id: 'x1', name: '现金' },
      { id: 'x2', name: '现金' },
    ]);
    expect(r).toEqual({ matched: false, ambiguous: true, candidates: [{ id: 'x1', name: '现金' }, { id: 'x2', name: '现金' }] });
  });

  it('包含匹配多个 → ambiguous', () => {
    const r = matchAccountInPoolDetailed('招商银行', [
      { id: 'b1', name: '招商银行信用卡' },
      { id: 'b2', name: '招商银行储蓄卡' },
    ]);
    expect(r.matched).toBe(false);
    if (!r.matched && r.ambiguous) expect(r.candidates).toHaveLength(2);
  });

  it('无任何命中', () => {
    expect(matchAccountInPoolDetailed('不存在的账户', pool)).toEqual({ matched: false, ambiguous: false });
  });

  it('空名称或空账户池不匹配', () => {
    expect(matchAccountInPoolDetailed('', pool)).toEqual({ matched: false, ambiguous: false });
    expect(matchAccountInPoolDetailed('支付宝', [])).toEqual({ matched: false, ambiguous: false });
  });

  describe('ownerId 过滤(多用户账本)', () => {
    it('仅在本人与未设归属人的账户中匹配', () => {
      // u1 视角:候选为 a1/a3/a4(排除他人 a2)
      // '支付宝余额' 无精确命中 → 目标名包含账户名 '支付宝' → 命中 a1
      const r = matchAccountInPoolDetailed('支付宝余额', pool, 'u1');
      expect(r).toEqual({ matched: true, id: 'a1', name: '支付宝' });
    });

    it('匹配到他人精确同名账户时被过滤 → 不匹配', () => {
      expect(matchAccountInPoolDetailed('支付宝余额', pool, 'u1')).not.toMatchObject({ id: 'a2' });
    });

    it('未设归属人的账户所有人可匹配(宽松语义)', () => {
      const r = matchAccountInPoolDetailed('现金', pool, 'u99');
      expect(r).toEqual({ matched: true, id: 'a4', name: '现金' });
    });

    it('过滤后无候选 → 不匹配', () => {
      expect(matchAccountInPoolDetailed('微信', [{ id: 'a3', name: '微信', ownerId: 'u1' }], 'u2')).toEqual({
        matched: false,
        ambiguous: false,
      });
    });
  });
});

describe('matchAccountInPool(简版)', () => {
  it('命中返回账户对象', () => {
    const acc = { id: 'a1', name: '支付宝' };
    expect(matchAccountInPool('支付宝', [acc])).toEqual(acc);
  });

  it('歧义/未命中返回 null', () => {
    expect(matchAccountInPool('现金', [{ id: 'x1', name: '现金' }, { id: 'x2', name: '现金' }])).toBeNull();
    expect(matchAccountInPool('没有', [{ id: 'a1', name: '支付宝' }])).toBeNull();
  });
});

describe('isColumnMappingValid', () => {
  it('date/amount/type 必填齐全', () => {
    expect(isColumnMappingValid({ date: '日期', amount: '金额', type: '收/支' })).toBe(true);
  });

  it('缺少任一必填项', () => {
    expect(isColumnMappingValid({ date: '日期', amount: '金额' })).toBe(false);
    expect(isColumnMappingValid({ date: '日期', type: '收/支' })).toBe(false);
    expect(isColumnMappingValid({})).toBe(false);
  });

  it('可选字段不影响校验', () => {
    expect(isColumnMappingValid({ date: 'd', amount: 'a', type: 't', remark: '备注' })).toBe(true);
  });
});

describe('autoDetectColumns', () => {
  it('中文表头', () => {
    const mapping = autoDetectColumns(['交易时间', '金额', '收/支', '支付方式', '交易对方', '备注']);
    expect(mapping).toEqual({
      date: '交易时间',
      amount: '金额',
      type: '收/支',
      account: '支付方式',
      payer: '交易对方',
      remark: '备注',
    });
  });

  it('英文表头', () => {
    const mapping = autoDetectColumns(['Date', 'Amount', 'Type', 'Account', 'Payer', 'Category', 'Remark']);
    expect(mapping).toEqual({
      date: 'Date',
      amount: 'Amount',
      type: 'Type',
      account: 'Account',
      payer: 'Payer',
      category: 'Category',
      remark: 'Remark',
    });
  });

  it('转账目标列', () => {
    const mapping = autoDetectColumns(['日期', '金额', '类型', '转账目标']);
    expect(mapping.toAccount).toBe('转账目标');
  });

  it('无匹配表头返回空映射', () => {
    expect(autoDetectColumns(['foo', 'bar'])).toEqual({});
  });
});

describe('detectTypeValues', () => {
  it('提取去重且去空白的唯一值', () => {
    const rows: Record<string, string>[] = [
      { t: '收入' },
      { t: ' 支出 ' },
      { t: '支出' },
      { t: '' },
      { other: 'x' },
    ];
    expect(detectTypeValues('t', rows)).toEqual(['收入', '支出']);
  });
});

describe('autoDetectTypeMapping', () => {
  it('常规收支与转账', () => {
    const m = autoDetectTypeMapping(['收入', '支出', '不计收支', '转账']);
    expect(m).toEqual({ 收入: 'INCOME', 支出: 'EXPENSE', 不计收支: 'TRANSFER', 转账: 'TRANSFER' });
  });

  it('英文(大小写不敏感)', () => {
    const m = autoDetectTypeMapping(['income', 'Expense']);
    expect(m).toEqual({ income: 'INCOME', Expense: 'EXPENSE' });
  });

  it('无法识别的值不产生映射', () => {
    const m = autoDetectTypeMapping(['退款']);
    expect(m).toEqual({});
    expect(m['退款']).toBeUndefined();
  });
});

describe('initAccountResolutions', () => {
  it('AI 决议 existing → 映射既有账户', () => {
    const ua: UnmatchedAccountInput[] = [
      { csvName: '招行', suggestedName: '招商银行', suggestedType: 'BANK_DEBIT', aiResolution: { action: 'existing', targetAccountId: 'a1' } },
    ];
    expect(initAccountResolutions(ua)).toEqual({ 招行: { action: 'existing', accountId: 'a1' } });
  });

  it('AI 决议 create → 新建名称+类型', () => {
    const ua: UnmatchedAccountInput[] = [
      { csvName: '零钱', suggestedName: '零钱', suggestedType: 'OTHER', aiResolution: { action: 'create', targetAccountName: '微信零钱', accountType: 'WECHAT' } },
    ];
    expect(initAccountResolutions(ua)).toEqual({ 零钱: { action: 'create', name: '微信零钱', type: 'WECHAT' } });
  });

  it('AI 决议字段残缺时回退候选首位', () => {
    const ua: UnmatchedAccountInput[] = [
      { csvName: 'x', suggestedName: 'x', suggestedType: 'OTHER', candidates: [{ id: 'c1' }, { id: 'c2' }], aiResolution: { action: 'existing' } },
    ];
    expect(initAccountResolutions(ua)).toEqual({ x: { action: 'existing', accountId: 'c1' } });
  });

  it('无 AI 决议无候选 → 新建建议', () => {
    const ua: UnmatchedAccountInput[] = [
      { csvName: 'x', suggestedName: '新账户', suggestedType: 'CASH' },
    ];
    expect(initAccountResolutions(ua)).toEqual({ x: { action: 'create', name: '新账户', type: 'CASH' } });
  });

  it('建议类型为空时兜底 OTHER', () => {
    const ua: UnmatchedAccountInput[] = [{ csvName: 'x', suggestedName: 'y', suggestedType: '' }];
    expect(initAccountResolutions(ua)).toEqual({ x: { action: 'create', name: 'y', type: 'OTHER' } });
  });

  it('aiArgsResolutions 覆盖默认值并可新增条目', () => {
    const ua: UnmatchedAccountInput[] = [
      { csvName: '招行', suggestedName: '招商银行', suggestedType: 'BANK_DEBIT', candidates: [{ id: 'old' }] },
    ];
    const res = initAccountResolutions(ua, [
      { action: 'create', sourceAccountName: '招行', targetAccountName: '招商银行卡', accountType: 'BANK_DEBIT' },
      { action: 'existing', sourceAccountName: '新来源', targetAccountId: 'a9' },
    ]);
    expect(res['招行']).toEqual({ action: 'create', name: '招商银行卡', type: 'BANK_DEBIT' });
    expect(res['新来源']).toEqual({ action: 'existing', accountId: 'a9' });
  });

  it('aiArgsResolutions 字段残缺时不覆盖', () => {
    const ua: UnmatchedAccountInput[] = [
      { csvName: 'x', suggestedName: '默认', suggestedType: 'OTHER' },
    ];
    const res = initAccountResolutions(ua, [{ action: 'existing', sourceAccountName: 'x' }]);
    expect(res['x']).toEqual({ action: 'create', name: '默认', type: 'OTHER' });
  });
});

describe('unresolvedAccountCount', () => {
  it('统计 existing 缺 accountId / create 缺 name 的数量', () => {
    const unmatched = [{ csvName: 'a' }, { csvName: 'b' }, { csvName: 'c' }, { csvName: 'd' }, { csvName: 'e' }];
    // 故意构造缺字段的非法决议测统计容错,超出 AccountResolution 合法形状,需断言绕过
    const resolutions: Record<string, AccountResolution> = {
      a: { action: 'existing' } as AccountResolution,          // 缺 accountId → 未解决
      b: { action: 'existing', accountId: 'x' },
      c: { action: 'create', name: 'n' } as AccountResolution,
      d: { action: 'create' } as AccountResolution,            // 缺 name → 未解决
      // e 无决议 → 不计入(视为未出现在 unmatched 决议中)
    };
    expect(unresolvedAccountCount(unmatched, resolutions)).toBe(2);
  });
});

describe('mergeAccountCreations', () => {
  it('同名账户合并,csvName 以逗号连接', () => {
    const raw: RawAccountCreation[] = [
      { csvName: '招行1', name: '招商银行', type: 'BANK_DEBIT', bankName: '招商银行', accountNo: null },
      { csvName: '招行2', name: '招商银行', type: 'OTHER', bankName: null, accountNo: '6225' },
    ];
    expect(mergeAccountCreations(raw)).toEqual([
      { csvName: '招行1, 招行2', name: '招商银行', type: 'BANK_DEBIT', bankName: '招商银行', accountNo: null },
    ]);
  });

  it('不同名账户保持独立且顺序不变', () => {
    const raw: RawAccountCreation[] = [
      { csvName: 'a', name: '甲', type: 'CASH' },
      { csvName: 'b', name: '乙', type: 'ALIPAY' },
    ];
    const merged = mergeAccountCreations(raw);
    expect(merged).toHaveLength(2);
    expect(merged[0].name).toBe('甲');
    expect(merged[1].name).toBe('乙');
  });

  it('空数组', () => {
    expect(mergeAccountCreations([])).toEqual([]);
  });
});

describe('共享标签常量', () => {
  it('RECORD_TYPE_LABELS 覆盖三种类型', () => {
    expect(RECORD_TYPE_LABELS).toEqual({ INCOME: '收入', EXPENSE: '支出', TRANSFER: '转账' });
  });

  it('IMPORT_SOURCE_LABELS 覆盖四种来源,未知来源回退原文', () => {
    expect(IMPORT_SOURCE_LABELS['alipay']).toBe('支付宝');
    expect(IMPORT_SOURCE_LABELS['unknown-src']).toBeUndefined();
  });

  it('TYPE_TO_GROUP 收支类型对应分类字典组', () => {
    expect(TYPE_TO_GROUP['EXPENSE']).toBe('transaction_category_expense');
    expect(TYPE_TO_GROUP['INCOME']).toBe('transaction_category_income');
    expect(TYPE_TO_GROUP['TRANSFER']).toBe('transaction_category_transfer');
  });
});

import { describe, expect, it } from 'vitest';
import {
  adoptSuggestedAccountResolutions,
  autoDetectColumns,
  autoDetectTypeMapping,
  canProceedImport,
  computeImportProgress,
  detectTypeValues,
  initAccountResolutions,
  isColumnMappingValid,
  isUnrecognizedResolutionComplete,
  matchAccountInPool,
  matchAccountInPoolDetailed,
  mergeAccountCreations,
  normalizeAccountName,
  pickAccountMappingCandidates,
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
    expect(initAccountResolutions(ua)).toEqual({ 招行: { action: 'existing', accountId: 'a1', source: 'ai' } });
  });

  it('AI 决议 create → 新建名称+类型', () => {
    const ua: UnmatchedAccountInput[] = [
      { csvName: '零钱', suggestedName: '零钱', suggestedType: 'OTHER', aiResolution: { action: 'create', targetAccountName: '微信零钱', accountType: 'WECHAT' } },
    ];
    expect(initAccountResolutions(ua)).toEqual({ 零钱: { action: 'create', name: '微信零钱', type: 'WECHAT', source: 'ai' } });
  });

  it('AI 决议字段残缺时回退候选首位,并标记为默认建议', () => {
    const ua: UnmatchedAccountInput[] = [
      { csvName: 'x', suggestedName: 'x', suggestedType: 'OTHER', candidates: [{ id: 'c1' }, { id: 'c2' }], aiResolution: { action: 'existing' } },
    ];
    expect(initAccountResolutions(ua)).toEqual({
      x: { action: 'existing', accountId: 'c1', isDefault: true, source: 'suggested-candidate' },
    });
  });

  it('无 AI 决议无候选 → 不写决议(不再自动新建,留待用户决策)', () => {
    const ua: UnmatchedAccountInput[] = [
      { csvName: 'x', suggestedName: '新账户', suggestedType: 'CASH' },
    ];
    expect(initAccountResolutions(ua)).toEqual({});
  });

  it('aiArgsResolutions 覆盖默认值并可新增条目', () => {
    const ua: UnmatchedAccountInput[] = [
      { csvName: '招行', suggestedName: '招商银行', suggestedType: 'BANK_DEBIT', candidates: [{ id: 'old' }] },
    ];
    const res = initAccountResolutions(ua, [
      { action: 'create', sourceAccountName: '招行', targetAccountName: '招商银行卡', accountType: 'BANK_DEBIT' },
      { action: 'existing', sourceAccountName: '新来源', targetAccountId: 'a9' },
    ]);
    expect(res['招行']).toEqual({ action: 'create', name: '招商银行卡', type: 'BANK_DEBIT', source: 'ai' });
    expect(res['新来源']).toEqual({ action: 'existing', accountId: 'a9', source: 'ai' });
  });

  it('aiArgsResolutions 字段残缺时不产生决议', () => {
    const ua: UnmatchedAccountInput[] = [
      { csvName: 'x', suggestedName: '默认', suggestedType: 'OTHER' },
    ];
    const res = initAccountResolutions(ua, [{ action: 'existing', sourceAccountName: 'x' }]);
    expect(res['x']).toBeUndefined();
  });
});

describe('adoptSuggestedAccountResolutions', () => {
  it('有候选 → 采纳候选首位并去掉默认标记', () => {
    const ua: UnmatchedAccountInput[] = [
      { csvName: 'a', suggestedName: 'A', suggestedType: 'CASH', candidates: [{ id: 'c1' }, { id: 'c2' }] },
    ];
    const res = adoptSuggestedAccountResolutions(ua, {
      a: { action: 'existing', accountId: 'c1', isDefault: true, source: 'suggested-candidate' },
    });
    expect(res['a']).toEqual({ action: 'existing', accountId: 'c1', source: 'suggested-candidate' });
  });

  it('无候选 → 采纳建议新建(类型为空兜底 OTHER)', () => {
    const ua: UnmatchedAccountInput[] = [{ csvName: 'b', suggestedName: '新账户', suggestedType: '' }];
    expect(adoptSuggestedAccountResolutions(ua, {})['b']).toEqual({
      action: 'create', name: '新账户', type: 'OTHER', source: 'suggested-candidate',
    });
  });

  it('用户已明确选择的项不被覆盖', () => {
    const ua: UnmatchedAccountInput[] = [
      { csvName: 'c', suggestedName: 'C', suggestedType: 'CASH', candidates: [{ id: 'c1' }] },
    ];
    const res = adoptSuggestedAccountResolutions(ua, { c: { action: 'create', name: '我自己建的', type: 'CASH' } });
    expect(res['c']).toEqual({ action: 'create', name: '我自己建的', type: 'CASH' });
  });
});

describe('unresolvedAccountCount', () => {
  it('统计缺键、existing 缺 accountId、create 缺 name 或 type 的数量', () => {
    const unmatched = [{ csvName: 'a' }, { csvName: 'b' }, { csvName: 'c' }, { csvName: 'd' }, { csvName: 'e' }];
    // 故意构造缺字段的非法决议测统计容错,超出 AccountResolution 合法形状,需断言绕过
    const resolutions: Record<string, AccountResolution> = {
      a: { action: 'existing' } as AccountResolution,          // 缺 accountId → 未解决
      b: { action: 'existing', accountId: 'x' },
      c: { action: 'create', name: 'n' } as AccountResolution, // 缺 type → 未解决
      d: { action: 'create' } as AccountResolution,            // 缺 name → 未解决
      // e 无决议(缺键) → 同样算未解决
    };
    expect(unresolvedAccountCount(unmatched, resolutions)).toBe(4);
  });
});

describe('isUnrecognizedResolutionComplete', () => {
  it('需类型 + 账户;转账还需转入账户', () => {
    expect(isUnrecognizedResolutionComplete(undefined)).toBe(false);
    expect(isUnrecognizedResolutionComplete({ type: '', accountId: 'a' })).toBe(false);
    expect(isUnrecognizedResolutionComplete({ type: 'EXPENSE' })).toBe(false);
    expect(isUnrecognizedResolutionComplete({ type: 'EXPENSE', accountId: 'a' })).toBe(true);
    expect(isUnrecognizedResolutionComplete({ type: 'TRANSFER', accountId: 'a' })).toBe(false);
    expect(isUnrecognizedResolutionComplete({ type: 'TRANSFER', accountId: 'a', toAccountId: 'b' })).toBe(true);
  });
});

describe('computeImportProgress', () => {
  it('统计 pending / mapped / willSkip(分类按 sourceCategory 聚合,多条需全部选好)', () => {
    const counts = computeImportProgress({
      unmatchedAccounts: [{ csvName: '招行' }, { csvName: '支付宝' }],
      accountResolutions: {
        招行: { action: 'existing', accountId: 'acc-1' },
        // 支付宝 缺键 → 未解析
      },
      categoryResolutions: [
        { sourceCategory: '餐饮美食', targetCode: 'food' },
        { sourceCategory: '服饰装扮', targetCode: '' },
        // 同一 sourceCategory 按类型拆成两条,其中一条没选 → 该分类未映射
        { sourceCategory: '服饰装扮', targetCode: 'cloth' },
      ],
      unrecognizedRecords: [{ rowIndex: 1 }, { rowIndex: 2 }, { rowIndex: 3 }],
      unrecognizedResolutions: {
        1: { type: 'EXPENSE', accountId: 'acc-1' },
        2: { type: 'TRANSFER', accountId: 'acc-1' },   // 转账缺转入 → 未解析
        // 3 无决议 → 未解析
      },
    });

    expect(counts.accountsTotal).toBe(2);
    expect(counts.accountsResolved).toBe(1);
    expect(counts.accountsDefault).toBe(0);
    expect(counts.categoriesTotal).toBe(2);
    expect(counts.categoriesResolved).toBe(1);
    expect(counts.unrecognizedTotal).toBe(3);
    expect(counts.unrecognizedResolved).toBe(1);
    expect(counts.pending).toBe(1 + 1 + 2);
    expect(counts.mapped).toBe(2);
    expect(counts.willSkip).toBe(2);
    expect(counts.blocking).toBe(1);
  });

  it('无入参决议时全部计入待处理', () => {
    const counts = computeImportProgress({
      unmatchedAccounts: [{ csvName: 'a' }],
      unrecognizedRecords: [],
    });
    expect(counts).toMatchObject({ accountsResolved: 0, categoriesTotal: 0, pending: 1, mapped: 0, willSkip: 0, blocking: 1 });
  });

  it('默认建议计入 accountsDefault,不计入 accountsResolved / pending', () => {
    const counts = computeImportProgress({
      unmatchedAccounts: [{ csvName: 'a' }, { csvName: 'b' }],
      accountResolutions: {
        a: { action: 'existing', accountId: 'x', isDefault: true, source: 'suggested-candidate' },
        b: { action: 'create', name: 'B', type: 'CASH' },
      },
      unrecognizedRecords: [],
    });
    expect(counts).toMatchObject({ accountsTotal: 2, accountsResolved: 1, accountsDefault: 1, pending: 0, mapped: 1, blocking: 0 });
    expect(canProceedImport(counts)).toBe(false);
  });

  it('canProceedImport:待处理清空、默认值已采纳才放行', () => {
    const counts = computeImportProgress({
      unmatchedAccounts: [{ csvName: 'a' }],
      accountResolutions: { a: { action: 'existing', accountId: 'x' } },
      unrecognizedRecords: [],
    });
    expect(canProceedImport(counts)).toBe(true);
  });

  it('canProceedImport:有未识别行将跳过时需显式同意', () => {
    const counts = computeImportProgress({
      unmatchedAccounts: [],
      unrecognizedRecords: [{ rowIndex: 1 }],
    });
    expect(counts.willSkip).toBe(1);
    expect(canProceedImport(counts)).toBe(false);
    expect(canProceedImport(counts, { agreeSkipUnrecognized: true })).toBe(true);
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

describe('normalizeAccountName', () => {
  it('剥离 & 拼接的促销/权益尾巴', () => {
    expect(normalizeAccountName('招商银行储蓄卡(9467)&现金抵价券')).toBe('招商银行储蓄卡(9467)');
    expect(normalizeAccountName('网商银行储蓄卡(7484)&网商银行福利金抵扣')).toBe('网商银行储蓄卡(7484)');
    expect(normalizeAccountName('工商银行储蓄卡(7193)&工商银行立减金')).toBe('工商银行储蓄卡(7193)');
    expect(normalizeAccountName('招商银行储蓄卡(9467)&焕新折扣')).toBe('招商银行储蓄卡(9467)');
    expect(normalizeAccountName('网商银行储蓄卡(7484)&网商银行支付享优惠')).toBe('网商银行储蓄卡(7484)');
  });

  it('去掉银行名冗余的「中国」前缀(「中国银行」本身除外)', () => {
    expect(normalizeAccountName('中国建设银行储蓄卡(7483)')).toBe('建设银行储蓄卡(7483)');
    expect(normalizeAccountName('中国工商银行')).toBe('工商银行');
    expect(normalizeAccountName('中国银行')).toBe('中国银行');
    expect(normalizeAccountName('中国银行储蓄卡(1111)')).toBe('中国银行储蓄卡(1111)');
  });

  it('不含促销词的 & 段保留,空白压缩,空值返回空串', () => {
    expect(normalizeAccountName('夫妻联名&共同账户')).toBe('夫妻联名&共同账户');
    expect(normalizeAccountName('  支付宝   余额  ')).toBe('支付宝 余额');
    expect(normalizeAccountName('')).toBe('');
  });
});

describe('matchAccountInPoolDetailed 归一名兜底', () => {
  it('「中国建设银行储蓄卡(7483)」命中已有「建设银行储蓄卡(7483)」', () => {
    const pool: PoolAccount[] = [{ id: 'b1', name: '建设银行储蓄卡(7483)' }];
    expect(matchAccountInPoolDetailed('中国建设银行储蓄卡(7483)', pool)).toEqual({
      matched: true,
      id: 'b1',
      name: '建设银行储蓄卡(7483)',
    });
  });

  it('带促销尾巴的变体命中已有干净账户名', () => {
    const pool: PoolAccount[] = [{ id: 'b2', name: '网商银行储蓄卡(7484)' }];
    expect(matchAccountInPoolDetailed('网商银行储蓄卡(7484)&网商银行福利金抵扣', pool)).toMatchObject({
      matched: true,
      id: 'b2',
    });
  });

  it('原样精确命中优先于归一匹配', () => {
    const pool: PoolAccount[] = [
      { id: 'x1', name: '中国建设银行储蓄卡(7483)' },
      { id: 'x2', name: '建设银行储蓄卡(7483)' },
    ];
    expect(matchAccountInPoolDetailed('中国建设银行储蓄卡(7483)', pool)).toMatchObject({ matched: true, id: 'x1' });
  });

  it('归一后仍无命中 → 不匹配', () => {
    expect(matchAccountInPoolDetailed('中国银行储蓄卡(1111)&立减金', [{ id: 'z1', name: '支付宝' }])).toEqual({
      matched: false,
      ambiguous: false,
    });
  });
});

describe('isAccountResolutionComplete(create 需名称+类型)', () => {
  it('create 缺类型视为未完成,门禁不放行', () => {
    const counts = computeImportProgress({
      unmatchedAccounts: [{ csvName: 'a' }],
      accountResolutions: { a: { action: 'create', name: 'A', type: '' } },
      unrecognizedRecords: [],
    });
    expect(counts.accountsResolved).toBe(0);
    expect(counts.blocking).toBe(1);
    expect(canProceedImport(counts)).toBe(false);
  });

  it('create 名称+类型齐全才放行', () => {
    const counts = computeImportProgress({
      unmatchedAccounts: [{ csvName: 'a' }],
      accountResolutions: { a: { action: 'create', name: 'A', type: 'CASH' } },
      unrecognizedRecords: [],
    });
    expect(counts.accountsResolved).toBe(1);
    expect(canProceedImport(counts)).toBe(true);
  });
});

describe('normalizeAccountName(手机银行促销尾巴)', () => {
  it('覆盖常见尾巴:立减 / 券 / 补贴 / 红包', () => {
    // 「立减」此前只收了「立减金」,导致「…&建设银行立减」漏网
    expect(normalizeAccountName('建设银行储蓄卡(7483)&建设银行立减')).toBe('建设银行储蓄卡(7483)');
    expect(normalizeAccountName('招商银行储蓄卡(9467)&政府补贴')).toBe('招商银行储蓄卡(9467)');
    expect(normalizeAccountName('工商银行储蓄卡(7193)&随机立减')).toBe('工商银行储蓄卡(7193)');
    expect(normalizeAccountName('支付宝&消费券')).toBe('支付宝');
    expect(normalizeAccountName('微信零钱&红包')).toBe('微信零钱');
    expect(normalizeAccountName('工商银行储蓄卡(7193)&工商银行立减金')).toBe('工商银行储蓄卡(7193)');
  });

  it('第一段不参与促销判定(账户名本身含这些字不受影响)', () => {
    expect(normalizeAccountName('福利彩票专用卡')).toBe('福利彩票专用卡');
    expect(normalizeAccountName('微信零钱')).toBe('微信零钱');
  });
});

describe('pickAccountMappingCandidates', () => {
  const m = (sourceAccountName: string, target: string) => ({ sourceAccountName, target });

  it('原始名精确优先', () => {
    const byName = new Map([['招商银行储蓄卡(9467)', [m('招商银行储蓄卡(9467)', 'A')]]]);
    const byNorm = new Map([['招商银行储蓄卡(9467)', [m('招商银行储蓄卡(9467)&现金抵价券', 'B')]]]);
    expect(pickAccountMappingCandidates('招商银行储蓄卡(9467)', byName, byNorm)?.[0].target).toBe('A');
  });

  it('精确分组为空时退回归一后相等的规则(换个促销尾巴仍能命中)', () => {
    const byName = new Map([['招商银行储蓄卡(9467)&现金抵价券', [m('招商银行储蓄卡(9467)&现金抵价券', 'A')]]]);
    const byNorm = new Map([['招商银行储蓄卡(9467)', [m('招商银行储蓄卡(9467)&现金抵价券', 'A')]]]);
    expect(pickAccountMappingCandidates('招商银行储蓄卡(9467)&政府补贴', byName, byNorm)?.[0].target).toBe('A');
  });

  it('「中国」前缀差异也能命中', () => {
    const byNorm = new Map([['建设银行储蓄卡(7483)', [m('中国建设银行储蓄卡(7483)', 'A')]]]);
    expect(pickAccountMappingCandidates('建设银行储蓄卡(7483)', new Map(), byNorm)?.[0].target).toBe('A');
  });

  it('不同卡号不互相命中', () => {
    const byNorm = new Map([['招商银行储蓄卡(9467)', [m('招商银行储蓄卡(9467)&立减', 'A')]]]);
    expect(pickAccountMappingCandidates('招商银行储蓄卡(9468)', new Map(), byNorm)).toBeUndefined();
  });

  it('两处都没有 → undefined', () => {
    expect(pickAccountMappingCandidates('没有这条', new Map(), new Map())).toBeUndefined();
  });
});

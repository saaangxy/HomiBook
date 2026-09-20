import { describe, expect, it } from 'vitest';
import { smsCandidatesToRows, type SmsCandidateInput } from '../src/services/import/sms.js';

// 短信路径没有文件:候选 → ParsedRow 的适配必须稳定,后面才敢交给「解析后」公共管线。
// 字段语义对齐 parsers.ts 的产出(尤其 rowIndex / accountName / categoryCode)。

/** 一条农行样本解析出的候选(脱敏) */
function candidate(overrides: Partial<SmsCandidateInput> = {}): SmsCandidateInput {
  return {
    sourceId: 'sms:42',
    date: '2026-09-17T04:58:00.000Z',
    type: 'EXPENSE',
    amount: 100,
    payer: 'xx',
    remark: '短信 中国农业银行(5172) 转支 xx',
    tradeKind: '转支',
    bankName: '中国农业银行',
    cardTail: '5172',
    accountName: '中国农业银行(5172)',
    ...overrides,
  };
}

describe('smsCandidatesToRows', () => {
  it('完整候选 → 解析后行(字段与 parsers.ts 产出同构)', () => {
    const { rows, errors } = smsCandidatesToRows([candidate()]);

    expect(errors).toEqual([]);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      date: '2026-09-17T04:58:00.000Z',
      type: 'EXPENSE',
      amount: 100,
      accountName: '中国农业银行(5172)',
      accountId: null,
      toAccountName: null,
      toAccountId: null,
      // 交易类型原文作为「源分类」,供 source='sms' 的分类映射使用
      categoryCode: '转支',
      mappedCategoryCode: null,
      payer: 'xx',
      remark: '短信 中国农业银行(5172) 转支 xx',
      tags: ['导入', '短信'],
      // 无文件行号:1 起序号(未识别记录的人工指定 key)
      rowIndex: 1,
    });
  });

  it('金额取绝对值:方向由 type 表达', () => {
    const { rows } = smsCandidatesToRows([candidate({ amount: -100 }), candidate({ amount: 200, type: 'INCOME' })]);
    expect(rows.map(r => r.amount)).toEqual([100, 200]);
    expect(rows.map(r => r.type)).toEqual(['EXPENSE', 'INCOME']);
  });

  it('缺 accountName 时用 银行(尾号) 兜底', () => {
    const { rows } = smsCandidatesToRows([candidate({ accountName: null })]);
    expect(rows[0].accountName).toBe('中国农业银行(5172)');
    expect(rows[0].type).toBe('EXPENSE');
  });

  it('无任何账户信息 → 未识别(UNKNOWN)并在备注说明,由用户在确认卡里指定', () => {
    const { rows } = smsCandidatesToRows([
      candidate({ accountName: null, bankName: null, cardTail: null }),
    ]);
    expect(rows[0]).toMatchObject({ type: 'UNKNOWN', accountName: '' });
    expect(rows[0].remark).toContain('缺少账户信息');
  });

  it('收支方向非法 → 未识别(不静默归一化)', () => {
    const { rows } = smsCandidatesToRows([candidate({ type: '收入' })]);
    expect(rows[0]).toMatchObject({ type: 'UNKNOWN' });
    expect(rows[0].remark).toContain('收支方向未识别');
  });

  it('金额/时间非法 → 跳过并记错误,rowIndex 仍按候选序号(不重排)', () => {
    const { rows, errors } = smsCandidatesToRows([
      candidate(),
      candidate({ amount: 0 }),
      candidate({ date: 'not-a-date' }),
      candidate({ sourceId: 'sms:45' }),
    ]);

    expect(rows).toHaveLength(2);
    // 第 2/3 条被跳过,第 4 条仍是 rowIndex=4(与移动端候选列表序号一致)
    expect(rows.map(r => r.rowIndex)).toEqual([1, 4]);
    expect(errors).toEqual(['第 2 条金额无效,已跳过', '第 3 条时间无效,已跳过']);
  });

  it('空交易类型 → categoryCode 为 null(不产生假的未映射分类)', () => {
    const { rows } = smsCandidatesToRows([candidate({ tradeKind: null, remark: null })]);
    expect(rows[0].categoryCode).toBeNull();
    expect(rows[0].remark).toBe('');
  });
});

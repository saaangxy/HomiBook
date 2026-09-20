import { describe, expect, it } from 'vitest';
import {
  SMS_AI_MAX_TEXT_LENGTH,
  toSmsCandidateFromAi,
  truncateSmsAiText,
  type SmsAiExtractCandidate,
  type SmsAiExtractItem,
} from '../src/sms-ai.js';

const item: SmsAiExtractItem = {
  sourceId: 'sms:7',
  text: '您尾号9671账户09月05日18:54代扣10.00元',
  sender: '95599',
  receivedAt: '2026-09-05T10:54:00.000Z',
  channel: 'sms',
};

const ai = (patch: Partial<SmsAiExtractCandidate> = {}): SmsAiExtractCandidate => ({
  sourceId: 'sms:7',
  isTransaction: true,
  date: '2026-09-05T10:54:00.000Z',
  amount: 10,
  type: 'EXPENSE',
  bankName: '中国农业银行',
  cardTail: '9671',
  tradeKind: '代扣',
  payer: null,
  remark: null,
  confidence: 0.7,
  notes: [],
  ...patch,
});

describe('truncateSmsAiText', () => {
  it('超长正文按上限截断,短文本原样返回', () => {
    expect(truncateSmsAiText('短文本')).toBe('短文本');
    const long = 'x'.repeat(SMS_AI_MAX_TEXT_LENGTH + 100);
    expect(truncateSmsAiText(long).length).toBe(SMS_AI_MAX_TEXT_LENGTH);
    expect(truncateSmsAiText(long, 100).length).toBe(100);
  });
});

describe('toSmsCandidateFromAi', () => {
  it('字段齐全 → 与本地解析同形的候选(账户名由 银行名+尾号 拼出)', () => {
    const c = toSmsCandidateFromAi(ai(), item);
    expect(c).toMatchObject({
      sourceId: 'sms:7',
      raw: item.text,
      sender: '95599',
      bankName: '中国农业银行',
      cardTail: '9671',
      amount: 10,
      type: 'EXPENSE',
      accountName: '中国农业银行(9671)',
      // 备注前缀标明渠道 + AI 标记(入库备注里能看出这条是模型抽取的)
      remark: '短信 AI 中国农业银行(9671) 代扣',
      balance: null,
      confidence: 0.7,
    });
    // dedupeKey/channel 由调用方补齐:两条路径(本地/AI)产出同一形状
    expect(c && 'dedupeKey' in c).toBe(false);
  });

  it('方向缺失 → UNKNOWN(由后端归入未识别记录交人工)', () => {
    expect(toSmsCandidateFromAi(ai({ type: null }), item)?.type).toBe('UNKNOWN');
  });

  it('时间缺失 → 用到达时刻兜底', () => {
    expect(toSmsCandidateFromAi(ai({ date: null }), item)?.date).toBe(item.receivedAt);
    expect(toSmsCandidateFromAi(ai({ date: '不是时间' }), item)?.date).toBe(item.receivedAt);
  });

  it('模型判定非交易 / 无金额 → 丢弃(不产生候选)', () => {
    expect(toSmsCandidateFromAi(ai({ isTransaction: false }), item)).toBeNull();
    expect(toSmsCandidateFromAi(ai({ amount: null }), item)).toBeNull();
    expect(toSmsCandidateFromAi(ai({ amount: 0 }), item)).toBeNull();
  });

  it('只有尾号 → 保留「尾号9671」而非空账户名', () => {
    expect(toSmsCandidateFromAi(ai({ bankName: null }), item)?.accountName).toBe('尾号9671');
  });

  it('置信度越界时收敛到 0.2~0.95', () => {
    expect(toSmsCandidateFromAi(ai({ confidence: 3 }), item)?.confidence).toBe(0.95);
    expect(toSmsCandidateFromAi(ai({ confidence: -1 }), item)?.confidence).toBe(0.2);
  });
});

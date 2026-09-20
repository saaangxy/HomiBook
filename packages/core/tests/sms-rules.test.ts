import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SMS_FILTER_RULES,
  applySmsFilterRules,
  isSenderAllowed,
  normalizeSmsFilterRules,
  type SmsFilterRules,
} from '../src/sms-rules.js';

const ABC =
  '【中国农业银行】您尾号5172账户09月17日12:58向xx完成转支交易人民币-100.00，余额611.92，详见掌银。';

const rules = (patch: Partial<SmsFilterRules> = {}): SmsFilterRules => ({ ...DEFAULT_SMS_FILTER_RULES, ...patch });

describe('normalizeSmsFilterRules', () => {
  it('去空白、去重,非法金额回落为 0', () => {
    expect(
      normalizeSmsFilterRules({
        senders: [' 95599 ', '95599', '', '  '],
        include: ['消费'],
        exclude: ['退订', '退订'],
        minAmount: -5 as unknown as number,
      }),
    ).toEqual({ sms: true, notification: true, senders: ['95599'], include: ['消费'], exclude: ['退订'], minAmount: 0 });
  });

  it('显式关闭的通道保持关闭(false 不能被默认值覆盖)', () => {
    const r = normalizeSmsFilterRules({ sms: false, notification: false });
    expect(r.sms).toBe(false);
    expect(r.notification).toBe(false);
  });

  it('缺省/垃圾输入回落为默认规则', () => {
    expect(normalizeSmsFilterRules(null)).toEqual(DEFAULT_SMS_FILTER_RULES);
    expect(normalizeSmsFilterRules({ senders: 'x' as unknown as string[] }).senders).toEqual([]);
  });
});

describe('isSenderAllowed', () => {
  it('空名单放行一切(含无发件人的内容)', () => {
    expect(isSenderAllowed(null, [])).toBe(true);
    expect(isSenderAllowed('95599', [])).toBe(true);
  });

  it('按包含匹配:95599 命中 106 聚合号段', () => {
    expect(isSenderAllowed('106980095599', ['95599'])).toBe(true);
  });

  it('白名单存在但内容没有发件人 → 不放行(无法确认来源)', () => {
    expect(isSenderAllowed(null, ['95599'])).toBe(false);
    expect(isSenderAllowed('', ['95599'])).toBe(false);
  });

  it('不匹配则拦截', () => {
    expect(isSenderAllowed('10086', ['95599', 'com.eg.android.AlipayGphone'])).toBe(false);
  });
});

describe('applySmsFilterRules', () => {
  it('默认规则:放行真实交易短信', () => {
    expect(applySmsFilterRules({ channel: 'sms', text: ABC, sender: '95599', rules: rules() })).toEqual({
      pass: true,
      reason: 'ok',
    });
  });

  it('通道开关关闭 → 该渠道整体不采(短信/通知互不影响)', () => {
    expect(applySmsFilterRules({ channel: 'sms', text: ABC, rules: rules({ sms: false }) })).toEqual({
      pass: false,
      reason: 'channel-off:sms',
    });
    expect(
      applySmsFilterRules({ channel: 'notification', text: '微信支付 消费 88.00 元', rules: rules({ notification: false }) }),
    ).toEqual({ pass: false, reason: 'channel-off:notification' });
  });

  it('发件人不在白名单 → 拦截', () => {
    expect(applySmsFilterRules({ channel: 'sms', text: ABC, sender: '10086', rules: rules({ senders: ['95599'] }) })).toEqual({
      pass: false,
      reason: 'sender-not-allowed',
    });
  });

  it('关键词黑名单命中即排除,且优先于白名单', () => {
    expect(
      applySmsFilterRules({
        channel: 'sms',
        text: ABC,
        rules: rules({ include: ['转支'], exclude: ['农业银行'] }),
      }),
    ).toEqual({ pass: false, reason: 'exclude:农业银行' });
  });

  it('设置了关键词白名单:不含任一关键词则拦截', () => {
    expect(applySmsFilterRules({ channel: 'sms', text: ABC, rules: rules({ include: ['消费'] }) })).toEqual({
      pass: false,
      reason: 'include-miss',
    });
    expect(applySmsFilterRules({ channel: 'sms', text: ABC, rules: rules({ include: ['转支'] }) }).pass).toBe(true);
  });

  it('金额下限:已解析出金额时低于门槛拦截;读不出金额时不参与判定(交给 AI/人工)', () => {
    expect(applySmsFilterRules({ channel: 'sms', text: ABC, amount: 0.01, rules: rules({ minAmount: 1 }) })).toEqual({
      pass: false,
      reason: 'below-min-amount',
    });
    expect(applySmsFilterRules({ channel: 'sms', text: ABC, amount: 100, rules: rules({ minAmount: 1 }) }).pass).toBe(true);
    expect(applySmsFilterRules({ channel: 'sms', text: ABC, amount: null, rules: rules({ minAmount: 1 }) }).pass).toBe(true);
  });

  it('空文本直接拦截', () => {
    expect(applySmsFilterRules({ channel: 'sms', text: '   ', rules: rules() })).toEqual({ pass: false, reason: 'empty' });
  });
});

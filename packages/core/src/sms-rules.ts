/**
 * 短信 / 通知记账 —— 用户自定义筛选规则(纯函数,三端共享)。
 *
 * 定位:在最外层决定「哪些内容值得进入解析与候选」,它既是降噪开关,也是**隐私边界** ——
 * 只有通过本规则的内容才可能成为候选;开启 AI 兜底解析时,也只有这些内容才可能上送模型。
 * 规则全部在本机求值(不联网、不落库),顺序:
 *   通道开关 → 发件人白名单 → 关键词黑名单 → 关键词白名单(为空=不限)→ 金额下限。
 * 「是不是一笔交易」仍由 screenSms 判定,本层只做用户可控的收窄,不代替预筛。
 */

export type SmsRuleChannel = 'sms' | 'notification';

export interface SmsFilterRules {
  /** 启用短信渠道 */
  sms: boolean;
  /** 启用通知渠道 */
  notification: boolean;
  /** 发件人白名单(服务号 / 通知来源包名)。空数组 = 不限;按「包含」匹配,故 95599 亦命中 106980095599 */
  senders: string[];
  /** 关键词白名单:非空时文本必须命中其一 */
  include: string[];
  /** 关键词黑名单:命中即排除(优先于白名单) */
  exclude: string[];
  /** 金额下限(元):已解析出金额且低于它则排除;0 = 不限 */
  minAmount: number;
}

export const DEFAULT_SMS_FILTER_RULES: SmsFilterRules = {
  sms: true,
  notification: true,
  senders: [],
  include: [],
  exclude: [],
  minAmount: 0,
};

export interface SmsRuleVerdict {
  pass: boolean;
  /**
   * 结论原因(调试日志与扫描统计用):
   * 'ok' | 'channel-off:sms' | 'channel-off:notification' | 'sender-not-allowed' |
   * 'empty' | 'exclude:关键词' | 'include-miss' | 'below-min-amount'
   */
  reason: string;
}

/** 规范化外部输入(去空白、去重、金额取非负);非法字段回落到默认值 */
export function normalizeSmsFilterRules(input: Partial<SmsFilterRules> | null | undefined): SmsFilterRules {
  const raw = input ?? {};
  const toList = (v: unknown): string[] =>
    Array.isArray(v) ? [...new Set(v.map((item) => String(item).trim()).filter(Boolean))] : [];
  const min = Number(raw.minAmount);
  return {
    sms: raw.sms !== false,
    notification: raw.notification !== false,
    senders: toList(raw.senders),
    include: toList(raw.include),
    exclude: toList(raw.exclude),
    minAmount: Number.isFinite(min) && min > 0 ? min : 0,
  };
}

/** 发件人是否放行:空名单=全部放行;未填发件人的内容在白名单存在时视为不放行 */
export function isSenderAllowed(sender: string | null | undefined, senders: string[]): boolean {
  if (senders.length === 0) return true;
  const s = (sender ?? '').trim();
  if (!s) return false;
  return senders.some((rule) => s.includes(rule));
}

/** 命中关键词列表中的任意一个,返回命中的词 */
function hitAny(text: string, words: string[]): string | null {
  for (const word of words) {
    if (word && text.includes(word)) return word;
  }
  return null;
}

/**
 * 规则求值。
 * amount 可选:本地已解析出金额时传入以参与金额下限;长尾格式解析不出金额时传 undefined/null,
 * 此时金额门槛不参与判定(交给 AI 兜底或人工确认,不因为「读不出金额」直接丢掉)。
 */
export function applySmsFilterRules(input: {
  channel: SmsRuleChannel;
  text: string;
  sender?: string | null;
  amount?: number | null;
  rules: SmsFilterRules;
}): SmsRuleVerdict {
  const { channel, text, sender, amount, rules } = input;

  if (channel === 'sms' && !rules.sms) return { pass: false, reason: 'channel-off:sms' };
  if (channel === 'notification' && !rules.notification) return { pass: false, reason: 'channel-off:notification' };

  if (!isSenderAllowed(sender, rules.senders)) return { pass: false, reason: 'sender-not-allowed' };

  const body = (text ?? '').trim();
  if (!body) return { pass: false, reason: 'empty' };

  const excluded = hitAny(body, rules.exclude);
  if (excluded) return { pass: false, reason: `exclude:${excluded}` };

  if (rules.include.length > 0 && !hitAny(body, rules.include)) {
    return { pass: false, reason: 'include-miss' };
  }

  if (rules.minAmount > 0 && amount != null && Number.isFinite(amount) && amount < rules.minAmount) {
    return { pass: false, reason: 'below-min-amount' };
  }

  return { pass: true, reason: 'ok' };
}

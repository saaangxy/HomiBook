import AsyncStorage from '@react-native-async-storage/async-storage';
import { DEFAULT_SMS_FILTER_RULES, normalizeSmsFilterRules, type SmsFilterRules } from '@homibook/core';

// 短信/通知筛选规则的本机存储(纯规则判定在 core sms-rules.ts,这里只负责读写)。
// 规则决定「哪些内容值得进入解析/候选」,同时也是**隐私边界**:只有通过规则的未识别内容才可能上送 AI。

const RULES_KEY = 'homibook.smsFilterRules';

/** 进程内缓存:扫描过程中需要同步读取,避免每条短信都 await 一次存储 */
let cached: SmsFilterRules | null = null;

export async function loadSmsFilterRules(): Promise<SmsFilterRules> {
  try {
    const raw = await AsyncStorage.getItem(RULES_KEY);
    cached = normalizeSmsFilterRules(raw ? (JSON.parse(raw) as Partial<SmsFilterRules>) : null);
  } catch {
    cached = { ...DEFAULT_SMS_FILTER_RULES };
  }
  return cached;
}

export async function saveSmsFilterRules(rules: SmsFilterRules): Promise<SmsFilterRules> {
  cached = normalizeSmsFilterRules(rules);
  try {
    await AsyncStorage.setItem(RULES_KEY, JSON.stringify(cached));
  } catch {
    // 存储不可用:本次会话仍生效(内存缓存),重启后回落默认规则
  }
  return cached;
}

/** 已加载的规则(未加载过时为默认规则:全部放行) */
export function getSmsFilterRules(): SmsFilterRules {
  return cached ?? DEFAULT_SMS_FILTER_RULES;
}

/** 规则是否做过自定义(UI 用它显示「已自定义」提示) */
export function isSmsFilterRulesCustomized(rules: SmsFilterRules): boolean {
  return (
    !rules.sms ||
    !rules.notification ||
    rules.senders.length > 0 ||
    rules.include.length > 0 ||
    rules.exclude.length > 0 ||
    rules.minAmount > 0
  );
}

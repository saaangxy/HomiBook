import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  buildSmsDedupeKey,
  SMS_AI_BATCH_SIZE,
  toSmsCandidateFromAi,
  type SmsAiExtractCandidate,
  type SmsAiExtractItem,
} from '@homibook/core';
import { http } from './http';
import type { SmsCandidate } from './sms-import';

// 短信/通知 —— AI 兜底解析(长尾内容)。
//
// 边界(与方案文档 2.6 一致):
//   · 只上送**本地规则解析读不懂**的原文,且这些内容必须先通过用户的筛选规则;
//   · 开关默认关闭,由用户主动开启;
//   · 结果只作为候选(仍需在确认卡里核对),账户匹配/分类/去重/入账仍走既有确定性管线;
//   · 本机按「来源 id + 正文指纹」缓存结果,同一批重复扫描不再调用模型。

const SETTINGS_KEY = 'homibook.smsAi';
const CACHE_KEY = 'homibook.smsAiCache';
/** 缓存条数上限(超出按写入顺序丢弃最早的) */
const CACHE_LIMIT = 300;
/**
 * 单次抽取请求超时:服务端要等模型返回,默认 10s 会在模型还没答完时被本地掐断
 * (症状是报「连接超时/无法连接」,而聊天能正常用 —— 聊天走 SSE 流式,不受这个超时影响)。
 */
const SMS_AI_REQUEST_TIMEOUT_MS = 60_000;
/**
 * 客户端每次请求的条数:取得比服务端上限更小 —— 模型生成 20 条 JSON 可能要几十秒,
 * 分批后单次等待更短、进度反馈更细,且某批失败不影响其余批。
 */
const SMS_AI_CHUNK_SIZE = Math.min(SMS_AI_BATCH_SIZE, 10);

export interface SmsAiSettings {
  enabled: boolean;
}

/** 默认关闭:开启后未识别正文会发送到用户配置的模型 */
export const DEFAULT_SMS_AI_SETTINGS: SmsAiSettings = { enabled: false };

export async function loadSmsAiSettings(): Promise<SmsAiSettings> {
  try {
    const raw = await AsyncStorage.getItem(SETTINGS_KEY);
    if (!raw) return { ...DEFAULT_SMS_AI_SETTINGS };
    return { enabled: !!(JSON.parse(raw) as Partial<SmsAiSettings>)?.enabled };
  } catch {
    return { ...DEFAULT_SMS_AI_SETTINGS };
  }
}

export async function saveSmsAiSettings(settings: SmsAiSettings): Promise<void> {
  try {
    await AsyncStorage.setItem(SETTINGS_KEY, JSON.stringify({ enabled: !!settings.enabled }));
  } catch {
    // 存储不可用:开关不生效
  }
}

// ── 本机缓存 ──

type CachedEntry = { key: string; candidate: SmsAiExtractCandidate };

/** 来源 id + 正文指纹:同一条消息重复扫描直接复用,连「非交易」的结论一起缓存 */
function cacheKeyOf(item: SmsAiExtractItem): string {
  let hash = 5381;
  for (let i = 0; i < item.text.length; i++) hash = ((hash << 5) + hash + item.text.charCodeAt(i)) | 0;
  return `${item.sourceId}|${hash}`;
}

async function readCache(): Promise<Map<string, SmsAiExtractCandidate>> {
  try {
    const raw = await AsyncStorage.getItem(CACHE_KEY);
    const list = raw ? (JSON.parse(raw) as CachedEntry[]) : [];
    return new Map(Array.isArray(list) ? list.map((e) => [e.key, e.candidate]) : []);
  } catch {
    return new Map();
  }
}

async function writeCache(cache: Map<string, SmsAiExtractCandidate>, fresh: CachedEntry[]): Promise<void> {
  const merged = [...cache.entries()].map(([key, candidate]) => ({ key, candidate })).concat(fresh);
  try {
    await AsyncStorage.setItem(CACHE_KEY, JSON.stringify(merged.slice(-CACHE_LIMIT)));
  } catch {
    // 存不下就算了:下次重新调用模型
  }
}

/** 清空缓存(设置页「清空本机标记」连带清掉,便于重新解析) */
export async function clearSmsAiCache(): Promise<void> {
  try {
    await AsyncStorage.removeItem(CACHE_KEY);
  } catch {
    // ignore
  }
}

export interface SmsAiExtractOutcome {
  /** 与本地解析同形的候选(已补 dedupeKey / channel),可直接并入候选列表 */
  candidates: SmsCandidate[];
  /** 命中缓存的条数(0 即本次真正调用了模型) */
  fromCache: number;
  /** 批次级错误(模型返回不合法、某批网络失败等);部分成功时仍返回已拿到的候选 */
  errors: string[];
}

export interface SmsAiExtractOptions {
  /** 进度回调(已处理 / 待处理):扫描页据此显示「AI 解析中 x/y」,避免长等待看起来像卡死 */
  onProgress?: (done: number, total: number) => void;
}

/**
 * 对未识别内容做 AI 兜底抽取。调用方负责传「已通过筛选规则且本地没读懂」的条目。
 * 网络/未配置模型等错误直接抛出,由调用方提示(不静默)。
 */
export async function extractCandidatesWithAi(
  accountBookId: string,
  items: SmsAiExtractItem[],
  opts?: SmsAiExtractOptions,
): Promise<SmsAiExtractOutcome> {
  if (items.length === 0) return { candidates: [], fromCache: 0, errors: [] };

  const cache = await readCache();
  const pending: SmsAiExtractItem[] = [];
  const resolved: { item: SmsAiExtractItem; candidate: SmsAiExtractCandidate }[] = [];
  for (const item of items) {
    const hit = cache.get(cacheKeyOf(item));
    if (hit) resolved.push({ item, candidate: hit });
    else pending.push(item);
  }

  const errors: string[] = [];
  const fresh: CachedEntry[] = [];
  let firstError: unknown = null;

  // 分批请求:既缩短单次等待,也让某批失败不至于拖垮整轮
  for (let offset = 0; offset < pending.length; offset += SMS_AI_CHUNK_SIZE) {
    const chunk = pending.slice(offset, offset + SMS_AI_CHUNK_SIZE);
    try {
      const res = await http.post<{ candidates: SmsAiExtractCandidate[]; errors: string[] }>(
        '/api/sms/extract',
        { accountBookId, items: chunk },
        { timeoutMs: SMS_AI_REQUEST_TIMEOUT_MS },
      );
      for (const err of res?.errors ?? []) errors.push(err);
      for (const candidate of res?.candidates ?? []) {
        const item = chunk.find((it) => it.sourceId === candidate.sourceId);
        if (!item) continue;
        const key = cacheKeyOf(item);
        cache.set(key, candidate);
        fresh.push({ key, candidate });
        resolved.push({ item, candidate });
      }
    } catch (e) {
      if (!firstError) firstError = e;
      errors.push(`第 ${Math.floor(offset / SMS_AI_CHUNK_SIZE) + 1} 批失败:${(e as Error)?.message || '未知错误'}`);
    }
    opts?.onProgress?.(Math.min(offset + chunk.length, pending.length), pending.length);
  }
  await writeCache(cache, fresh);

  // 一批都没成功(网络中断 / 服务端未更新 / 全部超时):如实抛出,由调用方提示;
  // 部分成功则照常返回已拿到的候选,失败批次记在 errors 里
  if (resolved.length === 0 && firstError) throw firstError;

  const candidates: SmsCandidate[] = [];
  for (const { item, candidate } of resolved) {
    const parsed = toSmsCandidateFromAi(candidate, item);
    if (!parsed) continue;
    candidates.push({
      ...parsed,
      channel: item.channel,
      dedupeKey: buildSmsDedupeKey(parsed, accountBookId),
    });
  }

  return { candidates, fromCache: items.length - pending.length, errors };
}

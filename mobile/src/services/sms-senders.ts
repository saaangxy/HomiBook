import AsyncStorage from '@react-native-async-storage/async-storage';
import type { SmsSenderStat } from './sms-import';

// 扫描到的来源(发件号码 / 通知来源)本机缓存 —— 给「筛选规则 → 发件人白名单」当可搜索下拉的候选。
// 只存标识、标签与计数,**不存任何正文**;每次扫描后合并更新,按命中次数降序。

const SENDERS_KEY = 'homibook.smsSenders';
/** 缓存条数上限:超出丢弃命中次数最少、最久未见的 */
const SENDERS_LIMIT = 200;

/** 缓存里的一条来源 */
export interface SmsSenderEntry extends SmsSenderStat {
  /** 最近一次扫描见到它的时刻(ms) */
  lastSeenAt: number;
}

const keyOf = (e: { channel: string; sender: string }) => `${e.channel}|${e.sender}`;

/** 降序:命中多的在前,其次最近见到的 */
function sortSenders(list: SmsSenderEntry[]): SmsSenderEntry[] {
  return list.sort((a, b) => b.count - a.count || b.lastSeenAt - a.lastSeenAt);
}

export async function loadSmsSenders(): Promise<SmsSenderEntry[]> {
  try {
    const raw = await AsyncStorage.getItem(SENDERS_KEY);
    const list = raw ? (JSON.parse(raw) as SmsSenderEntry[]) : [];
    return Array.isArray(list) ? sortSenders(list) : [];
  } catch {
    return [];
  }
}

/** 扫描后合并统计(计数累加、刷新 lastSeenAt 与标签);返回合并后的完整列表 */
export async function mergeSmsSenders(stats: SmsSenderStat[]): Promise<SmsSenderEntry[]> {
  if (stats.length === 0) return loadSmsSenders();
  const current = await loadSmsSenders();
  const byKey = new Map(current.map((e) => [keyOf(e), e]));
  const now = Date.now();

  for (const stat of stats) {
    const key = keyOf(stat);
    const prev = byKey.get(key);
    byKey.set(key, {
      sender: stat.sender,
      channel: stat.channel,
      // 标签可能后补(如服务号表新增条目),每次以最新为准
      detail: stat.detail ?? prev?.detail ?? null,
      count: (prev?.count ?? 0) + stat.count,
      transactions: (prev?.transactions ?? 0) + stat.transactions,
      lastSeenAt: now,
    });
  }

  const merged = sortSenders([...byKey.values()]).slice(0, SENDERS_LIMIT);
  try {
    await AsyncStorage.setItem(SENDERS_KEY, JSON.stringify(merged));
  } catch {
    // 存储不可用:仅影响下次打开时的候选列表
  }
  return merged;
}

export async function clearSmsSenders(): Promise<void> {
  try {
    await AsyncStorage.removeItem(SENDERS_KEY);
  } catch {
    // ignore
  }
}

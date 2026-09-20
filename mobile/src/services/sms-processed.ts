import AsyncStorage from '@react-native-async-storage/async-storage';

// 短信记账「已处理」标记 —— 去重第 1 层(见 example/图片分享与短信记账方案.md 2.4)。
// 按短信 _id 记已消费集合,让同一条短信不会在多次扫描里反复出现在候选列表。
// 仅存本机、不上送;容量上限按时间 FIFO 裁剪(标记只服务于「最近扫描过的短信」)。

const KEY = 'homibook.smsProcessed';
/** 保留上限:超出按时间裁剪最旧的 */
const MAX_ITEMS = 2000;

interface ProcessedEntry {
  id: string;
  at: number;
}

async function readAll(): Promise<ProcessedEntry[]> {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    if (!raw) return [];
    const list = JSON.parse(raw);
    return Array.isArray(list) ? (list as ProcessedEntry[]) : [];
  } catch {
    return [];
  }
}

async function writeAll(items: ProcessedEntry[]): Promise<void> {
  try {
    if (items.length === 0) await AsyncStorage.removeItem(KEY);
    else await AsyncStorage.setItem(KEY, JSON.stringify(items));
  } catch {
    // 存储不可用时放弃标记(最坏结果是重复展示,不阻断记账主流程)
  }
}

/** 已处理的短信 id 集合(扫描时据此过滤) */
export async function loadProcessedSmsIds(): Promise<Set<string>> {
  return new Set((await readAll()).map((e) => e.id));
}

/** 追加已处理标记(按 id 去重;超上限裁剪最旧的) */
export async function markSmsProcessed(ids: string[]): Promise<void> {
  const valid = ids.filter(Boolean);
  if (valid.length === 0) return;
  const cur = await readAll();
  const seen = new Set(cur.map((e) => e.id));
  const now = Date.now();
  const added = valid.filter((id) => !seen.has(id)).map((id) => ({ id, at: now }));
  if (added.length === 0) return;
  const next = [...cur, ...added].sort((a, b) => a.at - b.at);
  await writeAll(next.length > MAX_ITEMS ? next.slice(next.length - MAX_ITEMS) : next);
}

/** 撤销部分标记(自动记账回滚:这批短信/通知应重新回到候选列表) */
export async function unmarkSmsProcessed(ids: string[]): Promise<void> {
  const drop = new Set(ids.filter(Boolean));
  if (drop.size === 0) return;
  const cur = await readAll();
  const next = cur.filter((e) => !drop.has(e.id));
  if (next.length === cur.length) return;
  await writeAll(next);
}

/** 清空标记(用户在系统里删掉导入的流水后,需要重新扫描这些短信) */
export async function clearProcessedSmsIds(): Promise<void> {
  await writeAll([]);
}

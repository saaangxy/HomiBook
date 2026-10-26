import AsyncStorage from '@react-native-async-storage/async-storage';
import { SMS_IMPORT_SOURCE } from '@homibook/core';
import { confirmImport, type ImportConfirmPayload } from './import';
import { scanCandidates, smsPreview } from './sms-import';
import { loadProcessedSmsIds, markSmsProcessed } from './sms-processed';
import {
  hasSmsPermission,
  isNotificationAccessGranted,
  isTxnReaderSupported,
  removePendingNotifications,
} from './txn-reader';

// 自动记账(默认关闭):应用进入前台时静默扫描本机短信/通知,把「高置信度 + 已唯一匹配到已有账户」的交易直接入账。
//
// 刻意保守 —— 自动路径只做能原样撤回的事:
//   · 不新建账户、不写映射规则(未匹配/歧义账户一律留给手动扫描确认)
//   · 服务端弱校验命中「疑似重复」的不入账
//   · 只扫最近 AUTO_WINDOW_DAYS 天,不做全量回溯
//   · 流水打「自动」标签,可在流水列表按标签筛选后批量删除;本机历史只用于展示,不参与撤销
// 已知限制:Android 后台限制下无法做到「短信一到就入账」——应用被杀或长期未打开时会延迟(见方案文档风险表)。

/** 自动入账的置信度门槛(与 core sms-parse 注释里的「自动记账建议门槛」一致) */
export const AUTO_MIN_CONFIDENCE = 0.8;
/** 自动扫描窗口(天):短信只回溯最近 3 天,不做全量回溯 */
const AUTO_WINDOW_DAYS = 3;
/**
 * 通知队列的独立窗口(天)。
 *
 * 通知队列是「入账后即清理」的待办清单,不按短信的 3 天裁剪 ——
 * 否则后台被系统冻结期间积压的通知一旦超过 3 天,就会被窗口**永久跳过**
 * (既不处理也不标记),表现为「这几笔永远没记上」。
 */
const AUTO_NOTIFICATION_WINDOW_DAYS = 30;
/** 自动入账的流水打此标签,便于事后筛选与排查 */
export const AUTO_RECORD_TAG = '自动';
/** 两次自动扫描的最小间隔(前台频繁切换时不重复打服务器) */
export const AUTO_MIN_INTERVAL_MS = 10 * 1000;

const SETTINGS_KEY = 'homibook.smsAuto';
/** 最近自动入账记录:设置页「最近自动记账」查看用(不参与去重,也不用于撤销) */
const HISTORY_KEY = 'homibook.smsAutoHistory';
/** 本机保留的历史条数(超出丢最早的) */
const HISTORY_LIMIT = 50;

export interface AutoBookkeepingSettings {
  enabled: boolean;
  /** 入账完成后是否发系统通知提醒(默认开):关掉就只剩应用内 toast */
  notify: boolean;
}

/** 一条自动入账记录(设置页「最近自动记账」展示用) */
export interface AutoHistoryEntry {
  /** 批次时刻 */
  at: number;
  /** 创建出的流水 id */
  recordId: string;
  /** 交易时间(ISO) */
  date: string;
  /** 收支方向(EXPENSE / INCOME / UNKNOWN) */
  type: string;
  amount: number;
  accountName: string | null;
}

export type AutoRunReason = 'disabled' | 'unsupported' | 'no-permission' | 'nothing' | 'network';

export interface AutoRunResult {
  /** 已自动入账笔数 */
  imported: number;
  /** 仍需人工确认的笔数(低置信度 / 未匹配账户 / 疑似重复) */
  pending: number;
  /** 本批创建出的流水 id:完成通知点进去直接打开对应流水 */
  recordIds?: string[];
  /** 当前设置是否要发完成通知(调用方据此决定要不要发) */
  notify?: boolean;
  /** 本批入账流水(id / 方向 / 金额 / 账户):每笔发一条系统通知时用 */
  items?: { recordId: string; type: string; amount: number; accountName: string | null }[];
  /** 未入账原因(正常跑完且无候选时为 'nothing') */
  reason?: AutoRunReason;
}

// ── 设置 ──

export async function loadAutoSettings(): Promise<AutoBookkeepingSettings> {
  try {
    const raw = await AsyncStorage.getItem(SETTINGS_KEY);
    if (!raw) return { enabled: false, notify: true };
    const parsed = JSON.parse(raw) as Partial<AutoBookkeepingSettings>;
    // notify 缺省视为开:老版本存过 { enabled } 的用户升级后仍会有提醒
    return { enabled: !!parsed?.enabled, notify: parsed?.notify !== false };
  } catch {
    return { enabled: false, notify: true };
  }
}

export async function saveAutoSettings(settings: AutoBookkeepingSettings): Promise<void> {
  try {
    await AsyncStorage.setItem(
      SETTINGS_KEY,
      JSON.stringify({ enabled: !!settings.enabled, notify: settings.notify !== false }),
    );
  } catch {
    // 存储不可用:开关不生效,不影响手动路径
  }
}

// ── 最近自动入账记录 ──
// 只用来「看到自动记账都干了什么」:要删/改请去流水列表(和普通流水一样操作)。

/** 读最近自动入账记录(新的在前,最多 HISTORY_LIMIT 条) */
export async function loadAutoHistory(): Promise<AutoHistoryEntry[]> {
  try {
    const raw = await AsyncStorage.getItem(HISTORY_KEY);
    const list = raw ? (JSON.parse(raw) as AutoHistoryEntry[]) : [];
    return Array.isArray(list) ? list.filter((e) => !!e?.recordId) : [];
  } catch {
    return [];
  }
}

async function appendAutoHistory(entries: AutoHistoryEntry[]): Promise<void> {
  if (entries.length === 0) return;
  try {
    const current = await loadAutoHistory();
    await AsyncStorage.setItem(HISTORY_KEY, JSON.stringify([...entries, ...current].slice(0, HISTORY_LIMIT)));
  } catch {
    // 存不下就放弃历史,不影响已入账的流水
  }
}

/** 清空自动记账历史(与设置页「清空本机标记」一起用) */
export async function clearAutoHistory(): Promise<void> {
  try {
    await AsyncStorage.removeItem(HISTORY_KEY);
  } catch {
    // ignore
  }
}

// ── 执行 ──

// ── 临时调试日志(仅开发版输出) ──
// 排查「这条为什么没自动入账」:扫描到哪些候选、被哪道闸拦下、最终入账几笔。
// 只在开发版打印,确认行为无误后整块删除(连同 logAuto 调用点)。
function logAuto(...args: unknown[]): void {
  if (typeof __DEV__ !== 'undefined' && __DEV__) console.log('[自动记账]', ...args);
}

/**
 * 跑一次自动记账。调用方负责节流(见 hooks/useSmsAutoBookkeeping)。
 * 任何异常都向上抛,由调用方静默处理 —— 自动记账失败不该打扰用户。
 */
export async function runAutoBookkeeping(bookId: string): Promise<AutoRunResult> {
  const settings = await loadAutoSettings();
  const smsGranted = hasSmsPermission();
  const notifGranted = isNotificationAccessGranted();
  logAuto('开始', { bookId, enabled: settings.enabled, smsGranted, notifGranted });

  if (!settings.enabled) {
    logAuto('跳过:自动记账开关未开启');
    return { imported: 0, pending: 0, reason: 'disabled' };
  }
  if (!isTxnReaderSupported) {
    logAuto('跳过:当前平台不支持(TxnReader 不可用)');
    return { imported: 0, pending: 0, reason: 'unsupported' };
  }
  // 短信与通知是两个独立渠道:只开通知使用权(银行 App 通知)同样应能自动记账
  if (!smsGranted && !notifGranted) {
    logAuto('跳过:短信读取权限与通知使用权都未开启');
    return { imported: 0, pending: 0, reason: 'no-permission' };
  }

  const processedIds = await loadProcessedSmsIds();
  const scan = await scanCandidates({
    days: AUTO_WINDOW_DAYS,
    // 通知队列放宽:积压的待办不能因为「超过短信窗口」被永久跳过
    notificationDays: AUTO_NOTIFICATION_WINDOW_DAYS,
    accountBookId: bookId,
    processedIds,
  });

  // 只把高置信度的送去做账户匹配(低置信度留给人工,没必要为了它们跑预览)
  const eligible = scan.candidates.filter((c) => c.confidence >= AUTO_MIN_CONFIDENCE);
  if (eligible.length === 0) return { imported: 0, pending: scan.candidates.length, reason: 'nothing' };

  // rowIndex 由后端按「提交数组位置 + 1」生成:本地显式带上,才能把预览结果映射回候选
  const indexed = eligible.map((candidate, i) => ({ candidate, rowIndex: i + 1 }));
  const preview = await smsPreview(bookId, eligible);
  // 自动入账的三道闸:已匹配到**已有**账户 + 非疑似重复(+ 上面已过的置信度门槛)
  const rows = preview.records.filter((r) => !!r.accountId && !r.possibleDuplicate && r.rowIndex != null);
  // 一行说清三道闸:哪一步把候选挡下的,看这四个数就够了
  logAuto('闸门结果', {
    候选: scan.candidates.length,
    送匹配: eligible.length,
    通过: rows.length,
    无账户: preview.records.filter((r) => !r.accountId).length,
    疑似重复: preview.records.filter((r) => r.possibleDuplicate).length,
  });
  const pendingCount = scan.candidates.length - rows.length;
  if (rows.length === 0) return { imported: 0, pending: pendingCount, reason: 'nothing' };

  const pickedRows = new Set(rows.map((r) => r.rowIndex));
  const picked = indexed.filter((x) => pickedRows.has(x.rowIndex)).map((x) => x.candidate);

  const payload: ImportConfirmPayload = {
    accountBookId: bookId,
    source: SMS_IMPORT_SOURCE,
    // 自动路径只提交 records:不建账户、不落映射规则,保证可原样撤回
    records: rows.map((r) => ({
      date: r.date,
      type: r.type,
      amount: r.amount,
      accountId: r.accountId as string,
      toAccountId: r.toAccountId ?? undefined,
      categoryCode: r.mappedCategoryCode || r.categoryCode || null,
      payer: r.payer ?? undefined,
      remark: r.remark ?? undefined,
      tags: [...(r.tags ?? []), AUTO_RECORD_TAG],
    })),
  };

  const res = await confirmImport(payload);

  // 入账成功的来源才算「已处理」;pending 的保持可扫描,等用户手动确认。
  // 跨渠道折叠掉的副本也要一并标记并清出通知队列 —— 只标保留的那条,
  // 另一渠道(或队列里)的副本下一轮会以「疑似重复」再冒出来,越积越多。
  const sources = picked.flatMap((c) => [
    { id: c.sourceId, channel: c.channel },
    ...(c.mergedSources ?? []),
  ]);
  await markSmsProcessed(sources.map((s) => s.id));
  const notifKeys = sources.filter((s) => s.channel === 'notification').map((s) => s.id);
  if (notifKeys.length > 0) void removePendingNotifications(notifKeys);
  // 本机留一份「最近自动入账记录」(设置页展示用):rows 与创建出的 id 顺序一一对应
  const at = Date.now();
  const created: AutoHistoryEntry[] = rows
    .map((r, i) => ({
      at,
      recordId: res.ids?.[i] ?? '',
      date: r.date,
      type: r.type,
      amount: r.amount,
      accountName: r.accountName ?? null,
    }))
    .filter((e) => !!e.recordId);
  await appendAutoHistory(created);
  logAuto('入账完成', { imported: res.imported, pending: pendingCount });

  return {
    imported: res.imported,
    pending: pendingCount,
    recordIds: res.ids ?? [],
    notify: settings.notify,
    // 每笔一条系统通知用(id 用于点击直达该笔流水)
    items: created.map(({ recordId, type, amount, accountName }) => ({ recordId, type, amount, accountName })),
  };
}



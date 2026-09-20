import AsyncStorage from '@react-native-async-storage/async-storage';
import { SMS_IMPORT_SOURCE } from '@homibook/core';
import { confirmImport, type ImportConfirmPayload } from './import';
import { scanCandidates, smsPreview } from './sms-import';
import { loadProcessedSmsIds, markSmsProcessed } from './sms-processed';
import { hasSmsPermission, isTxnReaderSupported } from './txn-reader';

// 自动记账(默认关闭):应用进入前台时静默扫描本机短信/通知,把「高置信度 + 已唯一匹配到已有账户」的交易直接入账。
//
// 刻意保守 —— 自动路径只做能原样撤回的事:
//   · 不新建账户、不写映射规则(未匹配/歧义账户一律留给手动扫描确认)
//   · 服务端弱校验命中「疑似重复」的不入账
//   · 只扫最近 AUTO_WINDOW_DAYS 天,不做全量回溯
//   · 每次入账记下创建出的流水 id 与本批来源 id,设置页可一键撤销(删除流水 + 解除「已处理」标记)
// 已知限制:Android 后台限制下无法做到「短信一到就入账」——应用被杀或长期未打开时会延迟(见方案文档风险表)。

/** 自动入账的置信度门槛(与 core sms-parse 注释里的「自动记账建议门槛」一致) */
export const AUTO_MIN_CONFIDENCE = 0.8;
/** 自动扫描窗口(天) */
const AUTO_WINDOW_DAYS = 3;
/** 自动入账的流水打此标签,便于事后筛选与排查 */
export const AUTO_RECORD_TAG = '自动';
/** 两次自动扫描的最小间隔(前台频繁切换时不重复打服务器) */
export const AUTO_MIN_INTERVAL_MS = 5 * 60 * 1000;

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
  if (!settings.enabled) return { imported: 0, pending: 0, reason: 'disabled' };
  if (!isTxnReaderSupported) return { imported: 0, pending: 0, reason: 'unsupported' };
  if (!hasSmsPermission()) return { imported: 0, pending: 0, reason: 'no-permission' };

  const processedIds = await loadProcessedSmsIds();
  const scan = await scanCandidates({ days: AUTO_WINDOW_DAYS, accountBookId: bookId, processedIds });

  // 只把高置信度的送去做账户匹配(低置信度留给人工,没必要为了它们跑预览)
  const eligible = scan.candidates.filter((c) => c.confidence >= AUTO_MIN_CONFIDENCE);
  logAuto('扫描完成 · 第一道闸(本地)', {
    candidates: scan.candidates.length,
    channels: scan.channels,
    eligible: eligible.length,
    lowConfidence: scan.candidates.filter((c) => c.confidence < AUTO_MIN_CONFIDENCE).length,
  });
  if (eligible.length === 0) return { imported: 0, pending: scan.candidates.length, reason: 'nothing' };

  // rowIndex 由后端按「提交数组位置 + 1」生成:本地显式带上,才能把预览结果映射回候选
  const indexed = eligible.map((candidate, i) => ({ candidate, rowIndex: i + 1 }));
  const preview = await smsPreview(bookId, eligible);
  // 自动入账的三道闸:已匹配到**已有**账户 + 非疑似重复(+ 上面已过的置信度门槛)
  const rows = preview.records.filter((r) => !!r.accountId && !r.possibleDuplicate && r.rowIndex != null);
  logAuto('第二道闸(服务端匹配)', {
    submitted: eligible.length,
    passed: rows.length,
    noAccount: preview.records.filter((r) => !r.accountId).length,
    duplicate: preview.records.filter((r) => r.possibleDuplicate).length,
    // 逐条原因(截断到 12 条,避免一次刷几十行):
    // pass 通过 / no-account 没匹配到已有账户 / duplicate 疑似重复 / no-row 服务端没返回该行
    detail: eligible.slice(0, 12).map((c, i) => {
      const row = preview.records.find((r) => r.rowIndex === i + 1);
      return {
        amount: c.amount,
        type: c.type,
        account: c.accountName,
        conf: c.confidence,
        gate: !row ? 'no-row' : !row.accountId ? 'no-account' : row.possibleDuplicate ? 'duplicate' : 'pass',
      };
    }),
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

  // 入账成功的来源才算「已处理」;pending 的保持可扫描,等用户手动确认
  const sourceIds = picked.map((c) => c.sourceId);
  await markSmsProcessed(sourceIds);
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
  logAuto('入账完成', {
    imported: res.imported,
    pending: pendingCount,
    recordIds: res.ids?.length ?? 0,
  });

  return {
    imported: res.imported,
    pending: pendingCount,
    recordIds: res.ids ?? [],
    notify: settings.notify,
    // 每笔一条系统通知用(id 用于点击直达该笔流水)
    items: created.map(({ recordId, type, amount, accountName }) => ({ recordId, type, amount, accountName })),
  };
}



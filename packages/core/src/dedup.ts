/**
 * 流水去重 —— 纯 TS,三端共享(backend detect-duplicates / web DedupDialog / mobile DedupSheet)。
 * 分组 key 的字段顺序(日期 → 类型 → 账户 → 交易方 → 金额 → 归属人)与解析必须一致。
 */
import type { RecordType } from './types/index.js';

export type DedupDatePrecision = 'exact' | 'date' | null;

export interface DedupMatchFields {
  /** 日期匹配精度:exact=精确到秒,date=同日,null=忽略 */
  date: DedupDatePrecision;
  type: boolean;
  accountId: boolean;
  payer: boolean;
  amount: boolean;
  ownerId: boolean;
}

export const DEFAULT_DEDUP_MATCH_FIELDS: DedupMatchFields = {
  date: 'date',
  type: true,
  accountId: true,
  payer: true,
  amount: true,
  ownerId: false,
};

/** 可切换的匹配字段(日期单独用精度选择器,不在此列) */
export const DEDUP_TOGGLE_FIELDS: { key: Exclude<keyof DedupMatchFields, 'date'>; label: string }[] = [
  { key: 'type', label: '类型' },
  { key: 'accountId', label: '账户' },
  { key: 'payer', label: '交易方' },
  { key: 'amount', label: '金额' },
  { key: 'ownerId', label: '归属人' },
];

/** 去重界面标签(与 record-import 的 RECORD_TYPE_LABELS 同源) */
export const DEDUP_TYPE_LABELS: Record<RecordType, string> = {
  INCOME: '收入',
  EXPENSE: '支出',
  TRANSFER: '转账',
};

/** 交易方为空时在 key 中使用的占位值 */
export const DEDUP_EMPTY_PAYER = '__empty__';

export interface DedupKeyRecord {
  date: Date | string;
  type: string;
  accountId: string;
  payer?: string | null;
  amount: number;
  ownerId: string;
}

/** 按 matchFields 顺序构造分组 key(与解析严格对应) */
export function buildDuplicateKey(r: DedupKeyRecord, f: DedupMatchFields): string {
  const parts: string[] = [];

  if (f.date === 'exact') {
    parts.push(r.date instanceof Date ? r.date.toISOString() : new Date(r.date).toISOString());
  } else if (f.date === 'date') {
    parts.push((r.date instanceof Date ? r.date.toISOString() : new Date(r.date).toISOString()).slice(0, 10));
  }

  if (f.type) parts.push(r.type);
  if (f.accountId) parts.push(r.accountId);
  if (f.payer) parts.push(r.payer || DEDUP_EMPTY_PAYER);
  if (f.amount) parts.push(r.amount.toFixed(2));
  if (f.ownerId) parts.push(r.ownerId);

  return parts.join('||');
}

export interface DedupKeyParseOptions {
  /** 账户 id → 显示文本(如 "微信 · 张三") */
  accountDisplay?: Map<string, string>;
  /** 归属人 id → 显示名称 */
  ownerNames?: Map<string, string>;
  /** 精确日期的展示格式化(缺省 ISO → "YYYY-MM-DD HH:mm:ss") */
  formatDateTime?: (iso: string) => string;
}

/** 解析分组 key 为可读标签数组(['日期: …', '类型: …', …]),账户/归属人段优先显示名称而非 id */
export function parseDuplicateGroupKey(key: string, fields: DedupMatchFields, opts?: DedupKeyParseOptions): string[] {
  const parts = key.split('||');
  const labels: string[] = [];
  let idx = 0;
  const fmt = opts?.formatDateTime ?? ((iso: string) => iso.replace('T', ' ').slice(0, 19));

  if (fields.date) {
    const val = parts[idx++];
    labels.push(`日期: ${fields.date === 'date' ? val : fmt(val)}`);
  }
  if (fields.type) labels.push(`类型: ${DEDUP_TYPE_LABELS[parts[idx++] as RecordType] ?? parts[idx - 1]}`);
  if (fields.accountId) labels.push(`账户: ${opts?.accountDisplay?.get(parts[idx++]) ?? parts[idx - 1]}`);
  if (fields.payer) labels.push(`交易方: ${parts[idx++] === DEDUP_EMPTY_PAYER ? '(空)' : parts[idx - 1]}`);
  if (fields.amount) labels.push(`金额: ${parts[idx++]}`);
  if (fields.ownerId) labels.push(`归属人: ${opts?.ownerNames?.get(parts[idx++]) ?? parts[idx - 1]}`);

  return labels;
}

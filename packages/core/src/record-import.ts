/**
 * 流水导入 —— 纯 TS,web/mobile 共享的向导逻辑。
 * 来源定义 / 列映射字段与自动检测 / 账户池内匹配 / 待创建账户合并。
 * 与 backend services/import/shared.ts 的 matchAccountByName 语义保持一致。
 */
import type { RecordType } from './types';

// ── 来源定义 ──

export type ImportSource = 'alipay' | 'wechat' | 'jd' | 'csv';

/** 收支类型标签(导入/导出界面共用) */
export const IMPORT_TYPE_LABELS: Record<RecordType, string> = {
  INCOME: '收入',
  EXPENSE: '支出',
  TRANSFER: '转账',
};

export interface ImportSourceDef {
  key: ImportSource;
  label: string;
  description: string;
  /** 接受的文件扩展名(含点,DocumentPicker/accept 用) */
  accept: string[];
}

export const IMPORT_SOURCE_DEFS: ImportSourceDef[] = [
  { key: 'alipay', label: '支付宝', description: '支持支付宝交易明细导出CSV', accept: ['csv'] },
  { key: 'wechat', label: '微信', description: '支持微信支付账单导出Excel', accept: ['xlsx'] },
  { key: 'jd', label: '京东', description: '支持京东交易流水导出CSV', accept: ['csv'] },
  { key: 'csv', label: '其他CSV', description: '任意CSV文件,需手动配置列映射', accept: ['csv'] },
];

// ── 列映射字段定义 ──

export type ImportColumnField = 'date' | 'amount' | 'type' | 'account' | 'toAccount' | 'payer' | 'category' | 'remark';

export interface ImportColumnFieldDef {
  key: ImportColumnField;
  label: string;
  required: boolean;
}

/** 系统字段映射定义(顺序即展示顺序,date/amount/type 必填;名称与系统 Record 字段/导出 CSV 列一致) */
export const IMPORT_COLUMN_FIELDS: ImportColumnFieldDef[] = [
  { key: 'date', label: '日期', required: true },
  { key: 'amount', label: '金额', required: true },
  { key: 'type', label: '类型', required: true },
  { key: 'account', label: '账户', required: false },
  { key: 'toAccount', label: '转账目标', required: false },
  { key: 'payer', label: '交易方', required: false },
  { key: 'category', label: '分类', required: false },
  { key: 'remark', label: '备注', required: false },
];

/** 校验列映射是否满足必填项 */
export function isColumnMappingValid(mapping: Partial<Record<ImportColumnField, string>>): boolean {
  return IMPORT_COLUMN_FIELDS.filter((f) => f.required).every((f) => !!mapping[f.key]);
}

// ── 自动检测 ──

/** 按表头正则规则自动检测列映射 */
export function autoDetectColumns(headers: string[]): Partial<Record<ImportColumnField, string>> {
  const mapping: Partial<Record<ImportColumnField, string>> = {};
  const rules: Record<ImportColumnField, RegExp[]> = {
    date: [/日期/, /时间/, /date/i, /time/i],
    amount: [/金额/, /amount/i],
    type: [/收.?支/, /方向/, /类型/, /type/i, /出入/],
    account: [/支付方式/, /账户/, /付款方式/, /收款方式/, /account/i],
    toAccount: [/转账目标/, /目标账户/, /对方账户/, /收款账户/, /toAccount/i, /to_account/i],
    payer: [/对方/, /交易方/, /商户/, /商家/, /payer/i, /merchant/i],
    category: [/分类/, /category/i],
    remark: [/备注/, /remark/i, /note/i, /附言/],
  };
  for (const [field, patterns] of Object.entries(rules) as [ImportColumnField, RegExp[]][]) {
    for (const header of headers) {
      for (const pattern of patterns) {
        if (pattern.test(header)) {
          mapping[field] = header;
          break;
        }
      }
      if (mapping[field]) break;
    }
  }
  return mapping;
}

/** 提取类型列的唯一值 */
export function detectTypeValues(columnName: string, sampleRows: Record<string, string>[]): string[] {
  const values = new Set<string>();
  for (const row of sampleRows) {
    const v = (row[columnName] || '').trim();
    if (v) values.add(v);
  }
  return Array.from(values);
}

/** 自动推断收支类型值映射(与后端正则逻辑一致) */
export function autoDetectTypeMapping(values: string[]): Partial<Record<string, RecordType>> {
  const mapping: Partial<Record<string, RecordType>> = {};
  for (const v of values) {
    if (/^收入|^入账|^收款|income/i.test(v)) mapping[v] = 'INCOME';
    else if (/^不计收支|^不计|^转账|^transfer/i.test(v)) mapping[v] = 'TRANSFER';
    else if (/^支出|^出账|^付款|^expense/i.test(v)) mapping[v] = 'EXPENSE';
  }
  return mapping;
}

// ── 账户池内匹配(与 backend matchAccountByName 一致) ──

export interface PoolAccount {
  id: string;
  name: string;
  ownerId?: string;
}

/**
 * 按名称在账户池中匹配(优先级:精确 → 账户名包含目标名 → 目标名包含账户名)。
 * 传入 ownerId 时只在该归属人的账户中匹配(多成员账本下避免误匹配他人同名账户)。
 */
export function matchAccountInPool(name: string, pool: PoolAccount[], ownerId?: string): PoolAccount | null {
  const candidates = ownerId ? pool.filter((a) => a.ownerId === ownerId) : pool;
  if (!name || candidates.length === 0) return null;
  const exact = candidates.filter((a) => a.name === name);
  if (exact.length >= 1) return exact[0];
  const contains = candidates.filter((a) => a.name.includes(name));
  if (contains.length >= 1) return contains[0];
  const containedBy = candidates.filter((a) => name.includes(a.name));
  if (containedBy.length >= 1) return containedBy[0];
  return null;
}

// ── 待创建账户合并 ──

export interface RawAccountCreation {
  csvName: string;
  name: string;
  type: string;
  bankName?: string | null;
  accountNo?: string | null;
}

export interface MergedAccountCreation {
  csvName: string;
  name: string;
  type: string;
  bankName?: string | null;
  accountNo?: string | null;
}

/** 按 name 合并待创建账户(多个源账户名变体映射到同一目标账户) */
export function mergeAccountCreations(raw: RawAccountCreation[]): MergedAccountCreation[] {
  const merged = new Map<string, RawAccountCreation & { csvNames: string[] }>();
  for (const c of raw) {
    const existing = merged.get(c.name);
    if (existing) {
      existing.csvNames.push(c.csvName);
    } else {
      merged.set(c.name, { ...c, csvNames: [c.csvName] });
    }
  }
  return Array.from(merged.values()).map((c) => ({
    csvName: c.csvNames.join(', '),
    name: c.name,
    type: c.type,
    bankName: c.bankName,
    accountNo: c.accountNo,
  }));
}

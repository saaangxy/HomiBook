/**
 * 流水导入 —— 纯 TS,web/mobile 共享的向导逻辑。
 * 来源定义 / 列映射字段与自动检测 / 账户池内匹配 / 待创建账户合并。
 * 与 backend services/import/shared.ts 的 matchAccountByName 语义保持一致。
 */
import type { RecordType } from './types/index.js';

// ── 来源定义 ──

export type ImportSource = 'alipay' | 'wechat' | 'jd' | 'csv';

/** 收支类型标签(导入/导出界面共用;全站统一的权威标签,web/mobile 各处勿再本地定义) */
export const RECORD_TYPE_LABELS: Record<RecordType, string> = {
  INCOME: '收入',
  EXPENSE: '支出',
  TRANSFER: '转账',
};

/** 去重界面标签(与 RECORD_TYPE_LABELS 同源) */
export const IMPORT_TYPE_LABELS: Record<RecordType, string> = RECORD_TYPE_LABELS;

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

/** 来源 key → 展示标签(账单来源在消息/卡片中共用;键放宽为 string 便于动态来源名兜底) */
export const IMPORT_SOURCE_LABELS: Record<string, string> = Object.fromEntries(
  IMPORT_SOURCE_DEFS.map((d) => [d.key, d.label]),
);

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

// ── 账户池内匹配(对齐 backend matchAccountByName 多用户修复版语义) ──

export interface PoolAccount {
  id: string;
  name: string;
  ownerId?: string;
}

export type AccountPoolMatchResult =
  | { matched: true; id: string; name: string }
  | { matched: false; ambiguous: true; candidates: PoolAccount[] }
  | { matched: false; ambiguous: false };

/**
 * 按名称在账户池中匹配(完整协议;优先级:精确 → 账户名包含目标名 → 目标名包含账户名)。
 * 命中多个时返回 ambiguous + candidates 交由上层决议。
 * 传入 ownerId 时只在本人账户(及未设归属人的账户)中匹配(多成员账本下避免误匹配他人同名账户)。
 */
export function matchAccountInPoolDetailed(name: string, pool: PoolAccount[], ownerId?: string): AccountPoolMatchResult {
  const candidates = ownerId ? pool.filter((a) => !a.ownerId || a.ownerId === ownerId) : pool;
  if (!name || candidates.length === 0) return { matched: false, ambiguous: false };

  const exact = candidates.filter((a) => a.name === name);
  if (exact.length === 1) return { matched: true, id: exact[0].id, name: exact[0].name };
  if (exact.length > 1) return { matched: false, ambiguous: true, candidates: exact };

  const contains = candidates.filter((a) => a.name.includes(name));
  if (contains.length === 1) return { matched: true, id: contains[0].id, name: contains[0].name };
  if (contains.length > 1) return { matched: false, ambiguous: true, candidates: contains };

  const containedBy = candidates.filter((a) => name.includes(a.name));
  if (containedBy.length === 1) return { matched: true, id: containedBy[0].id, name: containedBy[0].name };
  if (containedBy.length > 1) return { matched: false, ambiguous: true, candidates: containedBy };

  return { matched: false, ambiguous: false };
}

/** 简化版:直接取首个命中(不做歧义决议),供导入向导直接取 id */
export function matchAccountInPool(name: string, pool: PoolAccount[], ownerId?: string): PoolAccount | null {
  const r = matchAccountInPoolDetailed(name, pool, ownerId);
  return r.matched ? pool.find((a) => a.id === r.id) ?? null : null;
}

// ── 账户决议(手动导入向导 / AI 导入卡共用) ──

/** 账户解析:映射已有账户 或 新建(名称+类型) */
export type AccountResolution =
  | { action: 'existing'; accountId: string }
  | { action: 'create'; name: string; type: string };

/** AI 预填的账户决议(preview 结果的 aiResolution / AI 参数中的 accountResolutions) */
export interface AIAccountResolution {
  action: string;
  sourceAccountName?: string;
  targetAccountId?: string;
  targetAccountName?: string;
  accountType?: string;
}

export interface UnmatchedAccountInput {
  csvName: string;
  suggestedName: string;
  suggestedType: string;
  candidates?: { id: string }[];
  aiResolution?: AIAccountResolution;
}

/** 收支类型 → 分类字典组 code */
export const TYPE_TO_GROUP: Record<string, string> = {
  EXPENSE: 'transaction_category_expense',
  INCOME: 'transaction_category_income',
  TRANSFER: 'transaction_category_transfer',
};

/**
 * 账户决议默认值初始化(四处导入 UI 共用策略):
 * AI 决议(既有→映射 / 新建→名称+类型) → 候选首位 → 新建建议;aiArgsResolutions 最后覆盖。
 */
export function initAccountResolutions(
  unmatchedAccounts: UnmatchedAccountInput[],
  aiArgsResolutions?: AIAccountResolution[],
): Record<string, AccountResolution> {
  const res: Record<string, AccountResolution> = {};
  for (const ua of unmatchedAccounts) {
    const ar = ua.aiResolution;
    if (ar?.action === 'existing' && ar.targetAccountId) {
      res[ua.csvName] = { action: 'existing', accountId: ar.targetAccountId };
    } else if (ar?.action === 'create' && ar.targetAccountName && ar.accountType) {
      res[ua.csvName] = { action: 'create', name: ar.targetAccountName, type: ar.accountType };
    } else if (ua.candidates?.length) {
      res[ua.csvName] = { action: 'existing', accountId: ua.candidates[0].id };
    } else {
      res[ua.csvName] = { action: 'create', name: ua.suggestedName, type: ua.suggestedType || 'OTHER' };
    }
  }
  // AI 参数中的账户映射回显(覆盖默认值)
  for (const ar of aiArgsResolutions ?? []) {
    if (ar.action === 'existing' && ar.targetAccountId) {
      res[ar.sourceAccountName ?? ''] = { action: 'existing', accountId: ar.targetAccountId };
    } else if (ar.action === 'create' && ar.targetAccountName && ar.accountType) {
      res[ar.sourceAccountName ?? ''] = { action: 'create', name: ar.targetAccountName, type: ar.accountType };
    }
  }
  return res;
}

/** 未匹配账户中仍缺决议的数量(existing 缺 accountId / create 缺 name) */
export function unresolvedAccountCount(
  unmatchedAccounts: { csvName: string }[],
  resolutions: Record<string, AccountResolution>,
): number {
  return unmatchedAccounts.filter((ua) => {
    const res = resolutions[ua.csvName];
    return res && (res.action === 'existing' ? !res.accountId : !res.name);
  }).length;
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

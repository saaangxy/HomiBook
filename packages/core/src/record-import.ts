/**
 * 流水导入 —— 纯 TS,web/mobile 共享的向导逻辑。
 * 来源定义 / 列映射字段与自动检测 / 账户池内匹配 / 待创建账户合并。
 * 与 backend services/import/shared.ts 的 matchAccountByName 语义保持一致。
 */
import type { RecordType } from './types/index.js';

// ── 来源定义 ──

export type ImportSource = 'alipay' | 'wechat' | 'jd' | 'csv' | 'sms';

/**
 * 短信导入来源:不经过文件上传与 parsers.ts,由移动端把本机预筛出的候选直接提交给「解析后」管线。
 * 刻意不放进 IMPORT_SOURCE_DEFS(文件导入来源选择器),仅用于映射表 source 与展示标签。
 */
export const SMS_IMPORT_SOURCE = 'sms' as const;

/** 全部导入来源(运行时校验用,与 ImportSource 联合保持一致;含非文件的短信来源) */
export const IMPORT_SOURCES = ['alipay', 'wechat', 'jd', 'csv', SMS_IMPORT_SOURCE] as const;

/**
 * AI 导入工具可识别的来源(不含 csv:csv 需手动配置列映射,走向导而非对话)。
 * backend 的 preview_import/confirm_import 工具与 mobile 的 AI 导入选择器共用此集合。
 */
export const IMPORT_AI_SOURCES = ['alipay', 'wechat', 'jd'] as const;

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
export const IMPORT_SOURCE_LABELS: Record<string, string> = {
  ...Object.fromEntries(IMPORT_SOURCE_DEFS.map((d) => [d.key, d.label])),
  // 短信来源无文件上传步骤,不在 DEFS 中,但消息/卡片展示需要标签
  [SMS_IMPORT_SOURCE]: '短信',
};

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

/**
 * 促销/权益尾巴词表:手机银行导出常在同一张卡上拼出「XX储蓄卡(1234)&立减金」这类变体,
 * 这些变体是同一个账户,归一后应同名(⇒ 导入时合并为一次创建)。
 */
const PROMO_WORD_RE = /(券|红包|立减|满减|折扣|焕新|支付享|优惠|权益|积分|返现|奖励|补贴|福利|抵扣)/;

/**
 * 归一账户名(匹配比较与「建议新建名」共用):
 * ① 砍掉 `&` 拼接的促销/权益尾巴(仅当该段含促销词,避免误伤正常含 `&` 的账户名)
 * ② 去掉银行名里冗余的「中国」前缀(「中国银行」本身除外)
 * ③ 压缩空白
 */
export function normalizeAccountName(raw: string): string {
  if (!raw) return '';
  const trimmed = raw.trim().replace(/\s+/g, ' ');
  let name = trimmed;

  const parts = trimmed.split(/[&＆]/);
  if (parts.length > 1) {
    const kept: string[] = [parts[0]];
    for (let i = 1; i < parts.length; i++) {
      if (PROMO_WORD_RE.test(parts[i])) break;
      kept.push(parts[i]);
    }
    name = kept.join('&');
  }

  // 非贪婪:「中国建设银行储蓄卡(7483)」→「建设银行储蓄卡(7483)」,而「中国银行…」不含冗余前缀(整体不匹配)
  name = name.replace(/^中国(.+?银行)/, '$1');
  return name.trim();
}

/**
 * 按源账户名挑候选账户映射规则:
 * ① 原始名精确优先;② 否则退回归一后相等的规则。
 *
 * 有了 ②,手机银行换个促销尾巴(「XX储蓄卡(1234)&立减金」)或银行名多写「中国」时,
 * 仍能复用同一张卡的历史规则 —— 归一保留卡号,不会把不同卡混起来。
 * 精确分组里若存在规则但不满足条件,不会退回归一组(避免更宽的规则覆盖用户的条件规则)。
 */
export function pickAccountMappingCandidates<M extends { sourceAccountName: string }>(
  accountName: string,
  byName: Map<string, M[]>,
  byNormalizedName: Map<string, M[]>,
): M[] | undefined {
  const exact = byName.get(accountName);
  if (exact?.length) return exact;

  const normalized = normalizeAccountName(accountName);
  return normalized ? byNormalizedName.get(normalized) : undefined;
}

export interface PoolAccount {
  id: string;
  name: string;
  ownerId?: string;
  /**
   * 归属人展示名。多成员账本下不同成员可以有同名账户(如各人的「微信」),
   * 歧义候选必须带上它,上层(前端选择器 / AI 建议选项)才区分得开。
   * 由调用方从 DB 补(见 backend/src/services/import/shared.ts 的账户池构建)。
   */
  ownerName?: string;
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

  // ① 原样四级匹配
  const direct = matchRounds(name, candidates, (a) => a.name);
  if (direct) return direct;

  // ② 归一名兜底:「中国建设银行储蓄卡(7483)」↔「建设银行储蓄卡(7483)」、带促销尾巴的变体
  const normalized = normalizeAccountName(name);
  if (normalized && normalized !== name) {
    const byNormalized = matchRounds(normalized, candidates, (a) => normalizeAccountName(a.name));
    if (byNormalized) return byNormalized;
  }

  return { matched: false, ambiguous: false };
}

/** 四级名称匹配(精确 → 账户名含目标名 → 目标名含账户名);nameOf 决定参与比较的名字 */
function matchRounds(
  target: string,
  candidates: PoolAccount[],
  nameOf: (a: PoolAccount) => string,
): AccountPoolMatchResult | null {
  const exact = candidates.filter((a) => nameOf(a) === target);
  if (exact.length === 1) return { matched: true, id: exact[0].id, name: exact[0].name };
  if (exact.length > 1) return { matched: false, ambiguous: true, candidates: exact };

  const contains = candidates.filter((a) => nameOf(a).includes(target));
  if (contains.length === 1) return { matched: true, id: contains[0].id, name: contains[0].name };
  if (contains.length > 1) return { matched: false, ambiguous: true, candidates: contains };

  const containedBy = candidates.filter((a) => target.includes(nameOf(a)));
  if (containedBy.length === 1) return { matched: true, id: containedBy[0].id, name: containedBy[0].name };
  if (containedBy.length > 1) return { matched: false, ambiguous: true, candidates: containedBy };

  return null;
}

/** 简化版:直接取首个命中(不做歧义决议),供导入向导直接取 id */
export function matchAccountInPool(name: string, pool: PoolAccount[], ownerId?: string): PoolAccount | null {
  const r = matchAccountInPoolDetailed(name, pool, ownerId);
  return r.matched ? pool.find((a) => a.id === r.id) ?? null : null;
}

// ── 账户决议(手动导入向导 / AI 导入卡共用) ──

/** 账户决议来源:ai=AI 给出;suggested-candidate=系统建议(候选首位/建议新建) */
export type AccountResolutionSource = 'ai' | 'suggested-candidate';

/** 账户解析:映射已有账户 或 新建(名称+类型)。isDefault 标记"仍是默认建议,用户未确认" */
export type AccountResolution =
  | { action: 'existing'; accountId: string; isDefault?: boolean; source?: AccountResolutionSource }
  | { action: 'create'; name: string; type: string; isDefault?: boolean; source?: AccountResolutionSource };

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
 * 账户决议初始化(四处导入 UI 共用策略):
 * AI 决议(既有→映射 / 新建→名称+类型) → 候选首位(标记 isDefault) → 无候选则**不写决议**。
 * 无候选不再自动新建:UI 显示「待选择」并阻止进入下一步,用户点「全部采纳建议」
 * (adoptSuggestedAccountResolutions)后才等价于旧的自动新建行为。
 */
export function initAccountResolutions(
  unmatchedAccounts: UnmatchedAccountInput[],
  aiArgsResolutions?: AIAccountResolution[],
): Record<string, AccountResolution> {
  const res: Record<string, AccountResolution> = {};
  for (const ua of unmatchedAccounts) {
    const ar = ua.aiResolution;
    if (ar?.action === 'existing' && ar.targetAccountId) {
      res[ua.csvName] = { action: 'existing', accountId: ar.targetAccountId, source: 'ai' };
    } else if (ar?.action === 'create' && ar.targetAccountName && ar.accountType) {
      res[ua.csvName] = { action: 'create', name: ar.targetAccountName, type: ar.accountType, source: 'ai' };
    } else if (ua.candidates?.length) {
      // 候选首位只是建议:标记 isDefault,用户不显式采纳就不放行(见 canProceedImport)
      res[ua.csvName] = { action: 'existing', accountId: ua.candidates[0].id, isDefault: true, source: 'suggested-candidate' };
    }
  }
  // AI 参数中的账户映射回显(覆盖默认值)
  for (const ar of aiArgsResolutions ?? []) {
    if (ar.action === 'existing' && ar.targetAccountId) {
      res[ar.sourceAccountName ?? ''] = { action: 'existing', accountId: ar.targetAccountId, source: 'ai' };
    } else if (ar.action === 'create' && ar.targetAccountName && ar.accountType) {
      res[ar.sourceAccountName ?? ''] = { action: 'create', name: ar.targetAccountName, type: ar.accountType, source: 'ai' };
    }
  }
  return res;
}

/**
 * 一键采纳建议:把默认值(候选首位)与缺失决议一次性落为明确决议(去掉 isDefault)。
 * 用户已明确选择的项保持不变。
 */
export function adoptSuggestedAccountResolutions(
  unmatchedAccounts: UnmatchedAccountInput[],
  current: Record<string, AccountResolution>,
): Record<string, AccountResolution> {
  const next = { ...current };
  for (const ua of unmatchedAccounts) {
    const cur = next[ua.csvName];
    if (cur && !cur.isDefault) continue;
    next[ua.csvName] = ua.candidates?.length
      ? { action: 'existing', accountId: ua.candidates[0].id, source: 'suggested-candidate' }
      : { action: 'create', name: ua.suggestedName, type: ua.suggestedType || 'OTHER', source: 'suggested-candidate' };
  }
  return next;
}

/** 账户决议是否完整(existing 需 accountId;create 需 name 且 type —— 与后端建账户的口径一致) */
export function isAccountResolutionComplete(res: AccountResolution | undefined): boolean {
  if (!res) return false;
  return res.action === 'existing' ? !!res.accountId : !!res.name && !!res.type;
}

/** 未识别记录的处置是否完整(需类型 + 账户;类型为转账时还需转入账户) */
export function isUnrecognizedResolutionComplete(
  res: { type?: string; accountId?: string; toAccountId?: string } | undefined,
): boolean {
  if (!res?.type || !res.accountId) return false;
  return res.type === 'TRANSFER' ? !!res.toAccountId : true;
}

/**
 * 未匹配账户中仍缺决议的数量。
 * 口径:「缺键」(没有任何决议记录)同样算未解析 —— 旧实现只统计"有决议但内容不全"的项,
 * 会让默认值/漏填的账户在计数里消失。
 */
export function unresolvedAccountCount(
  unmatchedAccounts: { csvName: string }[],
  resolutions: Record<string, AccountResolution>,
): number {
  return unmatchedAccounts.filter(
    (ua) => !Object.hasOwn(resolutions, ua.csvName) || !isAccountResolutionComplete(resolutions[ua.csvName]),
  ).length;
}

// ── 导入进度计数(web/mobile 手动向导 + AI 预览卡共用口径) ──

/** 导入进度(三项明细 + 三个界面直接展示的聚合值) */
export interface ImportProgressCounts {
  accountsTotal: number;
  /** 有明确决议的账户数(不含仍停留在默认建议上的) */
  accountsResolved: number;
  /** 仍是默认建议(候选首位)、需用户显式采纳的账户数 */
  accountsDefault: number;
  categoriesTotal: number;
  categoriesResolved: number;
  unrecognizedTotal: number;
  unrecognizedResolved: number;
  /** 待处理(未决)项数 = 未解析账户 + 未映射分类 + 未处置未识别 */
  pending: number;
  /** 已映射项数 = 已解析账户 + 已映射分类 */
  mapped: number;
  /** 未识别且未处置 → 导入时会被跳过的行数 */
  willSkip: number;
  /** 必然失败/写脏数据的项数(当前 = 账户未解析;D 项落地后改由服务端 blocking 下发) */
  blocking: number;
}

export interface ImportProgressInput {
  /** 未匹配账户(预览响应 unmatchedAccounts) */
  unmatchedAccounts: { csvName: string }[];
  /** 账户决议(按 csvName 索引;缺键即未解析) */
  accountResolutions?: Record<string, AccountResolution>;
  /** 未映射分类的决议条目(同一 sourceCategory 按收支类型拆成的多条需全部选好才算已映射) */
  categoryResolutions?: { sourceCategory: string; targetCode?: string | null }[];
  /** 未识别记录(预览响应 unrecognizedRecords;rowIndex 缺失时视为无决议) */
  unrecognizedRecords: { rowIndex?: number }[];
  /** 未识别记录的处置(按 rowIndex 索引) */
  unrecognizedResolutions?: Record<number, { type?: string; accountId?: string; toAccountId?: string }>;
}

/**
 * 汇总导入进度。三处 UI(web ImportDialog、mobile ImportSheet、双端 AI 预览卡)统一调用,
 * 避免各端各写一套"待处理/已映射/将跳过"口径。
 */
export function computeImportProgress(input: ImportProgressInput): ImportProgressCounts {
  const {
    unmatchedAccounts,
    accountResolutions = {},
    categoryResolutions = [],
    unrecognizedRecords,
    unrecognizedResolutions = {},
  } = input;

  const accountsTotal = unmatchedAccounts.length;
  const accountsDefault = unmatchedAccounts.filter((ua) => !!accountResolutions[ua.csvName]?.isDefault).length;
  const accountsResolved = accountsTotal - unresolvedAccountCount(unmatchedAccounts, accountResolutions) - accountsDefault;

  // 同一 sourceCategory 可能按收支类型拆成多条决议,全部选好才算已映射
  const categoryState = new Map<string, boolean>();
  for (const cr of categoryResolutions) {
    const ok = !!cr.targetCode;
    categoryState.set(cr.sourceCategory, (categoryState.get(cr.sourceCategory) ?? true) && ok);
  }
  const categoriesTotal = categoryState.size;
  const categoriesResolved = Array.from(categoryState.values()).filter(Boolean).length;

  const unrecognizedTotal = unrecognizedRecords.length;
  const unrecognizedResolved = unrecognizedRecords.filter((r) =>
    isUnrecognizedResolutionComplete(unrecognizedResolutions[r.rowIndex ?? -1]),
  ).length;

  const accountsUnresolved = accountsTotal - accountsResolved - accountsDefault;
  const categoriesUnresolved = categoriesTotal - categoriesResolved;
  const willSkip = unrecognizedTotal - unrecognizedResolved;
  return {
    accountsTotal,
    accountsResolved,
    accountsDefault,
    categoriesTotal,
    categoriesResolved,
    unrecognizedTotal,
    unrecognizedResolved,
    pending: accountsUnresolved + categoriesUnresolved + willSkip,
    mapped: accountsResolved + categoriesResolved,
    willSkip,
    blocking: accountsUnresolved,
  };
}

/**
 * 第一步/第二步放行判定(四处导入 UI 共用):
 * 账户(含还停留在默认建议上的)与分类必须都有明确决议;未识别行要么没有,要么用户显式同意跳过。
 */
export function canProceedImport(
  counts: ImportProgressCounts,
  opts: { agreeSkipUnrecognized?: boolean } = {},
): boolean {
  if (counts.accountsResolved < counts.accountsTotal) return false;
  if (counts.categoriesResolved < counts.categoriesTotal) return false;
  return counts.willSkip === 0 || !!opts.agreeSkipUnrecognized;
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

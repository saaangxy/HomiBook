/**
 * 流水去重 —— 纯 TS,三端共享(backend detect-duplicates / web DedupDialog / mobile DedupSheet)。
 * 分组 key 的字段顺序(日期 → 类型 → 账户 → 交易方 → 金额 → 归属人)与解析必须一致。
 */
import { RECORD_TYPES, type RecordType } from './types/index.js';

export type DedupDatePrecision = 'exact' | 'minute' | 'date' | null;

/** 日期匹配精度可选值(null=忽略日期,不属于「可选值」故不在此列) */
export const DEDUP_DATE_PRECISIONS = ['exact', 'minute', 'date'] as const;

export interface DedupMatchFields {
  /** 日期匹配精度:exact=精确到秒,minute=同一分钟,date=同日,null=忽略 */
  date: DedupDatePrecision;
  type: boolean;
  accountId: boolean;
  payer: boolean;
  amount: boolean;
  ownerId: boolean;
}

export const DEFAULT_DEDUP_MATCH_FIELDS: DedupMatchFields = {
  // 默认「同分钟」:同一笔常在短信 / 通知 / 导入里各来一条,时间戳只差几秒 ——
  // 精确到秒会漏判,同日又太宽(同一天同账户同金额很容易撞上)
  date: 'minute',
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

/**
 * 格式化为**本地时间**的日期 / 分钟片段(与 `backend/src/lib/date-time.ts` 的本地日口径一致)。
 *
 * 不能用 `toISOString()` 截断:它是 UTC ——
 * 实测(UTC+8)本地 02-10 21:22 与 02-11 05:22 的 UTC 日同为 02-10,会被误判成「同一天」;
 * 反过来本地同一天但跨了 UTC 午夜的两条(如 07:00 与 23:00)又会漏判。
 */
function localStamp(date: Date | string, precision: 'minute' | 'date'): string {
  const d = date instanceof Date ? date : new Date(date);
  const pad = (n: number) => String(n).padStart(2, '0');
  const day = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  return precision === 'date' ? day : `${day}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** 按 matchFields 顺序构造分组 key(与解析严格对应) */
export function buildDuplicateKey(r: DedupKeyRecord, f: DedupMatchFields): string {
  const parts: string[] = [];

  if (f.date) {
    if (f.date === 'exact') {
      // 精确到秒:完整时间戳用 ISO(UTC) 表示最稳,与时区无关
      parts.push(r.date instanceof Date ? r.date.toISOString() : new Date(r.date).toISOString());
    } else if (f.date === 'minute') {
      // 同一分钟:两条记录常因相差几秒而躲过「精确」,同一天又太宽 —— 分钟正好卡住「同一笔」
      parts.push(localStamp(r.date, 'minute'));
    } else {
      // 同日:按**本地**日期比较(见 localStamp 注释)
      parts.push(localStamp(r.date, 'date'));
    }
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
  // 缺省按**本地时间**格式化(「精确」精度的 key 存的是 ISO/UTC,直接截断会显示 UTC 时间)
  const fmt = opts?.formatDateTime ?? ((iso: string) => {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso.replace('T', ' ').slice(0, 19);
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
  });

  if (fields.date) {
    const val = parts[idx++];
    // date 段本身就是 YYYY-MM-DD;minute 段是 YYYY-MM-DDTHH:mm,直接换空格即可(补秒反而多此一举)
    const text = fields.date === 'date'
      ? val
      : fields.date === 'minute'
        ? val.replace('T', ' ')
        : fmt(val);
    labels.push(`日期: ${text}`);
  }
  if (fields.type) labels.push(`类型: ${DEDUP_TYPE_LABELS[parts[idx++] as RecordType] ?? parts[idx - 1]}`);
  // idx 自增须与 optional chaining 解耦:opts 缺省时 ?. 短路会使 idx++ 不执行,导致取段错位
  if (fields.accountId) {
    const val = parts[idx++];
    labels.push(`账户: ${opts?.accountDisplay?.get(val) ?? val}`);
  }
  if (fields.payer) labels.push(`交易方: ${parts[idx++] === DEDUP_EMPTY_PAYER ? '(空)' : parts[idx - 1]}`);
  if (fields.amount) labels.push(`金额: ${parts[idx++]}`);
  if (fields.ownerId) {
    const val = parts[idx++];
    labels.push(`归属人: ${opts?.ownerNames?.get(val) ?? val}`);
  }

  return labels;
}

// ── 检测范围筛选 ──
//
// 与 DedupMatchFields 的分工:**matchFields 决定「怎么算同一笔」(分组 key),scope 决定「在哪些流水里找」**。
// 两者独立 —— 筛选只减少参与分组的流水,不改变任何判定逻辑,因此「检测出来的组」与「合并时校验的组」仍然一致。
// 日期一律按**本地日**比较(与 buildDuplicateKey 同口径,直接截 ISO 会得到 UTC 日)。

/** 去重检测的范围筛选:只把命中的流水拿去做分组 */
export interface DedupScopeFilter {
  /** 起始日(含,按本地日);'YYYY-MM-DD' 或 ISO 串,null = 不限 */
  dateFrom: string | null;
  /** 结束日(含,按本地日,含当天一整天);null = 不限 */
  dateTo: string | null;
  /** 参与检测的方向;空数组 = 不限 */
  types: RecordType[];
  /** 金额下限(含,**按绝对值**);null = 不限 */
  amountMin: number | null;
  /** 金额上限(含,**按绝对值**);null = 不限 */
  amountMax: number | null;
}

export const DEDUP_SCOPE_DEFAULT: DedupScopeFilter = {
  dateFrom: null,
  dateTo: null,
  types: [],
  amountMin: null,
  amountMax: null,
};

/** 取日期串的**本地日**部分('YYYY-MM-DD');非日期串返回 null */
function toDayKey(value: string | null | undefined): string | null {
  const text = (value ?? '').trim();
  const m = /^(\d{4}-\d{2}-\d{2})/.exec(text);
  return m ? m[1] : null;
}

function toScopeAmount(value: number | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  const n = Number(value);
  return Number.isFinite(n) ? Math.abs(n) : null;
}

/**
 * 归一化范围筛选(三端入口共用):补默认值、日期截到日、金额取绝对值且保证 min ≤ max、types 去重保序。
 * 传 null / undefined 直接得到「不限」。
 */
export function normalizeDedupScopeFilter(input?: Partial<DedupScopeFilter> | null): DedupScopeFilter {
  const types = [...new Set((input?.types ?? []).filter((t): t is RecordType => (RECORD_TYPES as readonly string[]).includes(t)))];
  const a = toScopeAmount(input?.amountMin);
  const b = toScopeAmount(input?.amountMax);
  return {
    dateFrom: toDayKey(input?.dateFrom),
    dateTo: toDayKey(input?.dateTo),
    types,
    amountMin: a !== null && b !== null ? Math.min(a, b) : a,
    amountMax: a !== null && b !== null ? Math.max(a, b) : b,
  };
}

/** 是否设了任一范围条件(UI 折叠态提示 / 判断要不要传参) */
export function hasDedupScopeFilter(f?: Partial<DedupScopeFilter> | null): boolean {
  const n = normalizeDedupScopeFilter(f);
  return !!(n.dateFrom || n.dateTo || n.types.length > 0 || n.amountMin !== null || n.amountMax !== null);
}

/**
 * 单条流水是否在检测范围内(纯函数)。
 * 日期按**本地日**比较;金额按**绝对值**(流水金额恒为正,方向由 type 表达)。
 */
export function matchesDedupScope(r: DedupKeyRecord, f?: Partial<DedupScopeFilter> | null): boolean {
  const n = normalizeDedupScopeFilter(f);
  if (n.dateFrom || n.dateTo) {
    const day = localStamp(r.date, 'date');
    if (n.dateFrom && day < n.dateFrom) return false;
    if (n.dateTo && day > n.dateTo) return false;
  }
  if (n.types.length > 0 && !n.types.includes(r.type as RecordType)) return false;
  const amount = Math.abs(Number(r.amount));
  if (n.amountMin !== null && amount < n.amountMin) return false;
  if (n.amountMax !== null && amount > n.amountMax) return false;
  return true;
}

/** 折叠态摘要(如「时间 2026-06-01~2026-06-30 · 类型 支出/收入 · 金额 100~500」);未设条件返回 '' */
export function summarizeDedupScopeFilter(f?: Partial<DedupScopeFilter> | null): string {
  const n = normalizeDedupScopeFilter(f);
  const parts: string[] = [];
  if (n.dateFrom || n.dateTo) parts.push(`时间 ${n.dateFrom ?? '不限'}~${n.dateTo ?? '不限'}`);
  if (n.types.length > 0) parts.push(`类型 ${n.types.map((t) => DEDUP_TYPE_LABELS[t]).join('/')}`);
  if (n.amountMin !== null || n.amountMax !== null) parts.push(`金额 ${n.amountMin ?? '不限'}~${n.amountMax ?? '不限'}`);
  return parts.join(' · ');
}

// ── 重复组合并 ──
//
// 判定「同一笔」的字段(日期 / 金额,以及可选的类型 / 账户 / 交易方 / 归属人)是**锚点**,不参与合并;
// 其余字段按两条规则收敛到保留记录(组内最早一条)上:
//   · **空值补齐**:保留记录该字段为空、且组内只有 1 个候选非空值 → 直接赋值,不打扰用户
//   · **真冲突**:出现 ≥2 个不同非空值 → 交给用户拍板(默认选中保留记录的值)
// 备注是特例:不二选一,而是「保留记录的 + 其余不同片段」拼接(去重、截断);
// 附件与标签取并集 —— 它们是证据,多一条只会更好,不需要用户选。
//
// 组顺序即语义:**records[0] 是保留记录**,其余全部合并进它后被删除。
// 三端共用本文件:backend 用它算真正要写的 patch,web / mobile 用同一份算预览 ——
// 「前端看到的」与「后端会做的」必然一致。

/** 合并时需要读到的记录字段(去重接口返回的 `RecordItem` 是它的超集) */
export interface DuplicateMergeRecord {
  id: string;
  accountId: string;
  fromAccountId?: string | null;
  toAccountId?: string | null;
  categoryCode?: string | null;
  payer?: string | null;
  remark?: string | null;
  tags?: string[];
  attachments?: unknown[];
  /** 方向(INCOME | EXPENSE | TRANSFER):不一致时禁止合并 */
  type?: string;
}

/** 需要用户拍板的字段:账户、分类(其余字段都能自动收敛) */
export type DuplicateMergeConflictField = 'accountId' | 'categoryCode';

export interface DuplicateMergeOption {
  /** 字段值(null = 该条此字段为空) */
  value: string | null;
  count: number;
  recordIds: string[];
}

export interface DuplicateMergeConflict {
  field: DuplicateMergeConflictField;
  /** 组内出现过的值(含「空」,按首次出现顺序);count 供 UI 显示「值 × 条数」 */
  options: DuplicateMergeOption[];
  /** 默认建议值 = 保留记录的值(决策:冲突默认第一条) */
  default: string | null;
}

/** 用户对冲突字段的选择(缺省 = 用默认值,即保留记录的值) */
export interface DuplicateMergeChoice {
  accountId?: string | null;
  categoryCode?: string | null;
  /** 备注默认拼接;填某条记录 id 表示「只用这条的备注」 */
  remarkFrom?: string;
  /**
   * 用户在「合并结果」面板里直接编辑的备注(优先于 `remarkFrom` 与拼接);
   * 传空串 = 显式清空备注。文本字段由用户负责,服务端不做「必须是组内值」的校验。
   */
  remarkText?: string;
  /** 用户在「合并结果」面板里直接编辑的交易方(优先于「空则填」);空串 = 清空 */
  payerText?: string;
}

/** 写回保留记录的字段(只含发生变化的) */
export interface DuplicateMergePatch {
  accountId?: string;
  fromAccountId?: string | null;
  toAccountId?: string | null;
  categoryCode?: string | null;
  payer?: string | null;
  remark?: string | null;
  tags?: string[];
}

export interface DuplicateMergeAutoFill {
  field: 'accountId' | 'categoryCode' | 'payer' | 'remark' | 'tags' | 'attachments' | 'fromAccountId' | 'toAccountId';
  /** 值来自哪条记录(并集类字段没有单一来源) */
  fromId?: string;
  /** 人类可读说明,供 UI 灰字展示「自动做了什么」 */
  detail: string;
}

export interface DuplicateMergePlan {
  /** 保留记录 id(组内最早一条) */
  keepId: string;
  /** 合并后删除的记录 id */
  mergeIds: string[];
  patch: DuplicateMergePatch;
  /** 附件需迁移到保留记录的来源记录 id */
  attachmentSourceIds: string[];
  autoFilled: DuplicateMergeAutoFill[];
  conflicts: DuplicateMergeConflict[];
  /** 合并后的备注(与 patch.remark 同源,便于 UI 预览) */
  remark: string | null;
  /** 组内存在待拍板字段:UI 据此决定「直接合并」还是「打开选择面板」 */
  needsReview: boolean;
  /** 不可合并的原因(方向不一致等);有值时其余字段无意义 */
  blocked?: string;
}

/** 方向不一致:合并会抹掉一个方向的数据,宁可不做(重复判定的分组逻辑本身不变,这里只是拒绝合并) */
export const DUPLICATE_MERGE_TYPE_MISMATCH = '两条记录方向不同(收入 / 支出 / 转账),可能不是同一笔,不做合并';

/** 合并后备注的长度上限:数据库列无上限,反复拼接不应无限增长 */
export const DUPLICATE_MERGE_REMARK_MAX = 500;

/** 去重列表的「空值」占位显示 */
export const DEDUP_EMPTY_LABEL = '(空)';

/**
 * 拼接多条备注:按顺序取非空片段、去重(同一条重复不重复记),超长截断。
 * 传入顺序应是「保留记录在前」,因此第一条的备注永远优先展示。
 */
export function mergeDuplicateRemarks(remarks: (string | null | undefined)[]): string | null {
  const parts: string[] = [];
  for (const raw of remarks) {
    const text = (raw ?? '').trim();
    if (text && !parts.includes(text)) parts.push(text);
  }
  if (parts.length === 0) return null;
  const joined = parts.join(' / ');
  return joined.length > DUPLICATE_MERGE_REMARK_MAX ? joined.slice(0, DUPLICATE_MERGE_REMARK_MAX) : joined;
}

/** 标签并集(保序去重) */
export function mergeDuplicateTags(lists: (string[] | null | undefined)[]): string[] {
  const out: string[] = [];
  for (const list of lists) {
    for (const tag of list ?? []) {
      const text = (tag ?? '').trim();
      if (text && !out.includes(text)) out.push(text);
    }
  }
  return out;
}

/** 归一化字段值:空串视作空 */
function normalizeValue(value: string | null | undefined): string | null {
  const text = (value ?? '').trim();
  return text.length > 0 ? text : null;
}

/** 统计组内某字段出现过的值(含「空」)与各自条数,按首次出现顺序 */
function collectOptions(
  records: DuplicateMergeRecord[],
  pick: (r: DuplicateMergeRecord) => string | null | undefined,
): DuplicateMergeOption[] {
  const options: DuplicateMergeOption[] = [];
  for (const r of records) {
    const value = normalizeValue(pick(r));
    const hit = options.find((o) => o.value === value);
    if (hit) {
      hit.count += 1;
      hit.recordIds.push(r.id);
    } else {
      options.push({ value, count: 1, recordIds: [r.id] });
    }
  }
  return options;
}

/** ≥2 个不同非空值才算冲突(只有一个候选时直接补齐,不打扰用户) */
function conflictOf(
  field: DuplicateMergeConflictField,
  options: DuplicateMergeOption[],
  keepValue: string | null,
): DuplicateMergeConflict | null {
  if (options.filter((o) => o.value !== null).length < 2) return null;
  return { field, options, default: keepValue };
}

/**
 * 收敛一个字段的最终值:
 *   0. 可空字段被显式传 `null` → 清空(用户要「不填」时不该被迫选一个值)
 *   1. 用户已选且该值确实在组内出现过 → 用用户的选择
 *   2. 冲突(≥2 个不同非空值) → 保留记录的值(默认第一条,不擅自替用户决定)
 *   3. 保留记录为空、组内只有 1 个候选 → 自动补齐
 *   4. 其余 → 保持保留记录原值
 */
function resolveField(
  options: DuplicateMergeOption[],
  keepValue: string | null,
  chosen: string | null | undefined,
  allowEmpty = false,
): { value: string | null; fromId?: string } {
  // 先判「显式清空」:null 不一定出现在 options 里(组内可能没人留空)
  if (allowEmpty && chosen === null) return { value: null };
  if (chosen !== undefined && options.some((o) => o.value === chosen)) {
    return { value: chosen };
  }
  const nonEmpty = options.filter((o) => o.value !== null);
  if (nonEmpty.length >= 2) return { value: keepValue };
  if (keepValue === null && nonEmpty.length === 1) {
    return { value: nonEmpty[0].value, fromId: nonEmpty[0].recordIds[0] };
  }
  return { value: keepValue };
}

/** 「空则填」:保留记录为空时取组内首个非空值(交易方 / 转账对方账户;不同则保留第一条) */
function fillIfEmpty(
  keepValue: string | null | undefined,
  others: DuplicateMergeRecord[],
  pick: (r: DuplicateMergeRecord) => string | null | undefined,
): { value: string; fromId: string } | null {
  if (normalizeValue(keepValue)) return null;
  for (const r of others) {
    const value = normalizeValue(pick(r));
    if (value) return { value, fromId: r.id };
  }
  return null;
}

function emptyPlan(records: DuplicateMergeRecord[], blocked: string): DuplicateMergePlan {
  return {
    keepId: records[0]?.id ?? '',
    mergeIds: records.slice(1).map((r) => r.id),
    patch: {},
    attachmentSourceIds: [],
    autoFilled: [],
    conflicts: [],
    remark: records[0]?.remark ?? null,
    needsReview: false,
    blocked,
  };
}

/**
 * 规划一个重复组的合并:给定组内记录(**第一条为保留记录**)与用户的冲突选择,
 * 算出「要写回保留记录的字段 / 要迁移的附件 / 要删除的记录 / 待用户拍板的冲突」。
 *
 * 不传 choices 也能算:冲突字段按默认值(保留记录的值)收敛 —— 用于「一键合并无冲突组」的批量预演。
 */
export function planDuplicateMerge(
  records: DuplicateMergeRecord[],
  choices?: DuplicateMergeChoice,
): DuplicateMergePlan {
  if (records.length < 2) return emptyPlan(records, '至少需要两条记录才能合并');
  const keep = records[0];
  const others = records.slice(1);

  // 方向不一致:直接拒绝(收入与支出合并会算错账,交给用户手工处理)
  if (records.some((r) => r.type && keep.type && r.type !== keep.type)) {
    return emptyPlan(records, DUPLICATE_MERGE_TYPE_MISMATCH);
  }

  const patch: DuplicateMergePatch = {};
  const autoFilled: DuplicateMergeAutoFill[] = [];
  const conflicts: DuplicateMergeConflict[] = [];

  // ── 账户 / 分类:同一套「冲突则选、空则补」规则 ──
  const accountOptions = collectOptions(records, (r) => r.accountId);
  const accountConflict = conflictOf('accountId', accountOptions, normalizeValue(keep.accountId));
  if (accountConflict) conflicts.push(accountConflict);
  const accountNext = resolveField(accountOptions, normalizeValue(keep.accountId), choices?.accountId);
  if (accountNext.value && accountNext.value !== normalizeValue(keep.accountId)) {
    patch.accountId = accountNext.value;
    if (accountNext.fromId) {
      autoFilled.push({ field: 'accountId', fromId: accountNext.fromId, detail: `账户补齐自另一条` });
    }
  }

  const categoryOptions = collectOptions(records, (r) => r.categoryCode);
  const categoryConflict = conflictOf('categoryCode', categoryOptions, normalizeValue(keep.categoryCode));
  if (categoryConflict) conflicts.push(categoryConflict);
  // 分类可空:schema 允许 null,所以允许用户显式选择「不填」
  const categoryNext = resolveField(categoryOptions, normalizeValue(keep.categoryCode), choices?.categoryCode, true);
  if (categoryNext.value !== normalizeValue(keep.categoryCode)) {
    patch.categoryCode = categoryNext.value;
    if (categoryNext.fromId) {
      autoFilled.push({ field: 'categoryCode', fromId: categoryNext.fromId, detail: `分类补齐自另一条` });
    }
  }

  // ── 交易方 / 转账对方账户:用户在结果面板改过就用用户的,否则「空则填,不同则保留第一条」 ──
  if (choices?.payerText !== undefined) {
    const value = normalizeValue(choices.payerText);
    if (value !== normalizeValue(keep.payer)) patch.payer = value;
  } else {
    const payerNext = fillIfEmpty(keep.payer, others, (r) => r.payer);
    if (payerNext) {
      patch.payer = payerNext.value;
      autoFilled.push({ field: 'payer', fromId: payerNext.fromId, detail: `交易方 ← ${payerNext.value}` });
    }
  }
  const fromNext = fillIfEmpty(keep.fromAccountId, others, (r) => r.fromAccountId);
  if (fromNext) patch.fromAccountId = fromNext.value;
  const toNext = fillIfEmpty(keep.toAccountId, others, (r) => r.toAccountId);
  if (toNext) patch.toAccountId = toNext.value;

  // ── 备注:用户直接编辑 > 指定某条 > 默认拼接(第一条在前) ──
  const remarkSource = choices?.remarkFrom ? records.find((r) => r.id === choices.remarkFrom) : undefined;
  const remark = choices?.remarkText !== undefined
    ? normalizeValue(choices.remarkText)
    : remarkSource
      ? normalizeValue(remarkSource.remark)
      : mergeDuplicateRemarks(records.map((r) => r.remark));
  if (remark !== normalizeValue(keep.remark)) {
    patch.remark = remark;
    // 用户手动编辑的不算「自动补齐」
    if (choices?.remarkText === undefined) {
      autoFilled.push({
        field: 'remark',
        fromId: (remarkSource ?? others.find((r) => normalizeValue(r.remark)))?.id,
        detail: remarkSource ? '备注 ← 指定记录' : '备注拼接其余记录',
      });
    }
  }

  // ── 标签:并集 ──
  const tags = mergeDuplicateTags(records.map((r) => r.tags));
  const keepTags = keep.tags ?? [];
  if (tags.length !== keepTags.length || tags.some((t, i) => t !== keepTags[i])) {
    patch.tags = tags;
    if (tags.length > keepTags.length) {
      autoFilled.push({ field: 'tags', detail: `标签并入 ${tags.length - keepTags.length} 个` });
    }
  }

  // ── 附件:并集迁移(只改关联,文件不动;保留记录自己的附件原地不动) ──
  const attachmentSourceIds = others.filter((r) => (r.attachments?.length ?? 0) > 0).map((r) => r.id);
  const movedAttachments = others.reduce((sum, r) => sum + (r.attachments?.length ?? 0), 0);
  if (movedAttachments > 0) {
    autoFilled.push({ field: 'attachments', detail: `附件并入 ${movedAttachments} 个` });
  }

  return {
    keepId: keep.id,
    mergeIds: others.map((r) => r.id),
    patch,
    attachmentSourceIds,
    autoFilled,
    conflicts,
    remark,
    needsReview: conflicts.length > 0,
  };
}

export interface DuplicateMergeGroupRequest {
  /** 组内记录,第一条为保留记录(detect-duplicates 已按 date asc 返回) */
  records: DuplicateMergeRecord[];
  choices?: DuplicateMergeChoice;
}

export interface DuplicateMergeBatch {
  plans: DuplicateMergePlan[];
  /** 有组需要用户拍板:UI 应先打开面板,而不是直接提交 */
  needsReview: boolean;
  /** 被拒绝的组(方向不一致等),不会执行 */
  blocked: { keepId: string; reason: string }[];
}

/** 批量规划(多组一次算完):供「一键合并无冲突组」与冲突组面板共用 */
export function planDuplicateMergeBatch(groups: DuplicateMergeGroupRequest[]): DuplicateMergeBatch {
  const plans = groups.map((g) => planDuplicateMerge(g.records, g.choices));
  return {
    plans,
    needsReview: plans.some((p) => p.needsReview),
    blocked: plans
      .filter((p) => p.blocked)
      .map((p) => ({ keepId: p.keepId, reason: p.blocked as string })),
  };
}

/** 批量结果的口径统计(两端按钮文案「合并 N 组(M 条)」同源) */
export function summarizeDuplicateMerge(batch: DuplicateMergeBatch): {
  groups: number;
  mergedRecords: number;
  attachments: number;
} {
  const effective = batch.plans.filter((p) => !p.blocked);
  return {
    groups: effective.length,
    mergedRecords: effective.reduce((sum, p) => sum + p.mergeIds.length, 0),
    attachments: effective.reduce((sum, p) => sum + p.attachmentSourceIds.length, 0),
  };
}

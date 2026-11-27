/**
 * 导入向导的「UI 决议状态 → 后端 payload」投影。
 *
 * 为什么单独放这里：四处 UI（web 向导 / mobile 向导 / 双端 AI 预览卡）各自把 state 拼成
 * `accountResolutions` / `categoryResolutions` / `unrecognizedResolutions` / `newMappings`，
 * 字段名映射、空值归一、完整性过滤都抄了一遍，改一处容易漏其它三处。
 *
 * 两处**真实语义差异**用显式开关保留，不做隐式默认：
 * - `onlyComplete`：AI 卡片只提交「用户真正处置完」的行；向导提交全量，由服务端裁决。
 * - `onlySaved`：AI 卡片把「保存规则」当作提交与否的开关；向导的 `save` 只影响 newMappings。
 */
import {
  type AccountResolution,
  isAccountResolutionComplete,
  isUnrecognizedResolutionComplete,
  TYPE_TO_GROUP,
} from './record-import.js';

// ── 类型（UI state 与后端 payload 各一套，中间由下面的投影函数转换） ──

/** 分类决议的 UI 草稿（复合键的 value） */
export interface CategoryResolutionDraft {
  targetCode: string;
  /** 是否存成后台映射规则；不影响本次导入 */
  save: boolean;
  payerContains: string;
  descriptionContains: string;
}

/** 未识别行处置的 UI 草稿（按 rowIndex 索引） */
export interface UnrecognizedResolutionDraft {
  type: string;
  accountId: string;
  categoryCode: string;
  toAccountId: string;
  /** 用户是否手动选过账户：选过之后不再被上方账户映射的默认值覆盖 */
  accountTouched?: boolean;
}

/** 从上方账户映射推导出的未识别行账户引用 */
export interface DerivedUnrecognizedAccount {
  /** 提交用的账户引用：已有账户为 id，本次将新建的账户为目标名 */
  value: string;
  action: 'existing' | 'create';
  /** 将新建账户的名称（下拉里展示为「新建：名称」） */
  newAccountName?: string;
}

/** 分类决议的扁平条目（复合键已解析，供投影与匹配使用） */
export interface CategoryResolutionEntry extends CategoryResolutionDraft {
  sourceCategory: string;
  recordType?: string;
}

export interface AccountResolutionPayload {
  sourceAccountName: string;
  action: 'create' | 'existing';
  targetAccountId?: string;
  targetAccountName?: string;
  accountType?: string;
}

export interface CategoryResolutionPayload {
  sourceCategory: string;
  targetCategoryCode: string;
  recordType?: string;
  payerContains?: string;
  descriptionContains?: string;
}

export interface UnrecognizedResolutionPayload {
  rowIndex: number;
  type?: string;
  accountId?: string;
  toAccountId?: string;
  categoryCode?: string;
}

// ── 复合键 ──

/**
 * 分类决议的复合键：`sourceCategory::recordType`，手动复制的分类项再加 `::e{extraId}`。
 * 第三段只是 UI 用的唯一化后缀，**不是**收支类型（解析时忽略）。
 */
export function buildCategoryResolutionKey(sourceCategory: string, recordType: string, extraId?: number): string {
  return extraId === undefined
    ? `${sourceCategory}::${recordType}`
    : `${sourceCategory}::${recordType}::e${extraId}`;
}

/** 解析复合键；多余的后缀段（手动复制项）忽略 */
export function parseCategoryResolutionKey(key: string): { sourceCategory: string; recordType?: string } {
  const parts = key.split('::');
  return { sourceCategory: parts[0] ?? '', recordType: parts[1] || undefined };
}

// ── 初始化 ──

/**
 * 目标分类是否属于该记录的收支类型。
 *
 * 服务端 `applyCategoryMappings` 会按这条规则把不匹配的映射判为「未映射」
 * （`isCategoryCodeValidForType` → `mappedCategoryCode = null`），前端预填时必须同口径，
 * 否则会出现「界面上选好了、服务端说未映射」。
 *
 * 类型未知（UNKNOWN / 无对应字典组）一律视为不合法：这类记录走「需手动处理」区块。
 */
export function isCategoryCodeValidForType(
  code: string | null | undefined,
  recordType: string,
  dictItems: { code: string; group: string }[],
): boolean {
  if (!code) return false;
  const group = TYPE_TO_GROUP[recordType];
  if (!group) return false;
  return dictItems.some((d) => d.code === code && d.group === group);
}

/**
 * 分类决议草稿初始化：每个「源分类 × 收支类型」一条。
 *
 * ⚠️ `saveByDefault` 由调用方决定，core 不设默认值 —— 历史上 web 的两条解析路径分别是
 * true / false，把它统一成常量会静默改变「是否自动积累映射规则」的产品行为。
 *
 * ⚠️ 传 `dictItems` 时会校验建议值：后端 `unmatchedCategories` 按**源分类**聚合、只给一个
 * `suggestedCode`，同一源分类跨收支类型时（如「转账红包」既有支出行又有收入行），这个建议值
 * 只对其中一半类型合法。直接预填另一半会被服务端判成「目标分类与收支类型不符」→ 永远未映射。
 */
export function initCategoryResolutionDrafts(
  unmatchedCategories: { sourceCategory: string; types: string[]; suggestedCode?: string | null }[],
  opts: { saveByDefault: boolean; dictItems?: { code: string; group: string }[] },
): Record<string, CategoryResolutionDraft> {
  const drafts: Record<string, CategoryResolutionDraft> = {};
  for (const uc of unmatchedCategories) {
    for (const type of uc.types) {
      const suggested = uc.suggestedCode || '';
      const targetCode = opts.dictItems && !isCategoryCodeValidForType(suggested, type, opts.dictItems)
        ? ''
        : suggested;
      drafts[buildCategoryResolutionKey(uc.sourceCategory, type)] = {
        targetCode,
        save: opts.saveByDefault,
        payerContains: '',
        descriptionContains: '',
      };
    }
  }
  return drafts;
}

/**
 * AI 预览卡的分类决议初始化：把 `unmatchedCategories` 展开成「每种收支类型一条」的扁平条目。
 *
 * 与 `initCategoryResolutionDrafts` 的两点差异：
 * - AI 给了明确类型（aiRecordType）时以它为准，否则用该源分类出现过的全部类型；
 * - **UNKNOWN 不建条目** —— 这类行由「需手动处理」区块处置。用 UNKNOWN 当 recordType 提交，
 *   服务端按 `recordType === row.type` 匹配，永远命中不了，表现为「选了分类仍报未映射」。
 */
export function initCategoryResolutionEntries(
  unmatchedCategories: {
    sourceCategory: string
    types: string[]
    suggestedCode?: string | null
    aiRecordType?: string
  }[],
  opts: { saveByDefault: boolean; dictItems?: { code: string; group: string }[] },
): CategoryResolutionEntry[] {
  const drafts = initCategoryResolutionDrafts(
    unmatchedCategories.map((uc) => ({
      sourceCategory: uc.sourceCategory,
      types: uc.aiRecordType && uc.aiRecordType !== 'UNKNOWN'
        ? [uc.aiRecordType]
        : uc.types.filter((t) => t !== 'UNKNOWN'),
      suggestedCode: uc.suggestedCode,
    })),
    opts,
  );
  return toCategoryResolutionEntries(drafts);
}

/** 未识别行处置草稿初始化：全部置空，等用户填 */
export function initUnrecognizedResolutionDrafts(
  rows: { rowIndex: number }[],
): Record<number, UnrecognizedResolutionDraft> {
  const drafts: Record<number, UnrecognizedResolutionDraft> = {};
  for (const r of rows) {
    drafts[r.rowIndex] = { type: '', accountId: '', categoryCode: '', toAccountId: '' };
  }
  return drafts;
}

// ── 未识别行的账户默认值（来源：上方账户映射） ──

/**
 * 按本行源账户名推导账户引用：上方账户映射里已配置（映射到已有账户 / 新建账户）时返回结果。
 *
 * 首次导入没有已有账户时，「需手动处理」行的账户下拉此前为空，行永远完不成；
 * 这里让行内能直接复用它上方已经配置好的结果 —— 引用方式与普通记录一致：
 * 已有账户用 id，本次将新建的账户用目标名（后端 buildValidAccountRefs / AccountResolver 已支持）。
 *
 * 注：候选建议（isDefault）同样可用 —— 它只表示「尚未显式采纳」，不阻塞行内带入。
 */
export function deriveUnrecognizedAccount(
  accountName: string | null | undefined,
  accountResolutions: Record<string, AccountResolution>,
): DerivedUnrecognizedAccount | null {
  if (!accountName) return null;
  const res = accountResolutions[accountName];
  if (!res) return null;
  if (res.action === 'existing') {
    return res.accountId ? { value: res.accountId, action: 'existing' } : null;
  }
  return res.name ? { value: res.name, action: 'create', newAccountName: res.name } : null;
}

/**
 * 本次将新建的账户名（去重、排除与已有账户同名的项）。
 *
 * 用于「需手动处理」行的账户下拉追加「新建：名称」选项；与已有账户同名时无需重复 ——
 * 后端创建账户会按同名去重到同一账户，引用目标名与引用该账户 id 等价。
 */
export function collectPendingAccountNames(
  accountResolutions: Record<string, AccountResolution>,
  existingAccountNames: Iterable<string>,
): string[] {
  const existing = new Set(existingAccountNames);
  const names = new Set<string>();
  for (const res of Object.values(accountResolutions)) {
    if (res.action === 'create' && res.name && !existing.has(res.name)) names.add(res.name);
  }
  return Array.from(names);
}

/**
 * 合并「默认账户」后的有效未识别行决议：
 * - 用户手选过（accountTouched）的行保持不变；
 * - 其余行用上方账户映射推导出的账户覆盖（含 AI 卡里预置的首个账户等「默认值」）。
 * 只补账户，类型/分类/转入账户仍由用户自行选择。
 */
export function applyUnrecognizedAccountDefaults(
  state: Record<number, UnrecognizedResolutionDraft>,
  rows: { rowIndex?: number; accountName?: string | null }[],
  accountResolutions: Record<string, AccountResolution>,
): Record<number, UnrecognizedResolutionDraft> {
  const out: Record<number, UnrecognizedResolutionDraft> = {};
  for (const row of rows) {
    const rowIndex = row.rowIndex ?? -1;
    const cur = state[rowIndex] ?? { type: '', accountId: '', categoryCode: '', toAccountId: '' };
    const derived = cur.accountTouched
      ? null
      : deriveUnrecognizedAccount(row.accountName, accountResolutions);
    out[rowIndex] = derived ? { ...cur, accountId: derived.value } : cur;
  }
  return out;
}

// ── 投影 ──

/** `Record<sourceAccountName, AccountResolution>` → 后端数组 */
export function toAccountResolutionPayload(
  state: Record<string, AccountResolution>,
  opts: { onlyComplete?: boolean } = {},
): AccountResolutionPayload[] {
  const out: AccountResolutionPayload[] = [];
  for (const [sourceAccountName, r] of Object.entries(state)) {
    if (opts.onlyComplete && !isAccountResolutionComplete(r)) continue;
    out.push({
      sourceAccountName,
      action: r.action,
      targetAccountId: r.action === 'existing' ? r.accountId : undefined,
      targetAccountName: r.action === 'create' ? r.name : undefined,
      accountType: r.action === 'create' ? r.type : undefined,
    });
  }
  return out;
}

/** 复合键 Record → 扁平条目（解析 sourceCategory / recordType） */
export function toCategoryResolutionEntries(
  drafts: Record<string, CategoryResolutionDraft>,
): CategoryResolutionEntry[] {
  return Object.entries(drafts).map(([key, draft]) => {
    const { sourceCategory, recordType } = parseCategoryResolutionKey(key);
    return { sourceCategory, recordType, ...draft };
  });
}

/**
 * 分类决议 → 后端数组。
 * - 没选目标分类的一律不提交（后端会把它当「未映射」）；
 * - `onlySaved` 时只提交勾了「保存」的（AI 卡片的语义）。
 */
export function toCategoryResolutionPayload(
  entries: CategoryResolutionEntry[],
  opts: { onlySaved?: boolean } = {},
): CategoryResolutionPayload[] {
  return entries
    .filter((e) => !!e.targetCode && (!opts.onlySaved || e.save))
    .map((e) => ({
      sourceCategory: e.sourceCategory,
      targetCategoryCode: e.targetCode,
      recordType: e.recordType || undefined,
      payerContains: e.payerContains || undefined,
      descriptionContains: e.descriptionContains || undefined,
    }));
}

/**
 * 未识别行处置 → 后端数组。
 * - 向导传全量（空处置也传），由服务端 `applyUnrecognizedResolutions` 判定完整性；
 * - `onlyComplete` 时只提交完整处置（AI 卡片的语义：避免把空处置当成已处理）。
 */
export function toUnrecognizedResolutionPayload(
  state: Record<number, UnrecognizedResolutionDraft>,
  opts: { onlyComplete?: boolean } = {},
): UnrecognizedResolutionPayload[] {
  const out: UnrecognizedResolutionPayload[] = [];
  for (const [rowIndex, r] of Object.entries(state)) {
    if (opts.onlyComplete && !isUnrecognizedResolutionComplete(r)) continue;
    out.push({
      rowIndex: Number(rowIndex),
      type: r.type,
      accountId: r.accountId,
      categoryCode: r.categoryCode || '',
      toAccountId: r.type === 'TRANSFER' ? r.toAccountId : undefined,
    });
  }
  return out;
}

// ── 派生 ──

/**
 * 按 payer / remark 包含关系给分类决议打分，取最高分。
 *
 * 权重：交易方命中 +2，说明命中 +1；带条件但没命中的条目直接跳过。
 * 无条件条目得 0 分，因此「有条件的更具体」始终优先于无条件条目。
 * 与后端 `findBestMapping` 的口径一致（web/mobile 原先各抄了一份）。
 */
export function findBestCategoryResolution(
  entries: CategoryResolutionEntry[],
  target: { sourceCategory: string; recordType: string; payer?: string | null; remark?: string | null },
): string | null {
  let best: string | null = null;
  let bestScore = -1;
  for (const e of entries) {
    if (!e.targetCode) continue;
    if (e.sourceCategory !== target.sourceCategory || e.recordType !== target.recordType) continue;
    let score = 0;
    if (e.payerContains) {
      if (target.payer && target.payer.includes(e.payerContains)) score += 2;
      else continue;
    }
    if (e.descriptionContains) {
      if (target.remark && target.remark.includes(e.descriptionContains)) score += 1;
      else continue;
    }
    if (score > bestScore) {
      bestScore = score;
      best = e.targetCode;
    }
  }
  return best;
}

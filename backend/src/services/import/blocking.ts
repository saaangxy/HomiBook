/**
 * 导入阻断项(D 项) —— 预览阶段与导入阶段共用同一口径。
 *
 * 「必然失败」(willFailAtImport=true):不处理就会 400(账户/转入账户未解析、未识别未确认)。
 * 「会写脏」(willFailAtImport=false):不处理会写入错误分类,或该行被静默跳过。
 *
 * 纯函数、不碰 DB:账户/字典的有效集合由调用方查好后传入,便于单测与两处复用。
 */

export type ImportBlockingKind = 'account' | 'category' | 'unrecognized'

export interface ImportBlockingItem {
  kind: ImportBlockingKind
  /** 账户/分类:原始名;未识别:行号 */
  ref: string
  /** 用户可读原因 */
  reason: string
  /** true = 不处理必然失败;false = 会写脏数据或被跳过 */
  willFailAtImport: boolean
}

/** 预览阶段:把「未匹配账户 / 未映射分类 / 无法识别记录」三组清单翻译成阻断项 */
export function collectPreviewBlocking(input: {
  unmatchedAccounts: { csvName: string }[]
  unmatchedCategories: { sourceCategory: string }[]
  unrecognizedRecords: { rowIndex?: number }[]
}): ImportBlockingItem[] {
  const items: ImportBlockingItem[] = []

  for (const ua of input.unmatchedAccounts) {
    items.push({
      kind: 'account',
      ref: ua.csvName,
      reason: `账户「${ua.csvName}」未指定归属账户（导入时会因账户不存在失败）`,
      willFailAtImport: true,
    })
  }

  for (const uc of input.unmatchedCategories) {
    items.push({
      kind: 'category',
      ref: uc.sourceCategory,
      reason: `分类「${uc.sourceCategory}」未映射到系统分类（会按原始名写入）`,
      willFailAtImport: false,
    })
  }

  for (const r of input.unrecognizedRecords) {
    items.push({
      kind: 'unrecognized',
      ref: String(r.rowIndex ?? ''),
      reason: '记录类型无法识别，未处置时该行会被跳过',
      willFailAtImport: false,
    })
  }

  return items
}

/**
 * 导入校验用的「合法账户引用」集合 = 已有账户 id + 本次将创建的账户。
 * 账户是在事务内才创建的,而校验发生在事务外,所以新建账户必须提前算进合法集合,
 * 否则会被误判为「账户不存在」。引用键与 createAccountsInTx / AccountResolver 保持一致:
 * 目标名 + csvName 按 ', ' 拆分的每个片段。
 */
export function buildValidAccountRefs(
  existingIds: Iterable<string>,
  creations: { csvName: string; name: string }[],
): Set<string> {
  const set = new Set(existingIds)
  for (const c of creations) {
    for (const sn of c.csvName.split(', ')) {
      if (sn) set.add(sn)
    }
    set.add(c.name)
  }
  return set
}

/**
 * 该行是否该让它的源分类进入「未映射分类」清单。
 *
 * 类型未识别(UNKNOWN)的行**不参与**:它们的分类由「未识别行处置」负责
 * (第一步「需手动处理」区块里同时选类型与分类),前端门禁也只统计已识别类型的行。
 * 不排除它们,同一源分类既有 EXPENSE 又有 UNKNOWN 行时,前端显示已处理完毕、
 * 服务端复核却报「未决」并禁用确认按钮。
 */
export function shouldMarkCategoryUnmatched(row: {
  categoryCode?: string | null
  mappedCategoryCode?: string | null
  type: string
}): boolean {
  return !!row.categoryCode && row.mappedCategoryCode === null && row.type !== 'UNKNOWN'
}

/** 找出不在字典中的分类编码(去重保序) */
export function findUnknownCategoryCodes(
  codes: (string | undefined | null)[],
  validCodes: ReadonlySet<string>,
): string[] {
  const seen = new Set<string>()
  const unknown: string[] = []
  for (const code of codes) {
    if (!code || validCodes.has(code) || seen.has(code)) continue
    seen.add(code)
    unknown.push(code)
  }
  return unknown
}

/** 把字典项格式化成给模型看的候选清单 `label(code)`,防止一次塞太多 */
export function formatDictOptions(items: { code: string; label: string }[], limit = 30): string {
  const head = items.slice(0, limit).map(d => `${d.label}(${d.code})`)
  return items.length > limit ? `${head.join('、')} 等 ${items.length} 项` : head.join('、')
}

/**
 * 兜底/泛化类源分类:这些分类下的记录互不相关。
 * 注意不要扩大范围 —— 「转账红包」这类是**同质**分类(都是红包/转账),
 * 对它出无条件规则是对的,放进来会误报。
 */
const GENERIC_SOURCE_CATEGORY_RE = /^(其他|其它|未知)/

export interface CategoryResolutionLike {
  sourceCategory: string
  targetCategoryCode: string
  payerContains?: string
  descriptionContains?: string
}

/**
 * 找出「兜底类源分类 + 无条件规则」的决议。
 *
 * 例:「其他」→「育儿母婴」(不带任何条件) 会把这个源分类下**所有**记录都算成育儿母婴。
 * 目标是兜底类本身的除外(「其他」→「其他」无害)。
 * 用于 AI 链路:这类决议必然错,回报模型让它补条件或撤掉。
 */
export function findGenericUnconditionalResolutions<T extends CategoryResolutionLike>(resolutions: T[]): T[] {
  return resolutions.filter(r => {
    if (!GENERIC_SOURCE_CATEGORY_RE.test((r.sourceCategory || '').trim())) return false
    if ((r.payerContains || '').trim() || (r.descriptionContains || '').trim()) return false
    return !GENERIC_SOURCE_CATEGORY_RE.test((r.targetCategoryCode || '').trim())
  })
}

/**
 * 找出「源分类与目标分类同名」的决议。
 *
 * 例:「日用百货」→「日用百货」—— 等于没映射(未映射时 /import 也会回退成源名,结果完全一样),
 * 存成规则只会污染规则表。仅用于 AI 链路:这类决议没有价值,让模型去掉或改成真正的目标分类。
 */
export function findSelfMappedCategoryResolutions<T extends CategoryResolutionLike>(resolutions: T[]): T[] {
  return resolutions.filter(r => {
    const src = (r.sourceCategory || '').trim()
    return !!src && src === (r.targetCategoryCode || '').trim()
  })
}

/** 分类字典的三个组(收入/支出/转账):导入校验统一用这一份 */
export const CATEGORY_DICT_GROUPS = [
  'transaction_category_income',
  'transaction_category_expense',
  'transaction_category_transfer',
]

/** 参与导入校验的流水(importConfirmSchema 的子集) */
export interface ImportRecordForValidation {
  rowIndex?: number
  type: string
  accountId: string
  toAccountId?: string
  categoryCode?: string | null
}

/**
 * 导入阶段:逐条校验最终 records。
 * strict=true 时连"会写脏"的项也阻断;strict=false 只阻断必然失败的项(老客户端灰度)。
 */
export function validateImportRecords(input: {
  records: ImportRecordForValidation[]
  validAccountIds: ReadonlySet<string>
  validCategoryCodes: ReadonlySet<string>
  strict?: boolean
}): ImportBlockingItem[] {
  const { records, validAccountIds, validCategoryCodes, strict = true } = input
  const items: ImportBlockingItem[] = []
  const keepDirty = (item: ImportBlockingItem) => item.willFailAtImport || strict

  for (const r of records) {
    const row = r.rowIndex === undefined ? '' : `第 ${r.rowIndex} 行`

    if (!validAccountIds.has(r.accountId)) {
      items.push({
        kind: 'account',
        ref: r.accountId,
        reason: `${row}账户不存在或不属于本账本：${r.accountId}`,
        willFailAtImport: true,
      })
    }

    if (r.type === 'TRANSFER') {
      if (!r.toAccountId) {
        items.push({ kind: 'account', ref: row, reason: `${row}转账缺少转入账户`, willFailAtImport: true })
      } else if (!validAccountIds.has(r.toAccountId)) {
        items.push({
          kind: 'account',
          ref: r.toAccountId,
          reason: `${row}转入账户不存在或不属于本账本：${r.toAccountId}`,
          willFailAtImport: true,
        })
      }
    }

    if (r.categoryCode && !validCategoryCodes.has(r.categoryCode)) {
      items.push({
        kind: 'category',
        ref: r.categoryCode,
        reason: `${row}分类不在字典中：${r.categoryCode}`,
        willFailAtImport: false,
      })
    }
  }

  return items.filter(keepDirty)
}

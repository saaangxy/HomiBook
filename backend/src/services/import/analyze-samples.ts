/**
 * AI analyze 阶段的派生数据(纯函数,便于单测):
 *   - 账户待定的原始行(账户未匹配但分类可能已映射的那些行,AI 否则看不到)
 *   - 每个未映射源分类的样本 Top N(判断能否按交易方细分成条件化规则)
 * 依赖 prisma 的「既有规则」查询不在此处,由调用方(preview-import)负责。
 */
import type { ParsedRow } from './shared.js'

/** analyze 返回的账户待定行上限 / 每分类样本数上限(避免响应过大) */
export const ACCOUNT_UNMATCHED_LIMIT = 200
export const CATEGORY_SAMPLE_LIMIT = 5

/** 账户名(含转账目标名)落在 unmatchedNames 里的行 */
export function buildAccountUnmatchedRecords(
  rows: ParsedRow[],
  unmatchedNames: ReadonlySet<string>,
  limit = ACCOUNT_UNMATCHED_LIMIT,
) {
  return rows
    .filter(r => unmatchedNames.has(r.accountName) || (!!r.toAccountName && unmatchedNames.has(r.toAccountName)))
    .slice(0, limit)
    .map(r => ({
      rowIndex: r.rowIndex,
      date: r.date,
      type: r.type,
      amount: r.amount,
      accountName: r.accountName,
      toAccountName: r.toAccountName ?? null,
      payer: r.payer ?? null,
      remark: r.remark ?? '',
    }))
}

/** 每个未映射源分类的样本(按该分类实际出现的行截取前 N 条) */
export function buildCategorySamples(
  rows: ParsedRow[],
  sourceCategories: string[],
  limit = CATEGORY_SAMPLE_LIMIT,
) {
  return sourceCategories.map(sourceCategory => {
    const matched = rows.filter(r => r.categoryCode === sourceCategory)
    return {
      sourceCategory,
      total: matched.length,
      samples: matched.slice(0, limit).map(r => ({
        payer: r.payer ?? null,
        remark: r.remark ?? '',
        type: r.type,
        amount: r.amount,
      })),
    }
  })
}

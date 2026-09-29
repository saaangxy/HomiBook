/**
 * 导入映射规则归一化与合并(H 项)。
 *
 * 规则唯一键含条件字段(source/sourceCategory/payerContains/descriptionContains/recordType),
 * 条件"看起来不同、实际等价"(多一个空格/全角字符)就会被当成两条规则 —— 长期累积重复与碎片。
 * 保存前统一走这里:归一化条件 → 同键去重(保留最后一条,即本次用户/AI 决议覆盖旧值)。
 *
 * 刻意不归一化 sourceCategory / targetAccountName / targetCategoryCode:
 * 前者是匹配键(必须与账单里的原文相等),后者是账户名/字典码,改动会破坏匹配。
 */

import { RECORD_TYPES } from '@homibook/core'

/** 条件字符串归一化:全角转半角 → 全角空格转半角 → 连续空白折叠 → trim */
export function normalizeCondition(raw?: string | null): string {
  if (!raw) return ''
  return raw
    .replace(/[\uFF01-\uFF5E]/g, ch => String.fromCharCode(ch.charCodeAt(0) - 0xfee0))
    .replace(/\u3000/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/** 按 key 去重,保留最后一条(调用方保证"后者 = 本次决议") */
export function dedupeBy<T>(items: T[], keyOf: (item: T) => string): T[] {
  const map = new Map<string, T>()
  for (const item of items) map.set(keyOf(item), item)
  return Array.from(map.values())
}

export interface CategoryMappingLike {
  sourceCategory: string
  targetCategoryCode: string
  payerContains?: string
  descriptionContains?: string
  recordType?: string
}

export interface NormalizedCategoryMapping {
  sourceCategory: string
  targetCategoryCode: string
  payerContains: string
  descriptionContains: string
  recordType: string
}

/**
 * 规则里的 recordType:只接受合法类型,其余(含空)一律归为 ''(不限类型)。
 * 刻意不用 core 的 normalizeRecordType —— 它对非法值兜底成 EXPENSE,
 * 会让"不限类型"的规则静默变成"只匹配支出"。
 */
export function normalizeRuleRecordType(raw?: string | null): string {
  return raw && (RECORD_TYPES as readonly string[]).includes(raw) ? raw : ''
}

/** 分类映射:归一化条件 + 同唯一键去重 */
export function normalizeCategoryMappings(mappings: CategoryMappingLike[]): NormalizedCategoryMapping[] {
  const normalized = mappings.map(m => ({
    sourceCategory: m.sourceCategory,
    targetCategoryCode: m.targetCategoryCode,
    payerContains: normalizeCondition(m.payerContains),
    descriptionContains: normalizeCondition(m.descriptionContains),
    recordType: normalizeRuleRecordType(m.recordType),
  }))
  return dedupeBy(normalized, m => [m.sourceCategory, m.payerContains, m.descriptionContains, m.recordType].join('\u0000'))
}

export interface AccountMappingLike {
  sourceAccountName: string
  targetAccountName: string
  payerContains?: string
  descriptionContains?: string
}

export interface NormalizedAccountMapping {
  sourceAccountName: string
  targetAccountName: string
  payerContains: string
  descriptionContains: string
}

/** 账户映射:归一化条件 + 同唯一键去重(保留最后一条 = 本次决议) */
export function normalizeAccountMappings(mappings: AccountMappingLike[]): NormalizedAccountMapping[] {
  const normalized = mappings.map(m => ({
    sourceAccountName: m.sourceAccountName,
    targetAccountName: m.targetAccountName,
    payerContains: normalizeCondition(m.payerContains),
    descriptionContains: normalizeCondition(m.descriptionContains),
  }))
  return dedupeBy(normalized, m => [m.sourceAccountName, m.payerContains, m.descriptionContains].join('\u0000'))
}

/** 单来源规则数上限:超过时保存接口回传提示(防止碎片化) */
export const MAPPING_COUNT_WARN_LIMIT = 80

/** 是否属于「兜底规则」(条件全空,任何行都能命中) */
export function isFallbackRule(m: { payerContains?: string; descriptionContains?: string; recordType?: string }): boolean {
  return !m.payerContains && !m.descriptionContains && !m.recordType
}

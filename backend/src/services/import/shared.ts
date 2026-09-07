import { prisma } from '../../app.js'
import { matchAccountInPoolDetailed } from '@homibook/core'

// ======================== 工具函数 ========================

/** 检查文本是否匹配模式（支持正则表达式，如 燃气|电力|汇通 匹配任一关键词）。无效正则回退为字面包含匹配 */
export function testMatch(pattern: string, text: string): boolean {
  try {
    return new RegExp(pattern).test(text)
  } catch {
    return text.includes(pattern)
  }
}

// ======================== 类型 ========================

export interface ParsedRow {
  date: string
  type: 'INCOME' | 'EXPENSE' | 'TRANSFER' | 'UNKNOWN'
  amount: number
  accountName: string
  accountId: string | null
  toAccountName: string | null
  toAccountId: string | null
  categoryCode: string | null
  mappedCategoryCode: string | null
  payer: string | null
  remark: string
  tags: string[]
  rowIndex: number
}

export type AccountMatchResult =
  | { matched: true; id: string; name: string }
  | { matched: false; ambiguous: true; candidates: { id: string; name: string }[] }
  | { matched: false; ambiguous: false }

export interface UnmatchedAccount {
  csvName: string
  suggestedType: string
  suggestedName: string
  bankName?: string
  accountNo?: string
  candidates?: { id: string; name: string }[]
  /** AI 提供的解析信息（preview 模式带回，供前端展示预填充状态） */
  aiResolution?: { sourceAccountName: string; action: 'existing' | 'create'; targetAccountId?: string; targetAccountName?: string; accountType?: string }
}

export interface UnmatchedCategory {
  sourceCategory: string
  suggestedCode: string | null
  types: string[]
  /** AI 提供的目标分类编码（preview 模式带回，供前端展示预填充状态） */
  aiTargetCode?: string
  aiRecordType?: string
}

// ======================== 账户名推断 ========================

export const NAME_TYPE_RULES: { test: (name: string) => boolean; type: string }[] = [
  { test: (n) => /微信/.test(n), type: 'WECHAT' },
  { test: (n) => /支付宝/.test(n), type: 'ALIPAY' },
  { test: (n) => /信用卡/.test(n), type: 'CREDIT_CARD' },
  { test: (n) => /储蓄卡|借记卡/.test(n), type: 'BANK_DEBIT' },
  { test: (n) => /银行/.test(n), type: 'BANK_DEBIT' },
  { test: (n) => /投资|理财|基金|股票|余额宝/.test(n), type: 'INVESTMENT' },
  { test: (n) => /现金/.test(n), type: 'CASH' },
  { test: (n) => /充值/.test(n), type: 'RECHARGE_CARD' },
]

export function inferAccount(paymentMethod: string): { type: string; defaultName: string; bankName?: string; accountNo?: string } | null {
  if (!paymentMethod) return null

  // 银行卡：XX银行储蓄卡(NNNN) 或 XX银行信用卡(NNNN)
  const cardMatch = paymentMethod.match(/^(.+?银行).*?[储蓄信用]卡.*?[\(（](\d+)[\)）]/)
  if (cardMatch) {
    return {
      type: paymentMethod.includes('信用') ? 'CREDIT_CARD' : 'BANK_DEBIT',
      defaultName: paymentMethod,
      bankName: cardMatch[1],
      accountNo: cardMatch[2],
    }
  }

  // 通用银行匹配
  const bankMatch = paymentMethod.match(/^(.+?银行)/)
  if (bankMatch) {
    const type = /信用/.test(paymentMethod) ? 'CREDIT_CARD' : 'BANK_DEBIT'
    return { type, defaultName: paymentMethod, bankName: bankMatch[1] }
  }

  // 按名称关键词规则匹配
  for (const rule of NAME_TYPE_RULES) {
    if (rule.test(paymentMethod)) {
      return { type: rule.type, defaultName: paymentMethod }
    }
  }

  return { type: 'OTHER', defaultName: paymentMethod }
}

// ======================== 账户匹配 ========================

/**
 * 按名称包含匹配已有账户（优先级：精确 → 账户名包含目标名 → 目标名包含账户名）。
 * 传入 ownerId 时只在本人账户中匹配（多成员账本下避免匹配到他人同名账户）。
 * 算法单一来源在 @homibook/core（多用户修复版语义),此处仅保持既有导入路径。
 */
export function matchAccountByName(
  name: string,
  allAccounts: { id: string; name: string; ownerId?: string }[],
  ownerId?: string,
): AccountMatchResult {
  return matchAccountInPoolDetailed(name, allAccounts, ownerId)
}

// ======================== 账户映射 ========================

/** AI 账户映射参数 */
export interface AIAccountResolution {
  sourceAccountName: string
  action: 'existing' | 'create'
  targetAccountId?: string
  targetAccountName?: string
  accountType?: string
}

/** 加载导入账户映射并按评分匹配。aiResolutions 按 sourceAccountName 覆盖/补充 DB 规则（不写 DB）。传入 ownerId 时只在本人账户中匹配 */
export async function applyAccountMappings(
  source: string,
  rows: ParsedRow[],
  bookId: string,
  aiResolutions?: AIAccountResolution[],
  ownerId?: string,
) {
  const sourceNames = [...new Set(rows.map(r => r.accountName).filter(Boolean))]
  const empty = { idMap: new Map<string, string | null>(), nameRecord: {} as Record<string, string>, newAccountCreations: [] as { sourceAccountName: string; name: string; type: string }[] }
  if (sourceNames.length === 0 && !aiResolutions?.length) return empty

  const idMap = new Map<string, string | null>()
  const nameRecord: Record<string, string> = {}

  // 加载活跃账户（DB 评分 + AI 覆盖共用；多成员账本下只匹配本人账户）
  const allAccounts = await prisma.account.findMany({
    where: { accountBookId: bookId, status: 'ACTIVE', ...(ownerId ? { ownerId } : {}) },
    select: { id: true, name: true },
  })

  // DB 映射评分
  if (sourceNames.length > 0) {
    const allMappings = await prisma.importAccountMapping.findMany({
      where: {
        source,
        sourceAccountName: { in: sourceNames },
      },
      orderBy: [{ sourceAccountName: 'asc' }, { payerContains: 'desc' }, { descriptionContains: 'desc' }],
    })

    if (allMappings.length > 0) {
      const mappingsByName = Map.groupBy(allMappings, m => m.sourceAccountName)

      for (const r of rows) {
        const key = r.accountName
        if (idMap.has(key)) continue

        const candidates = mappingsByName.get(key)
        if (!candidates || candidates.length === 0) {
          idMap.set(key, null)
          continue
        }

        let best: string | null = null
        let bestScore = -1
        for (const m of candidates) {
          // 带条件的规则必须条件全部命中才参与匹配,避免同账户名多条规则时条件未命中的记录被误映射;无条件规则作兜底
          if (m.payerContains && !(r.payer && testMatch(m.payerContains, r.payer))) continue
          if (m.descriptionContains && !(r.remark && testMatch(m.descriptionContains, r.remark))) continue
          let score = 0
          if (m.payerContains) score += 1
          if (m.descriptionContains) score += 1
          if (score > bestScore) {
            bestScore = score
            best = m.targetAccountName
          }
        }

        if (best) {
          const result = matchAccountByName(best, allAccounts)
          if (result.matched) {
            idMap.set(key, result.id)
            nameRecord[key] = result.name
          } else {
            idMap.set(key, null)
          }
        } else {
          idMap.set(key, null)
        }
      }
    }
  }

  // AI 账户映射覆盖/补充（AI 优先于 DB，按 sourceAccountName 覆盖）
  const newAccountCreations: { sourceAccountName: string; name: string; type: string }[] = []
  if (aiResolutions?.length) {
    for (const ar of aiResolutions) {
      if (ar.action === 'existing' && ar.targetAccountId) {
        idMap.set(ar.sourceAccountName, ar.targetAccountId)
        const acc = allAccounts.find(a => a.id === ar.targetAccountId)
        if (acc) nameRecord[ar.sourceAccountName] = acc.name
      } else if (ar.action === 'create' && ar.targetAccountName && ar.accountType) {
        const matched = matchAccountByName(ar.targetAccountName, allAccounts)
        if (matched.matched) {
          idMap.set(ar.sourceAccountName, matched.id)
          nameRecord[ar.sourceAccountName] = matched.name
        } else {
          newAccountCreations.push({ sourceAccountName: ar.sourceAccountName, name: ar.targetAccountName, type: ar.accountType })
        }
      }
    }
  }

  return { idMap, nameRecord, newAccountCreations }
}

// ======================== 分类映射 ========================

/** 映射条目（DB 和 AI 统一结构） */
interface MappingEntry {
  sourceCategory: string
  recordType: string
  payerContains: string
  descriptionContains: string
  targetCategoryCode: string
}

/** AI 分类映射参数 */
export interface AICategoryResolution {
  sourceCategory: string
  targetCategoryCode: string
  recordType?: string
  payerContains?: string
  descriptionContains?: string
}

/** 加载导入分类映射并按评分匹配。aiResolutions 按唯一键覆盖/补充 DB 规则（不写 DB） */
export async function applyCategoryMappings(
  source: string,
  rows: ParsedRow[],
  aiResolutions?: AICategoryResolution[],
) {
  const sourceCategories = [...new Set(rows.map(r => r.categoryCode).filter(Boolean))] as string[]
  if (sourceCategories.length === 0) return { unmatched: [] as UnmatchedCategory[], allDictItems: [] as { code: string; label: string; group: string }[] }

  const allTypes = [...new Set(rows.map(r => r.type))]

  // 加载 DB 映射
  const dbMappings = await prisma.importCategoryMapping.findMany({
    where: {
      source,
      sourceCategory: { in: sourceCategories },
      OR: [
        { recordType: '' },
        { recordType: { in: allTypes } },
      ],
    },
    orderBy: [{ sourceCategory: 'asc' }, { payerContains: 'desc' }, { descriptionContains: 'desc' }],
  })

  // DB 映射 → 统一 MappingEntry
  const allMappings: MappingEntry[] = dbMappings.map(m => ({
    sourceCategory: m.sourceCategory,
    recordType: m.recordType,
    payerContains: m.payerContains,
    descriptionContains: m.descriptionContains,
    targetCategoryCode: m.targetCategoryCode,
  }))

  // AI 映射覆盖/补充（唯一键：sourceCategory + recordType + payerContains + descriptionContains）
  if (aiResolutions?.length) {
    const merged = new Map<string, MappingEntry>()
    for (const cr of aiResolutions) {
      const entry: MappingEntry = {
        sourceCategory: cr.sourceCategory,
        recordType: cr.recordType || '',
        payerContains: cr.payerContains || '',
        descriptionContains: cr.descriptionContains || '',
        targetCategoryCode: cr.targetCategoryCode,
      }
      merged.set(`${entry.sourceCategory}::${entry.recordType}::${entry.payerContains}::${entry.descriptionContains}`, entry)
    }
    for (const m of allMappings) {
      const key = `${m.sourceCategory}::${m.recordType}::${m.payerContains}::${m.descriptionContains}`
      if (!merged.has(key)) merged.set(key, m)
    }
    allMappings.length = 0
    allMappings.push(...merged.values())
  }

  // 按 sourceCategory 分组
  const mappingsByCat = Map.groupBy(allMappings, m => m.sourceCategory)

  const allDictItems = await prisma.dictionary.findMany({
    where: { group: { in: ['transaction_category_income', 'transaction_category_expense', 'transaction_category_transfer'] } },
    select: { code: true, label: true, group: true },
  })
  const expenseCodes = new Set(allDictItems.filter(d => d.group === 'transaction_category_expense').map(d => d.code))
  const incomeCodes = new Set(allDictItems.filter(d => d.group === 'transaction_category_income').map(d => d.code))
  const transferCodes = new Set(allDictItems.filter(d => d.group === 'transaction_category_transfer').map(d => d.code))

  // 收集每个分类出现的记录类型
  const categoryTypes = new Map<string, Set<string>>()
  // 收集仍有未匹配记录的分类
  const categoriesWithUnmatched = new Set<string>()
  for (const r of rows) {
    if (!r.categoryCode) continue
    const types = categoryTypes.get(r.categoryCode) || new Set()
    types.add(r.type)
    categoryTypes.set(r.categoryCode, types)

    if (r.categoryCode && r.mappedCategoryCode === null) {
      r.mappedCategoryCode = findBestMapping(r)
    }
    if (r.categoryCode && r.mappedCategoryCode === null) {
      categoriesWithUnmatched.add(r.categoryCode)
    }
  }

  const unmatched: UnmatchedCategory[] = []
  const seen = new Set<string>()

  for (const cat of sourceCategories) {
    if (!categoriesWithUnmatched.has(cat)) continue
    if (seen.has(cat)) continue
    seen.add(cat)

    let matched: string | null = null
    // 按该分类出现的记录类型,在对应类型字典中做包含匹配(收入分类不再只按支出字典建议)
    const types = categoryTypes.get(cat) || new Set<string>()
    const codeSets: Set<string>[] = []
    if (types.has('EXPENSE')) codeSets.push(expenseCodes)
    if (types.has('INCOME')) codeSets.push(incomeCodes)
    if (types.has('TRANSFER')) codeSets.push(transferCodes)
    if (codeSets.length === 0) codeSets.push(expenseCodes, incomeCodes)
    for (const codes of codeSets) {
      for (const code of codes) {
        if (cat.includes(code) || code.includes(cat)) {
          matched = code
          break
        }
      }
      if (matched) break
    }
    unmatched.push({ sourceCategory: cat, suggestedCode: matched, types: [...(categoryTypes.get(cat) || [])] })
  }


  // 评分匹配
  function findBestMapping(row: ParsedRow): string | null {
    const candidates = mappingsByCat.get(row.categoryCode!)
    if (!candidates || candidates.length === 0) return null

    let best: string | null = null
    let bestScore = -1

    for (const m of candidates) {
      if (m.recordType && m.recordType !== row.type) continue
      // 带条件的规则必须条件全部命中才参与匹配(与前端确认阶段语义一致);无条件规则作兜底
      if (m.payerContains && !(row.payer && testMatch(m.payerContains, row.payer))) continue
      if (m.descriptionContains && !(row.remark && testMatch(m.descriptionContains, row.remark))) continue
      let score = 0
      if (m.recordType === row.type) score += 1
      if (m.payerContains) score += 1
      if (m.descriptionContains) score += 1
      if (score > bestScore) {
        bestScore = score
        best = m.targetCategoryCode
      }
    }

    return best
  }

  return { unmatched, allDictItems: allDictItems.map(d => ({ code: d.code, label: d.label, group: d.group })) }
}

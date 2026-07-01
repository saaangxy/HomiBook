import { prisma } from '../../app.js'

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
}

export interface UnmatchedCategory {
  sourceCategory: string
  suggestedCode: string | null
  types: string[]
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

/** 按名称包含匹配已有账户（优先级：精确 → 账户名包含目标名 → 目标名包含账户名） */
export function matchAccountByName(name: string, allAccounts: { id: string; name: string }[]): AccountMatchResult {
  if (!name || allAccounts.length === 0) return { matched: false, ambiguous: false }

  // 1. 精确匹配
  const exact = allAccounts.filter(acc => acc.name === name)
  if (exact.length === 1) return { matched: true, id: exact[0].id, name: exact[0].name }
  if (exact.length > 1) return { matched: false, ambiguous: true, candidates: exact }

  // 2. 账户名包含目标名
  const contains = allAccounts.filter(acc => acc.name.includes(name))
  if (contains.length === 1) return { matched: true, id: contains[0].id, name: contains[0].name }
  if (contains.length > 1) return { matched: false, ambiguous: true, candidates: contains }

  // 3. 目标名包含账户名
  const containedBy = allAccounts.filter(acc => name.includes(acc.name))
  if (containedBy.length === 1) return { matched: true, id: containedBy[0].id, name: containedBy[0].name }
  if (containedBy.length > 1) return { matched: false, ambiguous: true, candidates: containedBy }

  return { matched: false, ambiguous: false }
}

// ======================== 账户映射 ========================

/** 加载导入账户映射并按评分匹配 */
export async function applyAccountMappings(source: string, rows: ParsedRow[], bookId: string) {
  const sourceNames = [...new Set(rows.map(r => r.accountName).filter(Boolean))]
  if (sourceNames.length === 0) return { idMap: new Map<string, string | null>(), nameRecord: {} as Record<string, string> }

  const allMappings = await prisma.importAccountMapping.findMany({
    where: {
      source,
      sourceAccountName: { in: sourceNames },
    },
    orderBy: [{ sourceAccountName: 'asc' }, { payerContains: 'desc' }, { descriptionContains: 'desc' }],
  })

  if (allMappings.length === 0) return { idMap: new Map<string, string | null>(), nameRecord: {} as Record<string, string> }

  const mappingsByName = new Map<string, typeof allMappings>()
  for (const m of allMappings) {
    const list = mappingsByName.get(m.sourceAccountName) || []
    list.push(m)
    mappingsByName.set(m.sourceAccountName, list)
  }

  const allAccounts = await prisma.account.findMany({
    where: { accountBookId: bookId, status: 'ACTIVE' },
    select: { id: true, name: true },
  })

  const idMap = new Map<string, string | null>()
  const nameRecord: Record<string, string> = {}

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
      let score = 0
      if (m.payerContains) {
        if (r.payer && r.payer.includes(m.payerContains)) score += 2
        else continue
      }
      if (m.descriptionContains) {
        if (r.remark && r.remark.includes(m.descriptionContains)) score += 1
        else continue
      }
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

  return { idMap, nameRecord }
}

// ======================== 分类映射 ========================

/** 加载导入分类映射并按评分匹配 */
export async function applyCategoryMappings(source: string, rows: ParsedRow[]) {
  const sourceCategories = [...new Set(rows.map(r => r.categoryCode).filter(Boolean))] as string[]
  if (sourceCategories.length === 0) return { unmatched: [] as UnmatchedCategory[], allDictItems: [] as { code: string; label: string; group: string }[] }

  const allTypes = [...new Set(rows.map(r => r.type))]

  const allMappings = await prisma.importCategoryMapping.findMany({
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

  const mappingsByCat = new Map<string, typeof allMappings>()
  for (const m of allMappings) {
    const list = mappingsByCat.get(m.sourceCategory) || []
    list.push(m)
    mappingsByCat.set(m.sourceCategory, list)
  }

  const allDictItems = await prisma.dictionary.findMany({
    where: { group: { in: ['transaction_category_income', 'transaction_category_expense', 'transaction_category_transfer'] } },
    select: { code: true, label: true, group: true },
  })
  const expenseCodes = new Set(allDictItems.filter(d => d.group === 'transaction_category_expense').map(d => d.code))

  // 评分匹配
  function findBestMapping(row: ParsedRow): string | null {
    const candidates = mappingsByCat.get(row.categoryCode!)
    if (!candidates || candidates.length === 0) return null

    let best: string | null = null
    let bestScore = -1

    for (const m of candidates) {
      if (m.recordType && m.recordType !== row.type) continue
      let score = 0
      if (m.recordType === row.type) score += 1
      if (m.payerContains) {
        if (row.payer && row.payer.includes(m.payerContains)) score += 2
        else continue
      }
      if (m.descriptionContains) {
        if (row.remark && row.remark.includes(m.descriptionContains)) score += 1
        else continue
      }
      if (score > bestScore) {
        bestScore = score
        best = m.targetCategoryCode
      }
    }

    return best
  }

  // 收集每个分类出现的记录类型
  const categoryTypes = new Map<string, Set<string>>()
  for (const r of rows) {
    if (!r.categoryCode) continue
    const types = categoryTypes.get(r.categoryCode) || new Set()
    types.add(r.type)
    categoryTypes.set(r.categoryCode, types)
  }

  for (const r of rows) {
    if (r.categoryCode) {
      r.mappedCategoryCode = findBestMapping(r)
    }
  }

  // 收集仍有未匹配记录的分类
  const categoriesWithUnmatched = new Set<string>()
  for (const r of rows) {
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
    for (const code of expenseCodes) {
      if (cat.includes(code) || code.includes(cat)) {
        matched = code
        break
      }
    }
    unmatched.push({ sourceCategory: cat, suggestedCode: matched, types: [...(categoryTypes.get(cat) || [])] })
  }

  return { unmatched, allDictItems: allDictItems.map(d => ({ code: d.code, label: d.label, group: d.group })) }
}

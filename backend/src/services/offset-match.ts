/**
 * 平账配对算法(纯函数,不碰 DB,便于单测)。
 *
 * 语义:把「购物支出 + 退款收入」这类**金额相等、方向相反**的流水配成组,
 * 用户确认后整组标记为已平账 —— 两边都不再计入收支统计,总额不再虚高。
 *
 * 规则:
 *   · 硬条件:一收一支、金额相等
 *   · 单侧拆:每笔收入可对 N 笔支出,或每笔支出可对 N 笔收入(默认 N≤5)
 *   · 优先全局 1:1,剩余流水再尝试多笔组合
 *   · 一笔流水只进一个组;锚点按时间顺序占用,先到先得
 */

import { textSimilarity } from './text-similarity.js'

export interface OffsetRow {
  id: string
  type: string
  amount: number
  /** ISO 日期 */
  date: string
  accountId: string
  ownerId: string
  /** 备注/交易方:仅用于优先配对(同额巧合时,备注相关的排在前面) */
  remark?: string | null
}

export interface OffsetGroup {
  /** 组内 id 排序后拼接,前端勾选用 */
  key: string
  /** 组内收入合计(等于支出合计) */
  amount: number
  income: OffsetRow[]
  expense: OffsetRow[]
  /** 组内最早与最晚相差天数 */
  spanDays: number
}

export interface OffsetMatchOptions {
  /** 组内时间跨度上限(天);null = 不限 */
  windowDays?: number | null
  /** 只配对同一账户 */
  sameAccount?: boolean
  /** 只配对同一归属人 */
  sameOwner?: boolean
  /**
   * 备注相似度阈值(0~1)。<=0 表示不启用。
   *
   * 只比较「收入侧 ↔ 支出侧」的最佳一对(合并退款时多笔支出可能各不相同,
   * 用组内两两最小相似度会把真实组合挡掉)。启用后低于阈值的组合不会成组。
   */
  minRemarkSimilarity?: number
  /** 单侧最多拆几笔 */
  maxSplit?: number
  /** 同额桶参与组合的候选上限(防子集和爆炸) */
  maxCandidatesPerAmount?: number
  /** 返回组数上限 */
  maxGroups?: number
}

const DEFAULT_MAX_SPLIT = 5
const DEFAULT_MAX_CANDIDATES = 20
const DEFAULT_MAX_GROUPS = 200

const cents = (v: number) => Math.round(v * 100)
const round2 = (v: number) => Math.round(v * 100) / 100
const dayMs = 86_400_000
const daysBetween = (a: string, b: string) =>
  Math.abs((new Date(a).getTime() - new Date(b).getTime()) / dayMs)

interface Guard {
  windowDays: number | null
  sameAccount: boolean
  sameOwner: boolean
}

/** 收入侧与支出侧的最佳备注相似度(跨侧两两比较,不比较同侧) */
function bestCrossSimilarity(income: OffsetRow[], expense: OffsetRow[]): number {
  let best = 0
  for (const i of income) {
    for (const e of expense) {
      const s = textSimilarity(i.remark, e.remark)
      if (s > best) best = s
      if (best >= 1) return 1
    }
  }
  return best
}

function compatible(rows: OffsetRow[], g: Guard): boolean {
  if (g.sameAccount && new Set(rows.map((r) => r.accountId)).size > 1) return false
  if (g.sameOwner && new Set(rows.map((r) => r.ownerId)).size > 1) return false
  if (g.windowDays != null) {
    const times = rows.map((r) => new Date(r.date).getTime())
    if ((Math.max(...times) - Math.min(...times)) / dayMs > g.windowDays) return false
  }
  return true
}

/** 在候选里找和为 target 的子集(minCount..maxSplit 笔),找到第一组即返回 */
function findSubset(
  candidates: OffsetRow[],
  target: number,
  maxSplit: number,
  minCount = 1,
): OffsetRow[] | null {
  const sorted = [...candidates].sort((a, b) => cents(a.amount) - cents(b.amount))
  const picked: OffsetRow[] = []
  let found: OffsetRow[] | null = null

  const dfs = (start: number, sum: number) => {
    if (found || picked.length >= maxSplit) return
    if (sum === target) {
      if (picked.length >= minCount) found = [...picked]
      return
    }
    for (let i = start; i < sorted.length; i++) {
      const c = cents(sorted[i].amount)
      if (sum + c > target) break // 已按金额升序,后面只会更大
      picked.push(sorted[i])
      dfs(i + 1, sum + c)
      picked.pop()
      if (found) return
    }
  }

  dfs(0, 0)
  return found
}

export function matchOffsetGroups(
  rows: OffsetRow[],
  options: OffsetMatchOptions = {},
): { groups: OffsetGroup[]; truncated: boolean; skippedBuckets: number } {
  const maxSplit = options.maxSplit ?? DEFAULT_MAX_SPLIT
  const maxCandidates = options.maxCandidatesPerAmount ?? DEFAULT_MAX_CANDIDATES
  const maxGroups = options.maxGroups ?? DEFAULT_MAX_GROUPS
  const guard: Guard = {
    windowDays: options.windowDays ?? null,
    sameAccount: !!options.sameAccount,
    sameOwner: !!options.sameOwner,
  }
  const minSimilarity = Math.min(Math.max(options.minRemarkSimilarity ?? 0, 0), 1)

  // 转账不参与平账:它本身是账户间搬运,不是收支虚高
  const usable = rows.filter((r) => r.type === 'INCOME' || r.type === 'EXPENSE')
  const used = new Set<string>()
  const groups: OffsetGroup[] = []
  let truncated = false
  let skippedBuckets = 0

  const tryPush = (income: OffsetRow[], expense: OffsetRow[]): boolean => {
    const all = [...income, ...expense]
    if (all.some((r) => used.has(r.id))) return false
    if (!compatible(all, guard)) return false
    // 备注相似度:启用后低于阈值的组合直接不成立
    if (minSimilarity > 0 && bestCrossSimilarity(income, expense) < minSimilarity) return false
    const times = all.map((r) => new Date(r.date).getTime())
    groups.push({
      key: all.map((r) => r.id).sort().join('|'),
      amount: round2(income.reduce((s, r) => s + r.amount, 0)),
      income,
      expense,
      spanDays: Math.round((Math.max(...times) - Math.min(...times)) / dayMs),
    })
    for (const r of all) used.add(r.id)
    return true
  }

  // 按金额分桶
  const buckets = new Map<number, { income: OffsetRow[]; expense: OffsetRow[] }>()
  for (const r of usable) {
    const k = cents(r.amount)
    const b = buckets.get(k) ?? { income: [], expense: [] }
    if (r.type === 'INCOME') b.income.push(r)
    else b.expense.push(r)
    buckets.set(k, b)
  }
  const byDate = (list: OffsetRow[]) => [...list].sort((a, b) => a.date.localeCompare(b.date))

  // 第一轮:全局 1:1,取时间最接近且满足约束的
  for (const b of buckets.values()) {
    const incomes = byDate(b.income)
    for (const exp of byDate(b.expense)) {
      if (used.has(exp.id)) continue
      const ordered = incomes
        .filter((i) => !used.has(i.id))
        .sort((a, b2) => {
          // 备注越像越优先(权重远大于时间差),其次比时间接近
          const sa = -textSimilarity(a.remark, exp.remark) * 1e6 + daysBetween(a.date, exp.date)
          const sb = -textSimilarity(b2.remark, exp.remark) * 1e6 + daysBetween(b2.date, exp.date)
          return sa - sb
        })
      for (const inc of ordered) {
        if (tryPush([inc], [exp])) break
      }
    }
  }

  // 第二轮:剩余流水单侧拆 1:N
  // 必须**跨金额桶**搜索:一笔 200 的收入要对上两笔 100 的支出,两者必然不同桶
  const remaining = usable.filter((r) => !used.has(r.id))
  for (const anchor of byDate(remaining)) {
    if (used.has(anchor.id)) continue
    const target = cents(anchor.amount)
    const pool = remaining
      .filter((r) => !used.has(r.id) && r.type !== anchor.type && cents(r.amount) <= target)
      .sort((a, b) => daysBetween(a.date, anchor.date) - daysBetween(b.date, anchor.date))
      .slice(0, maxCandidates)
    if (pool.length < 2) continue

    // 1:1 在第一轮已处理过,这里只接受 2 笔以上的组合
    const picked = findSubset(pool, target, maxSplit, 2)
    if (!picked) continue
    if (anchor.type === 'EXPENSE') tryPush(picked, [anchor])
    else tryPush([anchor], picked)
  }

  if (groups.length > maxGroups) {
    truncated = true
    groups.length = maxGroups
  }

  return { groups, truncated, skippedBuckets }
}

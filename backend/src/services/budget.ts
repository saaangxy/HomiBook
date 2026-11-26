import { prisma } from '../app.js'
import { dateKey, dayEnd, dayStart } from '../lib/date-time.js'

// ---- 格式化 ----

export function parseTags(tags: string): string[] {
  try {
    const parsed = JSON.parse(tags)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

/** 标签统一去重排序后序列化，便于重复判断与稳定输出 */
export function normalizeTags(tags?: string[] | null): string {
  return JSON.stringify([...new Set((tags ?? []).map((t) => t.trim()).filter(Boolean))].sort())
}

export function mapBudget(b: any) {
  // 查询可带 owner 关系；不要把整个 owner 对象暴露给前端
  const { owner, ...rest } = b
  return {
    ...rest,
    tags: parseTags(b.tags),
    startDate: b.startDate ? (b.startDate instanceof Date ? b.startDate.toISOString() : b.startDate) : null,
    endDate: b.endDate ? (b.endDate instanceof Date ? b.endDate.toISOString() : b.endDate) : null,
    ownerName: owner ? (owner.nickname || owner.email || null) : null,
  }
}

// ---- 家庭成员维度 ----

interface BudgetOwnerCandidate {
  userId: string
  name: string
}

/** 账本可选归属人：归属人 + 成员（去重，归属人排第一） */
export async function listBudgetOwners(bookId: string): Promise<BudgetOwnerCandidate[]> {
  const book = await prisma.accountBook.findUnique({
    where: { id: bookId },
    select: {
      owner: { select: { id: true, nickname: true, email: true } },
      members: { select: { user: { select: { id: true, nickname: true, email: true } } } },
    },
  })
  if (!book) return []

  const seen = new Set<string>()
  const result: BudgetOwnerCandidate[] = []
  const push = (u: { id: string; nickname: string | null; email: string }) => {
    if (seen.has(u.id)) return
    seen.add(u.id)
    result.push({ userId: u.id, name: u.nickname || u.email })
  }
  push(book.owner)
  for (const m of book.members) push(m.user)
  return result
}

function ownerError(message: string) {
  return Object.assign(new Error(message), { statusCode: 400 })
}

/**
 * 解析并校验预算归属人：
 * - ownerId 优先，必须属于该账本
 * - 否则按 ownerName 精确匹配（昵称/邮箱，忽略大小写），重名时要求改用 ownerId
 * 返回 User.id；未指定返回 null。
 */
export async function resolveBudgetOwner(
  bookId: string,
  ownerId?: string | null,
  ownerName?: string | null,
): Promise<string | null> {
  if (!ownerId && !ownerName?.trim()) return null

  const book = await prisma.accountBook.findUnique({
    where: { id: bookId },
    select: {
      owner: { select: { id: true, nickname: true, email: true } },
      members: { select: { user: { select: { id: true, nickname: true, email: true } } } },
    },
  })
  if (!book) throw ownerError('账本不存在')

  const candidates = [book.owner, ...book.members.map((m) => m.user)]

  if (ownerId) {
    if (!candidates.some((u) => u.id === ownerId)) {
      throw ownerError('归属人不属于该账本')
    }
    return ownerId
  }

  const keyword = ownerName!.trim().toLowerCase()
  const matched = candidates.filter(
    (u) => (u.nickname || '').toLowerCase() === keyword || u.email.toLowerCase() === keyword,
  )
  if (matched.length === 0) throw ownerError(`未找到归属人：${ownerName}`)
  if (matched.length > 1) throw ownerError(`归属人「${ownerName}」有重名，请改用 ownerId 指定`)
  return matched[0].id
}

// ---- 自由预算日期筛选 ----

export function buildFreeBudgetDateFilter(startDate?: string, endDate?: string) {
  if (!startDate && !endDate) return undefined

  const sd = startDate ? new Date(startDate) : null
  const ed = endDate ? new Date(endDate) : null
  const conditions: any[] = [{ startDate: null, endDate: null }]

  if (sd && ed) {
    conditions.push(
      { startDate: { lte: ed }, endDate: { gte: sd } },
      { startDate: { lte: ed }, endDate: null },
      { startDate: null, endDate: { gte: sd } },
    )
  } else if (sd) {
    conditions.push({ endDate: { gte: sd } }, { endDate: null })
  } else if (ed) {
    conditions.push({ startDate: { lte: ed } }, { startDate: null })
  }

  return conditions
}

// ---- 实际金额计算 ----

export interface BudgetCategorySets {
  expense: Set<string>
  income: Set<string>
}

/** 一次性加载收支分类编码，供多条预算复用 */
export async function loadBudgetCategorySets(): Promise<BudgetCategorySets> {
  const [expenseDicts, incomeDicts] = await Promise.all([
    prisma.dictionary.findMany({ where: { group: 'transaction_category_expense' }, select: { code: true } }),
    prisma.dictionary.findMany({ where: { group: 'transaction_category_income' }, select: { code: true } }),
  ])
  return {
    expense: new Set(expenseDicts.map((d) => d.code)),
    income: new Set(incomeDicts.map((d) => d.code)),
  }
}

/**
 * 预算匹配流水的统一条件（维度之间 AND，项目多标签 OR）：
 * 周期 + 分类 + 标签 + 家庭成员 + 未平账。
 * 页面、AI 查询、明细筛选都应遵循同一口径。
 */
export function buildBudgetRecordWhere(
  budget: any,
  bookId: string,
  sets?: BudgetCategorySets,
): any {
  const where: any = {
    accountBookId: bookId,
    offsetAt: null,
  }

  // 周期（按业务时区本地日边界，与流水列表/统计口径一致）
  if (budget.type === 'FIXED' && Number(budget.month) > 0) {
    const year = Number(budget.year)
    const month = Number(budget.month)
    const firstDay = `${year}-${String(month).padStart(2, '0')}-01`
    const lastDay = new Date(year, month, 0).getDate()
    const lastDayKey = `${year}-${String(month).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`
    where.date = {
      gte: dayStart(firstDay),
      lte: dayEnd(lastDayKey),
    }
  } else if (budget.startDate || budget.endDate) {
    where.date = {}
    if (budget.startDate) where.date.gte = dayStart(dateKey(new Date(budget.startDate)))
    if (budget.endDate) where.date.lte = dayEnd(dateKey(new Date(budget.endDate)))
  }

  // 分类 + 收支类型
  if (budget.categoryCode) {
    where.categoryCode = budget.categoryCode
    if (sets?.expense.has(budget.categoryCode)) where.type = 'EXPENSE'
    else if (sets?.income.has(budget.categoryCode)) where.type = 'INCOME'
    else where.type = 'EXPENSE'
  } else {
    where.type = 'EXPENSE'
  }

  // 家庭成员（流水归属人）
  if (budget.ownerId) where.ownerId = budget.ownerId

  // 标签（多标签 OR）
  const tags = parseTags(budget.tags).filter((t) => t.trim())
  if (tags.length > 0) {
    where.OR = tags.map((tag) => ({ tags: { contains: tag } }))
  }

  return where
}

export async function computeActualAmount(
  budget: any,
  bookId: string,
  sets?: BudgetCategorySets,
): Promise<number> {
  const categorySets = sets ?? (await loadBudgetCategorySets())
  const agg = await prisma.record.aggregate({
    where: buildBudgetRecordWhere(budget, bookId, categorySets),
    _sum: { amount: true },
  })
  return agg._sum.amount ?? 0
}

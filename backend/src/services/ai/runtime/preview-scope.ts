import { prisma } from '../../../app.js'

/** 确认卡要展示的流水行（账户名已解出，供卡片直接拼表格） */
export interface PreviewRecordRow {
  id: string
  type: string
  amount: number
  date: Date | string
  remark: string | null
  payer: string | null
  categoryCode: string | null
  accountId: string | null
  fromAccountId: string | null
  toAccountId: string | null
  accountName?: string
  fromAccountName?: string
  toAccountName?: string
  /** 分类编码对应的展示名，由 scope 一并查出 */
  categoryLabel?: string
}

/** 固定收支行（账户名与分类名已解出，供删除/修改的确认卡直接展示） */
export interface PreviewRecurringRow {
  id: string
  name: string
  type: string
  amount: number
  cron: string
  recurringType: string
  active: boolean
  accountId: string
  toAccountId: string | null
  categoryCode: string | null
  payer: string | null
  remark: string | null
  loanTotalAmount: number | null
  loanRemainingAmount: number | null
  loanInterestMethod: string | null
  accountName?: string
  toAccountName?: string
  categoryLabel?: string
}

/** 账户行（删除/修改/调余额的确认卡要展示旧值） */
export interface PreviewAccountRow {
  id: string
  name: string
  type: string
  balance: number
  currency: string
  accountNo: string | null
  bankName: string | null
  visibility: string
  status: string
  ownerId: string | null
}

/** 预算行（删除确认卡展示原配置，复制确认卡列源月份清单） */
export interface PreviewBudgetRow {
  id: string
  name: string
  type: string
  year: number
  month: number
  amount: number
  startDate: Date | null
  endDate: Date | null
  categoryCode: string | null
  remark: string | null
  categoryLabel?: string
}

/**
 * 确认卡预览能用的查询入口。
 *
 * 只暴露四类实体的窄查询而不是裸 prisma：预览发生在用户确认之前，
 * 任何一次漏掉 accountBookId 的查询都是跨账本信息泄漏。
 * 把账本过滤收进实现里，工具作者不可能忘。
 */
export interface PreviewScope {
  record(id: string): Promise<PreviewRecordRow | null>
  records(ids: string[]): Promise<PreviewRecordRow[]>
  accountNames(ids: string[]): Promise<Map<string, string>>
  categoryLabels(codes: string[]): Promise<Map<string, string>>
  recurring(id: string): Promise<PreviewRecurringRow | null>
  account(id: string): Promise<PreviewAccountRow | null>
  budget(id: string): Promise<PreviewBudgetRow | null>
  budgetsByMonth(year: number, month: number): Promise<PreviewBudgetRow[]>
}

const RECORD_SELECT = {
  id: true,
  type: true,
  amount: true,
  date: true,
  remark: true,
  payer: true,
  categoryCode: true,
  accountId: true,
  fromAccountId: true,
  toAccountId: true,
  account: { select: { name: true } },
  fromAccount: { select: { name: true } },
  toAccount: { select: { name: true } },
} as const

type RawRecord = {
  id: string
  type: string
  amount: number
  date: Date
  remark: string | null
  payer: string | null
  categoryCode: string | null
  accountId: string | null
  fromAccountId: string | null
  toAccountId: string | null
  account?: { name: string } | null
  fromAccount?: { name: string } | null
  toAccount?: { name: string } | null
}

function toRow(r: RawRecord): PreviewRecordRow {
  return {
    id: r.id,
    type: r.type,
    amount: r.amount,
    date: r.date,
    remark: r.remark,
    payer: r.payer,
    categoryCode: r.categoryCode,
    accountId: r.accountId,
    fromAccountId: r.fromAccountId,
    toAccountId: r.toAccountId,
    accountName: r.account?.name,
    fromAccountName: r.fromAccount?.name,
    toAccountName: r.toAccount?.name,
  }
}

/** 账户名映射：优先按 id 查，其次按 accountNo 查；多归属人账本在名字后带归属人 */
export async function loadAccountNames(
  ids: string[],
  accountBookId?: string,
): Promise<Map<string, string>> {
  const unique = [...new Set(ids.filter(Boolean))]
  if (unique.length === 0) return new Map()

  const accounts = await prisma.account.findMany({
    where: {
      ...(accountBookId ? { accountBookId } : {}),
      OR: [{ id: { in: unique } }, { accountNo: { in: unique } }],
    },
    select: { id: true, name: true, accountNo: true, ownerId: true, owner: { select: { nickname: true, email: true } } },
  })

  // 多归属人账本才在名字后带归属人（与前端 accountLabel 同口径）
  const multiOwner = new Set(accounts.map((a) => a.ownerId)).size > 1
  const labelOf = (a: (typeof accounts)[number]) => {
    const ownerName = a.owner?.nickname || a.owner?.email
    return multiOwner && ownerName ? `${a.name} · ${ownerName}` : a.name
  }

  const map = new Map<string, string>()
  for (const a of accounts) {
    map.set(a.id, labelOf(a))
    if (a.accountNo) map.set(a.accountNo, labelOf(a))
  }
  return map
}

/** 分类编码 → 展示名（只查三个 transaction_category_* 组） */
export async function loadCategoryLabels(codes: string[]): Promise<Map<string, string>> {
  const unique = [...new Set(codes.filter(Boolean))]
  if (unique.length === 0) return new Map()

  const dicts = await prisma.dictionary.findMany({
    where: {
      group: { in: ['transaction_category_income', 'transaction_category_expense', 'transaction_category_transfer'] },
      code: { in: unique },
    },
    select: { code: true, label: true },
  })
  return new Map(dicts.map((d) => [d.code, d.label]))
}

/**
 * 绑定当前账本的预览入口。所有查询自带 accountBookId 过滤，
 * 记录不存在或属于别的账本时一律返回 null —— 预览阶段也不会泄露他账本数据。
 */
export function createPreviewScope(accountBookId: string): PreviewScope {
  return {
    async record(id) {
      if (!id) return null
      const row = await prisma.record.findFirst({
        where: { id, accountBookId },
        select: RECORD_SELECT,
      })
      if (!row) return null
      const base = toRow(row as RawRecord)
      const labels = await loadCategoryLabels([base.categoryCode ?? ''])
      return { ...base, categoryLabel: labels.get(base.categoryCode ?? '') }
    },

    async records(ids) {
      const unique = [...new Set(ids.filter(Boolean))]
      if (unique.length === 0) return []
      const rows = await prisma.record.findMany({
        where: { id: { in: unique }, accountBookId },
        select: RECORD_SELECT,
        orderBy: { date: 'desc' },
      })
      const bases = rows.map((r) => toRow(r as RawRecord))
      const labels = await loadCategoryLabels(bases.map((b) => b.categoryCode ?? ''))
      return bases.map((b) => ({ ...b, categoryLabel: labels.get(b.categoryCode ?? '') }))
    },

    accountNames(ids) {
      return loadAccountNames(ids, accountBookId)
    },

    categoryLabels(codes) {
      return loadCategoryLabels(codes)
    },

    async recurring(id) {
      if (!id) return null
      const rt = await prisma.recurringTransaction.findFirst({
        where: { id, accountBookId },
        include: {
          account: { select: { name: true } },
          toAccount: { select: { name: true } },
        },
      })
      if (!rt) return null
      const labels = rt.categoryCode ? await loadCategoryLabels([rt.categoryCode]) : new Map<string, string>()
      return {
        id: rt.id,
        name: rt.name,
        type: rt.type,
        amount: rt.amount,
        cron: rt.cron,
        recurringType: rt.recurringType,
        active: rt.active,
        accountId: rt.accountId,
        toAccountId: rt.toAccountId,
        categoryCode: rt.categoryCode,
        payer: rt.payer,
        remark: rt.remark,
        loanTotalAmount: rt.loanTotalAmount,
        loanRemainingAmount: rt.loanRemainingAmount,
        loanInterestMethod: rt.loanInterestMethod,
        accountName: rt.account?.name,
        toAccountName: rt.toAccount?.name,
        categoryLabel: rt.categoryCode ? labels.get(rt.categoryCode) : undefined,
      }
    },

    async account(id) {
      if (!id) return null
      return prisma.account.findFirst({
        where: { id, accountBookId },
        select: {
          id: true,
          name: true,
          type: true,
          balance: true,
          currency: true,
          accountNo: true,
          bankName: true,
          visibility: true,
          status: true,
          ownerId: true,
        },
      })
    },

    async budget(id) {
      if (!id) return null
      const b = await prisma.budget.findFirst({ where: { id, accountBookId } })
      if (!b) return null
      const labels = b.categoryCode ? await loadCategoryLabels([b.categoryCode]) : new Map<string, string>()
      return { ...b, categoryLabel: b.categoryCode ? labels.get(b.categoryCode) : undefined }
    },

    async budgetsByMonth(year, month) {
      const rows = await prisma.budget.findMany({ where: { accountBookId, year, month } })
      const labels = await loadCategoryLabels(rows.map((r) => r.categoryCode ?? ''))
      return rows.map((r) => ({ ...r, categoryLabel: labels.get(r.categoryCode ?? '') }))
    },
  }
}

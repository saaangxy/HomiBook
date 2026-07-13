import { prisma } from '../app.js'

/** 检查用户是否有权限管理指定账户 */
export async function assertCanManageAccount(accountId: string, userId: string) {
  const account = await prisma.account.findUnique({ where: { id: accountId } })
  if (!account) {
    throw Object.assign(new Error('账户不存在'), { statusCode: 404 })
  }
  if (account.ownerId === userId) return account

  const book = await prisma.accountBook.findUnique({ where: { id: account.accountBookId } })
  if (book?.ownerId === userId) return account

  const member = await prisma.accountBookMember.findUnique({
    where: { accountBookId_userId: { accountBookId: account.accountBookId, userId } },
  })
  if (member?.role === 'admin') return account

  throw Object.assign(new Error('无权管理该账户'), { statusCode: 403 })
}

/** 对非公开账户脱敏 */
export function sanitizeAccount(account: Record<string, unknown>, userId: string) {
  if (account.visibility === 'PRIVATE' && account.ownerId !== userId) {
    return {
      ...account,
      balance: undefined,
      initialBalance: undefined,
      balanceAt: undefined,
      computedBalance: undefined,
      accountNo: null,
    }
  }
  return account
}

/** 计算账户实时余额（以最近一次余额调整为基准，叠加后续流水） */
export async function computeAccountBalance(accountId: string) {
  const account = await prisma.account.findUnique({ where: { id: accountId } })
  if (!account) throw Object.assign(new Error('账户不存在'), { statusCode: 404 })

  const latestAdjustment = await prisma.balanceAdjustment.findFirst({
    where: { accountId },
    orderBy: { date: 'desc' },
  })

  const baseBalance = latestAdjustment?.balanceAfter ?? account.initialBalance ?? 0
  const baseDate = latestAdjustment?.date ?? null

  const dateFilter = baseDate ? { gt: baseDate } : undefined

  const [incomeAgg, expenseAgg, transferOutAgg, transferInAgg] = await Promise.all([
    prisma.record.aggregate({ where: { accountId, type: 'INCOME', ...(dateFilter ? { date: dateFilter } : {}) }, _sum: { amount: true } }),
    prisma.record.aggregate({ where: { accountId, type: 'EXPENSE', ...(dateFilter ? { date: dateFilter } : {}) }, _sum: { amount: true } }),
    prisma.record.aggregate({ where: { fromAccountId: accountId, type: 'TRANSFER', ...(dateFilter ? { date: dateFilter } : {}) }, _sum: { amount: true } }),
    prisma.record.aggregate({ where: { toAccountId: accountId, type: 'TRANSFER', ...(dateFilter ? { date: dateFilter } : {}) }, _sum: { amount: true } }),
  ])

  const income = incomeAgg._sum.amount ?? 0
  const expense = expenseAgg._sum.amount ?? 0
  const transferOut = transferOutAgg._sum.amount ?? 0
  const transferIn = transferInAgg._sum.amount ?? 0

  return baseBalance + income - expense + transferIn - transferOut
}

/** 刷新账户余额并写入数据库 */
export async function refreshAccountBalance(accountId: string) {
  const balance = await computeAccountBalance(accountId)
  const latestAdjustment = await prisma.balanceAdjustment.findFirst({
    where: { accountId },
    orderBy: { date: 'desc' },
  })
  await prisma.account.update({
    where: { id: accountId },
    data: { balance, balanceAt: latestAdjustment?.date ?? null },
  })
}

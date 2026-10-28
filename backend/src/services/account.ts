import { prisma } from '../app.js'
import { computeBalance } from './record.js'

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

/**
 * 计算账户实时余额（以最近一次余额调整为基准，叠加后续流水）。
 *
 * 与 services/record.ts 的 computeBalance 必须是**同一份实现**：
 * 这里曾单独抄过一遍且日期过滤用的是 `gt: baseDate`（没有对齐到本地日 0 点），
 * 于是「账户列表」与「流水页」在同一账户上会给出不同的余额。
 */
export async function computeAccountBalance(accountId: string) {
  const { balance } = await computeBalance(accountId)
  return balance
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

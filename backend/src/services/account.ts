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

/**
 * 账户关联的流水数。
 *
 * 流水对账户有三个引用字段:普通收支的 accountId、转账的 fromAccountId(转出)与
 * toAccountId(转入)。任一有值都算「这个账户下还有流水」,删账户前必须一起检查,
 * 否则只查 accountId 会漏掉「只作为转入方」的账户。
 */
export async function countAccountRecords(accountId: string): Promise<number> {
  return prisma.record.count({
    where: {
      OR: [
        { accountId },
        { fromAccountId: accountId },
        { toAccountId: accountId },
      ],
    },
  })
}

/**
 * 删除账户前的守卫:**有流水就不允许删除**。
 *
 * 账户删掉后,这些流水会指向一个已删除的账户:记录列表/统计/余额都对不上,
 * 也再没有入口能修正它们。手动删除与 AI 的 delete_account 共用这一道校验。
 */
export async function assertAccountDeletable(accountId: string): Promise<void> {
  const count = await countAccountRecords(accountId)
  if (count > 0) {
    throw Object.assign(
      new Error(`该账户下还有 ${count} 条流水（收入/支出/转账），无法删除`),
      { statusCode: 400 },
    )
  }
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

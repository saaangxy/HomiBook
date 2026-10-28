/**
 * 账户余额的纯计算部分(不依赖 Prisma)。
 *
 * 抽出来的目的:让「单元测试」和「对账脚本」复用同一份公式,
 * 避免测试里另写一套算法、测了个寂寞。
 *
 * 口径:
 *   balance = 基准余额(上次余额调整 / 期初) + 收入 − 支出 + 转入 − 转出
 *
 * 转账字段语义:
 *   - accountId 与 fromAccountId 都指向**转出方**(实测数据库里两者恒等)
 *   - toAccountId 指向**转入方**
 *   - 同账户转账(转出 === 转入)两侧各算一次,净额为 0
 */

export interface BalanceSums {
  income: number
  expense: number
  transferIn: number
  transferOut: number
}

export const EMPTY_SUMS: BalanceSums = { income: 0, expense: 0, transferIn: 0, transferOut: 0 }

/** 金额保留两位(对账时避免 0.1+0.2 这类浮点尾差) */
export function roundMoney(v: number): number {
  return Math.round(v * 100) / 100
}

/** 由基准余额与四项汇总算出余额 */
export function computeBalanceValue(baseBalance: number, sums: BalanceSums): number {
  return roundMoney(baseBalance + sums.income - sums.expense + sums.transferIn - sums.transferOut)
}

export interface BalanceRecordLike {
  type: string
  amount: number
  accountId?: string | null
  fromAccountId?: string | null
  toAccountId?: string | null
}

/**
 * 单条流水对某个账户的净额影响。
 * 转账两侧独立判断(不能用 else-if 互斥,否则同账户转账只会算到转出那一侧)。
 */
export function recordDeltaForAccount(r: BalanceRecordLike, accountId: string): number {
  if (r.type === 'TRANSFER') {
    let delta = 0
    if (r.fromAccountId === accountId) delta -= r.amount
    if (r.toAccountId === accountId) delta += r.amount
    return delta
  }
  if (r.accountId === accountId) {
    if (r.type === 'INCOME') return r.amount
    if (r.type === 'EXPENSE') return -r.amount
  }
  return 0
}

/** 一组流水对某账户的净额(对账脚本用,等价于一笔笔累加) */
export function sumDeltasForAccount(records: BalanceRecordLike[], accountId: string): number {
  return roundMoney(records.reduce((sum, r) => sum + recordDeltaForAccount(r, accountId), 0))
}

/**
 * 一组流水 → 四项汇总(对账脚本与 computeBalanceValue 共用)。
 *
 * 用函数推导而不是手写四项:手写时很容易只填 `transferOut` 忘了 `transferIn`,
 * 同账户转账就会被算成净减少 —— 这正是余额曲线出过的错。
 */
export function sumsForAccount(records: BalanceRecordLike[], accountId: string): BalanceSums {
  const sums: BalanceSums = { ...EMPTY_SUMS }
  for (const r of records) {
    if (r.type === 'TRANSFER') {
      if (r.fromAccountId === accountId) sums.transferOut += r.amount
      if (r.toAccountId === accountId) sums.transferIn += r.amount
    } else if (r.accountId === accountId) {
      if (r.type === 'INCOME') sums.income += r.amount
      if (r.type === 'EXPENSE') sums.expense += r.amount
    }
  }
  return sums
}

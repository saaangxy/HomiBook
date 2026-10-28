import { describe, expect, it } from 'vitest'
import {
  computeBalanceValue,
  recordDeltaForAccount,
  roundMoney,
  sumDeltasForAccount,
  sumsForAccount,
  type BalanceRecordLike,
} from './balance.js'

// 账户 id 简写,便于阅读用例
const A = 'acc-A'
const B = 'acc-B'

const income = (accountId: string, amount: number): BalanceRecordLike =>
  ({ type: 'INCOME', amount, accountId })
const expense = (accountId: string, amount: number): BalanceRecordLike =>
  ({ type: 'EXPENSE', amount, accountId })
const transfer = (from: string, to: string | null, amount: number): BalanceRecordLike =>
  ({ type: 'TRANSFER', amount, accountId: from, fromAccountId: from, toAccountId: to })

describe('computeBalanceValue', () => {
  it('只有收支时期初余额正确叠加', () => {
    expect(computeBalanceValue(1000, { income: 200, expense: 50, transferIn: 0, transferOut: 0 })).toBe(1150)
  })

  it('转账两侧分别增减', () => {
    // A 转出 300、B 转入 300
    expect(computeBalanceValue(1000, { income: 0, expense: 0, transferIn: 0, transferOut: 300 })).toBe(700)
    expect(computeBalanceValue(0, { income: 0, expense: 0, transferIn: 300, transferOut: 0 })).toBe(300)
  })

  it('同账户转账净额为 0', () => {
    expect(computeBalanceValue(1000, { income: 0, expense: 0, transferIn: 400, transferOut: 400 })).toBe(1000)
  })

  it('浮点尾差收敛到分', () => {
    expect(computeBalanceValue(0, { income: 0.1, expense: 0.2, transferIn: 0, transferOut: 0 })).toBe(-0.1)
    expect(roundMoney(0.1 + 0.2)).toBe(0.3)
  })
})

describe('recordDeltaForAccount', () => {
  it('收入 / 支出只影响本账户', () => {
    expect(recordDeltaForAccount(income(A, 100), A)).toBe(100)
    expect(recordDeltaForAccount(expense(A, 30), A)).toBe(-30)
    expect(recordDeltaForAccount(income(A, 100), B)).toBe(0)
  })

  it('转账:转出方减、转入方加', () => {
    const t = transfer(A, B, 500)
    expect(recordDeltaForAccount(t, A)).toBe(-500)
    expect(recordDeltaForAccount(t, B)).toBe(500)
  })

  it('同账户转账正负抵消', () => {
    const t = transfer(A, A, 260)
    expect(recordDeltaForAccount(t, A)).toBe(0)
  })

  it('缺转入账户的转账:只扣不加(属于数据缺陷,必须能被测出来)', () => {
    const broken = transfer(A, null, 99)
    expect(recordDeltaForAccount(broken, A)).toBe(-99)
    // 没有任何账户会因为这条记录增加,资金凭空消失
    expect(recordDeltaForAccount(broken, B)).toBe(0)
  })
})

describe('sumDeltasForAccount / 全账本对账', () => {
  const records: BalanceRecordLike[] = [
    income(A, 1000),
    expense(A, 120),
    transfer(A, B, 300),      // A → B
    transfer(B, A, 50),       // B → A(反向)
    transfer(A, A, 70),       // 同账户转账(合并账户后的形态)
    income(B, 20),
  ]

  it('逐笔累加与公式结果一致', () => {
    expect(sumDeltasForAccount(records, A)).toBe(1000 - 120 - 300 + 50 + 0)
    expect(sumDeltasForAccount(records, B)).toBe(300 - 50 + 20)
  })

  it('转账在账户之间抵消:各账户净额之和 = 非转账净额', () => {
    const total = sumDeltasForAccount(records, A) + sumDeltasForAccount(records, B)
    const nonTransfer = roundMoney(1000 - 120 + 20)
    expect(total).toBe(nonTransfer)
  })

  it('对账恒等式:期初合计 + 各账户净额 = 各账户余额合计', () => {
    const initialA = 500
    const initialB = 0
    // 用 sumsForAccount 推导,避免手写四项时漏掉同账户转账的转入侧
    const balanceA = computeBalanceValue(initialA, sumsForAccount(records, A))
    const balanceB = computeBalanceValue(initialB, sumsForAccount(records, B))
    expect(roundMoney(balanceA + balanceB)).toBe(roundMoney(initialA + initialB + sumDeltasForAccount(records, A) + sumDeltasForAccount(records, B)))
  })

  it('同账户转账:四项汇总里两侧都必须出现,否则余额会被算少', () => {
    const sums = sumsForAccount(records, A)
    expect(sums.transferOut).toBe(300 + 70)
    expect(sums.transferIn).toBe(50 + 70)
    // 净额 = −300(A→B) + 50(B→A) + 0(自转) = −250
    expect(roundMoney(sums.transferIn - sums.transferOut)).toBe(-250)
  })

  it('存在缺转入账户的转账时,账本净额不再守恒(用于检测脏数据)', () => {
    const dirty = [...records, transfer(A, null, 80)]
    const total = sumDeltasForAccount(dirty, A) + sumDeltasForAccount(dirty, B)
    const nonTransfer = roundMoney(1000 - 120 + 20)
    expect(total).toBe(roundMoney(nonTransfer - 80)) // 少了 80,说明有笔转账只在转出方记账
    expect(total).not.toBe(nonTransfer)
  })
})

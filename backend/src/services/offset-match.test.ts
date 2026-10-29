import { describe, expect, it } from 'vitest'
import { matchGroupsForAnchor, matchOffsetGroups, type OffsetRow } from './offset-match.js'

const row = (
  id: string,
  type: 'INCOME' | 'EXPENSE',
  amount: number,
  date: string,
  accountId = 'acc-1',
  ownerId = 'user-1',
  remark = '',
): OffsetRow => ({ id, type, amount, date, accountId, ownerId, remark })

const ids = (g: { income: OffsetRow[]; expense: OffsetRow[] }) =>
  [...g.income, ...g.expense].map((r) => r.id).sort()

describe('matchOffsetGroups', () => {
  it('同额一收一支配成一组', () => {
    const { groups } = matchOffsetGroups([
      row('e1', 'EXPENSE', 100, '2026-03-01'),
      row('i1', 'INCOME', 100, '2026-03-05'),
    ])
    expect(groups).toHaveLength(1)
    expect(ids(groups[0])).toEqual(['e1', 'i1'])
    expect(groups[0].amount).toBe(100)
    expect(groups[0].spanDays).toBe(4)
  })

  it('金额不等不配对', () => {
    const { groups } = matchOffsetGroups([
      row('e1', 'EXPENSE', 100, '2026-03-01'),
      row('i1', 'INCOME', 99.99, '2026-03-02'),
    ])
    expect(groups).toHaveLength(0)
  })

  it('超过时间窗口不成组', () => {
    const records = [
      row('e1', 'EXPENSE', 100, '2026-01-01'),
      row('i1', 'INCOME', 100, '2026-06-01'),
    ]
    expect(matchOffsetGroups(records, { windowDays: 90 }).groups).toHaveLength(0)
    expect(matchOffsetGroups(records, { windowDays: null }).groups).toHaveLength(1)
  })

  it('sameAccount 时跨账户不配对', () => {
    const records = [
      row('e1', 'EXPENSE', 100, '2026-03-01', 'acc-1'),
      row('i1', 'INCOME', 100, '2026-03-02', 'acc-2'),
    ]
    expect(matchOffsetGroups(records, { sameAccount: true }).groups).toHaveLength(0)
    expect(matchOffsetGroups(records, { sameAccount: false }).groups).toHaveLength(1)
  })

  it('sameOwner 时跨归属人不配对', () => {
    const records = [
      row('e1', 'EXPENSE', 100, '2026-03-01', 'acc-1', 'u1'),
      row('i1', 'INCOME', 100, '2026-03-02', 'acc-1', 'u2'),
    ]
    expect(matchOffsetGroups(records, { sameOwner: true }).groups).toHaveLength(0)
  })

  it('单侧拆:一笔收入对两笔支出', () => {
    const { groups } = matchOffsetGroups([
      row('e1', 'EXPENSE', 100, '2026-03-01'),
      row('e2', 'EXPENSE', 100, '2026-03-02'),
      row('i1', 'INCOME', 200, '2026-03-10'),
    ])
    expect(groups).toHaveLength(1)
    expect(ids(groups[0])).toEqual(['e1', 'e2', 'i1'])
    expect(groups[0].amount).toBe(200)
  })

  it('单侧拆:一笔支出对两笔收入', () => {
    const { groups } = matchOffsetGroups([
      row('e1', 'EXPENSE', 200, '2026-03-01'),
      row('i1', 'INCOME', 60, '2026-03-05'),
      row('i2', 'INCOME', 140, '2026-03-08'),
    ])
    expect(groups).toHaveLength(1)
    expect(ids(groups[0])).toEqual(['e1', 'i1', 'i2'])
  })

  it('优先 1:1:有同额一对一时不拆', () => {
    const { groups } = matchOffsetGroups([
      row('e1', 'EXPENSE', 100, '2026-03-01'),
      row('i1', 'INCOME', 100, '2026-03-02'),
      row('e2', 'EXPENSE', 100, '2026-03-03'),
      row('e3', 'EXPENSE', 100, '2026-03-04'),
      row('i2', 'INCOME', 200, '2026-03-05'),
    ])
    // 先配 e1+i1,再让 i2 收 e2+e3
    expect(groups).toHaveLength(2)
    const sizes = groups.map((g) => g.income.length + g.expense.length).sort()
    expect(sizes).toEqual([2, 3])
  })

  it('一笔流水只进一个组', () => {
    const { groups } = matchOffsetGroups([
      row('e1', 'EXPENSE', 100, '2026-03-01'),
      row('e2', 'EXPENSE', 100, '2026-03-02'),
      row('i1', 'INCOME', 100, '2026-03-03'),
    ])
    expect(groups).toHaveLength(1)
    const all = groups.flatMap((g) => [...g.income, ...g.expense].map((r) => r.id))
    expect(new Set(all).size).toBe(all.length)
  })

  it('忽略转账', () => {
    const { groups } = matchOffsetGroups([
      { id: 't1', type: 'TRANSFER', amount: 100, date: '2026-03-01', accountId: 'a', ownerId: 'u' },
      { id: 't2', type: 'TRANSFER', amount: 100, date: '2026-03-02', accountId: 'b', ownerId: 'u' },
    ])
    expect(groups).toHaveLength(0)
  })

  it('同额多笔时,备注相关的优先配对', () => {
    const { groups } = matchOffsetGroups([
      row('e1', 'EXPENSE', 19.9, '2026-03-01', 'a', 'u', '抖音商城-除菌去垢马桶香香泡'),
      row('i1', 'INCOME', 19.9, '2026-03-02', 'a', 'u', '退款-盒马工坊土豆红肠色拉'),
      row('i2', 'INCOME', 19.9, '2026-03-12', 'a', 'u', '退款-除菌去垢马桶香香泡'),
    ])
    // 时间更近的是 i1,但备注相关的是 i2 —— 应配 i2
    expect(groups).toHaveLength(1)
    expect(ids(groups[0])).toEqual(['e1', 'i2'])
  })

  it('备注相似度阈值:启用后低相似的组合不成立', () => {
    const records = [
      row('e1', 'EXPENSE', 19.9, '2026-03-01', 'a', 'u', '抖音商城-除菌去垢马桶香香泡'),
      row('i1', 'INCOME', 19.9, '2026-03-02', 'a', 'u', '退款-盒马工坊土豆红肠色拉'),
    ]
    // 默认不启用 → 成组
    expect(matchOffsetGroups(records).groups).toHaveLength(1)
    // 阈值 0.6 → 两段文本几乎没有公共 bigram,不成组
    expect(matchOffsetGroups(records, { minRemarkSimilarity: 0.6 }).groups).toHaveLength(0)
  })

  it('备注相似度阈值:高相似仍能成组', () => {
    const records = [
      row('e1', 'EXPENSE', 100, '2026-03-01', 'a', 'u', '美团-双人餐'),
      row('i1', 'INCOME', 100, '2026-03-05', 'a', 'u', '退款-美团双人餐'),
    ]
    expect(matchOffsetGroups(records, { minRemarkSimilarity: 0.6 }).groups).toHaveLength(1)
  })

  it('组数上限生效并标记 truncated', () => {
    const records: OffsetRow[] = []
    for (let i = 0; i < 5; i++) {
      records.push(row(`e${i}`, 'EXPENSE', 100, `2026-03-0${i + 1}`))
      records.push(row(`i${i}`, 'INCOME', 100, `2026-03-1${i}`))
    }
    const { groups, truncated } = matchOffsetGroups(records, { maxGroups: 3 })
    expect(groups).toHaveLength(3)
    expect(truncated).toBe(true)
  })
})

describe('matchGroupsForAnchor', () => {
  const anchor: OffsetRow = row('a1', 'EXPENSE', 200, '2026-03-10', 'acc-1', 'u1', '京东-降噪耳机')

  it('1 笔对 1 笔', () => {
    const { groups } = matchGroupsForAnchor(anchor, [
      row('i1', 'INCOME', 200, '2026-03-12', 'acc-1', 'u1', '退款-京东降噪耳机'),
    ])
    expect(groups).toHaveLength(1)
    expect(groups[0].amount).toBe(200)
  })

  it('1 笔对 2 笔', () => {
    const { groups } = matchGroupsForAnchor(anchor, [
      row('i1', 'INCOME', 60, '2026-03-11'),
      row('i2', 'INCOME', 140, '2026-03-12'),
    ])
    expect(groups).toHaveLength(1)
    expect(ids(groups[0])).toEqual(['a1', 'i1', 'i2'])
  })

  it('每组都含锚点,且相似度高的排前面', () => {
    const { groups } = matchGroupsForAnchor(anchor, [
      row('i1', 'INCOME', 200, '2026-03-11', 'acc-1', 'u1', '退款-京东降噪耳机'),
      row('i2', 'INCOME', 200, '2026-03-11', 'acc-1', 'u1', '无关交易'),
    ])
    expect(groups).toHaveLength(2)
    expect(groups[0].income[0].id).toBe('i1')
    for (const g of groups) {
      expect([...g.income, ...g.expense].some((r) => r.id === 'a1')).toBe(true)
    }
  })

  it('超过上限截断', () => {
    const pool = Array.from({ length: 5 }, (_, i) => row(`i${i}`, 'INCOME', 100, `2026-03-1${i}`))
    const { groups, truncated } = matchGroupsForAnchor(anchor, pool, { maxGroups: 2 })
    expect(groups).toHaveLength(2)
    expect(truncated).toBe(true)
  })

  it('sameAccount 时跨账户不生成组', () => {
    const { groups } = matchGroupsForAnchor(
      anchor,
      [row('i1', 'INCOME', 200, '2026-03-11', 'acc-2')],
      { sameAccount: true },
    )
    expect(groups).toHaveLength(0)
  })

  it('超出时间跨度不生成组', () => {
    const { groups } = matchGroupsForAnchor(
      anchor,
      [row('i1', 'INCOME', 200, '2026-09-11')],
      { windowDays: 30 },
    )
    expect(groups).toHaveLength(0)
  })
})

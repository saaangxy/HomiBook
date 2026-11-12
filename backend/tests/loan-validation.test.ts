import { describe, expect, it } from 'vitest'
import { loanPreviewTool } from '../src/services/ai/tools/loan-preview.js'
import { parseStrictDay } from '../src/lib/date-time.js'

const ctx = { userId: 'u1', accountBookId: 'b1' }

const base = {
  total: 120000,
  annualRate: 4.2,
  months: 60,
  startDate: '2026-01-01',
  method: 'EQUAL_INSTALLMENT' as const,
}

const run = (patch: Partial<typeof base> = {}) =>
  loanPreviewTool.execute({ ...base, ...patch }, ctx) as Promise<{
    monthlyPayment: number
    plan: { dueDate: string }[]
  }>

describe('loan_preview 参数校验', () => {
  it('总额为 0 或负数时拒绝，而不是返回全 0 计划', async () => {
    await expect(run({ total: 0 })).rejects.toThrow('贷款总额必须大于 0')
    await expect(run({ total: -50000 })).rejects.toThrow('贷款总额必须大于 0')
  })

  it('负利率拒绝，零利率合法', async () => {
    await expect(run({ annualRate: -0.035 })).rejects.toThrow('年利率不能为负数')
    const zero = await run({ annualRate: 0 })
    // 无息：月供就是本金均摊
    expect(zero.monthlyPayment).toBeCloseTo(2000, 2)
  })

  it('期数必须是正整数', async () => {
    await expect(run({ months: 0 })).rejects.toThrow('期数必须是正整数')
    await expect(run({ months: 12.5 })).rejects.toThrow('期数必须是正整数')
  })

  it('不存在的日期拒绝，而不是静默进位', async () => {
    // 2 月没有 30 日：new Date 会进位到 3-02
    await expect(run({ startDate: '2026-02-30' })).rejects.toThrow('开始日期不存在或格式错误')
    // 13 月：new Date 是 Invalid Date，继续算会产出 NaN-NaN-NaN
    await expect(run({ startDate: '2026-13-01' })).rejects.toThrow('开始日期不存在或格式错误')
    await expect(run({ startDate: '2026/01/01' })).rejects.toThrow('开始日期不存在或格式错误')
  })

  it('非法还款方式拒绝', async () => {
    await expect(run({ method: 'EQUAL' as never })).rejects.toThrow()
  })
})

describe('loan_preview 利率口径', () => {
  it('按百分数解释：4.2 表示 4.2%', async () => {
    const r = await run({ annualRate: 4.2 })
    // 12 万 / 60 期 / 4.2%：月供约 2220.83
    expect(r.monthlyPayment).toBeCloseTo(2220.83, 1)
  })

  it('低息贷款可填：0.042 按 0.042% 算，0.5 按 0.5% 算', async () => {
    const decimal = await run({ annualRate: 0.042 })
    // 0.042% 几乎无息，月供接近本金均摊
    expect(decimal.monthlyPayment).toBeCloseTo(2002.14, 1)

    const lowRate = await run({ annualRate: 0.5 })
    const normal = await run({ annualRate: 4.2 })
    expect(lowRate.monthlyPayment).toBeGreaterThan(decimal.monthlyPayment)
    expect(lowRate.monthlyPayment).toBeLessThan(normal.monthlyPayment)
  })

  it('返回里回显 annualRate，便于发现口径误传', async () => {
    const r = (await run({ annualRate: 0.042 })) as { annualRate?: number }
    expect(r.annualRate).toBe(0.042)
  })

  it('首期还款日是起算日的次月同日（不是起算日当天）', async () => {
    const r = await run()
    expect(r.plan[0].dueDate).toBe('2026-02-01')
    expect(r.plan[1].dueDate).toBe('2026-03-01')
  })
})

describe('parseStrictDay', () => {
  it('合法日期返回当日零点', () => {
    const d = parseStrictDay('2026-01-01')
    expect(d).not.toBeNull()
    expect([d!.getFullYear(), d!.getMonth(), d!.getDate()]).toEqual([2026, 0, 1])
  })

  it('闰日按年份判定', () => {
    expect(parseStrictDay('2024-02-29')).not.toBeNull()
    expect(parseStrictDay('2026-02-29')).toBeNull()
  })

  it('非法输入返回 null', () => {
    for (const bad of ['2026-02-30', '2026-13-01', '2026-00-10', '2026/01/01', '20260101', '']) {
      expect(parseStrictDay(bad), bad).toBeNull()
    }
  })
})

import { describe, expect, it } from 'vitest'
import { sanitizeSmsAiItem } from '../src/services/ai/sms-extract.js'
import type { SmsAiExtractItem } from '@homibook/core'

// 模型输出不可信:这里的每条断言都是「非法输入必须被置空 + 记 notes」,不允许静默归一化
const item: SmsAiExtractItem = {
  sourceId: 'sms:9',
  text: '您尾号9671账户09月05日18:54代扣10.00元',
  sender: '95599',
  receivedAt: '2026-09-05T10:54:00.000Z',
  channel: 'sms',
}

const run = (raw: Record<string, unknown>) => sanitizeSmsAiItem(raw, item)

describe('sanitizeSmsAiItem', () => {
  it('合法输出 → 全字段保留,时间转 ISO', () => {
    const c = run({
      i: 1,
      isTransaction: true,
      amount: 10,
      type: 'EXPENSE',
      date: '2026-09-05T18:54:00+08:00',
      bankName: '中国农业银行',
      cardTail: '9671',
      tradeKind: '代扣',
      payer: null,
      remark: '代扣 10 元',
      confidence: 0.9,
    })
    expect(c).toMatchObject({
      sourceId: 'sms:9',
      isTransaction: true,
      amount: 10,
      type: 'EXPENSE',
      date: '2026-09-05T10:54:00.000Z',
      bankName: '中国农业银行',
      cardTail: '9671',
      tradeKind: '代扣',
      payer: null,
      remark: '代扣 10 元',
      confidence: 0.9,
      notes: [],
    })
  })

  it('金额带符号 → 取绝对值(方向由 type 表达)', () => {
    expect(run({ amount: -100.005, type: 'EXPENSE', isTransaction: true }).amount).toBe(100.01)
  })

  it('金额为 0 / 越界 → 置空并降置信度,该条判定为非交易', () => {
    const zero = run({ amount: 0, type: 'EXPENSE', isTransaction: true })
    expect(zero.amount).toBeNull()
    expect(zero.isTransaction).toBe(false)
    expect(zero.notes.some(n => n.includes('金额'))).toBe(true)

    const huge = run({ amount: 5e9, type: 'EXPENSE', isTransaction: true })
    expect(huge.amount).toBeNull()
    expect(huge.notes.length).toBeGreaterThan(0)
  })

  it('方向不在枚举内 → 置空并记 notes(不猜、不转大写)', () => {
    const c = run({ amount: 10, type: 'income', isTransaction: true, confidence: 0.8 })
    expect(c.type).toBeNull()
    expect(c.notes.some(n => n.includes('方向不在枚举内'))).toBe(true)
    // 丢字段要下调置信度
    expect(c.confidence).toBeLessThan(0.8)
  })

  it('时间无法解析 → 置空(由客户端用到达时刻兜底)', () => {
    expect(run({ amount: 10, type: 'EXPENSE', date: '昨天下午', isTransaction: true }).date).toBeNull()
    expect(run({ amount: 10, type: 'EXPENSE', isTransaction: true }).date).toBeNull()
  })

  it('卡尾号必须正好 4 位数字', () => {
    expect(run({ amount: 10, isTransaction: true, cardTail: '671' }).cardTail).toBeNull()
    expect(run({ amount: 10, isTransaction: true, cardTail: '12345' }).cardTail).toBeNull()
    expect(run({ amount: 10, isTransaction: true, cardTail: ' 9671 ' }).cardTail).toBe('9671')
  })

  it('超长字段按上限截断', () => {
    const c = run({ amount: 10, isTransaction: true, remark: 'x'.repeat(200), payer: '长'.repeat(80) })
    expect(c.remark?.length).toBe(120)
    expect(c.payer?.length).toBe(60)
  })

  it('模型判定非交易 → isTransaction=false(其它字段不再采信)', () => {
    expect(run({ isTransaction: false, amount: 10, type: 'EXPENSE' }).isTransaction).toBe(false)
  })

  it('缺失 confidence → 取中性 0.5,不会因为没自评就变成高置信', () => {
    expect(run({ amount: 10, type: 'EXPENSE', isTransaction: true }).confidence).toBe(0.5)
  })
})

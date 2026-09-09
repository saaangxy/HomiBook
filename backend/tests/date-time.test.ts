import { describe, expect, it } from 'vitest'
import {
  dayStart,
  dayEnd,
  dayStartOf,
  dateKey,
  monthKey,
  parseDayStart,
  parseDayEnd,
} from '../src/lib/date-time.js'

// 业务时区 = 运行环境本地时区(部署由 TZ 环境变量控制)。
// 时区无关断言:用本地构造的 Date(构造与断言同用本地日历,任意时区机器上均成立),
// 验证"锚定本地当日"语义而非特定时区数值。
describe('date-time(业务时区=运行环境本地)', () => {
  it('dayStart:锚定本地当日 00:00:00.000', () => {
    const d = dayStart('2026-05-01')
    expect([d.getFullYear(), d.getMonth(), d.getDate(), d.getHours(), d.getMinutes(), d.getSeconds(), d.getMilliseconds()])
      .toEqual([2026, 4, 1, 0, 0, 0, 0])
  })

  it('dayEnd:锚定本地当日 23:59:59.999', () => {
    const d = dayEnd('2026-05-01')
    expect([d.getFullYear(), d.getMonth(), d.getDate(), d.getHours(), d.getMinutes(), d.getSeconds(), d.getMilliseconds()])
      .toEqual([2026, 4, 1, 23, 59, 59, 999])
  })

  it('dayStartOf:任意时刻对齐到所在本地日 00:00', () => {
    const morning = new Date(2026, 4, 1, 10, 30) // 本地 10:30
    const midnight = dayStartOf(morning)
    expect(midnight.getTime()).toBe(new Date(2026, 4, 1, 0, 0, 0).getTime())
    expect(dateKey(midnight)).toBe('2026-05-01')
  })

  it('dateKey:本地日历取键,本地 23:30 属当日、次日 00:30 属次日', () => {
    expect(dateKey(new Date(2026, 4, 1, 23, 30))).toBe('2026-05-01')
    expect(dateKey(new Date(2026, 4, 2, 0, 30))).toBe('2026-05-02')
  })

  it('monthKey:本地月末晚间属当月,次日属次月', () => {
    expect(monthKey(new Date(2026, 4, 31, 23, 30))).toBe('2026-05')
    expect(monthKey(new Date(2026, 5, 1, 0, 30))).toBe('2026-06')
  })

  it('parseDayStart:纯日期锚定本地日始;带时间/时区字符串原样解析', () => {
    expect(parseDayStart('2026-05-01').getTime()).toBe(new Date(2026, 4, 1, 0, 0, 0).getTime())
    expect(parseDayStart('2026-05-01T05:00:00Z').toISOString()).toBe('2026-05-01T05:00:00.000Z')
  })

  it('parseDayEnd:纯日期锚定本地日终(含整天)', () => {
    expect(parseDayEnd('2026-05-01').getTime()).toBe(new Date(2026, 4, 1, 23, 59, 59, 999).getTime())
    expect(parseDayEnd('2026-05-01T12:00:00Z').toISOString()).toBe('2026-05-01T12:00:00.000Z')
  })
})

// 回归:与旧硬编码 +08:00 行为等价,仅在本地时区为东八区(UTC+8)的机器上执行
const itCST = new Date().getTimezoneOffset() === -480 ? it : it.skip

describe('date-time(回归:东八区机器上与旧 +08:00 硬编码行为等价)', () => {
  itCST('UTC 时刻切日:UTC 00:30 → 本地同日;UTC 18:00 → 本地次日', () => {
    expect(dateKey(new Date('2026-05-01T00:30:00Z'))).toBe('2026-05-01')
    expect(dateKey(new Date('2026-05-01T18:00:00Z'))).toBe('2026-05-02')
  })

  itCST('dayStart:本地当日 00:00 = UTC 前一日 16:00', () => {
    expect(dayStart('2026-05-01').toISOString()).toBe('2026-04-30T16:00:00.000Z')
  })

  itCST('monthKey:本地月末晚间 UTC 时刻归次月', () => {
    expect(monthKey(new Date('2026-05-31T20:00:00Z'))).toBe('2026-06')
  })
})

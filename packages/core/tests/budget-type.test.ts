import { describe, expect, it } from 'vitest'
import { BUDGET_TYPES, isBudgetType, normalizeBudgetType } from '../src/types/budget.js'

// 背景:预算列表按 type(FIXED/FREE)过滤,而各端渲染用 `type === 'FIXED' ? 固定 : 自由` 分支,
// 非法值会「显示为自由预算但任何列表都查不到」,故写入前归一化。
describe('预算类型运行时校验', () => {
  it('合法类型原样返回', () => {
    for (const t of BUDGET_TYPES) {
      expect(isBudgetType(t)).toBe(true)
      expect(normalizeBudgetType(t)).toBe(t)
    }
  })

  it('非法值归一为 FREE(与各端 else 分支的展示口径一致)', () => {
    expect(isBudgetType('MONTHLY')).toBe(false)
    expect(normalizeBudgetType('MONTHLY')).toBe('FREE')
    expect(normalizeBudgetType('fixed')).toBe('FREE')
    expect(normalizeBudgetType(undefined)).toBe('FREE')
    expect(normalizeBudgetType(null)).toBe('FREE')
    expect(normalizeBudgetType('')).toBe('FREE')
    expect(normalizeBudgetType(0)).toBe('FREE')
  })
})

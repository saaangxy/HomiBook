import { describe, expect, it } from 'vitest'
import { buildBudgetRecordWhere, normalizeTags } from '../src/services/budget.js'

describe('normalizeTags', () => {
  it('去空、去重并排序后序列化', () => {
    expect(normalizeTags([' 旅行 ', '餐饮', '旅行', '', '  '])).toBe(JSON.stringify(['旅行', '餐饮']))
  })

  it('空值输出空数组 JSON', () => {
    expect(normalizeTags()).toBe('[]')
    expect(normalizeTags(null)).toBe('[]')
  })
})

describe('buildBudgetRecordWhere 多维度组合', () => {
  const sets = {
    expense: new Set(['food']),
    income: new Set(['salary']),
  }

  it('月度预算：整月 + 分类 + 成员 + 标签 + 未平账', () => {
    const where = buildBudgetRecordWhere(
      {
        type: 'FIXED',
        year: 2026,
        month: 2,
        categoryCode: 'food',
        ownerId: 'u1',
        tags: JSON.stringify(['旅行', '餐饮']),
      },
      'book1',
      sets,
    )

    expect(where.accountBookId).toBe('book1')
    expect(where.offsetAt).toBeNull()
    expect(where.type).toBe('EXPENSE')
    expect(where.categoryCode).toBe('food')
    expect(where.ownerId).toBe('u1')
    // 月份边界按业务时区本地日：2/1 00:00 ~ 2/28 23:59
    expect(where.date.gte.getFullYear()).toBe(2026)
    expect(where.date.gte.getMonth()).toBe(1)
    expect(where.date.gte.getDate()).toBe(1)
    expect(where.date.gte.getHours()).toBe(0)
    expect(where.date.lte.getMonth()).toBe(1)
    expect(where.date.lte.getDate()).toBe(28)
    expect(where.date.lte.getHours()).toBe(23)
    expect(where.OR).toEqual([{ tags: { contains: '旅行' } }, { tags: { contains: '餐饮' } }])
  })

  it('收入分类按字典识别为 INCOME', () => {
    const where = buildBudgetRecordWhere(
      { type: 'FIXED', year: 2026, month: 1, categoryCode: 'salary', tags: '[]' },
      'book1',
      sets,
    )
    expect(where.type).toBe('INCOME')
  })

  it('未指定分类时默认只统计支出', () => {
    const where = buildBudgetRecordWhere(
      { type: 'FIXED', year: 2026, month: 1, tags: '[]' },
      'book1',
    )
    expect(where.type).toBe('EXPENSE')
    expect(where.categoryCode).toBeUndefined()
  })

  it('项目预算无日期时不限制日期', () => {
    const where = buildBudgetRecordWhere(
      { type: 'FREE', startDate: null, endDate: null, tags: JSON.stringify(['旅行']), ownerId: null },
      'book1',
    )
    expect(where.date).toBeUndefined()
    expect(where.OR).toEqual([{ tags: { contains: '旅行' } }])
    expect(where.ownerId).toBeUndefined()
  })

  it('项目预算有日期时按区间（结束日含当天）', () => {
    const where = buildBudgetRecordWhere(
      {
        type: 'FREE',
        startDate: new Date(2026, 2, 1),
        endDate: new Date(2026, 2, 15),
        tags: '[]',
      },
      'book1',
    )
    expect(where.date.gte.getFullYear()).toBe(2026)
    expect(where.date.gte.getMonth()).toBe(2)
    expect(where.date.gte.getDate()).toBe(1)
    expect(where.date.gte.getHours()).toBe(0)
    expect(where.date.lte.getDate()).toBe(15)
    expect(where.date.lte.getHours()).toBe(23)
    expect(where.date.lte.getMinutes()).toBe(59)
  })
})

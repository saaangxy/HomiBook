import { describe, expect, it } from 'vitest'
import { RECORD_TYPES, isRecordType, normalizeRecordType } from '../src/types/record.js'
import { RECORD_TYPE_LABELS } from '../src/record-import.js'

// 背景与账户类型同理:各端按 type 查图标/颜色(如固定收支列表 TYPE_ICON[t.type]),
// 非法值会直接导致渲染崩溃,故在写入与读取两侧都做归一化兜底。
describe('收支类型运行时校验', () => {
  it('合法类型原样返回', () => {
    for (const t of RECORD_TYPES) {
      expect(isRecordType(t)).toBe(true)
      expect(normalizeRecordType(t)).toBe(t)
      expect(RECORD_TYPE_LABELS[t]).toBeTruthy()
    }
  })

  it('非法值归一为 EXPENSE(与导入解析器的默认口径一致)', () => {
    expect(isRecordType('OTHER')).toBe(false)
    expect(normalizeRecordType('OTHER')).toBe('EXPENSE')
    expect(normalizeRecordType('UNKNOWN')).toBe('EXPENSE') // 解析器的中间态哨兵值,不落库
    expect(normalizeRecordType('income')).toBe('EXPENSE')
    expect(normalizeRecordType(undefined)).toBe('EXPENSE')
    expect(normalizeRecordType(null)).toBe('EXPENSE')
    expect(normalizeRecordType('')).toBe('EXPENSE')
    expect(normalizeRecordType(1)).toBe('EXPENSE')
  })

  it('类型全集与展示标签数量一致(防新增类型时漏改运行时表)', () => {
    expect(RECORD_TYPES).toHaveLength(Object.keys(RECORD_TYPE_LABELS).length)
  })
})

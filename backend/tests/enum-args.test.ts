import { describe, expect, it } from 'vitest'
import { checkEnumList, checkEnums } from '../src/services/ai/security.js'

// AI 工具入参枚举校验:模型给出非法枚举时必须回报错误(而不是被静默归一化成默认值后落库)
const TYPES = ['INCOME', 'EXPENSE', 'TRANSFER'] as const

describe('checkEnums(AI 工具入参枚举校验)', () => {
  it('合法值通过', () => {
    expect(checkEnums({ type: ['INCOME', TYPES] })).toBeNull()
  })

  it('未传(undefined/null)不算非法,由各工具自行判断可选/必填', () => {
    expect(checkEnums({ type: [undefined, TYPES], status: [null, TYPES] })).toBeNull()
  })

  it('非法值返回可重试错误,并带上字段名/实际值/允许值', () => {
    const result = checkEnums({ type: ['收入', TYPES] })
    expect(result?.success).toBe(false)
    expect(result?.retryable).toBe(true)
    expect(result?.error).toContain('type')
    expect(result?.error).toContain('收入')
    expect(result?.error).toContain('INCOME / EXPENSE / TRANSFER')
  })

  it('大小写/多余空白等近似值同样视为非法', () => {
    expect(checkEnums({ type: ['income', TYPES] })?.error).toBeTruthy()
    expect(checkEnums({ type: ['INCOME ', TYPES] })?.error).toBeTruthy()
  })

  it('非字符串值视为非法', () => {
    expect(checkEnums({ type: [123, TYPES] })?.error).toContain('123')
  })

  it('多字段时只报第一个非法字段', () => {
    const result = checkEnums({
      type: ['INCOME', TYPES],
      status: ['ARCHIVED!', ['ACTIVE', 'ARCHIVED']],
    })
    expect(result?.error).toContain('status')
    expect(result?.error).not.toContain('type')
  })

  it('数组入参逐个校验', () => {
    expect(checkEnums({ types: [['INCOME', 'EXPENSE'], TYPES] })).toBeNull()
    expect(checkEnums({ types: [['INCOME', 'OTHER'], TYPES] })?.error).toContain('OTHER')
  })
})

describe('checkEnumList(数组项枚举校验)', () => {
  it('全部合法则通过', () => {
    expect(checkEnumList('records[].type', ['INCOME', 'TRANSFER'], TYPES)).toBeNull()
  })

  it('未传或非数组视为通过', () => {
    expect(checkEnumList('records[].type', undefined, TYPES)).toBeNull()
    expect(checkEnumList('records[].type', 'INCOME', TYPES)).toBeNull()
  })

  it('报错信息带下标,便于模型定位是哪一条', () => {
    const result = checkEnumList('records[].type', ['INCOME', 'TRANSFER', 'X'], TYPES)
    expect(result?.success).toBe(false)
    expect(result?.error).toContain('records[].type[2]')
    expect(result?.error).toContain('INCOME / EXPENSE / TRANSFER')
  })

  it('自定义允许值(如分类映射的空串=不限类型)可通过', () => {
    expect(checkEnumList('mappings[].recordType', ['', 'INCOME'], [...TYPES, ''])).toBeNull()
    expect(checkEnumList('mappings[].recordType', ['不限'], [...TYPES, ''])?.error).toContain('不限')
  })
})

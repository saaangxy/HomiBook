import { describe, expect, it } from 'vitest'
import { ACCOUNT_TYPES, ACCOUNT_TYPE_LABELS, isAccountType, normalizeAccountType } from '../src/types/account.js'

// 背景:历史数据/外部写入可能存在非法账户类型(真实案例:库里出现 type="BANK" 而非 "BANK_DEBIT"),
// 客户端会按 type 查图标与标签,非法值直接导致渲染崩溃("Cannot read property 'displayName' of undefined")。
describe('账户类型运行时校验', () => {
  it('合法类型原样返回', () => {
    for (const t of ACCOUNT_TYPES) {
      expect(isAccountType(t)).toBe(true)
      expect(normalizeAccountType(t)).toBe(t)
      expect(ACCOUNT_TYPE_LABELS[t]).toBeTruthy()
    }
  })

  it('非法值归一为 OTHER', () => {
    expect(isAccountType('BANK')).toBe(false)
    expect(normalizeAccountType('BANK')).toBe('OTHER')
    expect(normalizeAccountType('bank_debit')).toBe('OTHER') // 大小写不匹配
    expect(normalizeAccountType(undefined)).toBe('OTHER')
    expect(normalizeAccountType(null)).toBe('OTHER')
    expect(normalizeAccountType('')).toBe('OTHER')
    expect(normalizeAccountType(123)).toBe('OTHER')
  })

  it('类型全集与联合类型的取值数量一致(防新增类型时漏改运行时表)', () => {
    expect(ACCOUNT_TYPES).toHaveLength(Object.keys(ACCOUNT_TYPE_LABELS).length)
  })
})

import { describe, expect, it } from 'vitest'
import { inferAccount } from '../src/services/import/shared.js'

describe('inferAccount 建议新建名归一', () => {
  it('剥离 & 促销尾巴,同一张卡的多个变体建议同名', () => {
    expect(inferAccount('招商银行储蓄卡(9467)')?.defaultName).toBe('招商银行储蓄卡(9467)')
    expect(inferAccount('招商银行储蓄卡(9467)&现金抵价券')?.defaultName).toBe('招商银行储蓄卡(9467)')
    expect(inferAccount('招商银行储蓄卡(9467)&焕新折扣')?.defaultName).toBe('招商银行储蓄卡(9467)')
    expect(inferAccount('网商银行储蓄卡(7484)&网商银行福利金抵扣')?.defaultName).toBe('网商银行储蓄卡(7484)')
    expect(inferAccount('网商银行储蓄卡(7484)')?.defaultName).toBe('网商银行储蓄卡(7484)')
    expect(inferAccount('工商银行储蓄卡(7193)&工商银行立减金')?.defaultName).toBe('工商银行储蓄卡(7193)')
  })

  it('去掉冗余「中国」前缀,与已有「建设银行储蓄卡(7483)」同名', () => {
    expect(inferAccount('中国建设银行储蓄卡(7483)')?.defaultName).toBe('建设银行储蓄卡(7483)')
    expect(inferAccount('建设银行储蓄卡(7483)')?.defaultName).toBe('建设银行储蓄卡(7483)')
  })

  it('类型/银行/卡号仍正确识别', () => {
    expect(inferAccount('招商银行储蓄卡(9467)&现金抵价券')).toMatchObject({
      type: 'BANK_DEBIT',
      bankName: '招商银行',
      accountNo: '9467',
    })
    expect(inferAccount('中国建设银行信用卡(8888)')).toMatchObject({
      type: 'CREDIT_CARD',
      bankName: '建设银行',
      accountNo: '8888',
    })
    expect(inferAccount('交通银行')).toMatchObject({ type: 'BANK_DEBIT', bankName: '交通银行' })
  })

  it('财富/证券/黄金归投资类', () => {
    expect(inferAccount('蚂蚁财富')).toMatchObject({ type: 'INVESTMENT', defaultName: '蚂蚁财富' })
    expect(inferAccount('华泰证券')).toMatchObject({ type: 'INVESTMENT', defaultName: '华泰证券' })
    expect(inferAccount('黄金积存')).toMatchObject({ type: 'INVESTMENT', defaultName: '黄金积存' })
    expect(inferAccount('天天基金')).toMatchObject({ type: 'INVESTMENT' })
    // 银行规则在前,「XX银行财富卡」仍应识别为借记卡(投资词不会把银行卡抢成投资类)
    expect(inferAccount('建设银行财富卡')).toMatchObject({ type: 'BANK_DEBIT', bankName: '建设银行' })
    expect(inferAccount('招商银行财富信用卡(6666)')).toMatchObject({ type: 'CREDIT_CARD' })
  })
})

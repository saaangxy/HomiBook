/**
 * 短信记账 —— 候选 → 解析后行(ParsedRow)适配层。
 *
 * 短信路径没有文件:移动端在本机做预筛与字段提取(core 的 screenSms / parseTransactionSms),
 * 只把结构化候选提交上来;本模块把它们适配成与 parsers.ts 同构的 ParsedRow,
 * 之后完全走「解析后」公共管线(账户匹配 / 分类映射 / 批量入账)。
 *
 * 纯函数:不碰 DB / 文件系统,便于单测。
 */
import { isRecordType } from '@homibook/core'
import type { ParsedRow } from './shared.js'

/** 移动端提交的短信候选(与 core SmsTransactionCandidate 对齐;raw 原文默认不上送) */
export interface SmsCandidateInput {
  /** 来源消息 id(Android 短信 _id):「已处理」标记与跨渠道去重 */
  sourceId?: string
  /** 账单时区 ISO(core sms-parse 产出) */
  date: string
  type: string
  /** 入参为正数;方向由 type 表达 */
  amount: number
  payer?: string | null
  remark?: string | null
  /** 交易类型原文(转支/消费/…):作为分类映射的「源分类」 */
  tradeKind?: string | null
  bankName?: string | null
  cardTail?: string | null
  accountName?: string | null
}

export interface SmsRowsResult {
  rows: ParsedRow[]
  errors: string[]
}

/** 落库标签:便于按标签批量筛选/撤销导入的短信流水 */
const SMS_TAGS = ['导入', '短信']

/** 账户标识:优先移动端算好的账户名,其次「银行(尾号)」,都没有返回 null */
function accountLabelOf(c: SmsCandidateInput): string | null {
  const direct = (c.accountName ?? '').trim()
  if (direct) return direct
  const bank = (c.bankName ?? '').trim()
  const tail = (c.cardTail ?? '').trim()
  if (bank && tail) return `${bank}(${tail})`
  if (bank) return bank
  return null
}

/**
 * 候选 → ParsedRow[]。
 * - 金额取绝对值(方向由 type 表达);金额/时间非法的候选跳过并记入 errors
 * - 类型非法或**缺少账户信息** → 置为 UNKNOWN,进「未识别记录」由用户在确认卡里指定类型与账户
 *   (带着空账户名往下走只会在入账那一刻才报错,不如提前交给人工)
 * - categoryCode 取交易类型原文(tradeKind):配合 source='sms' 的映射规则可持久化(如 转支 → 转账)
 */
export function smsCandidatesToRows(candidates: SmsCandidateInput[]): SmsRowsResult {
  const rows: ParsedRow[] = []
  const errors: string[] = []

  candidates.forEach((c, i) => {
    const label = `第 ${i + 1} 条`
    const amount = Math.abs(Number(c.amount))
    if (!Number.isFinite(amount) || amount <= 0) {
      errors.push(`${label}金额无效,已跳过`)
      return
    }
    const date = new Date(c.date)
    if (isNaN(date.getTime())) {
      errors.push(`${label}时间无效,已跳过`)
      return
    }

    const accountName = accountLabelOf(c) ?? ''
    const missingAccount = !accountName
    const validType = isRecordType(c.type)
    // 方向非法或缺少账户 → UNKNOWN,交给用户在确认卡里指定(不猜、不静默归一化)
    const type: ParsedRow['type'] = !missingAccount && isRecordType(c.type) ? c.type : 'UNKNOWN'

    const notes: string[] = []
    if (missingAccount) notes.push('缺少账户信息,请指定账户')
    if (!validType) notes.push('收支方向未识别')
    const remark = [c.remark?.trim(), ...notes].filter(Boolean).join(' ｜ ')

    rows.push({
      date: date.toISOString(),
      type,
      amount,
      accountName,
      accountId: null,
      toAccountName: null,
      toAccountId: null,
      categoryCode: (c.tradeKind ?? '').trim() || null,
      mappedCategoryCode: null,
      payer: c.payer?.trim() || null,
      remark,
      tags: [...SMS_TAGS],
      // 短信无文件行号:用 1 起序号回填,仅作卡内展示与未识别记录的人工指定 key
      rowIndex: i + 1,
    })
  })

  return { rows, errors }
}

import { RECORD_TYPE_LABELS } from '@homibook/core'
import { dateKey } from '../../../lib/date-time.js'

/** 确认卡的四种呈现形态 */
export type ConfirmPreviewType = 'records-table' | 'record-changes' | 'budget-card' | 'generic'

export interface PreviewCell {
  text: string
  highlight?: boolean
  color?: 'green' | 'red'
}

export interface ConfirmPreview {
  type: ConfirmPreviewType
  title: string
  description?: string
  columns?: string[]
  rows?: PreviewCell[][]
  changes?: {
    id: string
    date: string
    /** 这条流水的辨识摘要（一律用修改前的原值，它标识「哪条流水」而不是「改成了什么」） */
    summary?: string
    fields: { label: string; before: string; after: string }[]
  }[]
  budgetFields?: { label: string; value: string }[]
  text?: string
}

/** 收支类型标签（单一来源 @homibook/core，键放宽便于动态索引） */
export const TYPE_LABELS = RECORD_TYPE_LABELS as Record<string, string>

/** 把一条流水渲染成表格行（账户 / 分类名已由 PreviewScope 解出） */
export function recordToRow(r: {
  type: string
  amount: number
  date: string | Date
  accountName?: string
  fromAccountName?: string
  toAccountName?: string
  categoryLabel?: string
  remark?: string | null
}): PreviewCell[][] {
  const date = typeof r.date === 'string' ? r.date : dateKey(r.date)
  const typeLabel = TYPE_LABELS[r.type] || r.type
  const color = r.type === 'INCOME' ? 'green' : r.type === 'EXPENSE' ? 'red' : undefined

  let accountText = r.accountName || '-'
  if (r.type === 'TRANSFER') {
    accountText = `${r.fromAccountName || '-'} → ${r.toAccountName || '-'}`
  }

  return [[
    { text: date },
    { text: typeLabel, color },
    { text: accountText },
    { text: r.categoryLabel || '-' },
    { text: r.amount.toFixed(2), color },
    { text: r.remark || '-' },
  ]]
}

/**
 * 兜底卡片：工具拿不到目标数据（记录不存在 / 未提供 ID 等）时用它解释原因。
 *
 * @param title 工具自己的 displayName —— 由调用方传入，避免这里维护一份
 *              「工具名 → 中文名」的映射表（新增工具时忘改就会显示英文名）
 */
export function genericPreview(title: string, detail: { error?: string } = {}): string {
  const error = typeof detail?.error === 'string' ? detail.error : null
  const preview: ConfirmPreview = {
    type: 'generic',
    title: `${title} · 未能执行`,
    // 有明确原因时不再 dump 参数；否则保留摘要便于排查
    ...(error ? { description: error } : {}),
    text: error ? '' : '',
  }
  return JSON.stringify(preview)
}

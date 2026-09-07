import { RECORD_TYPE_LABELS as CORE_LABELS } from '@homibook/core'

/** 收支类型中文标签(单一来源 @homibook/core,与 mobile 共享;键放宽 string 便于动态索引) */
export const RECORD_TYPE_LABELS: Record<string, string> = CORE_LABELS

/** 收支语义色 — 文字(tailwind class;权威色 #22c55e/#ef4444/#3b82f6,全站统一,勿再散写) */
export const RECORD_TYPE_TEXT_CLASS: Record<string, string> = {
  INCOME: 'text-[#22c55e]',
  EXPENSE: 'text-[#ef4444]',
  TRANSFER: 'text-[#3b82f6]',
}

/** 收支语义色 — 文字 + 10% 底(Badge/图标底用) */
export const RECORD_TYPE_BADGE_CLASS: Record<string, string> = {
  INCOME: 'text-[#22c55e] bg-[#22c55e]/10',
  EXPENSE: 'text-[#ef4444] bg-[#ef4444]/10',
  TRANSFER: 'text-[#3b82f6] bg-[#3b82f6]/10',
}

/** 收支语义色 — 10% 底(容器背景用) */
export const RECORD_TYPE_BG_CLASS: Record<string, string> = {
  INCOME: 'bg-[#22c55e]/10',
  EXPENSE: 'bg-[#ef4444]/10',
  TRANSFER: 'bg-[#3b82f6]/10',
}

/** 收支语义色 — 10% 底 + 30% 边框(卡片容器用) */
export const RECORD_TYPE_CONTAINER_CLASS: Record<string, string> = {
  INCOME: 'bg-[#22c55e]/10 border-[#22c55e]/30',
  EXPENSE: 'bg-[#ef4444]/10 border-[#ef4444]/30',
  TRANSFER: 'bg-[#3b82f6]/10 border-[#3b82f6]/30',
}

/** 收支语义色 — hex 值(style 内联/ECharts 用) */
export const RECORD_TYPE_HEX: Record<string, string> = {
  INCOME: '#22c55e',
  EXPENSE: '#ef4444',
  TRANSFER: '#3b82f6',
}

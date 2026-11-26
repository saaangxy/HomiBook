import type { SuggestionOption } from '../types/chat.js'

/** 归一化后的建议问题(结构与 suggest_options 工具的返回值一致) */
export interface NormalizedSuggestionQuestion {
  question: string
  field: string
  options: Array<string | SuggestionOption>
  allowCustom: boolean
  /** 是否多选:多选问题的答案以数组形式回填给模型 */
  multiple: boolean
}

/** 模型偶尔会把 label/value 写成 XML 式标签文本,这里统一清理 */
const RESIDUAL_TAG_RE = /<\/?\s*(?:label|value|name|code|description)\s*>/gi

function cleanText(text: string): string {
  return text.replace(RESIDUAL_TAG_RE, ' ').replace(/\s+/g, ' ').trim()
}

/** 取 `<tag>...</tag>` 内的文本(容忍标签内空格与大小写差异) */
function pickTag(text: string, tag: string): string | undefined {
  const match = new RegExp(`<\\s*${tag}\\s*>([\\s\\S]*?)<\\s*/\\s*${tag}\\s*>`, 'i').exec(text)
  return match ? cleanText(match[1]) : undefined
}

/**
 * 归一化单个选项:
 * - 普通字符串:去掉首尾空白
 * - 形如 `<label>显示文本</label><value>实际值</value>` 的字符串:解析成 { label, value }
 * - 对象:清理 label/value 里可能混入的标签
 */
export function normalizeSuggestionOption(option: unknown): string | SuggestionOption {
  if (typeof option === 'string') {
    const label = pickTag(option, 'label') ?? pickTag(option, 'name')
    const value = pickTag(option, 'value') ?? pickTag(option, 'code')
    if (label == null && value == null) return option.trim()

    const finalLabel = cleanText(label ?? value ?? option)
    const finalValue = cleanText(value ?? label ?? finalLabel)
    return { label: finalLabel, value: finalValue }
  }

  if (option && typeof option === 'object' && !Array.isArray(option)) {
    const raw = option as SuggestionOption
    const rawLabel = typeof raw.label === 'string' ? raw.label : (typeof raw.name === 'string' ? raw.name : undefined)
    const rawValue = typeof raw.value === 'string' ? raw.value : (typeof raw.code === 'string' ? raw.code : undefined)
    const label = rawLabel ? (pickTag(rawLabel, 'label') ?? pickTag(rawLabel, 'name') ?? cleanText(rawLabel)) : undefined
    const value = rawValue ? (pickTag(rawValue, 'value') ?? pickTag(rawValue, 'code') ?? cleanText(rawValue)) : undefined
    return {
      ...raw,
      ...(label !== undefined ? { label } : {}),
      ...(value !== undefined ? { value } : {}),
    }
  }

  return String(option)
}

/** 归一化问题列表:用于工具执行结果与前端历史回显,避免把标签直接展示/回传 */
export function normalizeSuggestionQuestions(questions: unknown[]): NormalizedSuggestionQuestion[] {
  return questions.map((question) => {
    const item = question as { question?: unknown; field?: unknown; options?: unknown; allowCustom?: unknown; multiple?: unknown }
    return {
      question: cleanText(String(item?.question ?? '')),
      field: String(item?.field ?? ''),
      options: Array.isArray(item?.options) ? item.options.map(normalizeSuggestionOption) : [],
      allowCustom: item?.allowCustom !== false,
      // 兼容模型用 multiSelect / multi 等写法表达多选
      multiple: item?.multiple === true || (item as { multiSelect?: unknown })?.multiSelect === true,
    }
  })
}

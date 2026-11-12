/**
 * 提示词注入防护：清洗外部文本（网页正文 / 搜索结果）。
 *
 * 正则只维护这一份 —— read_webpage 与 web_search 面对的是同一类不可信内容，
 * 两边规则不同就会出现「同一个页面从搜索进被过滤、从网页进没过滤」的漏洞。
 */

/** 注入话术与危险标签（img/svg 也清掉：它们可能带 onerror 等事件属性） */
const INJECTION_PATTERNS = [
  /ignore\s+(all\s+)?previous\s+(instructions?|prompts?|rules?)/gi,
  /忽略(之前|以上|前面|上述)(的)?(指令|提示|规则|指示)/gi,
  /you\s+are\s+now\s+/gi,
  /你(现在|从现在开始)(是|扮演|作为一个)/gi,
  /system\s*:/gi,
  /系统\s*[:：]/gi,
  /<\s*(script|iframe|img|svg|tool_call|invoke|system)\b[^>]*>/gi,
  /<\/\s*(script|iframe|tool_call|invoke|system)\s*>/gi,
]

/**
 * 过滤注入话术与控制字符，超长截断。
 * @param maxLen 截断阈值（字符数），超出部分以「...」结尾
 */
export function sanitizeExternalText(text: string, maxLen: number): string {
  let cleaned = text
  for (const pattern of INJECTION_PATTERNS) {
    cleaned = cleaned.replace(pattern, '[已过滤]')
  }
  cleaned = cleaned.replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, '')
  if (cleaned.length > maxLen) cleaned = cleaned.slice(0, maxLen) + '...'
  return cleaned.trim()
}

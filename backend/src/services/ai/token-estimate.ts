/**
 * 无依赖 token 估算
 * 中文场景：CJK ~1.5 token/字，ASCII ~4 字符/token
 */

// CJK Unicode 范围检测
function isCJK(char: string): boolean {
  const code = char.codePointAt(0) ?? 0
  return (
    (code >= 0x4e00 && code <= 0x9fff) ||   // CJK 统一汉字
    (code >= 0x3000 && code <= 0x30ff) ||   // CJK 标点、假名
    (code >= 0xff00 && code <= 0xffef)      // 全角字符
  )
}

export function estimateTokens(text: string): number {
  if (!text) return 0
  let cjkCount = 0
  let asciiCount = 0
  for (const char of text) {
    if (isCJK(char)) cjkCount++
    else asciiCount++
  }
  // CJK ~1.5 token/字，ASCII ~4 字符/token
  return Math.ceil(cjkCount * 1.5 + asciiCount / 4)
}

/**
 * 从 CoreMessage 数组估算总 token
 * 每条消息 +4 开销（role 标记等）
 */
export function estimateMessagesTokens(messages: any[]): number {
  let total = 0
  for (const msg of messages) {
    total += 4 // 每条消息固定开销
    total += estimateTokens(extractMessageText(msg))
  }
  return total
}

/** 从消息中提取所有文本用于估算 */
function extractMessageText(msg: any): string {
  if (typeof msg.content === 'string') return msg.content

  if (Array.isArray(msg.content)) {
    return msg.content
      .map((part: any) => {
        if (part.type === 'text') return part.text ?? ''
        if (part.type === 'tool-call') return JSON.stringify(part.input ?? {})
        if (part.type === 'tool-result') {
          const output = part.output
          if (output?.value !== undefined) return JSON.stringify(output.value)
          if (typeof output === 'string') return output
          return JSON.stringify(output ?? {})
        }
        return ''
      })
      .join(' ')
  }

  return ''
}

/**
 * 估算工具定义的 token 开销
 * 序列化 name + description + parameters 后估算
 */
export function estimateToolsTokens(tools: Record<string, any>): number {
  let text = ''
  for (const [name, def] of Object.entries(tools)) {
    text += name + ' '
    text += def?.description ?? ''
    text += ' '
    text += JSON.stringify(def?.inputSchema ?? def?.parameters ?? {})
    text += ' '
  }
  return estimateTokens(text)
}

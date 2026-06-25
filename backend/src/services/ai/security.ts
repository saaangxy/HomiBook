import { prisma } from '../../app.js'

// 工具执行结果（包含错误信息，让 LLM 决定是否重试）
export interface ToolResult<T = unknown> {
  success: boolean
  data?: T
  error?: string
  retryable: boolean
}

// 脱敏：银行卡号 → 保留前4后4
export function desensitizeBankCard(card: string): string {
  const cleaned = card.replace(/\s+/g, '')
  if (cleaned.length < 8) return '****'
  return cleaned.slice(0, 4) + '****' + cleaned.slice(-4)
}

// 脱敏：手机号 → 保留后4位
function desensitizePhone(phone: string): string {
  const cleaned = phone.replace(/\s+/g, '')
  if (cleaned.length < 4) return '****'
  return '****' + cleaned.slice(-4)
}

// 脱敏：身份证 → 保留前6位和后4位
function desensitizeIdCard(idCard: string): string {
  const cleaned = idCard.replace(/\s+/g, '')
  if (cleaned.length < 10) return '****'
  return cleaned.slice(0, 6) + '****' + cleaned.slice(-4)
}

// 脱敏：数据对象中自动检测并脱敏敏感字段
export function desensitize(data: unknown): unknown {
  if (typeof data !== 'object' || data === null) return data
  if (Array.isArray(data)) return data.map(desensitize)

  const record = data as Record<string, unknown>
  const result: Record<string, unknown> = {}
  const sensitiveKeys = ['accountNo', 'idCard', 'phone']

  for (const [key, value] of Object.entries(record)) {
    if (sensitiveKeys.includes(key) && typeof value === 'string' && value) {
      if (key === 'accountNo') {
        result[key] = desensitizeBankCard(value)
      } else if (key === 'idCard') {
        result[key] = desensitizeIdCard(value)
      } else if (key === 'phone') {
        result[key] = desensitizePhone(value)
      }
    } else if (typeof value === 'object' && value !== null) {
      result[key] = desensitize(value)
    } else {
      result[key] = value
    }
  }
  return result
}

// 超时控制
export function withTimeout<T>(promise: Promise<T>, ms: number, label?: string): Promise<T> {
  const controller = new AbortController()
  const timer = setTimeout(() => {
    controller.abort()
  }, ms)

  // 如果 promise 可接收 abort signal
  return Promise.race([
    promise,
    new Promise<never>((_, reject) => {
      const onAbort = () => {
        clearTimeout(timer)
        reject(new Error(label ? `${label} 超时 (${ms}ms)` : `操作超时 (${ms}ms)`))
      }
      if (controller.signal.aborted) {
        onAbort()
      } else {
        controller.signal.addEventListener('abort', onAbort, { once: true })
      }
    }),
  ]).finally(() => clearTimeout(timer))
}

// 工具调用重试包装
export async function retryable<T>(
  fn: () => Promise<T>,
  label?: string,
): Promise<ToolResult<T>> {
  try {
    const data = await fn()
    return { success: true, data, retryable: false }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err)
    const statusCode = (err as { statusCode?: number }).statusCode

    // 网络/超时错误 → 可重试
    const retryablePatterns = ['timeout', 'ETIMEDOUT', 'ECONNREFUSED', 'ECONNRESET', 'fetch failed', 'network']
    // 权限/冲突错误 → 不可重试
    const nonRetryableCodes = [401, 403, 404, 409]

    const isRetryable =
      !nonRetryableCodes.includes(statusCode ?? 0) &&
      retryablePatterns.some((p) => message.toLowerCase().includes(p.toLowerCase()))

    return { success: false, error: label ? `[${label}] ${message}` : message, retryable: isRetryable }
  }
}

// 权限校验：用户必须是账本成员
export async function assertIsMember(bookId: string, userId: string): Promise<void> {
  const book = await prisma.accountBook.findUnique({ where: { id: bookId } })
  if (!book) throw Object.assign(new Error('账本不存在'), { statusCode: 404 })
  if (book.ownerId === userId) return

  const member = await prisma.accountBookMember.findUnique({
    where: { accountBookId_userId: { accountBookId: bookId, userId } },
  })
  if (!member) throw Object.assign(new Error('无权访问该账本'), { statusCode: 403 })
}

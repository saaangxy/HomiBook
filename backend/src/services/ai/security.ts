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
  // Date 等非普通对象原样保留：继续递归会按可枚举属性展开成空对象
  if (data instanceof Date) return data
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

/**
 * 工具业务失败。
 *
 * 工具里不再手工拼 `{ success: false, error, retryable }`：成功直接 return 数据，
 * 失败 throw 这个异常，由 runtime/run-tool 统一转成回传给模型的错误结果。
 */
export class ToolError extends Error {
  constructor(message: string, readonly retryable = false) {
    super(message)
    this.name = 'ToolError'
  }
}

/** 网络/超时类错误 → 值得让模型重试一次 */
const RETRYABLE_PATTERNS = ['timeout', 'ETIMEDOUT', 'ECONNREFUSED', 'ECONNRESET', 'fetch failed', 'network']
/** 权限/冲突类状态码 → 重试也不会成功 */
const NON_RETRYABLE_CODES = [401, 403, 404, 409]

export interface ToolErrorInfo {
  message: string
  /** 是否值得给模型一次重试机会 */
  retryable: boolean
}

/**
 * 异常 → 「可回传给模型的错误」+「是否可重试」。
 *
 * 工具的 execute 抛出的异常全部由 runTool 在这里归类，
 * 同一种异常只有一种 retryable 取值。
 */
export function classifyToolError(err: unknown): ToolErrorInfo {
  // 工具主动抛的业务失败：可重试性由抛出处决定，不再靠消息猜
  if (err instanceof ToolError) return { message: err.message, retryable: err.retryable }

  const message = err instanceof Error ? err.message : String(err)
  const statusCode = (err as { statusCode?: number }).statusCode
  const lower = message.toLowerCase()
  const retryable =
    !NON_RETRYABLE_CODES.includes(statusCode ?? 0) &&
    RETRYABLE_PATTERNS.some((p) => lower.includes(p.toLowerCase()))
  return { message, retryable }
}

/**
 * 校验工具入参里的枚举值,非法则返回可直接回传给 LLM 的错误结果。
 *
 * 为什么不用「静默归一化」:模型给出非法枚举(如 type="收入"、账户类型 "BANK")时,
 * 归一化会把它悄悄改成默认值(EXPENSE / OTHER / FREE)再落库——用户看到的是记错账且无法察觉。
 * 这里返回 retryable 错误,由运行时在执行前统一转成工具结果回传,模型据此改用合法值重试。
 *
 * 约定:
 * - 未传(undefined/null)不算非法,由各工具按「可选/必填」自行判断;
 * - 传入数组时逐个校验;返回结果只包含第一个非法字段。
 */
export function checkEnums(fields: Record<string, [unknown, readonly string[]]>): ToolResult | null {
  for (const [field, [value, allowed]] of Object.entries(fields)) {
    if (value === undefined || value === null) continue
    const values = Array.isArray(value) ? value : [value]
    for (const item of values) {
      if (typeof item === 'string' && allowed.includes(item)) continue
      return {
        success: false,
        retryable: true,
        error: `参数 ${field} 的值 ${JSON.stringify(item)} 非法。允许值: ${allowed.join(' / ')}。请改用允许值后重试。`,
      }
    }
  }
  return null
}

/** 校验数组入参中每一项的枚举值(带下标,便于模型定位),如 items[].type */
export function checkEnumList(field: string, values: unknown, allowed: readonly string[]): ToolResult | null {
  if (!Array.isArray(values)) return null
  for (let i = 0; i < values.length; i++) {
    const bad = checkEnums({ [`${field}[${i}]`]: [values[i], allowed] })
    if (bad) return bad
  }
  return null
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

/**
 * 按归属读取用户的供应商配置。
 *
 * 必须走这个入口:直接 `findUnique({ where: { id } })` 只按主键取,会取到他人配置 ——
 * AI 配置里的 simpleProviderConfigId 等字段来自客户端,一旦指向他人配置,
 * 后续模型调用就会用别人的 apiKey 发请求(越权)。
 */
export async function loadUserProviderConfig(userId: string, configId: string | null | undefined) {
  if (!configId) return null
  return prisma.userProviderConfig.findFirst({ where: { id: configId, userId } })
}

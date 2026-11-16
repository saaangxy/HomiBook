/** SSE 事件下发函数：由路由（HTTP adapter）实现，对话轮本身不认 Fastify 的 reply */
export type EmitSSE = (event: string, data: unknown) => void

export const SSE_HEADERS = {
  'Content-Type': 'text/event-stream',
  'Cache-Control': 'no-cache',
  'Connection': 'keep-alive',
  'X-Accel-Buffering': 'no',
}

/**
 * 把 Fastify reply 包装成 EmitSSE。
 *
 * 响应头**惰性写入**：第一次下发事件时才 writeHead(200)。
 * 这样「校验失败 → reply.status(400).send(JSON)」的路径仍然走普通 JSON 响应，
 * 不会出现「已经写过 SSE 头还去 send」的冲突。
 */
export function createSSEWriter(reply: any): EmitSSE {
  let started = false
  return (event: string, data: unknown) => {
    try {
      if (!started) {
        reply.raw.writeHead(200, SSE_HEADERS)
        started = true
      }
      reply.raw.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
    } catch (e) {
      console.error(`[SSE] write error for event "${event}":`, e)
    }
  }
}

/**
 * 将 AI SDK 异常规范化为简洁可读的提示,避免整段堆栈(如 zod 校验失败的原始 JSON)直达客户端 UI
 */
export function friendlyAIErrorMessage(err: unknown): string {
  const raw = typeof err === 'string' ? err : (err as any)?.message || String(err ?? '')
  // 无效响应体:先看上游 API 是否给出业务可读 message(如"无效的 API Key")
  const body = (err as any)?.responseBody
  if (body) {
    try {
      const p = typeof body === 'string' ? JSON.parse(body) : body
      const m = p?.error?.message || p?.message
      if (m) return String(m)
    } catch { /* ignore */ }
  }
  // 模型返回与工具调用协议不兼容(zod 校验失败/JSON 解析失败等):给固定中文提示
  if (/Type validation failed|does not match expected schema|JSON parsing failed|NoObjectGeneratedError/i.test(raw)) {
    return '模型返回数据异常（可能与当前模型的工具调用协议不兼容），请重试或更换模型'
  }
  // 其余超长错误信息截断,保留关键头部
  const MAX = 300
  return raw.length > MAX ? `${raw.slice(0, MAX)}…` : (raw || 'AI 服务异常')
}

/** 将 result.data 中超过 batchSize 的数组字段拆分，返回分批发货的 result 数组 */
export function splitResultBatches(result: any, batchSize: number): any[] {
  const data = result?.data
  if (!data || typeof data !== 'object') return [result]

  const arrayFields: { key: string; items: any[] }[] = []
  for (const [key, value] of Object.entries(data)) {
    if (Array.isArray(value) && value.length > batchSize) {
      arrayFields.push({ key, items: value as any[] })
    }
  }

  if (arrayFields.length === 0) return [result]

  // 以最长数组为准计算批次数
  const maxLength = Math.max(...arrayFields.map(f => f.items.length))
  const totalBatches = Math.ceil(maxLength / batchSize)

  const batches: any[] = []
  for (let i = 0; i < totalBatches; i++) {
    const batchData: any = { ...data }
    for (const { key, items } of arrayFields) {
      const start = i * batchSize
      const end = start + batchSize
      batchData[key] = items.slice(start, end)
    }
    batches.push({ ...result, data: batchData })
  }

  return batches
}

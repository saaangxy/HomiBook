/**
 * 工具调用 id 的生成与去重。
 *
 * 为什么单独成模块:同一 step 内的并行工具调用是在同一 tick 里启动的,Date.now() 完全相同 ——
 * 只用时间戳生成 id 时,「并行调用同名工具」**必然**撞号(不同名工具因 id 里带 name 而侥幸不冲突)。
 * 重复的 tool_call_id 一旦落库,上游会回:
 *   Duplicate value for 'tool_call_id' of call_xxx in message[N]
 * 并拒绝该会话之后**所有**请求(每轮都会重放这段历史),会话就此不可用。
 *
 * 因此:生成端保证唯一(时间戳 + 自增序号),读取端再做一次去重(修复已污染的旧数据)。
 */

let seq = 0

/** 生成工具调用 id:时间戳 + 自增序号,保证同一毫秒内并行调用也唯一 */
export function nextToolCallId(toolName: string): string {
  return `call_${toolName}_${Date.now()}_${++seq}`
}

/** 按 toolCallId 去重(保留首次出现);缺失 id 的脏项直接丢弃 */
export function dedupeToolCalls<T extends { toolCallId?: string | null }>(list: T[]): T[] {
  const seen = new Set<string>()
  return list.filter((item) => {
    const id = item?.toolCallId
    if (!id || seen.has(id)) return false
    seen.add(id)
    return true
  })
}

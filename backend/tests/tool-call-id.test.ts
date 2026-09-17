import { describe, expect, it } from 'vitest'
import { dedupeToolCalls, nextToolCallId } from '../src/services/ai/tool-call-id.js'

// 回归:同一 step 内并行调用同名工具时 Date.now() 相同,纯时间戳 id 必然撞号,
// 重复的 tool_call_id 会让上游拒绝该会话之后的所有请求
describe('nextToolCallId(并行同名工具调用不撞号)', () => {
  it('同一毫秒内连续生成也互不相同', () => {
    const ids = Array.from({ length: 200 }, () => nextToolCallId('query_records'))
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('保留可读格式(工具名 + 时间戳 + 序号)', () => {
    expect(nextToolCallId('query_records')).toMatch(/^call_query_records_\d+_\d+$/)
  })

  it('不同工具名生成的 id 不同', () => {
    expect(nextToolCallId('query_records')).not.toBe(nextToolCallId('create_record'))
  })
})

describe('dedupeToolCalls(重放与修复历史数据)', () => {
  it('按 id 去重,保留首次出现的那条', () => {
    const list = [
      { toolCallId: 'a', toolName: 'query_records', result: 1 },
      { toolCallId: 'b', toolName: 'query_records', result: 2 },
      { toolCallId: 'a', toolName: 'query_records', result: 3 },
    ]
    expect(dedupeToolCalls(list).map((t) => t.result)).toEqual([1, 2])
  })

  it('丢弃缺失 id 的脏项', () => {
    const list = [{ toolCallId: '' }, { toolCallId: null }, { toolCallId: undefined }, { toolCallId: 'x' }]
    expect(dedupeToolCalls(list)).toHaveLength(1)
  })

  it('无重复或空数组时原样返回', () => {
    expect(dedupeToolCalls([])).toEqual([])
    expect(dedupeToolCalls([{ toolCallId: 'a' }, { toolCallId: 'b' }])).toHaveLength(2)
  })
})

import type { ToolDef, ToolContext } from './types.js'
import type { ToolResult } from '../security.js'
import { searchMemoriesByKeyword } from '../memory.js'

export const searchMemoryTool: ToolDef = {
  name: 'search_memory',
  description: '搜索用户长期记忆。当需要回忆用户的消费习惯、记账偏好或规则时调用。',
  requireConfirm: false,
  parameters: {
    type: 'object',
    properties: {
      query: { type: 'string', description: '搜索关键词' },
      limit: { type: 'number', description: '返回数量，默认 5' },
    },
    required: ['query'],
  },

  async execute(args: any, ctx: ToolContext): Promise<ToolResult> {
    const { query, limit } = args as { query: string; limit?: number }
    const memories = await searchMemoriesByKeyword(ctx.userId, query, limit || 5)
    return {
      success: true,
      retryable: false,
      data: {
        memories: memories.map(m => ({
          id: m.id,
          content: m.content,
          memoryType: m.memoryType,
          importance: m.importance,
        })),
        count: memories.length,
      },
    }
  },
}

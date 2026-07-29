import type { ToolDef, ToolContext } from './types.js'
import type { ToolResult } from '../security.js'
import { listMemories } from '../memory.js'

export const listMemoriesTool: ToolDef = {
  name: 'list_memories',
  description: '查看用户全部长期记忆。用于整理、归纳和检查记忆是否需要更新或删除。',
  requireConfirm: false,
  parameters: {
    type: 'object',
    properties: {},
  },

  async execute(_args: any, ctx: ToolContext): Promise<ToolResult> {
    const memories = await listMemories(ctx.userId)
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

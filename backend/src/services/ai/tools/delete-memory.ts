import type { ToolDef, ToolContext } from './types.js'
import type { ToolResult } from '../security.js'
import { deleteMemory } from '../memory.js'

export const deleteMemoryTool: ToolDef = {
  name: 'delete_memory',
  displayName: '删除记忆',
  promptHint: '记忆重复或不再有效时',
  description: '删除用户长期记忆。当记忆过时、错误或重复时调用。整理归纳记忆时用于清理冗余条目。',
  requireConfirm: false,
  parameters: {
    type: 'object',
    properties: {
      memoryId: { type: 'string', description: '要删除的记忆 ID（从 search_memory 或 list_memories 获取）' },
    },
    required: ['memoryId'],
  },

  async execute(args: any, ctx: ToolContext): Promise<ToolResult> {
    const { memoryId } = args as { memoryId: string }
    const deleted = await deleteMemory(ctx.userId, memoryId)
    return {
      success: deleted,
      retryable: false,
      data: deleted ? { deleted: true, memoryId } : null,
      error: deleted ? undefined : '记忆不存在或无权删除',
    }
  },
}

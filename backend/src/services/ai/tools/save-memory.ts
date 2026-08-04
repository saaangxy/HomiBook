import type { ToolDef, ToolContext } from './types.js'
import type { ToolResult } from '../security.js'
import { saveMemory } from '../memory.js'

export const saveMemoryTool: ToolDef = {
  name: 'save_memory',
  displayName: '保存记忆',
  promptHint: '识别到用户消费习惯或记账偏好时保存；传入 memoryId 可更新已有记忆',
  description: '保存或更新用户长期记忆。当用户表达消费习惯、记账偏好或明确要求记住某事时调用。传入 memoryId 可更新已有记忆（用于整理归纳）。非破坏性操作，无需用户确认。',
  requireConfirm: false,
  parameters: {
    type: 'object',
    properties: {
      content: { type: 'string', description: '记忆内容，简洁描述一条习惯/偏好/规则/事实' },
      memoryType: {
        type: 'string',
        enum: ['habit', 'preference', 'rule', 'fact'],
        description: 'habit=消费习惯, preference=记账偏好, rule=明确规则, fact=事实信息',
      },
      importance: { type: 'number', description: '重要程度 0-1，可不填使用类型默认值' },
      memoryId: { type: 'string', description: '更新已有记忆时传入其 ID（从 search_memory 或 list_memories 获取）' },
    },
    required: ['content', 'memoryType'],
  },

  async execute(args: any, ctx: ToolContext): Promise<ToolResult> {
    const { content, memoryType, importance, memoryId } = args as {
      content: string
      memoryType: 'habit' | 'preference' | 'rule' | 'fact'
      importance?: number
      memoryId?: string
    }
    const result = await saveMemory(ctx.userId, content, memoryType, importance, memoryId)
    if (!result.memory) {
      return { success: false, retryable: false, error: '记忆不存在，无法更新' }
    }
    const message = result.created
      ? '记忆已保存'
      : result.updated
        ? '记忆已更新'
        : '记忆已存在，无变化'
    return {
      success: true,
      retryable: false,
      data: {
        created: result.created,
        updated: result.updated,
        memoryId: result.memory.id,
        memoryType,
        content,
        importance: result.memory.importance,
        message,
      },
    }
  },
}

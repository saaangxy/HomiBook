import type { ToolDef, ToolContext } from './types.js'
import type { ToolResult } from '../security.js'
import { saveMemory } from '../memory.js'

export const saveMemoryTool: ToolDef = {
  name: 'save_memory',
  description: '保存用户长期记忆。当用户表达消费习惯、记账偏好或明确要求记住某事时调用。非破坏性操作，无需用户确认。',
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
    },
    required: ['content', 'memoryType'],
  },

  async execute(args: any, ctx: ToolContext): Promise<ToolResult> {
    const { content, memoryType, importance } = args as {
      content: string
      memoryType: 'habit' | 'preference' | 'rule' | 'fact'
      importance?: number
    }
    const result = await saveMemory(ctx.userId, content, memoryType, importance)
    return {
      success: true,
      retryable: false,
      data: {
        created: result.created,
        memoryType,
        content,
        importance: result.memory.importance,
        message: result.created ? '记忆已保存' : '记忆已存在，重要程度已更新',
      },
    }
  },
}

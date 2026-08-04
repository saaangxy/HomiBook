import type { ToolDef, ToolContext } from './types.js'

export const suggestOptionsTool: ToolDef = {
  name: 'suggest_options',
  displayName: '建议选项',
  promptHint: '用户操作意图明确但缺少具体参数时使用',
  description: '当需要用户选择或补充信息时调用。可同时提出多个问题，一次收集所有缺失信息。向用户展示每个问题的选项列表并等待用户选择或输入，结果会作为工具返回值传给模型继续对话。',
  parameters: {
    type: 'object',
    properties: {
      questions: {
        type: 'array',
        description: '需要用户回答的问题列表',
        items: {
          type: 'object',
          properties: {
            question: { type: 'string', description: '向用户提出的问题，如"请选择支出账户"' },
            field: { type: 'string', description: '信息字段名，如 accountId、date' },
            options: { type: 'array', items: { type: 'string' }, description: '可选项列表，如 ["支付宝", "微信钱包", "现金"]' },
            allowCustom: { type: 'boolean', description: '是否允许用户自定义输入，默认 true' },
          },
          required: ['question', 'field', 'options'],
        },
      },
    },
    required: ['questions'],
  },

  // 由路由层特殊处理，不会走到这里
  async execute(_args: any, _ctx: ToolContext) {
    return { success: false, error: 'suggest_options 应由路由层处理', retryable: false }
  },
}

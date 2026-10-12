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
            options: {
              type: 'array',
              // 允许字符串或对象:对象 { label, value } 用于「展示文本 ≠ 实际参数值」的场景,
              // 典型是账户 —— 同名账户靠 label 带上归属人区分,同时把 accountId 作为 value 传回
              items: {
                oneOf: [
                  { type: 'string' },
                  {
                    type: 'object',
                    properties: {
                      label: { type: 'string', description: '展示给用户的文本，如「微信 · 张三」' },
                      value: { type: 'string', description: '作为该字段实际参数的取值，如账户 ID' },
                      description: { type: 'string', description: '补充说明（可选）' },
                    },
                    required: ['label', 'value'],
                  },
                ],
              },
              description:
                '可选项列表。简单场景用字符串（如 ["现金","微信钱包"]）；' +
                '需要区分同名项（如同名账户）或展示值与实际值不同时用 {label,value}，' +
                '例如 [{"label":"微信 · 张三","value":"<账户ID>"}]',
            },
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

import { normalizeSuggestionQuestions } from '@homibook/core'
import type { ToolDef, ToolContext } from './types.js'

export const suggestOptionsTool: ToolDef = {
  name: 'suggest_options',
  displayName: '建议选项',
  promptHint: '用户操作意图明确但缺少具体参数时使用',
  description: '当需要用户选择或补充信息时调用。可同时提出多个问题，一次收集所有缺失信息。每个问题支持单选或多选（multiple=true 时用户可选多个选项，答案以数组返回）。向用户展示每个问题的选项列表并等待用户选择或输入，结果会作为工具返回值传给模型继续对话。',
  // 执行后挂起：返回问题列表，等用户选择/填写后续流
  pause: 'suggestion',
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
                '例如 [{"label":"微信 · 张三","value":"<账户ID>"}]。' +
                'label/value 必须作为 JSON 对象字段输出，禁止写成 <label>…</label>、<value>…</value> 这类标签文本',
            },
            allowCustom: { type: 'boolean', description: '是否允许用户自定义输入，默认 true' },
            multiple: { type: 'boolean', description: '是否多选：为 true 时用户可同时选中多个选项，答案以数组形式返回；默认 false（单选）。需要用户一次选多项（如多个标签、多个账户）时设为 true' },
          },
          required: ['question', 'field', 'options'],
        },
      },
    },
    required: ['questions'],
  },

  /**
   * 执行结果就是问题列表本身（挂起卡要渲染的内容）。
   * 用户选择后的真实取值不在这里构造 —— 那条路径在 /confirm 路由，作为工具结果回填。
   */
  async execute(args: { questions?: unknown[] }, _ctx: ToolContext) {
    // 兼容模型把 label/value 写成标签文本的情况:统一解析成 {label,value}
    return { questions: normalizeSuggestionQuestions(Array.isArray(args?.questions) ? args.questions : []) }
  },
}

import { generateText } from 'ai'
import { createModel, type ProviderType, type ProviderConfig } from './providers.js'

export type IntentLevel = 'simple' | 'complex'

interface RouteResult {
  intent: IntentLevel
  provider: ProviderType
  model: string
}

/**
 * 两级模型路由：
 * - simple: 查流水、查余额、简单问答 → 便宜模型
 * - complex: 数据分析、报表、多步骤操作 → 强模型
 */
export async function routeIntent(
  userMessage: string,
  simpleProvider: ProviderType,
  simpleModel: string,
  complexProvider: ProviderType,
  complexModel: string,
  config: ProviderConfig,
): Promise<RouteResult> {
  try {
    const intent = await classifyWithLLM(userMessage, simpleProvider, simpleModel, config)
    if (intent === 'complex') {
      return { intent: 'complex', provider: complexProvider, model: complexModel }
    }
    return { intent: 'simple', provider: simpleProvider, model: simpleModel }
  } catch {
    // LLM 分类失败时用关键词规则兜底
    const intent = classifyWithKeywords(userMessage)
    if (intent === 'complex') {
      return { intent: 'complex', provider: complexProvider, model: complexModel }
    }
    return { intent: 'simple', provider: simpleProvider, model: simpleModel }
  }
}

/**
 * 用便宜模型做意图分类，只输出一个单词
 */
async function classifyWithLLM(
  message: string,
  provider: ProviderType,
  model: string,
  config: ProviderConfig,
): Promise<IntentLevel> {
  const modelInstance = createModel(provider, model, config)
  const result = await generateText({
    model: modelInstance,
    system: `你是意图分类器。分析用户消息，只返回一个单词：
simple - 简单数据查询（查流水、看余额、查预算、分类查询、简单问答）
complex - 复杂分析（对比分析、趋势统计、报表生成、多步骤操作、设定预算/记账）

规则：
- 包含"分析"、"趋势"、"对比"、"统计"、"报表"、"建议"、"这月汇总"、"今年" → complex
- 包含"花了多少"、"余额"、"记一笔"、"分类"、"预算还剩" → simple
- 设置类操作（设预算、记账）→ complex

只输出 simple 或 complex，不要其他内容。`,
    messages: [{ role: 'user', content: message }],
    temperature: 0,
    maxOutputTokens: 10,
  })
  const text = result.text.trim().toLowerCase()
  return text === 'complex' ? 'complex' : 'simple'
}

/**
 * 关键词规则兜底（LLM 调用失败时使用）
 */
function classifyWithKeywords(message: string): IntentLevel {
  const complexKeywords = [
    '分析', '报表', '趋势', '统计', '对比', '比较',
    '建议', '优化', '规划', '评估', '汇总', '总结',
    '这月', '这个月', '本月', '今年', '全年', '年度',
    '设定', '设置', '创建', '修改', '删除', '记账',
    '写一笔', '记一笔', '帮我记',
  ]
  const matched = complexKeywords.filter((kw) => message.includes(kw))
  return matched.length > 0 ? 'complex' : 'simple'
}

import { createOpenAI } from '@ai-sdk/openai'
import { createAnthropic } from '@ai-sdk/anthropic'
import type { LanguageModelV3 } from '@ai-sdk/provider'

export type ProviderType =
  | 'openai'
  | 'anthropic'
  | 'deepseek'
  | 'qwen'
  | 'ollama'
  | 'zhipu'
  | 'gemini'
  | 'moonshot'
  | 'baichuan'
  | 'yi'
  | 'bytedance'
  | 'hunyuan'
  | 'minimax'
  | 'custom'

export interface ProviderConfig {
  apiKey: string
  baseURL?: string
}

export const ALL_PROVIDERS: { value: ProviderType; label: string; defaultModels: string[]; defaultBaseURL: string }[] = [
  {
    value: 'openai',
    label: 'OpenAI',
    defaultModels: ['gpt-5.4-nano', 'gpt-5.4-mini', 'gpt-5.4', 'gpt-5.4-pro'],
    defaultBaseURL: 'https://api.openai.com/v1',
  },
  {
    value: 'anthropic',
    label: 'Claude',
    defaultModels: ['claude-haiku-4-5', 'claude-sonnet-4-6', 'claude-opus-4-6'],
    defaultBaseURL: 'https://api.anthropic.com/v1',
  },
  {
    value: 'deepseek',
    label: 'DeepSeek',
    defaultModels: ['deepseek-chat', 'deepseek-reasoner'],
    defaultBaseURL: 'https://api.deepseek.com/v1',
  },
  {
    value: 'qwen',
    label: '通义千问',
    defaultModels: ['qwen-turbo', 'qwen-plus', 'qwen-max'],
    defaultBaseURL: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
  },
  {
    value: 'zhipu',
    label: '智谱 GLM',
    defaultModels: ['glm-4-flash', 'glm-4-plus'],
    defaultBaseURL: 'https://open.bigmodel.cn/api/paas/v4',
  },
  {
    value: 'gemini',
    label: 'Google Gemini',
    defaultModels: ['gemini-3.0-flash', 'gemini-3.0-pro'],
    defaultBaseURL: 'https://generativelanguage.googleapis.com/v1beta/openai',
  },
  {
    value: 'moonshot',
    label: '月之暗面 Kimi',
    defaultModels: ['moonshot-v1-8k', 'moonshot-v1-32k', 'moonshot-v1-128k'],
    defaultBaseURL: 'https://api.moonshot.cn/v1',
  },
  {
    value: 'baichuan',
    label: '百川',
    defaultModels: ['Baichuan4', 'Baichuan4-Air'],
    defaultBaseURL: 'https://api.baichuan-ai.com/v1',
  },
  {
    value: 'yi',
    label: '零一万物',
    defaultModels: ['yi-large', 'yi-medium', 'yi-spark'],
    defaultBaseURL: 'https://api.lingyiwanwu.com/v1',
  },
  {
    value: 'bytedance',
    label: '火山方舟 (豆包)',
    defaultModels: ['doubao-lite-32k', 'doubao-pro-32k'],
    defaultBaseURL: 'https://ark.cn-beijing.volces.com/api/v3',
  },
  {
    value: 'hunyuan',
    label: '腾讯混元',
    defaultModels: ['hunyuan-lite', 'hunyuan-pro'],
    defaultBaseURL: 'https://api.hunyuan.cloud.tencent.com/v1',
  },
  {
    value: 'minimax',
    label: 'MiniMax',
    defaultModels: ['abab6.5s-chat', 'abab6.5-chat'],
    defaultBaseURL: 'https://api.minimax.chat/v1',
  },
  {
    value: 'ollama',
    label: 'Ollama (本地)',
    defaultModels: ['qwen2.5:3b', 'qwen2.5:7b', 'deepseek-r1:8b'],
    defaultBaseURL: 'http://localhost:11434/v1',
  },
  {
    value: 'custom',
    label: '自定义 (OpenAI 兼容)',
    defaultModels: [],
    defaultBaseURL: '',
  },
]

export const DEFAULT_BASE_URLS: Record<ProviderType, string> = {
  openai: 'https://api.openai.com/v1',
  anthropic: 'https://api.anthropic.com/v1',
  deepseek: 'https://api.deepseek.com/v1',
  qwen: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
  zhipu: 'https://open.bigmodel.cn/api/paas/v4',
  gemini: 'https://generativelanguage.googleapis.com/v1beta/openai',
  moonshot: 'https://api.moonshot.cn/v1',
  baichuan: 'https://api.baichuan-ai.com/v1',
  yi: 'https://api.lingyiwanwu.com/v1',
  bytedance: 'https://ark.cn-beijing.volces.com/api/v3',
  hunyuan: 'https://api.hunyuan.cloud.tencent.com/v1',
  minimax: 'https://api.minimax.chat/v1',
  ollama: 'http://localhost:11434/v1',
  custom: '',
}

/**
 * 创建语言模型实例
 * Anthropic 使用 createAnthropic，其他均通过 OpenAI 兼容 API 接入
 */
export function createModel(
  provider: ProviderType,
  modelName: string,
  config: ProviderConfig,
): LanguageModelV3 {
  const apiKey = config.apiKey
  const baseURL = config.baseURL || DEFAULT_BASE_URLS[provider]

  if (provider === 'anthropic') {
    const anthropic = createAnthropic({
      apiKey,
      baseURL: baseURL.replace(/\/v1$/, ''),
    })
    return anthropic.languageModel(modelName)
  }

  // OpenAI 兼容供应商
  const openai = createOpenAI({
    apiKey,
    baseURL: baseURL.replace(/\/v1\/?$/, '/v1'),
  })
  return openai.chat(modelName)
}

import { z } from 'zod'

// 发送消息
export const sendMessageSchema = z.object({
  sessionId: z.string().optional().describe('会话ID，不传则自动创建新会话'),
  accountBookId: z.string().describe('账本ID'),
  message: z.string().max(5000).default('').describe('消息文本，纯图片时可为空'),
  parentMessageId: z.string().optional().describe('父消息ID，用于构建对话链'),
  replaceAssistantDbId: z.string().optional().describe('重试时替换的助手消息ID'),
  attachmentIds: z.array(z.string()).optional().describe('附件ID列表（小票图片等）'),
}).refine((data) => data.message.trim().length > 0 || (data.attachmentIds && data.attachmentIds.length > 0), {
  message: '消息内容或附件至少需要提供一个',
  path: ['message'],
})

// 创建会话
export const createSessionSchema = z.object({
  title: z.string().max(100).optional().describe('会话标题'),
  modelProvider: z.string().optional().describe('模型供应商'),
  modelName: z.string().optional().describe('模型名称'),
  accountBookId: z.string().optional().describe('关联账本ID'),
})

// 更新会话
export const updateSessionSchema = z.object({
  title: z.string().max(100).optional().describe('会话标题'),
  modelProvider: z.string().optional().describe('模型供应商'),
  modelName: z.string().optional().describe('模型名称'),
  status: z.enum(['active', 'archived']).optional().describe('会话状态'),
})

// 确认/拒绝操作（始终批量）
export const confirmActionSchema = z.object({
  decisions: z.array(z.object({
    toolCallId: z.string().describe('工具调用ID'),
    approved: z.boolean().describe('是否批准'),
    data: z.object({}).passthrough().optional().describe('附加数据'),
  })).min(1).describe('决策列表'),
})

// 回复建议
export const respondSuggestionSchema = z.object({
  toolCallId: z.string().describe('工具调用ID'),
  values: z.record(z.string(), z.string()).nullable().describe('字段值映射，null表示取消'),
})

// 更新助手配置
export const updateAIConfigSchema = z.object({
  simpleProviderConfigId: z.string().nullable().optional().describe('简单任务供应商配置ID'),
  simpleModel: z.string().optional().describe('简单任务模型'),
  complexProviderConfigId: z.string().nullable().optional().describe('复杂任务供应商配置ID'),
  complexModel: z.string().optional().describe('复杂任务模型'),
  autoConfirmCreate: z.boolean().optional().describe('是否自动确认创建操作'),
  language: z.string().optional().describe('回复语言，如 zh-CN'),
  temperature: z.number().min(0).max(2).optional().describe('温度参数 0-2'),
  maxTokens: z.number().min(1).max(1000000).optional().describe('最大输出token数'),
  maxSteps: z.number().min(1).max(100).optional().describe('最大工具调用步数'),
  visionProviderConfigId: z.string().nullable().optional().describe('视觉识别供应商配置ID'),
  visionModel: z.string().optional().describe('视觉识别模型'),
})

// 供应商配置
export const createProviderConfigSchema = z.object({
  name: z.string().optional().describe('配置名称'),
  provider: z.string().describe('供应商类型：openai/anthropic/deepseek等'),
  apiKey: z.string().optional().describe('API密钥'),
  baseURL: z.string().optional().describe('API基础URL'),
  models: z.string().optional().describe('可用模型列表，逗号分隔'),
  temperature: z.number().min(0).max(2).nullable().optional().describe('默认温度'),
  maxTokens: z.number().min(1).max(1000000).nullable().optional().describe('默认最大token'),
})

export const updateProviderConfigSchema = z.object({
  name: z.string().optional().describe('配置名称'),
  provider: z.string().optional().describe('供应商类型'),
  apiKey: z.string().optional().describe('API密钥'),
  baseURL: z.string().optional().describe('API基础URL'),
  models: z.string().optional().describe('可用模型列表'),
  temperature: z.number().min(0).max(2).nullable().optional().describe('默认温度'),
  maxTokens: z.number().min(1).max(1000000).nullable().optional().describe('默认最大token'),
})

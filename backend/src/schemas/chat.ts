import { z } from 'zod'

// 发送消息
export const sendMessageSchema = z.object({
  sessionId: z.string().optional(),
  accountBookId: z.string(),
  message: z.string().min(1).max(5000),
})

// 创建会话
export const createSessionSchema = z.object({
  title: z.string().max(100).optional(),
  modelProvider: z.string().optional(),
  modelName: z.string().optional(),
  accountBookId: z.string().optional(),
})

// 更新会话
export const updateSessionSchema = z.object({
  title: z.string().max(100).optional(),
  modelProvider: z.string().optional(),
  modelName: z.string().optional(),
  status: z.enum(['active', 'archived']).optional(),
})

// 确认/拒绝操作
export const confirmActionSchema = z.object({
  toolCallId: z.string(),
  approved: z.boolean(),
})

// 更新偏好设置
export const updatePreferencesSchema = z.object({
  simpleProviderConfigId: z.string().nullable().optional(),
  simpleModel: z.string().optional(),
  complexProviderConfigId: z.string().nullable().optional(),
  complexModel: z.string().optional(),
  autoConfirmCreate: z.boolean().optional(),
  language: z.string().optional(),
  temperature: z.number().min(0).max(2).optional(),
  maxTokens: z.number().min(1).max(1000000).optional(),
})

// 供应商配置
export const createProviderConfigSchema = z.object({
  name: z.string().optional(),
  provider: z.string(),
  apiKey: z.string().optional(),
  baseURL: z.string().optional(),
  models: z.string().optional(),
  temperature: z.number().min(0).max(2).nullable().optional(),
  maxTokens: z.number().min(1).max(1000000).nullable().optional(),
})

export const updateProviderConfigSchema = z.object({
  name: z.string().optional(),
  provider: z.string().optional(),
  apiKey: z.string().optional(),
  baseURL: z.string().optional(),
  models: z.string().optional(),
  temperature: z.number().min(0).max(2).nullable().optional(),
  maxTokens: z.number().min(1).max(1000000).nullable().optional(),
})

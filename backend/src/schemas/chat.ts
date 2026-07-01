import { z } from 'zod'

// 发送消息
export const sendMessageSchema = z.object({
  sessionId: z.string().optional(),
  accountBookId: z.string(),
  message: z.string().min(1).max(5000),
  parentMessageId: z.string().optional(),
  replaceAssistantDbId: z.string().optional(),
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
  data: z.object({
    fileId: z.string().optional(),
    accountResolutions: z.array(z.object({
      sourceAccountName: z.string(),
      action: z.enum(['existing', 'create']),
      targetAccountId: z.string().optional(),
      targetAccountName: z.string().optional(),
      accountType: z.string().optional(),
    })).optional(),
    categoryResolutions: z.array(z.object({
      sourceCategory: z.string(),
      targetCategoryCode: z.string(),
      recordType: z.string().optional(),
      payerContains: z.string().optional(),
      descriptionContains: z.string().optional(),
    })).optional(),
    unrecognizedResolutions: z.array(z.object({
      rowIndex: z.number(),
      type: z.string(),
      accountId: z.string(),
      categoryCode: z.string(),
    })).optional(),
  }).optional(),
})

// 回复建议
export const respondSuggestionSchema = z.object({
  toolCallId: z.string(),
  values: z.record(z.string(), z.string()).nullable(), // null 表示取消，否则为 { field: value } 映射
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
  maxSteps: z.number().min(1).max(100).optional(),
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

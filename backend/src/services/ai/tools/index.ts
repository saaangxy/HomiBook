import type { ToolDef, ToolContext } from './types.js'
import { queryRecordsTool } from './query-records.js'
import { queryBudgetsTool } from './query-budgets.js'
import { queryAccountsTool } from './query-accounts.js'
import { getStatsTool } from './get-stats.js'
import { queryCategoriesTool } from './query-categories.js'
import { createRecordTool } from './create-record.js'
import { updateRecordTool } from './update-record.js'
import { deleteRecordTool } from './delete-record.js'
import { setBudgetTool } from './set-budget.js'
import { batchCreateRecordsTool } from './batch-create-records.js'
import { batchUpdateRecordsTool } from './batch-update-records.js'
import { suggestOptionsTool } from './suggest-options.js'
import { queryImportMappingsTool } from './query-import-mappings.js'
import { saveImportMappingTool } from './save-import-mapping.js'
import { previewImportTool } from './preview-import.js'
import { confirmImportTool } from './confirm-import.js'

// 所有可用工具注册
export const ALL_TOOLS: ToolDef[] = [
  queryRecordsTool,
  queryBudgetsTool,
  queryAccountsTool,
  getStatsTool,
  queryCategoriesTool,
  createRecordTool,
  updateRecordTool,
  deleteRecordTool,
  setBudgetTool,
  batchCreateRecordsTool,
  batchUpdateRecordsTool,
  suggestOptionsTool,
  queryImportMappingsTool,
  saveImportMappingTool,
  previewImportTool,
  confirmImportTool,
]

// 确认管理器：内存 Map 存储待确认的工具调用
interface PendingConfirmation {
  resolve: (approved: boolean) => void
  toolCallId: string
  toolName: string
  preview: string
}

const pendingConfirmations = new Map<string, PendingConfirmation>()

// 注册一个等待确认的工具调用（无限等待，直到用户确认或手动拒绝）
export function registerConfirmation(
  toolCallId: string,
  toolName: string,
  preview: string,
): Promise<boolean> {
  return new Promise((resolve) => {
    pendingConfirmations.set(toolCallId, {
      resolve,
      toolCallId,
      toolName,
      preview,
    })
  })
}

// 处理用户确认
export function confirmAction(toolCallId: string, approved: boolean): boolean {
  const pending = pendingConfirmations.get(toolCallId)
  console.log('[confirmAction] looking for:', toolCallId, 'found:', !!pending, 'pending keys:', getPendingConfirmations().map(p => p.toolCallId))
  if (!pending) return false

  pendingConfirmations.delete(toolCallId)
  pending.resolve(approved)
  return true
}

// 获取所有待确认项（供前端轮询或 SSE 推送）
export function getPendingConfirmations(): { toolCallId: string; toolName: string; preview: string }[] {
  return Array.from(pendingConfirmations.values()).map((p) => ({
    toolCallId: p.toolCallId,
    toolName: p.toolName,
    preview: p.preview,
  }))
}

// ---- 建议管理器（类似确认管理器，但返回用户选择的键值对）----

interface QuestionDef {
  question: string
  field: string
  options: string[]
  allowCustom: boolean
}

interface PendingSuggestion {
  resolve: (values: Record<string, string> | null) => void
  toolCallId: string
  questions: QuestionDef[]
}

const pendingSuggestions = new Map<string, PendingSuggestion>()

export function registerSuggestion(
  toolCallId: string,
  questions: QuestionDef[],
): Promise<Record<string, string> | null> {
  return new Promise((resolve) => {
    pendingSuggestions.set(toolCallId, {
      resolve,
      toolCallId,
      questions,
    })
  })
}

export function respondSuggestion(toolCallId: string, values: Record<string, string> | null): boolean {
  const pending = pendingSuggestions.get(toolCallId)
  if (!pending) return false
  pendingSuggestions.delete(toolCallId)
  pending.resolve(values)
  return true
}

export function getPendingSuggestions(): { toolCallId: string; questions: QuestionDef[] }[] {
  return Array.from(pendingSuggestions.values()).map((p) => ({
    toolCallId: p.toolCallId,
    questions: p.questions,
  }))
}

// ---- 用户导入覆盖数据存储 ----
// 前端 ImportPreviewInteractive 组件中用户修改后的映射规则
// 通过 confirmAction API 传入，由 confirm_import 消费

interface UserImportOverrides {
  accountResolutions?: { sourceAccountName: string; action: 'existing' | 'create'; targetAccountId?: string; targetAccountName?: string; accountType?: string }[]
  categoryResolutions?: { sourceCategory: string; targetCategoryCode: string; recordType?: string; payerContains?: string; descriptionContains?: string }[]
  unrecognizedResolutions?: { rowIndex: number; type: string; accountId: string; categoryCode: string }[]
  ownerId?: string
}

const userImportOverrides = new Map<string, UserImportOverrides>()

export function storeImportOverrides(fileId: string, data: UserImportOverrides) {
  userImportOverrides.set(fileId, data)
}

export function consumeImportOverrides(fileId: string): UserImportOverrides | undefined {
  const data = userImportOverrides.get(fileId)
  userImportOverrides.delete(fileId)
  return data
}

export function peekImportOverrides(fileId: string): UserImportOverrides | undefined {
  return userImportOverrides.get(fileId)
}

// 生成 AI SDK 可用的工具定义列表
export function buildAITools() {
  return ALL_TOOLS.map((tool) => ({
    description: tool.description,
    parameters: tool.parameters,
    execute: tool.execute,
  }))
}

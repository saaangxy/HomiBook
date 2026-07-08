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
import { ocrReceiptTool } from './ocr-receipt.js'

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
  ocrReceiptTool,
]

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

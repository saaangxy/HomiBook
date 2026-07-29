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
// 固定收支/贷款
import { queryRecurringTool } from './query-recurring.js'
import { createRecurringTool } from './create-recurring.js'
import { updateRecurringTool } from './update-recurring.js'
import { deleteRecurringTool } from './delete-recurring.js'
import { toggleRecurringTool } from './toggle-recurring.js'
import { loanPreviewTool } from './loan-preview.js'
import { queryRepaymentPlanTool } from './query-repayment-plan.js'
// 账户管理
import { createAccountTool } from './create-account.js'
import { updateAccountTool } from './update-account.js'
import { deleteAccountTool } from './delete-account.js'
import { adjustBalanceTool } from './adjust-balance.js'
import { queryBalanceHistoryTool } from './query-balance-history.js'
// 预算
import { deleteBudgetTool } from './delete-budget.js'
import { copyBudgetsTool } from './copy-budgets.js'
import { batchCreateBudgetsTool } from './batch-create-budgets.js'
// 管理
import { switchBookTool } from './switch-book.js'
import { queryMembersTool } from './query-members.js'
import { createBookTool } from './create-book.js'
// 流水
import { cloneRecordTool } from './clone-record.js'
import { detectDuplicatesTool } from './detect-duplicates.js'
import { batchDeleteRecordsTool } from './batch-delete-records.js'
// 记忆
import { saveMemoryTool } from './save-memory.js'
import { searchMemoryTool } from './search-memory.js'
import { deleteMemoryTool } from './delete-memory.js'
import { listMemoriesTool } from './list-memories.js'

// 所有可用工具按分类分组
export const TOOL_GROUPS: { label: string; tools: ToolDef[] }[] = [
  {
    label: '查询',
    tools: [
      queryRecordsTool,
      queryBudgetsTool,
      queryAccountsTool,
      getStatsTool,
      queryCategoriesTool,
    ],
  },
  {
    label: '流水操作',
    tools: [
      createRecordTool,
      updateRecordTool,
      deleteRecordTool,
      batchCreateRecordsTool,
      batchUpdateRecordsTool,
      cloneRecordTool,
      detectDuplicatesTool,
      batchDeleteRecordsTool,
    ],
  },
  {
    label: '预算',
    tools: [
      setBudgetTool,
      deleteBudgetTool,
      batchCreateBudgetsTool,
      copyBudgetsTool,
    ],
  },
  {
    label: '固定收支/贷款',
    tools: [
      queryRecurringTool,
      createRecurringTool,
      updateRecurringTool,
      deleteRecurringTool,
      toggleRecurringTool,
      loanPreviewTool,
      queryRepaymentPlanTool,
    ],
  },
  {
    label: '账户管理',
    tools: [
      createAccountTool,
      updateAccountTool,
      deleteAccountTool,
      adjustBalanceTool,
      queryBalanceHistoryTool,
    ],
  },
  {
    label: '管理',
    tools: [
      switchBookTool,
      queryMembersTool,
      createBookTool,
    ],
  },
  {
    label: '导入',
    tools: [
      suggestOptionsTool,
      queryImportMappingsTool,
      saveImportMappingTool,
      previewImportTool,
      confirmImportTool,
      ocrReceiptTool,
    ],
  },
  {
    label: '记忆',
    tools: [
      saveMemoryTool,
      searchMemoryTool,
      listMemoriesTool,
      deleteMemoryTool,
    ],
  },
]

export const ALL_TOOLS: ToolDef[] = TOOL_GROUPS.flatMap(g => g.tools)

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

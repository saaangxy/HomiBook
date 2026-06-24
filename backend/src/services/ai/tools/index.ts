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
]

// 确认管理器：内存 Map 存储待确认的工具调用
interface PendingConfirmation {
  resolve: (approved: boolean) => void
  toolCallId: string
  toolName: string
  preview: string
  timer: ReturnType<typeof setTimeout>
}

const pendingConfirmations = new Map<string, PendingConfirmation>()

// 60s 超时自动拒绝
const CONFIRM_TIMEOUT_MS = 60_000

// 注册一个等待确认的工具调用
export function registerConfirmation(
  toolCallId: string,
  toolName: string,
  preview: string,
): Promise<boolean> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      pendingConfirmations.delete(toolCallId)
      resolve(false)
    }, CONFIRM_TIMEOUT_MS)

    pendingConfirmations.set(toolCallId, {
      resolve,
      toolCallId,
      toolName,
      preview,
      timer,
    })
  })
}

// 处理用户确认
export function confirmAction(toolCallId: string, approved: boolean): boolean {
  const pending = pendingConfirmations.get(toolCallId)
  if (!pending) return false

  clearTimeout(pending.timer)
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

// 生成 AI SDK 可用的工具定义列表
export function buildAITools() {
  return ALL_TOOLS.map((tool) => ({
    description: tool.description,
    parameters: tool.parameters,
    execute: tool.execute,
  }))
}

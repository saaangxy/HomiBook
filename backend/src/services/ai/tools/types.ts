import type { ToolResult } from '../security.js'

// 每个工具的上下文：用户 + 账本信息（由路由层注入，不允许 LLM 自由选择）
export interface ToolContext {
  userId: string
  accountBookId: string
}

// 工具定义接口
export interface ToolDef {
  name: string
  displayName: string // 中文显示名称（系统提示词 + 前端工具管理）
  description: string
  promptHint?: string // 系统提示词中的补充说明（如"多条记录一次确认"）
  parameters: Record<string, unknown> // JSON Schema 格式
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  execute: (args: any, ctx: ToolContext) => Promise<ToolResult>
  requireConfirm?: boolean
  /**
   * 入参校验(可选):返回非 null 时直接把该错误结果回传给模型。
   * 用途:要求确认的工具在弹出确认卡之前先校验,避免非法入参让用户白确认一次;
   * execute 内仍会调用一次兜底(执行前的最后一次闸门)。
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  validateArgs?: (args: any) => ToolResult | null
}

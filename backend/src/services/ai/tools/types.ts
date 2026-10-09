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
  /**
   * AI SDK:把工具结果转换成「模型可见的内容」(可含图片 part)。
   *
   * ⚠️ 当前**没有任何工具使用它**。原打算给 view_image 用(把图片作为 tool-result 的 content
   * 当轮下发),但 openai-compatible 的 tool 消息**不支持图片 content** —— base64 会被当作文本
   * 塞进 messages,实测单次请求炸到 320 万 token、上游直接 400(整轮对话中断)。
   * 后改为「视觉问答」(让视觉模型看图后返回文字,见 tools/view-image.ts),与供应商能力解耦。
   * 保留此字段,供将来对接原生支持多模态 tool-result 的供应商。
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  toModelOutput?: (opts: { toolCallId: string; input: any; output: any }) => unknown
}

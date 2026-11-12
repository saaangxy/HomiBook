import type { ToolResult } from '../security.js'
import type { PreviewScope } from '../runtime/preview-scope.js'

// 每个工具的上下文：用户 + 账本信息（由路由层注入，不允许 LLM 自由选择）
export interface ToolContext {
  userId: string
  accountBookId: string
  /**
   * 本次执行来自「用户点了确认」的续流（/confirm），而不是模型直接调用。
   *
   * 放在 ctx 而不是 args：模型能伪造 args，但改不了 ctx。
   * confirm_import 靠它区分「返回预览」与「真正写库」两个阶段。
   */
  confirmed?: boolean
}

// 工具定义接口
//
// 工具只声明「是什么」与「怎么执行」，跨工具的通用动作（成员校验、审计、
// 参数闸门、挂起判定、确认卡分发）都由 runtime/run-tool.ts 统一接管。
export interface ToolDef {
  name: string
  displayName: string // 中文显示名称（系统提示词 + 前端工具管理）
  description: string
  promptHint?: string // 系统提示词中的补充说明（如"多条记录一次确认"）
  parameters: Record<string, unknown> // JSON Schema 格式
  /**
   * 执行工具。成功时**直接返回业务数据**（运行时包成 `{ success, data }`），
   * 业务失败 throw `ToolError`，其余异常由运行时归类。
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  execute: (args: any, ctx: ToolContext) => Promise<unknown>

  /** 需要用户确认后才执行：运行时先出确认卡，用户确认后再走 execute */
  requireConfirm?: boolean
  /**
   * 执行前挂起的另一种形态（confirm 用 requireConfirm）：
   * - suggestion: 返回问题列表，等用户选择后续流
   * - switch-book: 返回账本列表，等用户选账本
   */
  pause?: 'suggestion' | 'switch-book'
  /**
   * 执行后条件挂起：结果本身是一张待确认卡时返回 'confirm'
   * （preview_import 的 mode='preview'、confirm_import 的 confirm_preview）
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  pauseAfter?: (args: any, result: ToolResult) => 'confirm' | null
  /**
   * 确认卡预览构建器。第三个参数是**已绑定当前账本**的查询入口，
   * 不允许直接查 prisma —— 预览发生在用户确认之前，裸查询会跨账本泄露。
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  confirmation?: (args: any, ctx: ToolContext, scope: PreviewScope) => Promise<string>
  /** 只在界面上给「处理中」提示，不写进 toolCallEntries（读图类工具：历史回看不留痕） */
  uiHintOnly?: boolean

  /**
   * 入参校验(可选):返回非 null 时直接把该错误结果回传给模型。
   * 由运行时在成员校验之前统一调用一次，工具内不必再调。
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
   * 保留此字段,供将来对接原生支持多模态 tool-result 的供应商 —— 目前无使用者。
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  toModelOutput?: (opts: { toolCallId: string; input: any; output: any }) => unknown
}

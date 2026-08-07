/**
 * AI 工具确认/提交的"防重复提交"守卫。
 *
 * 问题背景：点击确认后，块的 status 会变为 pending，导致 ToolCallCard 及其子组件
 * （ConfirmPreviewView / SuggestionView / SwitchBookView / ImportPreviewInteractive / ImportConfirmCard）
 * 被重挂载，useState / useRef 全部重置，重复点击窗口随之出现。
 *
 * 因此用模块级 Set 记录"已提交"的工具调用 ID，跨重挂载保留，直到确认完成（或进入结果态）后清除。
 */

const submittedToolCalls = new Set<string>()

/** 标记该工具调用已提交（按钮应禁用） */
export function markSubmitted(toolCallId: string) {
  submittedToolCalls.add(toolCallId)
}

/** 是否已提交（用于按钮 disabled / 文案） */
export function isSubmitted(toolCallId: string | undefined): boolean {
  return !!toolCallId && submittedToolCalls.has(toolCallId)
}

/** 清除提交标记（确认完成 / 出错重试时调用） */
export function clearSubmitted(toolCallId: string | undefined) {
  if (toolCallId) submittedToolCalls.delete(toolCallId)
}

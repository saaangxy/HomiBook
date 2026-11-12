import type { ToolCallEntry } from '@homibook/core'
import type { ToolContext, ToolDef } from '../tools/types.js'
import { classifyToolError, type ToolResult } from '../security.js'
import type { PreviewScope } from './preview-scope.js'

/** 工具挂起、等用户决策的原因 */
export type PauseReason = 'confirm' | 'suggestion' | 'switch-book'

/**
 * 状态取值从 core 的枚举里收敛：core 一旦改名/删值，这里会编译失败，
 * 而不是像手写字面量那样静默漂移。
 */
type ResultStatus = Extract<ToolCallEntry['status'], 'success' | 'error'>
type PausedStatus = Extract<ToolCallEntry['status'], 'confirming' | 'suggesting' | 'switching'>

/**
 * 一次工具调用的结局。
 *
 * 只有两种：要么直接产出结果，要么挂起等用户决策。
 * SSE 编码、消息落库、UI 卡片都不在这里 —— 那是调用方（路由 adapter）的事。
 */
export type ToolOutcome =
  | { kind: 'result'; status: ResultStatus; result: ToolResult; durationMs: number }
  | {
      kind: 'paused'
      reason: PauseReason
      status: PausedStatus
      durationMs: number
      /** reason='confirm' 时的确认卡预览（JSON 字符串） */
      preview?: string
      /** suggestion / switch-book 的结构化数据（questions / books） */
      payload?: unknown
      /** 执行后暂停时携带的执行结果（preview_import / confirm_import） */
      result?: ToolResult
    }

export interface ToolRuntimeDeps {
  /** 账本成员校验，生产实现是 assertIsMember，测试注入内存 fake */
  assertMember(bookId: string, userId: string): Promise<void>
  /** 执行期审计：字段拼装只在这里做一次 */
  logToolCall(event: {
    toolName: string
    input: unknown
    output?: unknown
    errorMessage?: string
    durationMs: number
    status: ResultStatus
  }): Promise<void>
  /** 已绑定当前账本的预览查询入口 */
  scope?: PreviewScope
}

export interface RunToolInput {
  tool: ToolDef
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  args: any
  ctx: ToolContext
  deps: ToolRuntimeDeps
  /** 自动确认开启时跳过确认卡，直接执行 */
  autoConfirm?: boolean
}

const PAUSED_STATUS: Record<PauseReason, PausedStatus> = {
  confirm: 'confirming',
  suggestion: 'suggesting',
  'switch-book': 'switching',
}

/**
 * 执行一次工具调用。
 *
 * 顺序：参数闸门 → 成员校验 → 执行前挂起（确认 / 建议 / 切换账本）→ 执行 → 执行后条件挂起 → 审计。
 * 挂起时不开流、不落库，把决策交回调用方；调用方按 outcome 发对应 SSE 并记 pendingState。
 */
export async function runTool(input: RunToolInput): Promise<ToolOutcome> {
  const { tool, args, ctx, deps, autoConfirm } = input
  const start = Date.now()

  // 1. 参数闸门：非法入参直接回报模型，不让用户白确认一次
  const invalidArgs = tool.validateArgs?.(args)
  if (invalidArgs) {
    const durationMs = Date.now() - start
    await deps.logToolCall({
      toolName: tool.name,
      input: args,
      output: invalidArgs,
      durationMs,
      status: 'error',
    })
    return { kind: 'result', status: 'error', result: invalidArgs, durationMs }
  }

  // 2. 成员校验：工具内部不再各自调用
  try {
    await deps.assertMember(ctx.accountBookId, ctx.userId)
  } catch (err) {
    const result: ToolResult = {
      success: false,
      error: err instanceof Error ? err.message : String(err),
      retryable: false,
    }
    const durationMs = Date.now() - start
    await deps.logToolCall({ toolName: tool.name, input: args, output: result, durationMs, status: 'error' })
    return { kind: 'result', status: 'error', result, durationMs }
  }

  // 3. 执行前挂起：建议选项 / 切换账本（执行后把结构化数据交给调用方）
  if (tool.pause === 'suggestion' || tool.pause === 'switch-book') {
    try {
      const data = await tool.execute(args, ctx)
      return {
        kind: 'paused',
        reason: tool.pause,
        status: PAUSED_STATUS[tool.pause],
        durationMs: Date.now() - start,
        payload: data,
        result: { success: true, data, retryable: false },
      }
    } catch (err) {
      const info = classifyToolError(err)
      const result: ToolResult = {
        success: false,
        error: `[${tool.displayName}] ${info.message}`,
        retryable: info.retryable,
      }
      const durationMs = Date.now() - start
      await deps.logToolCall({ toolName: tool.name, input: args, output: result, durationMs, status: 'error' })
      return { kind: 'result', status: 'error', result, durationMs }
    }
  }

  // 4. 执行前挂起：确认卡
  if (tool.requireConfirm && !autoConfirm) {
    let preview: string
    try {
      if (!tool.confirmation) throw new Error('工具未声明确认卡构建器')
      if (!deps.scope) throw new Error('缺少确认卡查询入口')
      preview = await tool.confirmation(args, ctx, deps.scope)
    } catch (err) {
      const info = classifyToolError(err)
      const result: ToolResult = {
        success: false,
        error: `[${tool.displayName}] 生成确认信息失败：${info.message}`,
        retryable: info.retryable,
      }
      const durationMs = Date.now() - start
      await deps.logToolCall({ toolName: tool.name, input: args, output: result, durationMs, status: 'error' })
      return { kind: 'result', status: 'error', result, durationMs }
    }
    return {
      kind: 'paused',
      reason: 'confirm',
      status: PAUSED_STATUS.confirm,
      durationMs: Date.now() - start,
      preview,
    }
  }

  // 5. 执行：工具返回业务数据，异常统一归类成可回传的错误结果
  let result: ToolResult
  try {
    result = { success: true, data: await tool.execute(args, ctx), retryable: false }
  } catch (err) {
    const info = classifyToolError(err)
    result = { success: false, error: `[${tool.displayName}] ${info.message}`, retryable: info.retryable }
  }
  const status: ResultStatus = result.success ? 'success' : 'error'
  const durationMs = Date.now() - start

  // 6. 执行后条件挂起：结果本身就是一张待确认卡（导入预览 / 导入确认）
  const pauseAfter = tool.pauseAfter?.(args, result)
  if (pauseAfter) {
    return {
      kind: 'paused',
      reason: pauseAfter,
      status: PAUSED_STATUS[pauseAfter],
      durationMs,
      result,
    }
  }

  // 7. 审计 → 结果
  await deps.logToolCall({ toolName: tool.name, input: args, output: result, durationMs, status })
  return { kind: 'result', status, result, durationMs }
}

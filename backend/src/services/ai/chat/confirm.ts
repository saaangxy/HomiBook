import {prisma} from '../../../app.js'
import {ALL_TOOLS, peekImportOverrides, storeImportOverrides} from '../tools/index.js'
import {assertIsMember, classifyToolError} from '../security.js'
import {logToolCall} from '../audit.js'
import {buildChatMessages, findPendingToolMessage} from './history.js'
import {continueWithLLM} from './continue.js'
import type {EmitSSE} from './sse.js'
import type {TurnResult} from './types.js'

export interface ConfirmDecision {
  toolCallId: string
  approved: boolean
  data?: Record<string, unknown>
}

/**
 * 用户确认/拒绝之后的续写：先把每个 decision 落成工具结果，再重建消息数组让模型继续。
 *
 * 注意：这里仍直接调 `tool.execute`（历史路径），与 runtime/runTool 的差异是
 * 没有 validateArgs 与 assertMember —— 参数早已在弹卡前校验过，改接运行时要单独设计
 * 「已确认续流」入口，不要在这里硬塞分支。
 */
export async function runConfirmationTurn(opts: {
  userId: string
  decisions: ConfirmDecision[]
  enableWebSearch?: boolean
  emit: EmitSSE
}): Promise<TurnResult> {
  const { userId, decisions, enableWebSearch, emit } = opts

  // 所有 decisions 必须属于同一条消息
  const firstDecision = decisions[0]
  const found = await findPendingToolMessage(firstDecision.toolCallId, userId)
  if (!found.success) return { ok: false, status: found.status, message: found.message }
  const { message, toolCalls, accountBookId } = found.data

  const initialSSEEvents: { event: string; data: any }[] = []
  const pendingToolResults: { toolCallId: string; toolName: string; result: unknown }[] = []
  // 若本批包含 switch_book 决定，续流账本上下文切换为新账本
  let continuationBookId: string | null = null

  /**
   * 决策期审计：字段拼装只此一处，调用点只说明「谁做了哪个决定」。
   * 与执行期审计（runtime/run-tool.ts）分开——决策发生在工具早已返回之后。
   */
  const auditToolDecision = (entry: any, action: 'confirm' | 'reject', result?: unknown) =>
    logToolCall({
      userId,
      sessionId: message.sessionId,
      action,
      toolName: entry.toolName,
      input: entry.args,
      output: result,
    })

  for (const { toolCallId, approved, data } of decisions) {
    const entry = toolCalls.find((tc: any) => tc.toolCallId === toolCallId)
    if (!entry) continue

    if (!approved) {
      const toolResult = { success: false, error: entry.toolName === 'suggest_options' ? '用户取消了选择' : '用户拒绝了此操作', retryable: false }
      entry.status = 'error'
      entry.result = toolResult
      initialSSEEvents.push({ event: 'tool-result', data: { toolCallId, toolName: entry.toolName, result: toolResult, durationMs: 0, status: 'error' } })
      pendingToolResults.push({ toolCallId, toolName: entry.toolName, result: toolResult })
      await auditToolDecision(entry, 'reject')
      continue
    }

    // 每个 decision 各自存储自己的导入覆盖数据（先存再执行，避免多工具并行时 data 串扰）
    // key 用账单附件的 attachmentId（导入链路已统一到 attachmentId，不再有 fileId）
    const decData = data as Record<string, unknown> | undefined
    if (decData?.attachmentId) {
      const existing = peekImportOverrides(decData.attachmentId as string) || {}
      storeImportOverrides(decData.attachmentId as string, {
        accountResolutions: (decData.accountResolutions ?? existing.accountResolutions) as any,
        categoryResolutions: (decData.categoryResolutions ?? existing.categoryResolutions) as any,
        unrecognizedResolutions: (decData.unrecognizedResolutions ?? existing.unrecognizedResolutions) as any,
        ownerId: (decData.ownerId ?? existing.ownerId) as any,
      })
    }

    // switch_book 不执行工具本体（其结果是待选账本列表），按用户选择构造结果
    if (entry.toolName === 'switch_book') {
      const bookId = typeof decData?.bookId === 'string' ? decData.bookId : ''
      if (!bookId) {
        const toolResult = { success: false, error: '缺少账本ID', retryable: false }
        entry.status = 'error'
        entry.result = toolResult
        initialSSEEvents.push({ event: 'tool-result', data: { toolCallId, toolName: entry.toolName, result: toolResult, durationMs: 0, status: 'error' } })
        pendingToolResults.push({ toolCallId, toolName: entry.toolName, result: toolResult })
        continue
      }
      try {
        await assertIsMember(bookId, userId)
      } catch (e: any) {
        const toolResult = { success: false, error: e.message, retryable: false }
        entry.status = 'error'
        entry.result = toolResult
        initialSSEEvents.push({ event: 'tool-result', data: { toolCallId, toolName: entry.toolName, result: toolResult, durationMs: 0, status: 'error' } })
        pendingToolResults.push({ toolCallId, toolName: entry.toolName, result: toolResult })
        continue
      }
      const book = await prisma.accountBook.findUnique({ where: { id: bookId }, select: { name: true } })
      const toolResult = { success: true, data: { switched: true, bookId, bookName: book?.name || bookId } }
      entry.status = 'success'
      entry.result = toolResult
      initialSSEEvents.push({ event: 'tool-result', data: { toolCallId, toolName: entry.toolName, result: toolResult, durationMs: 0, status: 'success' } })
      pendingToolResults.push({ toolCallId, toolName: entry.toolName, result: toolResult })
      continuationBookId = bookId
      await auditToolDecision(entry, 'confirm', toolResult)
      continue
    }

    // suggest_options：用户已选择/填写的字段值直接作为工具结果
    if (entry.toolName === 'suggest_options') {
      const toolResult = { success: true, values: (decData?.values ?? {}) as Record<string, string> }
      entry.status = 'success'
      entry.result = toolResult
      initialSSEEvents.push({ event: 'tool-result', data: { toolCallId, toolName: entry.toolName, result: toolResult, durationMs: 0, status: 'success' } })
      pendingToolResults.push({ toolCallId, toolName: entry.toolName, result: toolResult })
      await auditToolDecision(entry, 'confirm', toolResult)
      continue
    }

    const tool = ALL_TOOLS.find(t => t.name === entry.toolName)
    if (!tool) {
      const toolResult = { success: false, error: '工具不存在', retryable: false }
      entry.status = 'error'
      entry.result = toolResult
      initialSSEEvents.push({ event: 'tool-result', data: { toolCallId, toolName: entry.toolName, result: toolResult, durationMs: 0, status: 'error' } })
      pendingToolResults.push({ toolCallId, toolName: entry.toolName, result: toolResult })
      continue
    }

    // confirmed: true 让 confirm_import 进入写库阶段；模型传参数无法伪造这一点
    const ctx = { userId, accountBookId, confirmed: true }
    let toolResult: any
    try {
      if (entry.toolName === 'preview_import') {
        const args = entry.args || {}
        const userOverrides = peekImportOverrides(args.attachmentId as string)
        const mergedArgs = { ...args, accountResolutions: userOverrides?.accountResolutions ?? args.accountResolutions, categoryResolutions: userOverrides?.categoryResolutions ?? args.categoryResolutions }
        const reData = ((await tool.execute(mergedArgs, ctx)) ?? {}) as any
        toolResult = {
          success: true, retryable: false,
          // confirmed: true 标记该预览已确认，前端 ImportPreviewInteractive 据此切换为「已确认」并禁用按钮（防重复提交）
          data: { mode: 'review', confirmed: true, source: reData.source, records: reData.records ? (reData.records as any[]).map((r: any) => ({ type: r.type, categoryCode: r.categoryCode, categoryLabel: r.categoryLabel, mappedCategoryCode: r.mappedCategoryCode, mappedCategoryLabel: r.mappedCategoryLabel, payer: r.payer, remark: r.remark })) : [], unrecognizedRecords: reData.unrecognizedRecords ? (reData.unrecognizedRecords as any[]).map((r: any) => ({ type: r.type, categoryCode: r.categoryCode, categoryLabel: r.categoryLabel, mappedCategoryCode: r.mappedCategoryCode, mappedCategoryLabel: r.mappedCategoryLabel, payer: r.payer, remark: r.remark })) : [], unmatchedAccounts: reData.unmatchedAccounts || [], unmatchedCategories: reData.unmatchedCategories || [], stats: reData.stats, message: '请检查以上映射结果是否正确。' },
        }
      } else if (entry.toolName === 'confirm_import') {
        const args = entry.args || {}
        const userOverrides = peekImportOverrides(args.attachmentId as string)
        const mergedArgs: any = { ...args }
        if (userOverrides?.ownerId) mergedArgs.ownerId = userOverrides.ownerId
        toolResult = { success: true, data: await tool.execute(mergedArgs, ctx), retryable: false }
      } else {
        toolResult = { success: true, data: await tool.execute(entry.args || {}, ctx), retryable: false }
      }
    } catch (err) {
      const info = classifyToolError(err)
      toolResult = { success: false, error: `[${tool.displayName}] ${info.message}`, retryable: info.retryable }
    }

    entry.status = toolResult.success ? 'success' : 'error'
    entry.result = toolResult
    initialSSEEvents.push({ event: 'tool-result', data: { toolCallId, toolName: entry.toolName, result: toolResult, durationMs: 0, status: entry.status } })
    pendingToolResults.push({ toolCallId, toolName: entry.toolName, result: toolResult })
    await auditToolDecision(entry, 'confirm', toolResult)
  }

  // 统一写入 DB
  await prisma.chatMessage.update({
    where: { id: message.id },
    data: { toolCalls: JSON.stringify(toolCalls) },
  }).catch(() => {})

  const { messages, messageIds } = await buildChatMessages(message.sessionId, pendingToolResults)
  return continueWithLLM({
    emit,
    sessionId: message.sessionId,
    accountBookId: continuationBookId || accountBookId,
    userId,
    message,
    messages,
    messageIds,
    initialSSEEvents,
    enableWebSearch,
  })
}

import {jsonSchema, stepCountIs, streamText} from 'ai'
import {prisma} from '../../../app.js'
import {createModel, type ProviderType} from '../providers.js'
import {ALL_TOOLS, ALWAYS_ENABLED_TOOL_NAMES} from '../tools/index.js'
import {runTool} from '../runtime/run-tool.js'
import {createPreviewScope} from '../runtime/preview-scope.js'
import {resolveToolAvailability} from '../runtime/availability.js'
import {assertIsMember} from '../security.js'
import {logToolCall} from '../audit.js'
import {nextToolCallId} from '../tool-call-id.js'
import {estimateTokens} from '../token-estimate.js'
import {applyPendingImageInjection, buildPendingImageMessage, requestImageInjection} from './pending-image.js'
import {friendlyAIErrorMessage, splitResultBatches, type EmitSSE} from './sse.js'

export interface StreamAssistantOptions {
  /** SSE 下发函数；HTTP 细节（写头、连接生命周期）由路由负责，本模块不认 Fastify */
  emit: EmitSSE
  sessionId: string
  accountBookId: string
  userId: string
  systemPrompt: string
  messages: any[]
  parentMessageId: string
  provider: string
  model: string
  apiKey: string
  baseURL: string
  temperature: number
  maxTokens: number
  maxSteps: number
  autoConfirmCreate: boolean
  disabledTools: string[]
  /**
   * 本轮运行时禁用(如用户关了联网搜索)。这些工具**仍留在 tools 里**,
   * 只在执行层拒绝 —— 否则开关一变，请求前缀(含 tools)变化，整段历史缓存失效。
   */
  runtimeDisabledTools?: string[]
  initialSSEEvents?: { event: string; data: any }[]
  /** 本轮带图且尚无摘要缓存:首步强制调用 save_image_content(只写文字，不产生第二次识图) */
  forceImageSummary?: boolean
}

export interface AssistantTurnOutcome {
  assistantMessageId: string | null
  usage?: unknown
  pendingSwitchBook?: unknown
  pendingConfirmations?: unknown
  pendingSuggestion?: unknown
}

/**
 * 执行一轮助手回复：建工具表 → streamText → 逐事件下发 → 落库快照。
 * 所有入口（/send、/confirm、续写）都经过这里，因此待注入图片也在这里统一消费。
 */
export async function streamAssistantTurn(opts: StreamAssistantOptions): Promise<AssistantTurnOutcome> {
  const { emit, sessionId, accountBookId, userId, systemPrompt, messages, parentMessageId, provider, model, apiKey, baseURL, temperature, maxTokens, maxSteps, autoConfirmCreate, disabledTools, runtimeDisabledTools, forceImageSummary } = opts

  // view_image 请求「直接看图」时,把图作为 user message 注入一次。
  // 放在这里而不是各装配路径:所有入口(/send、/confirm、续写)都会经过本函数
  await applyPendingImageInjection(sessionId, messages)

  const sendSSE: EmitSSE = emit

  // 发送初始 SSE 事件（如已确认的工具结果）
  if (opts.initialSSEEvents) {
    for (const ev of opts.initialSSEEvents) {
      sendSSE(ev.event, ev.data)
    }
  }

  const toolCallEntries: any[] = []
  let fullText = ''
  let reasoningContent = ''
  let activeToolCount = 0
  const pendingState = { confirmations: [] as { toolCallId: string; toolName: string; args: any }[], suggestion: null as { toolCallId: string; questions: any[] } | null }

  const msgState = { dbId: null as string | null }
  const writeSnapshot = async () => {
    const toolCallsJson = toolCallEntries.length > 0 ? JSON.stringify(toolCallEntries) : null
    const snapData = {
      sessionId,
      accountBookId,
      role: 'assistant' as const,
      content: fullText,
      reasoningContent: reasoningContent || null,
      modelProvider: provider,
      modelName: model,
      toolCalls: toolCallsJson,
      tokenCount: estimateTokens(fullText) + (toolCallsJson ? estimateTokens(toolCallsJson) : 0),
      parentMessageId,
    }
    if (msgState.dbId) {
      await prisma.chatMessage.update({ where: { id: msgState.dbId }, data: snapData }).catch((e) => console.error('[chat-debug] chatMessage.update 失败:', e.message))
    } else {
      const created = await prisma.chatMessage.create({ data: snapData }).catch((e) => {
        console.error('[chat-debug] chatMessage.create 失败:', e.message, '| provider=', process.env.DATABASE_PROVIDER, '| sessionId=', sessionId)
        return null
      })
      if (created) msgState.dbId = created.id
    }
  }
  /**
   * 快照**串行化**：AI SDK 会**并发**执行同一 step 内的多个工具调用（例如一次导入 4 张预览卡），
   * 而每个工具执行内部都会 `await saveMessageSnapshot()`。并发进入时 `msgState.dbId` 都还是 null，
   * 于是各自 `create` 一条 assistant 消息 —— 同一 parent 下出现多条**兄弟消息**（实测 createdAt 精确同毫秒）：
   *   - 前端 buildActivePath 只取「最后一个子节点」，刷新后这条重复消息会把真正的分支整棵顶掉
   *     （表现：消息消失、确认状态回滚、历史像没加载）；
   *   - buildChatMessages 重放时会带上两份相同 tool_call 的消息，上游以 duplicate tool_call_id 拒整会话。
   * 用一条 promise 链把写入排队，保证「先到的 create、后到的 update」。
   */
  let snapshotQueue: Promise<void> = Promise.resolve()
  const saveMessageSnapshot = () => {
    const next = snapshotQueue.then(writeSnapshot)
    snapshotQueue = next.catch(() => {})
    return next
  }

  // 构建 AI SDK 工具：可用性规则统一由 runtime/availability 给出
  const availability = resolveToolAvailability(ALL_TOOLS, {
    userDisabled: disabledTools,
    runtimeDisabled: runtimeDisabledTools,
    alwaysEnabled: ALWAYS_ENABLED_TOOL_NAMES,
  })
  const runtimeDisabledSet = availability.runtimeBlocked
  const aiTools: Record<string, any> = {}
  for (const tool of availability.enabled) {
    aiTools[tool.name] = {
      description: tool.description,
      inputSchema: jsonSchema(tool.parameters as Record<string, unknown>),
      // 工具可自带 toModelOutput:把结果转成模型可见的内容(如 view_image 把图片按需注入当轮)
      ...(tool.toModelOutput ? { toModelOutput: tool.toModelOutput } : {}),
      execute: async (args: any) => {
        const start = Date.now()
        // 运行时禁用(如本轮关了联网):工具仍留在 tools 里(保证请求前缀稳定),
        // 这里静默拒绝并告知模型 —— 不推 SSE,界面不会出现一张失败卡
        if (runtimeDisabledSet.has(tool.name)) {
          const error = `本轮未启用「${tool.displayName}」,请改用其他方式回答`
          await logToolCall({
            userId,
            sessionId,
            action: 'tool_call',
            toolName: tool.name,
            input: args,
            errorMessage: error,
            durationMs: 0,
            status: 'error'
          })
          return { success: false, error, retryable: false }
        }
        // id 必须唯一:并行调用同名工具时时间戳相同,重复 id 会让上游拒绝整个会话(见 tool-call-id.ts)
        const toolCallId = nextToolCallId(tool.name)
        sendSSE('tool-call', { toolCallId, toolName: tool.name, args })
        // 读图类工具只给前端一个「读图中」状态:不写进 toolCallEntries ⇒ 不落 assistant.toolCalls,
        // 历史回看不留痕;SSE 照常推,当轮界面才有进度可显示
        if (!tool.uiHintOnly) {
          toolCallEntries.push({ toolCallId, toolName: tool.name, args, status: 'pending', textOffset: fullText.length })
        }
        activeToolCount++

        // 把 outcome 落到「消息里那一条记录」，避免每个分支各抄一遍 find + assign
        const syncEntry = (patch: Record<string, unknown>) => {
          const entry = toolCallEntries.find(e => e.toolCallId === toolCallId)
          if (entry) Object.assign(entry, patch)
        }
        // 结果超过 50 条分帧推送，前端按 merge 指令拼接
        const sendResult = (result: any, durationMs: number, status: 'success' | 'error') => {
          const batches = splitResultBatches(result, 50)
          if (batches.length === 1) {
            sendSSE('tool-result', { toolCallId, toolName: tool.name, result, durationMs, status })
            return
          }
          for (let i = 0; i < batches.length; i++) {
            const merge = i === 0
              ? { total: batches.length }
              : { action: 'append' as const, batch: i + 1, total: batches.length }
            sendSSE('tool-result', {
              toolCallId,
              toolName: tool.name,
              result: batches[i],
              durationMs,
              status: batches[i].success ? 'success' : 'error',
              merge,
            })
          }
        }
        try {
          // 参数闸门、成员校验、挂起判定、审计全部由运行时接管；
          // 这里只按 outcome 发 SSE 并登记 pendingState（HTTP 与消息落库属于 adapter 职责）
          const outcome = await runTool({
            tool,
            args,
            ctx: { userId, accountBookId },
            autoConfirm: autoConfirmCreate,
            deps: {
              assertMember: assertIsMember,
              logToolCall: (event) => logToolCall({ userId, sessionId, action: 'tool_call', ...event }),
              scope: createPreviewScope(accountBookId),
            },
          })

          if (outcome.kind === 'result') {
            // view_image 请求「直接看图」→ 记下来,下一次请求把它作为图片注入一次。
            // fromPart/toPart 是模型指定的分段区间,用于续看或跳读长截图的任意部分。
            // 跨轮注入属于会话层状态，留在路由而不是工具运行时。
            if (tool.name === 'view_image' && (args as any)?.needImage && outcome.result.success) {
              const attachmentId = (outcome.result as any).data?.attachmentId
              const fromPart = (outcome.result as any).data?.fromPart as number | undefined
              const toPart = (outcome.result as any).data?.toPart as number | undefined
              if (attachmentId) {
                requestImageInjection(sessionId, { attachmentId, fromPart, toPart })
              }
            }
            sendResult(outcome.result, outcome.durationMs, outcome.status)
            syncEntry({ result: outcome.result, durationMs: outcome.durationMs, status: outcome.status })
            return outcome.result
          }

          // ---- 挂起：先落卡片需要的状态，再由路由发对应 SSE 并登记 pendingState ----
          if (outcome.reason === 'confirm') {
            // preview_import / confirm_import 的结果本身就是卡片内容，先推结果再挂起
            if (outcome.result) {
              const resultStatus = outcome.result.success ? 'success' : 'error'
              sendResult(outcome.result, outcome.durationMs, resultStatus)
              syncEntry({ result: outcome.result, durationMs: outcome.durationMs, status: resultStatus })
            }
            if (outcome.preview) {
              sendSSE('tool-confirm-required', { toolCallId, toolName: tool.name, preview: outcome.preview })
              syncEntry({ status: 'confirming', preview: outcome.preview })
            } else {
              syncEntry({ status: 'confirming' })
            }
            await saveMessageSnapshot()
            pendingState.confirmations.push({ toolCallId, toolName: tool.name, args })
            return outcome.result ?? { __pending: true, toolCallId }
          }

          if (outcome.reason === 'suggestion') {
            // 规范化在工具里做（suggest-options.ts 的 execute），这里只取结果
            const questions = ((outcome.payload as { questions?: unknown[] } | undefined)?.questions ?? []) as {
              question: string; field: string; options: string[]; allowCustom: boolean
            }[]
            sendSSE('tool-suggest-required', { toolCallId, toolName: tool.name, questions })
            syncEntry({ status: 'suggesting', suggestion: { questions } })
            await saveMessageSnapshot()
            pendingState.suggestion = { toolCallId, questions }
            return { __pending: true, toolCallId }
          }

          // switch-book：账本列表由 execute 返回，用户在 /confirm 里选定后再续流
          const payload = (outcome.payload ?? {}) as { books?: unknown[]; currentBookId?: string }
          sendSSE('tool-switch-book', { toolCallId, books: payload.books || [], currentBookId: payload.currentBookId })
          syncEntry({ result: outcome.result, status: 'switching' })
          await saveMessageSnapshot()
          pendingState.confirmations.push({ toolCallId, toolName: tool.name, args })
          return { __pending: true, toolCallId }
        } catch (err: any) {
          const durationMs = Date.now() - start
          sendSSE('tool-result', { toolCallId, toolName: tool.name, error: err.message, durationMs, status: 'error' })
          await logToolCall({
            userId,
            sessionId,
            action: 'tool_call',
            toolName: tool.name,
            input: args,
            errorMessage: err.message,
            durationMs,
            status: 'error'
          })
          const entry = toolCallEntries.find(e => e.toolCallId === toolCallId)
          if (entry) Object.assign(entry, { result: { error: err.message }, durationMs, status: 'error' })
          return { success: false, error: err.message, retryable: false }
        } finally {
          activeToolCount--
        }
      },
    }
  }

  const abortController = new AbortController()

  try {
    const llmModel = createModel(provider as ProviderType, model, { apiKey, baseURL })
    /**
     * 是否禁用 tool_choice。
     * DeepSeek 官方 API 的模型(chat / reasoner / flash)在有思考能力时都拒绝 tool_choice,
     */
    const isThinkingModel =
      provider === 'deepseek' || /reasoner|thinking|flash|(^|[^\d])o[13]([^\d]|$)/i.test(model)

    const result = streamText({
      model: llmModel,
      system: systemPrompt,
      messages,
      tools: aiTools,
      temperature,
      maxOutputTokens: maxTokens,
      stopWhen: stepCountIs(maxSteps),
      abortSignal: abortController.signal,
      // prepareStep 是 SDK 里唯一能在「同一次请求内、下一步之前」改 messages 的钩子:
      //   · step 0:forceImageSummary 时强制模型先记录图片内容
      //   · step >0:上一步 view_image 请求了原图时,把图插进下一步的 messages(同轮就能看到,不用等下一轮)
      prepareStep: async ({ stepNumber, messages: stepMessages }: { stepNumber: number; messages: any[] }) => {
        if (stepNumber > 0) {
          const injected = await buildPendingImageMessage(sessionId)
          if (injected) return { messages: [...stepMessages, injected] }
        }
        if (forceImageSummary && stepNumber === 0) {
          // DeepSeek 的思考模型(reasoner)不支持 tool_choice,传了会直接 400:
          // "Thinking mode does not support this tool_choice"
          // 这类模型不加约束,靠 system prompt 里的指引让它自行调用。
          if (isThinkingModel) return {}
          return { toolChoice: { type: 'tool' as const, toolName: 'save_image_content' } }
        }
        return {}
      },
      onStepFinish: () => {
        // 所有 tool 的 execute() 已执行完、tool-result 已全部 enqueue
        // 此时 controller 空闲，安全调用 abort 阻止下一步 LLM 调用
        if (pendingState.confirmations.length > 0 || pendingState.suggestion) {
          abortController.abort()
        }
      },
    })

    for await (const part of result.fullStream) {
      if (part.type === 'text-delta') {
        // ai@6 的 fullStream text/reasoning-delta part 字段名均为 text(经实测确认,非 delta)
        const deltaText = (part as any).text ?? ''
        fullText += deltaText
        sendSSE('text-delta', { delta: deltaText })
      } else if (part.type === 'reasoning-delta') {
        // DeepSeek 等推理模型的思考内容:累积存库并转发给前端渲染 thinking 块
        const deltaText = (part as any).text ?? ''
        reasoningContent += deltaText
        sendSSE('reasoning-delta', { delta: deltaText })
      } else if (part.type === 'error') {
        // AI SDK 把 API 错误作为流内 error part 发出，不会走 throw
        const errPart = part as { type: 'error'; error: unknown }
        sendSSE('error', { message: friendlyAIErrorMessage(errPart.error) })
        return { assistantMessageId: msgState.dbId, usage: null }
      }
    }

    // 流结束 → 保存最终 assistant 消息（包含所有已执行工具的结果）
    await saveMessageSnapshot()

    const confirmations = pendingState.confirmations
    if (confirmations.length > 0) {
      const switchBookConf = confirmations.find(c => c.toolName === 'switch_book')
      const otherConfs = confirmations.filter(c => c.toolName !== 'switch_book')
      const pendingConfirmations = otherConfs.map(c => ({ toolCallId: c.toolCallId, toolName: c.toolName }))

      sendSSE('finish', {
        ...(switchBookConf ? { pendingSwitchBook: { toolCallId: switchBookConf.toolCallId } } : {}),
        ...(pendingConfirmations.length > 0 ? { pendingConfirmations } : {}),
        assistantMessageId: msgState.dbId,
        userMessageId: parentMessageId,
      })
      return { assistantMessageId: msgState.dbId, pendingSwitchBook: switchBookConf, pendingConfirmations }
    }
    const suggestion = pendingState.suggestion
    if (suggestion) {
      sendSSE('finish', { pendingSuggestion: { toolCallId: suggestion.toolCallId }, assistantMessageId: msgState.dbId, userMessageId: parentMessageId })
      return { assistantMessageId: msgState.dbId, pendingSuggestion: suggestion }
    }

    const usage = await result.usage
    // usage 落库:含缓存命中量(cachedInputTokens / DeepSeek 的 prompt_cache_hit_tokens),
    // 是判断前缀缓存是否命中的唯一依据(以前只发给前端,无法观测)
    if (usage && msgState.dbId) {
      const cachedTokens = Number((usage as { cachedInputTokens?: number }).cachedInputTokens ?? 0)
      const inputTokens = Number((usage as { inputTokens?: number }).inputTokens ?? 0)
      // 前缀缓存命中率是这套改造的唯一验收指标:命中越多说明提示词前缀越稳定
      console.log(`[缓存] 输入 ${inputTokens} tokens,命中 ${cachedTokens} tokens${inputTokens > 0 ? `（${Math.round((cachedTokens / inputTokens) * 100)}%）` : ''}`)
      await prisma.chatMessage.update({
        where: { id: msgState.dbId },
        data: { usageJson: JSON.stringify(usage) },
      }).catch(() => {})
    }
    sendSSE('finish', { usage, assistantMessageId: msgState.dbId, userMessageId: parentMessageId })
    return { assistantMessageId: msgState.dbId, usage }
  } catch (err: any) {
    // AbortError 是预期行为，等待并发工具执行完成后保存状态
    if (err.name === 'AbortError') {
      const deadline = Date.now() + 5000
      while (activeToolCount > 0 && Date.now() < deadline) {
        await new Promise(r => setTimeout(r, 50))
      }
      await saveMessageSnapshot().catch(() => {})
      return { assistantMessageId: msgState.dbId, usage: null }
    }
    await saveMessageSnapshot().catch(() => {})
    sendSSE('error', { message: friendlyAIErrorMessage(err) })
    return { assistantMessageId: msgState.dbId, usage: null }
  }
}

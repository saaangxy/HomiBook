import {prisma} from '../../../app.js'
import {createModel, type ProviderType} from '../providers.js'
import {ALL_TOOLS, ALWAYS_ENABLED_TOOL_NAMES} from '../tools/index.js'
import {resolveToolAvailability, WEB_SEARCH_TOOL_NAMES} from '../runtime/availability.js'
import {computeHistoryBudget, MAX_OUTPUT_TOKENS} from '../context-compress.js'
import {buildSystemPrompt} from './prompt.js'
import {loadAIConfig, loadBaseURL} from './session.js'
import {compressAndPersist, toolSchemaMap} from './budget.js'
import {streamAssistantTurn} from './stream.js'
import type {EmitSSE} from './sse.js'
import type {TurnResult} from './types.js'

/**
 * 确认/续写路径：用「被确认的那条消息」的模型配置继续生成。
 * 与 /send 的区别是不重新路由模型、不重新装配注入（注入已在首轮落库）。
 */
export async function continueWithLLM(opts: {
  emit: EmitSSE
  sessionId: string
  accountBookId: string
  userId: string
  message: { modelProvider: string | null; modelName: string | null; id: string }
  messages: any[]
  messageIds: string[]
  initialSSEEvents?: { event: string; data: any }[]
  enableWebSearch?: boolean
}): Promise<TurnResult> {
  const { emit, sessionId, accountBookId, userId, message, messages, messageIds, initialSSEEvents, enableWebSearch } = opts
  const prefs = await loadAIConfig(userId)
  const provider = message.modelProvider || ''
  const model = message.modelName || ''

  if (!provider || !model) {
    return { ok: false, status: 500, message: '无法确定模型配置，请重新发送消息' }
  }

  const providerConfigs = await prisma.userProviderConfig.findMany({ where: { userId } })
  const activeConfig = providerConfigs.find(c => c.provider === provider)
  const apiKey = activeConfig?.apiKey || ''
  const baseURL = activeConfig?.baseURL || (await loadBaseURL(provider))

  // 系统提示词是纯静态常量:账本/语言/工具清单等动态内容由注入消息承载(续写场景不重复注入)
  const systemPrompt = buildSystemPrompt()

  // 三级上下文压缩
  // 输出预留必须钳制:模型配置里可能被填成上下文窗口量级(实测 393216),
  // 它既是发给上游的 maxOutputTokens,又要从窗口里减掉,不钳会直接把输入空间挤没。
  const maxTokens = Math.min(activeConfig?.maxTokens ?? prefs.maxTokens, MAX_OUTPUT_TOKENS)
  // 续写场景只需要工具清单的体积（算上下文预算），不需要 execute
  const continuationAvailability = resolveToolAvailability(ALL_TOOLS, {
    userDisabled: prefs.disabledTools,
    alwaysEnabled: ALWAYS_ENABLED_TOOL_NAMES,
  })
  const historyBudget = computeHistoryBudget(
    activeConfig?.contextWindow,
    maxTokens,
    systemPrompt,
    toolSchemaMap(continuationAvailability.enabled),
  )
  const compressed = await compressAndPersist({
    sessionId,
    messages,
    messageIds,
    historyBudget,
    systemPrompt,
    model: createModel(provider as ProviderType, model, { apiKey, baseURL }),
  })

  const outcome = await streamAssistantTurn({
    emit, sessionId, accountBookId, userId, systemPrompt: compressed.systemPrompt, messages: compressed.messages,
    parentMessageId: message.id,
    provider, model, apiKey, baseURL,
    temperature: activeConfig?.temperature ?? prefs.temperature,
    maxTokens,
    maxSteps: prefs.maxSteps,
    autoConfirmCreate: prefs.autoConfirmCreate,
    disabledTools: prefs.disabledTools,
    // 与 /send 同口径:开关关闭时工具仍留在 tools 里,只在执行层拒绝(保证请求前缀稳定)
    runtimeDisabledTools: enableWebSearch === false ? [...WEB_SEARCH_TOOL_NAMES] : undefined,
    initialSSEEvents,
  })

  return { ok: true, assistantMessageId: outcome.assistantMessageId, usage: outcome.usage ?? null }
}

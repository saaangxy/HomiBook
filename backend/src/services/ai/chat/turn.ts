import type {z} from 'zod'
import {prisma} from '../../../app.js'
import {dateKey} from '../../../lib/date-time.js'
import type {sendMessageSchema} from '../../../schemas/chat.js'
import {createModel, type ProviderType} from '../providers.js'
import {ALL_TOOLS, ALWAYS_ENABLED_TOOL_NAMES} from '../tools/index.js'
import {resolveToolAvailability, WEB_SEARCH_TOOL_NAMES} from '../runtime/availability.js'
import {assertIsMember, loadUserProviderConfig} from '../security.js'
import {detectSkills} from '../skills/index.js'
import {
  buildAttachmentSection,
  collectInjections,
  enrichAttachmentSections,
  foldInjections,
  INJECT_ROLE,
  persistInjectionIfChanged,
  takeOverInjections
} from '../context-inject.js'
import {ensureImageTextContexts, type ImageTextContext} from '../image-context.js'
import {loadMemoriesForPrompt} from '../memory.js'
import {estimateTokens} from '../token-estimate.js'
import {computeHistoryBudget, MAX_OUTPUT_TOKENS} from '../context-compress.js'
import {buildSystemPrompt, buildToolPromptLines} from './prompt.js'
import {getOrCreateSession, loadAIConfig, loadBaseURL, resolveModelRoute} from './session.js'
import {buildHistoryChain, deleteAssistantSubtree, loadChatAttachments} from './history.js'
import {hasVisionCache, IMAGE_EXT_RE, injectImagesToLastUserMessage} from './pending-image.js'
import {compressAndPersist, toolSchemaMap} from './budget.js'
import {streamAssistantTurn} from './stream.js'
import type {EmitSSE} from './sse.js'
import type {TurnResult} from './types.js'

export type SendMessageInput = z.infer<typeof sendMessageSchema>

/**
 * 一次完整的「用户发消息 → 助手回复」。
 *
 * 顺序与副作用与拆分前逐行一致（附件 → 会话/模型 → 记忆 → 重试清理 → 历史链 → 路由 →
 * 工具集合 → 图片文字化 → 附件段 → 落库 → 注入继承 → 注入落库 → 折叠 → 压缩 → 流式）。
 * 唯一的差别是不再碰 Fastify reply：HTTP 状态通过返回值表达，SSE 通过 emit 下发。
 */
export async function runConversationTurn(opts: {
  userId: string
  input: SendMessageInput
  emit: EmitSSE
}): Promise<TurnResult> {
  const { userId, input, emit } = opts
  const { sessionId: sid, accountBookId, message, attachmentIds, enableWebSearch } = input

  try { await assertIsMember(accountBookId, userId) } catch (e: any) {
    return { ok: false, status: e.statusCode || 403, message: e.message }
  }

  // ── 1) 附件 ──
  const attachments = await loadChatAttachments(attachmentIds)

  // ── 2) 会话与模型配置 ──
  const session = await getOrCreateSession(sid, userId, message)

  // 加载用户配置
  const prefs = await loadAIConfig(userId)

  // 加载供应商配置(按归属读取:避免 AI 配置里的 ID 指向他人配置从而用其 apiKey)
  const simpleConfig = await loadUserProviderConfig(userId, prefs.simpleProviderConfigId)
  const complexConfig = await loadUserProviderConfig(userId, prefs.complexProviderConfigId)

  const simpleProvider = simpleConfig?.provider || ''
  const complexProvider = complexConfig?.provider || ''

  // 校验：必须至少配置一个模型
  const hasSimple = simpleProvider && prefs.simpleModel
  const hasComplex = complexProvider && prefs.complexModel
  if (!hasSimple && !hasComplex) {
    return { ok: false, status: 400, message: '请先在 AI 设置中配置模型后再发送消息' }
  }

  // ── 3) 长期记忆 ──
  const memories = await loadMemoriesForPrompt(userId, message, 8)

  // ── 3b) 会话消息快照(历史链与重试删除都要用) ──
  const allMessages = await prisma.chatMessage.findMany({
    where: { sessionId: session.id },
    orderBy: { createdAt: 'asc' },
    select: { id: true, role: true, content: true, parentMessageId: true },
    take: 1000,
  })

  // ── 4) 重试:删掉被替换的助手消息子树;记下被替换的用户消息(它的注入要继承) ──
  const retriedUserId = input.replaceAssistantDbId
    ? await deleteAssistantSubtree(input.replaceAssistantDbId)
    : null

  // ── 5) 历史链 ──
  const parentId = input.parentMessageId || null
  const { history, historyIds } = buildHistoryChain(allMessages, parentId)

  // ── 6) 模型路由(必须在图片文字化之前:多模态主模型本轮直接看图,不必再花一次视觉调用) ──
  const routeResult = await resolveModelRoute({
    message,
    hasSimple: !!hasSimple,
    simpleProvider,
    complexProvider,
    simpleModel: prefs.simpleModel,
    complexModel: prefs.complexModel,
    simpleApiKey: simpleConfig?.apiKey || '',
  })
  if ('error' in routeResult) return { ok: false, status: 400, message: routeResult.error }
  const route = routeResult.route

  const activeConfig = route.provider === simpleProvider ? simpleConfig : complexConfig
  const apiKey = activeConfig?.apiKey || ''
  const baseURL = activeConfig?.baseURL || (await loadBaseURL(route.provider))

  // ── 7) 工具集合与图片附件判定 ──
  /**
   * 工具集合只由**用户设置**决定(会话内稳定)。
   * 联网开关 / 多模态这类「运行时状态」既不进 tools、也不改系统提示词,
   * 统一交给 streamAssistantTurn 在执行层拦截 ——
   * 否则用户每拨一次联网开关、每发一张图,整段历史的前缀缓存都会失效。
   */
  const userDisabledTools = prefs.disabledTools || []
  const runtimeDisabledTools = enableWebSearch === false ? [...WEB_SEARCH_TOOL_NAMES] : []
  const requestAvailability = resolveToolAvailability(ALL_TOOLS, {
    userDisabled: userDisabledTools,
    runtimeDisabled: runtimeDisabledTools,
    alwaysEnabled: ALWAYS_ENABLED_TOOL_NAMES,
  })
  // 注入段用:首轮给完整清单,之后按「已禁用/已恢复」发差量(见 planInjection)
  const toolsText = buildToolPromptLines(new Set(userDisabledTools))
  const toolNames = requestAvailability.enabled.map(t => t.name)

  // ── 图片附件 ──
  const imageAttachments = attachments.filter(a => IMAGE_EXT_RE.test(a.originalFilename))
  // 多模态主模型：消息含图片附件时直接注入图片(ocr_receipt 保持可用,由技能提示引导不要重复识别)
  const isMultimodalImage = !!activeConfig?.multimodal && imageAttachments.length > 0

  // ── 8) 图片文字化(仅纯文本主模型需要) ──
  /**
   * 图片「文字化」(摘要/OCR 全文/关键字段)只为**后续轮次**能记得图片内容。
   * 多模态主模型本轮会直接看图 —— 若在这里 await,同一张图会先被视觉模型看一遍、再被主模型看一遍,
   * 首响被硬生生拖长数秒(大图还要切片,更慢)。因此多模态场景直接跳过,
   * 用户追问视觉细节时由 view_image 工具按需重读(该链路的缓存仍在)。
   * 纯文本主模型看不到图,仍需提前提取,保持等待。
   */
  const imageTextContexts: Map<string, ImageTextContext> = isMultimodalImage
    ? new Map()
    : await ensureImageTextContexts(
        imageAttachments.map(a => ({ id: a.id, path: a.url, originalFilename: a.originalFilename })),
        userId,
      )

  /**
   * 有图、且至少一张还没有摘要缓存 ⇒ 首步强制调用 save_image_content。
   * 用「无缓存」做条件:同一张图再次发送时不必重复强制(用户可能只是追加提问)。
   * 该工具不可禁用(见 ALWAYS_ENABLED_TOOLS)
   */
  const forceImageSummary = isMultimodalImage && !(await hasVisionCache(imageAttachments.map(a => a.id)))

  // ── 9) 附件清单注入段 ──
  // 改走「注入消息」下发(以前只拼在请求文本里不落库,下一轮重放文本不同会在此处丢缓存)
  // 多模态场景传 true:本轮图片是直接下发的,提示词要改成「看图作答」而不是「凭摘要作答」
  const attachmentSection = buildAttachmentSection(attachments, imageTextContexts, isMultimodalImage)
  // 技能检测仍用「用户原文 + 附件信息」(导入/图片账单等技能靠其中的标记触发)
  const fullMessage = attachmentSection ? `${message}\n\n${attachmentSection}` : message

  // ── 10) 落库用户消息 + 附件关联 ──
  // 数据库只存用户原文;附件信息随后随注入消息折叠回这条消息
  history.push({ role: 'user', content: message })

  // 保存用户消息（仅用户输入的文本，不含系统附加的附件信息）
  const userMsgDb = await prisma.chatMessage.create({
    data: { sessionId: session.id, accountBookId, role: 'user', content: message, parentMessageId: parentId, tokenCount: estimateTokens(message) },
  })
  historyIds.push(userMsgDb.id)

  // 持久化消息与附件的关联（历史会话回显附件 + 防止孤儿清理误删聊天中的附件）
  if (attachments.length > 0) {
    await prisma.chatMessageAttachment.createMany({
      data: attachments.map(a => ({ messageId: userMsgDb.id, attachmentId: a.id })),
    })
  }

  // ── 11) 注入继承(重试 / 编辑重发) ──
  // 重试：接管被替换那条用户消息的注入内容（日期/记忆/技能）。
  // 这些是会话级差量、新一轮不会再写，而旧消息已不在历史链上 —— 不接管模型这一轮就看不到它们了。
  // 取回的文本随后作为 extraSections 交给 persistInjectionIfChanged，与新一轮的附件段**合并成同一条**
  // 注入消息（与首次发送的形态一致，避免出现「记忆/技能」+「附件清单」两个 chip）。
  //
  // 编辑重发走另一条路：新消息与被编辑的那条是「同父兄弟」（前端把新消息挂在同一个 parent 下），
  // 它的注入同样要带过来，否则新分支只剩新一轮生成的「附件清单」——模型这一轮就看不到日期/记忆/技能
  // （表现为：编辑后 AI 忘了用户偏好/记忆）。与重试的区别是编辑要**保留**那条旧消息（1/2 可切换），
  // 所以只复制内容、不删旧注入。
  let injectSourceUserId = retriedUserId
  if (!injectSourceUserId) {
    const sibling = await prisma.chatMessage.findFirst({
      where: {
        sessionId: session.id,
        role: 'user',
        id: { not: userMsgDb.id },
        // 编辑首条消息时前端传来的父是空（本地 greeting 锚点不发给后端），
        // 而老数据里那条的父是 'greeting' —— 两种都要能匹配到。
        ...(parentId
          ? { parentMessageId: parentId }
          : { OR: [{ parentMessageId: null }, { parentMessageId: 'greeting' }] }),
      },
      orderBy: { createdAt: 'desc' },
      select: { id: true },
    }).catch(() => null)
    injectSourceUserId = sibling?.id ?? null
  }

  const inheritedSections = retriedUserId && retriedUserId !== userMsgDb.id
    ? await takeOverInjections(retriedUserId).catch(() => [])
    : injectSourceUserId && injectSourceUserId !== userMsgDb.id
      ? await collectInjections(injectSourceUserId).catch(() => [])
      : []

  // 重试：清掉被替换的旧用户消息 —— 前端只删了**本地**那条，DB 里留着会让刷新后出现
  // 「同一条消息两遍」（新消息的 parentId 指向旧消息之前，两者互为兄弟，都会被拉回来）。
  // 先把旧消息剩余的子消息（用户切换过的其他回复版本）转挂到新消息上再删，版本不丢；
  // parentMessageId 无外键约束，删除本身安全；附件的关联行随消息级联清理，附件文件不受影响。
  if (retriedUserId && retriedUserId !== userMsgDb.id) {
    await prisma.chatMessage.updateMany({
      where: { parentMessageId: retriedUserId, role: { not: INJECT_ROLE } },
      data: { parentMessageId: userMsgDb.id },
    }).catch(() => {})
    await prisma.chatMessage.delete({ where: { id: retriedUserId } }).catch(() => {})
  }

  // ── 12) 账本名 / 技能检测 ──
  const book = await prisma.accountBook.findUnique({
    where: { id: accountBookId },
    select: { name: true },
  })
  const bookName = book?.name || accountBookId

  const activeSkills = detectSkills(fullMessage)

  // ── 13) 上下文注入落库(日期/记忆/技能/附件段) ──
  // 只追加差量、落库为 inject 消息,随后折叠回本轮用户消息。
  // 这些内容以前拼在系统提示词里,一变就让其后整段历史缓存失效;现在变化只影响新追加的那一条。
  const sessionState = await prisma.chatSession
    .findUnique({ where: { id: session.id }, select: { injectedContext: true } })
    .catch(() => null)
  const injection = await persistInjectionIfChanged({
    sessionId: session.id,
    accountBookId,
    userMessageId: userMsgDb.id,
    currentState: sessionState?.injectedContext,
    input: {
      today: dateKey(new Date()),
      memories,
      skills: activeSkills.map((s) => ({ name: s.name, prompt: s.buildPrompt({ multimodalImage: isMultimodalImage }) })),
      // 账本/语言/工具清单:首轮各注入一次,之后只在变化时追加(不再插值进系统提示词)
      bookId: accountBookId,
      bookName,
      language: prefs.language || 'zh-CN',
      toolsText,
      toolNames,
      disabledToolCount: ALL_TOOLS.length - requestAvailability.enabled.length,
      // 继承的段(重试)放最前,与新一轮的附件段合并成同一条注入消息(与首次发送的形态一致)
      extraSections: [
        ...inheritedSections,
        ...(attachmentSection ? [attachmentSection] : []),
      ],
    },
  })

  // ── 14) 系统提示词(纯静态,动态上下文已走注入消息) ──
  // 本轮带新图片时必须先记录图片内容:思考模型不允许 toolChoice 强制,
  // 只能靠这段强指令兜住,否则它可能跳过 save_image_content 直接凭空回答。
  const systemPrompt = buildSystemPrompt({ forceImageSummary })

  const messages = [...history]
  const messageIds = [...historyIds]
  // ── 15) 折叠注入 + 附件摘要补全(与 buildChatMessages 同一套规则) ──
  const injects = await prisma.chatMessage
    .findMany({
      where: { sessionId: session.id, role: INJECT_ROLE },
      orderBy: { createdAt: 'asc' },
      select: { parentMessageId: true, content: true },
    })
    .catch(() => [])
  foldInjections(messages, messageIds, injects)
  // 历史里的附件段按缓存补摘要:多模态首轮的摘要是主模型用 save_image_content 写的,
  // 注入段落库时还没有 —— 这里补回,后续轮次才「记得」图片(不写库、幂等)
  await enrichAttachmentSections(messages, messageIds, {
    messageId: userMsgDb.id,
    attachments: attachments.map(a => ({ id: a.id, originalFilename: a.originalFilename })),
  })

  // ── 16) 上下文压缩 ──
  // 输出预留必须钳制:模型配置里可能被填成上下文窗口量级(重试/续写路径同样适用)
  const maxTokens = Math.min(activeConfig?.maxTokens ?? prefs.maxTokens, MAX_OUTPUT_TOKENS)
  const historyBudget = computeHistoryBudget(
    activeConfig?.contextWindow,
    maxTokens,
    systemPrompt,
    toolSchemaMap(requestAvailability.enabled),
  )
  const compressed = await compressAndPersist({
    sessionId: session.id,
    messages,
    messageIds,
    historyBudget,
    systemPrompt,
    model: createModel(route.provider as ProviderType, route.model, { apiKey, baseURL }),
  })

  // ── 17) 注入本轮图片 base64(必须在压缩之后:压缩只处理文本,末尾消息一定保留) ──
  const finalMessages = isMultimodalImage
    ? await injectImagesToLastUserMessage(compressed.messages, imageAttachments)
    : compressed.messages

  // ── 18) 流式响应 ──
  const outcome = await streamAssistantTurn({
    emit,
    sessionId: session.id,
    accountBookId,
    userId,
    systemPrompt: compressed.systemPrompt,
    messages: finalMessages,
    parentMessageId: userMsgDb.id,
    provider: route.provider,
    model: route.model,
    apiKey,
    baseURL,
    temperature: activeConfig?.temperature ?? prefs.temperature,
    // 本轮注入实时回传:界面据此在用户消息下方显示「本轮注入了哪些记忆/技能」
    // (重试场景的继承段已合并进这一条注入消息,故这里仍是单条事件)
    initialSSEEvents: injection ? [{ event: 'context-injected', data: { userMessageId: userMsgDb.id, injection } }] : undefined,
    maxTokens,
    maxSteps: prefs.maxSteps,
    autoConfirmCreate: prefs.autoConfirmCreate,
    disabledTools: userDisabledTools,
    runtimeDisabledTools,
    forceImageSummary,
  })

  return { ok: true, assistantMessageId: outcome.assistantMessageId, usage: outcome.usage ?? null }
}

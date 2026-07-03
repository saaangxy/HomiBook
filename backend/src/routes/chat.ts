import type { FastifyInstance } from 'fastify'
import { streamText, stepCountIs, jsonSchema } from 'ai'
import { prisma } from '../app.js'
import { authenticate } from '../middleware/auth.js'
import { createModel, ALL_PROVIDERS, DEFAULT_BASE_URLS, type ProviderType } from '../services/ai/providers.js'
import { routeIntent, classifyWithKeywords } from '../services/ai/model-router.js'
import { assertIsMember } from '../services/ai/security.js'
import { logToolCall } from '../services/ai/audit.js'
import { ALL_TOOLS, storeImportOverrides, peekImportOverrides, consumeImportOverrides } from '../services/ai/tools/index.js'
import { buildConfirmPreview } from '../services/ai/confirm-preview.js'
import { sendMessageSchema, createSessionSchema, updateSessionSchema, confirmActionSchema, respondSuggestionSchema, updatePreferencesSchema, createProviderConfigSchema, updateProviderConfigSchema } from '../schemas/chat.js'

// ---- 共享流式响应函数：供 /send 和 /confirm 复用 ----

interface StreamAssistantOptions {
  reply: any
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
}

async function streamAssistantResponse(opts: StreamAssistantOptions) {
  const { reply, sessionId, accountBookId, userId, systemPrompt, messages, parentMessageId, provider, model, apiKey, baseURL, temperature, maxTokens, maxSteps } = opts

  reply.raw.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no',
  })

  const sendSSE = (event: string, data: unknown) => {
    try {
      reply.raw.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
    } catch (e) {
      console.error(`[SSE] write error for event "${event}":`, e)
    }
  }

  const toolCallEntries: any[] = []
  let fullText = ''
  const pendingState = { abort: null as { toolCallId: string; toolName: string; args: any } | null, suggestion: null as { toolCallId: string; questions: any[] } | null }

  const msgState = { dbId: null as string | null }
  const saveMessageSnapshot = async () => {
    const snapData = {
      sessionId,
      role: 'assistant' as const,
      content: fullText,
      modelProvider: provider,
      modelName: model,
      toolCalls: toolCallEntries.length > 0 ? JSON.stringify(toolCallEntries) : null,
      parentMessageId,
    }
    if (msgState.dbId) {
      await prisma.chatMessage.update({ where: { id: msgState.dbId }, data: snapData }).catch(() => {})
    } else {
      const created = await prisma.chatMessage.create({ data: snapData }).catch(() => null)
      if (created) msgState.dbId = created.id
    }
  }

  // 构建 AI SDK 工具
  const aiTools: Record<string, any> = {}
  for (const tool of ALL_TOOLS) {
    aiTools[tool.name] = {
      description: tool.description,
      inputSchema: jsonSchema(tool.parameters as Record<string, unknown>),
      execute: async (args: any) => {
        const start = Date.now()
        const toolCallId = `call_${tool.name}_${start}`
        sendSSE('tool-call', { toolCallId, toolName: tool.name, args })
        toolCallEntries.push({ toolCallId, toolName: tool.name, args, status: 'pending', textOffset: fullText.length })
        try {
          // ---- suggest_options：关闭流等待用户选择 ----
          if (tool.name === 'suggest_options') {
            const questions: { question: string; field: string; options: string[]; allowCustom: boolean }[] = (args.questions || []).map((q: any) => ({
              question: q.question, field: q.field, options: q.options, allowCustom: q.allowCustom ?? true,
            }))
            sendSSE('tool-suggest-required', { toolCallId, toolName: tool.name, questions })
            const entry = toolCallEntries.find(e => e.toolCallId === toolCallId)
            if (entry) Object.assign(entry, { status: 'suggesting', suggestion: { questions } })
            await saveMessageSnapshot()
            pendingState.suggestion = { toolCallId, questions }
            return { __pending: true, toolCallId }
          }

          // ---- requireConfirm：关闭流等待用户确认 ----
          if (tool.requireConfirm) {
            const preview = await buildConfirmPreview(tool.name, args, accountBookId)
            sendSSE('tool-confirm-required', { toolCallId, toolName: tool.name, preview })
            const entry = toolCallEntries.find(e => e.toolCallId === toolCallId)
            if (entry) Object.assign(entry, { status: 'confirming', preview })
            await saveMessageSnapshot()
            pendingState.abort = { toolCallId, toolName: tool.name, args }
            return { __pending: true, toolCallId }
          }

          // ---- 普通工具：直接执行 ----
          const result = await tool.execute(args, { userId, accountBookId })
          const durationMs = Date.now() - start
          const status = result.success ? 'success' : 'error'

          const batches = splitResultBatches(result, 50)
          if (batches.length > 1) {
            for (let i = 0; i < batches.length; i++) {
              const merge = i === 0 ? { total: batches.length } : { action: 'append' as const, batch: i + 1, total: batches.length }
              sendSSE('tool-result', { toolCallId, toolName: tool.name, result: batches[i], durationMs, status: batches[i].success ? 'success' : 'error', merge })
            }
          } else {
            sendSSE('tool-result', { toolCallId, toolName: tool.name, result, durationMs, status })
          }

          // ---- preview_import 预览模式：展示结果后再挂起确认 ----
          if (tool.name === 'preview_import' && (args as any).mode === 'preview' && result.success) {
            const entry = toolCallEntries.find(e => e.toolCallId === toolCallId)
            if (entry) Object.assign(entry, { result, durationMs, status })
            await saveMessageSnapshot()
            pendingState.abort = { toolCallId, toolName: tool.name, args }
            return result
          }

          // ---- confirm_import 确认预览模式：展示结果后再挂起确认 ----
          if (tool.name === 'confirm_import' && result.success && (result as any).data?.mode === 'confirm_preview') {
            const entry = toolCallEntries.find(e => e.toolCallId === toolCallId)
            if (entry) Object.assign(entry, { result, durationMs, status })
            await saveMessageSnapshot()
            pendingState.abort = { toolCallId, toolName: tool.name, args }
            return result
          }

          logToolCall({ userId, sessionId, action: 'tool_call', toolName: tool.name, input: args, output: result, durationMs, status })
          const entry = toolCallEntries.find(e => e.toolCallId === toolCallId)
          if (entry) Object.assign(entry, { result, durationMs, status })
          return result
        } catch (err: any) {
          const durationMs = Date.now() - start
          sendSSE('tool-result', { toolCallId, toolName: tool.name, error: err.message, durationMs, status: 'error' })
          logToolCall({ userId, sessionId, action: 'tool_call', toolName: tool.name, input: args, errorMessage: err.message, durationMs, status: 'error' })
          const entry = toolCallEntries.find(e => e.toolCallId === toolCallId)
          if (entry) Object.assign(entry, { result: { error: err.message }, durationMs, status: 'error' })
          return { success: false, error: err.message, retryable: false }
        }
      },
    }
  }

  try {
    const llmModel = createModel(provider as ProviderType, model, { apiKey, baseURL })
    const result = streamText({
      model: llmModel,
      system: systemPrompt,
      messages,
      tools: aiTools,
      temperature,
      maxOutputTokens: maxTokens,
      stopWhen: stepCountIs(maxSteps),
    })

    for await (const part of result.fullStream) {
      if (pendingState.abort || pendingState.suggestion) continue
      if (part.type === 'text-delta') {
        fullText += part.text
        sendSSE('text-delta', { delta: part.text })
      }
    }

    // 流结束 → 保存最终 assistant 消息
    const finalData = {
      sessionId,
      role: 'assistant' as const,
      content: fullText,
      modelProvider: provider,
      modelName: model,
      toolCalls: toolCallEntries.length > 0 ? JSON.stringify(toolCallEntries) : null,
      parentMessageId,
    }
    if (msgState.dbId) {
      await prisma.chatMessage.update({ where: { id: msgState.dbId }, data: finalData })
    } else {
      const created = await prisma.chatMessage.create({ data: finalData })
      if (created) msgState.dbId = created.id
    }

    const abort = pendingState.abort
    if (abort) {
      sendSSE('finish', { pendingConfirmation: { toolCallId: abort.toolCallId, toolName: abort.toolName }, assistantMessageId: msgState.dbId, userMessageId: parentMessageId })
      return { assistantMessageId: msgState.dbId, pendingConfirmation: abort }
    }
    const suggestion = pendingState.suggestion
    if (suggestion) {
      sendSSE('finish', { pendingSuggestion: { toolCallId: suggestion.toolCallId }, assistantMessageId: msgState.dbId, userMessageId: parentMessageId })
      return { assistantMessageId: msgState.dbId, pendingSuggestion: suggestion }
    }

    const usage = await result.usage
    sendSSE('finish', { usage, assistantMessageId: msgState.dbId, userMessageId: parentMessageId })
    return { assistantMessageId: msgState.dbId, usage }
  } catch (err: any) {
    if (msgState.dbId) {
      try {
        await prisma.chatMessage.update({
          where: { id: msgState.dbId },
          data: { content: fullText || '(响应中断)', toolCalls: toolCallEntries.length > 0 ? JSON.stringify(toolCallEntries) : null },
        })
      } catch { /* ignore */ }
    } else if (fullText || toolCallEntries.length > 0) {
      try {
        const created = await prisma.chatMessage.create({
          data: { sessionId, role: 'assistant', content: fullText || '(响应中断)', modelProvider: provider, modelName: model, toolCalls: toolCallEntries.length > 0 ? JSON.stringify(toolCallEntries) : null, parentMessageId },
        })
        if (created) msgState.dbId = created.id
      } catch { /* ignore */ }
    }
    sendSSE('error', { message: err.message || 'AI 服务异常' })
    return { assistantMessageId: msgState.dbId, usage: null }
  } finally {
    reply.raw.end()
  }
}

export async function chatRoutes(app: FastifyInstance) {
  app.addHook('onRequest', authenticate)

  // SSE 流式发送消息
  app.post('/send', async (req, reply) => {
    const parsed = sendMessageSchema.safeParse(req.body)
    if (!parsed.success) return reply.status(400).send({ message: parsed.error.issues[0].message })

    const userId = (req as any).user.id as string
    const { sessionId: sid, accountBookId, message } = parsed.data

    try { await assertIsMember(accountBookId, userId) } catch (e: any) {
      return reply.status(e.statusCode || 403).send({ message: e.message })
    }

    // 获取或创建会话
    const session = await getOrCreateSession(sid, userId, accountBookId)

    // 加载用户配置
    const prefs = await loadPreferences(userId)

    // 加载供应商配置
    const simpleConfig = prefs.simpleProviderConfigId
      ? await prisma.userProviderConfig.findUnique({ where: { id: prefs.simpleProviderConfigId } })
      : null
    const complexConfig = prefs.complexProviderConfigId
      ? await prisma.userProviderConfig.findUnique({ where: { id: prefs.complexProviderConfigId } })
      : null

    const simpleProvider = simpleConfig?.provider || ''
    const complexProvider = complexConfig?.provider || ''

    // 校验：必须至少配置一个模型
    const hasSimple = simpleProvider && prefs.simpleModel
    const hasComplex = complexProvider && prefs.complexModel
    if (!hasSimple && !hasComplex) {
      return reply.status(400).send({ message: '请先在 AI 设置中配置模型后再发送消息' })
    }

    // 检索长期记忆
    const memories = await searchMemories(userId, message, 5)

    // 加载会话所有消息（用于构建历史链）
    const allMessages = await prisma.chatMessage.findMany({
      where: { sessionId: session.id },
      orderBy: { createdAt: 'asc' },
      select: { id: true, role: true, content: true, parentMessageId: true },
      take: 100,
    })

    // 重试：删除被替换的助手消息及其所有后继（按 parentMessageId 链向下删除）
    if (parsed.data.replaceAssistantDbId) {
      let idsToDelete = [parsed.data.replaceAssistantDbId]
      while (idsToDelete.length > 0) {
        await prisma.chatMessage.deleteMany({ where: { id: { in: idsToDelete } } })
        const children = await prisma.chatMessage.findMany({
          where: { parentMessageId: { in: idsToDelete } },
          select: { id: true },
        })
        idsToDelete = children.map((c) => c.id)
      }
    }

    // 构建消息历史：从 parentMessageId 沿链回溯到根
    const history: { role: 'user' | 'assistant'; content: string }[] = []
    const parentId = parsed.data.parentMessageId || null
    if (parentId) {
      const chain: { role: 'user' | 'assistant'; content: string }[] = []
      let currentId: string | null = parentId
      while (currentId) {
        const msg = allMessages.find((m) => m.id === currentId)
        if (!msg) break
        if (msg.role === 'user' || msg.role === 'assistant') {
          chain.unshift({ role: msg.role, content: msg.content })
        }
        currentId = msg.parentMessageId
      }
      history.push(...chain)
    }
    history.push({ role: 'user', content: message })

    // 保存用户消息
    const userMsgDb = await prisma.chatMessage.create({
      data: { sessionId: session.id, role: 'user', content: message, parentMessageId: parentId },
    })

    // 查询账本名称用于提示词
    const book = await prisma.accountBook.findUnique({
      where: { id: accountBookId },
      select: { name: true },
    })
    const bookName = book?.name || accountBookId

    // 构建 system prompt
    const systemPrompt = buildSystemPrompt(prefs, accountBookId, bookName, memories)

    // 模型路由
    let route
    if (hasSimple) {
      const simpleApiKey = simpleConfig?.apiKey || (await loadApiKey(simpleProvider))
      route = await routeIntent(message, simpleProvider as ProviderType, prefs.simpleModel, complexProvider as ProviderType, prefs.complexModel, { apiKey: simpleApiKey })
    } else {
      // 简单模型未配置，直接用关键词判断是否需要复杂模型
      const intent = classifyWithKeywords(message)
      route = {
        intent,
        provider: intent === 'complex' ? complexProvider : simpleProvider,
        model: intent === 'complex' ? prefs.complexModel : prefs.simpleModel,
      } as { intent: 'simple' | 'complex'; provider: string; model: string }
    }

    // 校验所选路由的模型是否已配置
    if (!route.model || !route.provider) {
      const taskType = route.intent === 'complex' ? '复杂任务' : '简单任务'
      return reply.status(400).send({ message: `未配置${taskType}模型，请在 AI 设置中选择模型后重试` })
    }

    const activeConfig = route.provider === simpleProvider ? simpleConfig : complexConfig
    const apiKey = activeConfig?.apiKey || (await loadApiKey(route.provider))
    const baseURL = activeConfig?.baseURL || (await loadBaseURL(route.provider))

    const messages = [
      { role: 'system' as const, content: systemPrompt },
      ...history,
    ]

    await streamAssistantResponse({
      reply,
      sessionId: session.id,
      accountBookId,
      userId,
      systemPrompt,
      messages,
      parentMessageId: userMsgDb.id,
      provider: route.provider,
      model: route.model,
      apiKey,
      baseURL,
      temperature: activeConfig?.temperature ?? prefs.temperature,
      maxTokens: activeConfig?.maxTokens ?? prefs.maxTokens,
      maxSteps: prefs.maxSteps,
    })
  })

  // 会话列表
  app.get('/sessions', async (req) => {
    const userId = (req as any).user.id as string
    const sessions = await prisma.chatSession.findMany({
      where: { userId, status: 'active' },
      select: { id: true, title: true, modelProvider: true, modelName: true, updatedAt: true },
      orderBy: { updatedAt: 'desc' },
    })
    return { sessions }
  })

  // 创建会话
  app.post('/sessions', async (req, reply) => {
    const parsed = createSessionSchema.safeParse(req.body)
    if (!parsed.success) return reply.status(400).send({ message: parsed.error.issues[0].message })

    const userId = (req as any).user.id as string
    const { title, modelProvider, modelName, accountBookId } = parsed.data

    const session = await prisma.chatSession.create({
      data: { userId, accountBookId, title: title || '新对话', modelProvider, modelName },
    })
    return { session }
  })

  // 更新会话
  app.patch('/sessions/:id', async (req, reply) => {
    const parsed = updateSessionSchema.safeParse(req.body)
    if (!parsed.success) return reply.status(400).send({ message: parsed.error.issues[0].message })

    const userId = (req as any).user.id as string
    const { id } = req.params as { id: string }

    const session = await prisma.chatSession.findUnique({ where: { id } })
    if (!session || session.userId !== userId) return reply.status(404).send({ message: '会话不存在' })

    await prisma.chatSession.update({ where: { id }, data: parsed.data })
    return { success: true }
  })

  // 删除会话
  app.delete('/sessions/:id', async (req, reply) => {
    const userId = (req as any).user.id as string
    const { id } = req.params as { id: string }

    const session = await prisma.chatSession.findUnique({ where: { id } })
    if (!session || session.userId !== userId) return reply.status(404).send({ message: '会话不存在' })

    await prisma.chatSession.delete({ where: { id } })
    return { success: true }
  })

  // 获取会话消息
  app.get('/sessions/:id/messages', async (req, reply) => {
    const userId = (req as any).user.id as string
    const { id } = req.params as { id: string }

    const session = await prisma.chatSession.findUnique({ where: { id } })
    if (!session || session.userId !== userId) return reply.status(404).send({ message: '会话不存在' })

    const messages = await prisma.chatMessage.findMany({
      where: { sessionId: id },
      select: { id: true, role: true, content: true, toolCalls: true, modelProvider: true, modelName: true, parentMessageId: true, createdAt: true },
      orderBy: { createdAt: 'asc' },
    })
    return { messages }
  })

  // 确认操作 → 从DB加载 → 执行工具 → SSE流式继续对话
  app.post('/confirm', async (req, reply) => {
    const parsed = confirmActionSchema.safeParse(req.body)
    if (!parsed.success) return reply.status(400).send({ message: parsed.error.issues[0].message })

    const { toolCallId, approved, data } = parsed.data
    const userId = (req as any).user.id as string

    // 存储用户修改后的导入映射数据
    if (data?.fileId) {
      const existing = peekImportOverrides(data.fileId) || {}
      storeImportOverrides(data.fileId, {
        accountResolutions: data.accountResolutions ?? existing.accountResolutions,
        categoryResolutions: data.categoryResolutions ?? existing.categoryResolutions,
        unrecognizedResolutions: data.unrecognizedResolutions ?? existing.unrecognizedResolutions,
        ownerId: data.ownerId ?? existing.ownerId,
      })
    }

    // 从数据库查找包含此 toolCallId 的 assistant 消息
    const message = await prisma.chatMessage.findFirst({
      where: { toolCalls: { contains: toolCallId } },
      select: { id: true, toolCalls: true, sessionId: true, parentMessageId: true, modelProvider: true, modelName: true },
    })
    if (!message) return reply.status(404).send({ message: '确认已过期或不存在' })

    let toolCalls: any[]
    try { toolCalls = JSON.parse(message.toolCalls || '[]') } catch { return reply.status(404).send({ message: '确认已过期或不存在' }) }
    const entry = toolCalls.find((tc: any) => tc.toolCallId === toolCallId)
    if (!entry) return reply.status(404).send({ message: '确认已过期或不存在' })

    const session = await prisma.chatSession.findUnique({
      where: { id: message.sessionId },
      select: { accountBookId: true, id: true },
    })
    if (!session?.accountBookId) return reply.status(404).send({ message: '会话不存在' })
    try { await assertIsMember(session.accountBookId, userId) } catch (e: any) {
      return reply.status(e.statusCode || 403).send({ message: e.message })
    }

    const accountBookId = session.accountBookId

    // 用户拒绝 → 更新快照状态，不启动新 SSE
    if (!approved) {
      const rejectEntry = toolCalls.find((tc: any) => tc.toolCallId === toolCallId)
      if (rejectEntry) {
        rejectEntry.status = 'error'
        rejectEntry.result = { error: '用户拒绝了此操作' }
        await prisma.chatMessage.update({
          where: { id: message.id },
          data: { toolCalls: JSON.stringify(toolCalls) },
        }).catch(() => {})
      }
      logToolCall({ userId, action: 'reject', toolName: entry.toolName })
      return { success: true, approved: false }
    }

    // ---- 执行工具获取结果 ----
    const tool = ALL_TOOLS.find(t => t.name === entry.toolName)
    if (!tool) return reply.status(404).send({ message: '工具不存在' })

    const ctx = { userId, accountBookId }
    let toolResult: any

    if (entry.toolName === 'preview_import') {
      // 预览模式确认 → 重新执行获取 review 结果
      const args = entry.args || {}
      const fileId = args.fileId as string
      const userOverrides = peekImportOverrides(fileId)
      const mergedArgs = {
        ...args,
        accountResolutions: userOverrides?.accountResolutions ?? args.accountResolutions,
        categoryResolutions: userOverrides?.categoryResolutions ?? args.categoryResolutions,
      }
      toolResult = await tool.execute(mergedArgs, ctx)
    } else if (entry.toolName === 'confirm_import') {
      // 确认导入 → 执行实际导入
      const args = entry.args || {}
      const fileId = args.fileId as string
      const userOverrides = peekImportOverrides(fileId)
      const mergedArgs: any = { ...args, _execute: true }
      if (userOverrides?.ownerId) mergedArgs.ownerId = userOverrides.ownerId
      toolResult = await tool.execute(mergedArgs, ctx)
    } else {
      // requireConfirm 工具 → 直接执行
      toolResult = await tool.execute(entry.args || {}, ctx)
    }

    logToolCall({ userId, sessionId: session.id, action: 'confirm', toolName: entry.toolName, input: entry.args, output: toolResult })

    // 更新 DB 快照中该工具调用的结果
    const doneEntry = toolCalls.find((tc: any) => tc.toolCallId === toolCallId)
    if (doneEntry) {
      doneEntry.status = toolResult.success ? 'success' : 'error'
      doneEntry.result = toolResult
      await prisma.chatMessage.update({
        where: { id: message.id },
        data: { toolCalls: JSON.stringify(toolCalls) },
      }).catch(() => {})
    }

    // ---- 构建 AI SDK 格式的消息历史 ----
    const dbMessages = await prisma.chatMessage.findMany({
      where: { sessionId: message.sessionId },
      orderBy: { createdAt: 'asc' },
      select: { id: true, role: true, content: true, toolCalls: true, parentMessageId: true, modelProvider: true, modelName: true },
      take: 100,
    })

    const messages: any[] = []
    for (const msg of dbMessages) {
      if (msg.role === 'user') {
        messages.push({ role: 'user', content: msg.content })
      } else if (msg.role === 'assistant') {
        const tcList = msg.toolCalls ? JSON.parse(msg.toolCalls) : []
        const contentParts: any[] = []
        if (msg.content) contentParts.push({ type: 'text', text: msg.content })
        for (const tc of tcList) {
          contentParts.push({ type: 'tool-call', toolCallId: tc.toolCallId, toolName: tc.toolName, args: tc.args })
        }
        messages.push({ role: 'assistant', content: contentParts })

        // 已完成工具调用的 results（排除当前正在确认的，因为我们会新追加）
        const completedResults = tcList.filter((tc: any) =>
          tc.toolCallId !== toolCallId && tc.result != null && tc.status !== 'confirming' && tc.status !== 'suggesting',
        )
        if (completedResults.length > 0) {
          messages.push({
            role: 'tool',
            content: completedResults.map((tc: any) => ({
              type: 'tool-result',
              toolCallId: tc.toolCallId,
              toolName: tc.toolName,
              result: tc.result,
            })),
          })
        }
      }
    }

    // 追加待确认工具的 result
    messages.push({
      role: 'tool',
      content: [{
        type: 'tool-result',
        toolCallId,
        toolName: entry.toolName,
        result: toolResult,
      }],
    })

    // ---- 加载 LLM 配置并启动新 SSE 流 ----
    const prefs = await loadPreferences(userId)
    const provider = message.modelProvider || ''
    const model = message.modelName || ''

    if (!provider || !model) {
      return reply.status(500).send({ message: '无法确定模型配置，请重新发送消息' })
    }

    const providerConfigs = await prisma.userProviderConfig.findMany({
      where: { userId },
    })
    const activeConfig = providerConfigs.find(c => c.provider === provider)
    const apiKey = activeConfig?.apiKey || (await loadApiKey(provider))
    const baseURL = activeConfig?.baseURL || (await loadBaseURL(provider))

    const book = await prisma.accountBook.findUnique({
      where: { id: accountBookId },
      select: { name: true },
    })
    const bookName = book?.name || accountBookId
    const memories = await searchMemories(userId, '', 5)
    const systemPrompt = buildSystemPrompt(prefs, accountBookId, bookName, memories)

    // 续写消息的 parent 是原始 assistant 消息（形成链：user → assistant1(含tool_call) → assistant2(续写)）
    await streamAssistantResponse({
      reply,
      sessionId: message.sessionId,
      accountBookId,
      userId,
      systemPrompt,
      messages,
      parentMessageId: message.id,
      provider,
      model,
      apiKey,
      baseURL,
      temperature: activeConfig?.temperature ?? prefs.temperature,
      maxTokens: activeConfig?.maxTokens ?? prefs.maxTokens,
      maxSteps: prefs.maxSteps,
    })
  })

  // 回复建议（用户选择或自定义输入）→ SSE 流式继续对话
  app.post('/respond-suggestion', async (req, reply) => {
    const parsed = respondSuggestionSchema.safeParse(req.body)
    if (!parsed.success) return reply.status(400).send({ message: parsed.error.issues[0].message })

    const { toolCallId, values } = parsed.data
    const userId = (req as any).user.id as string

    // 从数据库查找包含此 toolCallId 的 assistant 消息
    const message = await prisma.chatMessage.findFirst({
      where: { toolCalls: { contains: toolCallId } },
      select: { id: true, toolCalls: true, sessionId: true, parentMessageId: true, modelProvider: true, modelName: true },
    })
    if (!message) return reply.status(404).send({ message: '建议已过期或不存在' })

    let toolCalls: any[]
    try { toolCalls = JSON.parse(message.toolCalls || '[]') } catch { return reply.status(404).send({ message: '建议已过期或不存在' }) }
    const entry = toolCalls.find((tc: any) => tc.toolCallId === toolCallId)
    if (!entry) return reply.status(404).send({ message: '建议已过期或不存在' })

    const session = await prisma.chatSession.findUnique({
      where: { id: message.sessionId },
      select: { accountBookId: true, id: true },
    })
    if (!session?.accountBookId) return reply.status(404).send({ message: '会话不存在' })
    try { await assertIsMember(session.accountBookId, userId) } catch (e: any) {
      return reply.status(e.statusCode || 403).send({ message: e.message })
    }

    const accountBookId = session.accountBookId

    // 用户取消选择
    if (values === null) {
      const cancelEntry = toolCalls.find((tc: any) => tc.toolCallId === toolCallId)
      if (cancelEntry) {
        cancelEntry.status = 'error'
        cancelEntry.result = { error: '用户取消了选择' }
        await prisma.chatMessage.update({
          where: { id: message.id },
          data: { toolCalls: JSON.stringify(toolCalls) },
        }).catch(() => {})
      }
      return { success: true, acknowledged: true }
    }

    // 构建 suggest_options 的 tool result
    const toolResult = { success: true, values }

    const doneEntry = toolCalls.find((tc: any) => tc.toolCallId === toolCallId)
    if (doneEntry) {
      doneEntry.status = 'success'
      doneEntry.result = toolResult
      await prisma.chatMessage.update({
        where: { id: message.id },
        data: { toolCalls: JSON.stringify(toolCalls) },
      }).catch(() => {})
    }

    // ---- 构建 AI SDK 格式的消息历史 ----
    const dbMessages = await prisma.chatMessage.findMany({
      where: { sessionId: message.sessionId },
      orderBy: { createdAt: 'asc' },
      select: { id: true, role: true, content: true, toolCalls: true, parentMessageId: true, modelProvider: true, modelName: true },
      take: 100,
    })

    const messages: any[] = []
    for (const msg of dbMessages) {
      if (msg.role === 'user') {
        messages.push({ role: 'user', content: msg.content })
      } else if (msg.role === 'assistant') {
        const tcList = msg.toolCalls ? JSON.parse(msg.toolCalls) : []
        const contentParts: any[] = []
        if (msg.content) contentParts.push({ type: 'text', text: msg.content })
        for (const tc of tcList) {
          contentParts.push({ type: 'tool-call', toolCallId: tc.toolCallId, toolName: tc.toolName, args: tc.args })
        }
        messages.push({ role: 'assistant', content: contentParts })

        const completedResults = tcList.filter((tc: any) =>
          tc.toolCallId !== toolCallId && tc.result != null && tc.status !== 'confirming' && tc.status !== 'suggesting',
        )
        if (completedResults.length > 0) {
          messages.push({
            role: 'tool',
            content: completedResults.map((tc: any) => ({
              type: 'tool-result',
              toolCallId: tc.toolCallId,
              toolName: tc.toolName,
              result: tc.result,
            })),
          })
        }
      }
    }

    messages.push({
      role: 'tool',
      content: [{
        type: 'tool-result',
        toolCallId,
        toolName: entry.toolName,
        result: toolResult,
      }],
    })

    // ---- 加载 LLM 配置并启动新 SSE 流 ----
    const prefs = await loadPreferences(userId)
    const provider = message.modelProvider || ''
    const model = message.modelName || ''

    if (!provider || !model) {
      return reply.status(500).send({ message: '无法确定模型配置，请重新发送消息' })
    }

    const providerConfigs = await prisma.userProviderConfig.findMany({
      where: { userId },
    })
    const activeConfig = providerConfigs.find(c => c.provider === provider)
    const apiKey = activeConfig?.apiKey || (await loadApiKey(provider))
    const baseURL = activeConfig?.baseURL || (await loadBaseURL(provider))

    const book = await prisma.accountBook.findUnique({
      where: { id: accountBookId },
      select: { name: true },
    })
    const bookName = book?.name || accountBookId
    const memories = await searchMemories(userId, '', 5)
    const systemPrompt = buildSystemPrompt(prefs, accountBookId, bookName, memories)

    await streamAssistantResponse({
      reply,
      sessionId: message.sessionId,
      accountBookId,
      userId,
      systemPrompt,
      messages,
      parentMessageId: message.id,
      provider,
      model,
      apiKey,
      baseURL,
      temperature: activeConfig?.temperature ?? prefs.temperature,
      maxTokens: activeConfig?.maxTokens ?? prefs.maxTokens,
      maxSteps: prefs.maxSteps,
    })
  })

  // === 供应商配置 CRUD ===
  // 列表
  app.get('/provider-configs', async (req) => {
    const userId = (req as any).user.id as string
    const configs = await prisma.userProviderConfig.findMany({
      where: { userId },
      orderBy: { sortOrder: 'asc' },
    })
    return configs.map((c) => ({
      ...c,
      apiKey: c.apiKey ? '****' : '',
    }))
  })

  // 创建
  app.post('/provider-configs', async (req, reply) => {
    const parsed = createProviderConfigSchema.safeParse(req.body)
    if (!parsed.success) return reply.status(400).send({ message: parsed.error.issues[0].message })

    const userId = (req as any).user.id as string
    const config = await prisma.userProviderConfig.create({
      data: { userId, ...parsed.data, name: parsed.data.name || parsed.data.provider },
    })
    return config
  })

  // 更新
  app.put('/provider-configs/:id', async (req, reply) => {
    const parsed = updateProviderConfigSchema.safeParse(req.body)
    if (!parsed.success) return reply.status(400).send({ message: parsed.error.issues[0].message })

    const userId = (req as any).user.id as string
    const { id } = req.params as { id: string }

    const existing = await prisma.userProviderConfig.findUnique({ where: { id } })
    if (!existing || existing.userId !== userId) return reply.status(404).send({ message: '配置不存在' })

    const updateData = { ...parsed.data }
    if (!updateData.apiKey) delete updateData.apiKey

    const config = await prisma.userProviderConfig.update({ where: { id }, data: updateData })
    return config
  })

  // 删除
  app.delete('/provider-configs/:id', async (req, reply) => {
    const userId = (req as any).user.id as string
    const { id } = req.params as { id: string }

    const existing = await prisma.userProviderConfig.findUnique({ where: { id } })
    if (!existing || existing.userId !== userId) return reply.status(404).send({ message: '配置不存在' })

    await prisma.userProviderConfig.delete({ where: { id } })
    return { success: true }
  })

  // 复制
  app.post('/provider-configs/:id/copy', async (req, reply) => {
    const userId = (req as any).user.id as string
    const { id } = req.params as { id: string }

    const existing = await prisma.userProviderConfig.findUnique({ where: { id } })
    if (!existing || existing.userId !== userId) return reply.status(404).send({ message: '配置不存在' })

    const copy = await prisma.userProviderConfig.create({
      data: {
        userId,
        name: `${existing.name} (副本)`,
        provider: existing.provider,
        apiKey: existing.apiKey,
        baseURL: existing.baseURL,
        models: existing.models,
        temperature: existing.temperature,
        maxTokens: existing.maxTokens,
        sortOrder: existing.sortOrder + 1,
      },
    })
    return copy
  })

  // 获取偏好
  app.get('/preferences', async (req) => {
    const userId = (req as any).user.id as string
    const prefs = await loadPreferences(userId)
    return prefs
  })

  // 更新偏好
  app.put('/preferences', async (req, reply) => {
    const parsed = updatePreferencesSchema.safeParse(req.body)
    if (!parsed.success) return reply.status(400).send({ message: parsed.error.issues[0].message })

    const userId = (req as any).user.id as string

    await prisma.userPreference.upsert({
      where: { userId },
      create: { userId, ...parsed.data },
      update: parsed.data,
    })
    return { success: true }
  })

  // 可用模型列表
  app.get('/providers', async () => {
    const { ALL_PROVIDERS } = await import('../services/ai/providers.js')
    return { providers: ALL_PROVIDERS }
  })

  // 动态获取供应商模型列表（代理调用供应商 /v1/models）
  app.get('/providers/models', async (req, reply) => {
    const { provider, baseURL: customBaseURL } = req.query as { provider?: string; baseURL?: string }

    if (!provider) return reply.status(400).send({ message: '缺少 provider 参数' })

    const providerConfig = ALL_PROVIDERS.find((p) => p.value === provider)
    if (!providerConfig) return reply.status(400).send({ message: '无效的供应商' })

    // 获取 API Key
    const apiKey = await loadApiKey(provider)

    // 获取 baseURL
    let baseURL = customBaseURL || DEFAULT_BASE_URLS[provider as keyof typeof DEFAULT_BASE_URLS] || ''
    if (!baseURL) {
      try {
        const cfg = await prisma.systemConfig.findUnique({ where: { key: `ai_baseurl_${provider}` } })
        baseURL = cfg?.value || ''
      } catch { baseURL = '' }
    }
    if (!baseURL) {
      return { models: providerConfig.defaultModels }
    }

    try {
      if (provider === 'ollama') {
        const ollamaBase = baseURL.replace(/\/v1\/?$/, '')
        const res = await fetch(`${ollamaBase}/api/tags`, { signal: AbortSignal.timeout(10000) })
        const data = (await res.json()) as { models?: { name: string }[] }
        return { models: (data.models || []).map((m) => m.name) }
      }

      // OpenAI 兼容: GET {baseURL}/models
      const modelsURL = baseURL.replace(/\/$/, '') + '/models'
      const res = await fetch(modelsURL, {
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        signal: AbortSignal.timeout(10000),
      })

      if (!res.ok) {
        return { models: providerConfig.defaultModels }
      }

      const data = (await res.json()) as { data?: { id: string }[] }
      const allModels = (data.data || []).map((m) => m.id)

      // 过滤非 chat 模型
      const excludePatterns = /embedding|tts|whisper|dall-e|moderation|audio|image|vision/i
      const filtered = allModels.filter((m) => !excludePatterns.test(m))

      return { models: filtered.length > 0 ? filtered : providerConfig.defaultModels }
    } catch {
      return { models: providerConfig.defaultModels }
    }
  })

  // 供应商 API Key 状态（只返回是否已配置）
  app.get('/providers/status', async () => {
    const configs = await prisma.systemConfig.findMany({
      where: { key: { startsWith: 'ai_key_' } },
    })
    const keyMap = new Map(configs.map((c) => [c.key.replace('ai_key_', ''), true]))

    const envKeys: Record<string, string> = {
      openai: process.env.OPENAI_API_KEY || '',
      anthropic: process.env.ANTHROPIC_API_KEY || '',
      deepseek: process.env.DEEPSEEK_API_KEY || '',
      qwen: process.env.QWEN_API_KEY || '',
      zhipu: process.env.ZHIPU_API_KEY || '',
      gemini: process.env.GEMINI_API_KEY || '',
      moonshot: process.env.MOONSHOT_API_KEY || '',
      baichuan: process.env.BAICHUAN_API_KEY || '',
      yi: process.env.YI_API_KEY || '',
      bytedance: process.env.BYTEDANCE_API_KEY || '',
      hunyuan: process.env.HUNYUAN_API_KEY || '',
      minimax: process.env.MINIMAX_API_KEY || '',
      ollama: process.env.OLLAMA_API_KEY || 'ollama',
    }

    const status: Record<string, boolean> = {}
    for (const p of ALL_PROVIDERS) {
      status[p.value] = !!(keyMap.get(p.value) || envKeys[p.value] || (p.value === 'ollama'))
    }
    return status
  })

  // 保存供应商 API Key
  app.post('/providers/key', async (req, reply) => {
    const { provider, apiKey } = req.body as { provider?: string; apiKey?: string }
    if (!provider || !apiKey) return reply.status(400).send({ message: '缺少参数' })

    const validProviders = ALL_PROVIDERS.map((p) => p.value)
    if (!validProviders.includes(provider as any)) return reply.status(400).send({ message: '无效的供应商' })

    await prisma.systemConfig.upsert({
      where: { key: `ai_key_${provider}` },
      create: { key: `ai_key_${provider}`, value: apiKey },
      update: { value: apiKey },
    })
    return { success: true, provider, configured: true }
  })

  // 删除供应商 API Key
  app.delete('/providers/key', async (req, reply) => {
    const { provider } = req.query as { provider?: string }
    if (!provider) return reply.status(400).send({ message: '缺少参数' })

    try {
      await prisma.systemConfig.delete({ where: { key: `ai_key_${provider}` } })
    } catch {
      // 不存在也没关系
    }
    return { success: true, configured: false }
  })

  // 获取供应商 baseURL（存储值或默认值）
  app.get('/providers/baseurl', async (req, reply) => {
    const { provider } = req.query as { provider?: string }
    if (!provider) return reply.status(400).send({ message: '缺少 provider 参数' })

    const stored = await loadStoredBaseURL(provider)
    const defaultURL = DEFAULT_BASE_URLS[provider as keyof typeof DEFAULT_BASE_URLS] || ''
    return { baseURL: stored || defaultURL, isCustom: !!stored }
  })

  // 保存供应商 baseURL
  app.post('/providers/baseurl', async (req, reply) => {
    const { provider, baseURL } = req.body as { provider?: string; baseURL?: string }
    if (!provider) return reply.status(400).send({ message: '缺少 provider 参数' })

    const validProviders = ALL_PROVIDERS.map((p) => p.value)
    if (!validProviders.includes(provider as any)) return reply.status(400).send({ message: '无效的供应商' })

    if (!baseURL) {
      // 空值则删除，回退到默认
      try { await prisma.systemConfig.delete({ where: { key: `ai_baseurl_${provider}` } }) } catch { /* ignore */ }
      return { success: true, baseURL: DEFAULT_BASE_URLS[provider as keyof typeof DEFAULT_BASE_URLS] || '', isCustom: false }
    }

    await prisma.systemConfig.upsert({
      where: { key: `ai_baseurl_${provider}` },
      create: { key: `ai_baseurl_${provider}`, value: baseURL },
      update: { value: baseURL },
    })
    return { success: true, baseURL, isCustom: true }
  })
}

// 辅助函数
async function getOrCreateSession(sid: string | undefined, userId: string, bookId: string) {
  if (sid) {
    const existing = await prisma.chatSession.findUnique({ where: { id: sid } })
    if (existing && existing.userId === userId) return existing
  }
  return prisma.chatSession.create({
    data: { userId, accountBookId: bookId },
  })
}

async function loadPreferences(userId: string) {
  const prefs = await prisma.userPreference.findUnique({ where: { userId } })
  return {
    simpleProviderConfigId: prefs?.simpleProviderConfigId || null,
    simpleModel: prefs?.simpleModel || '',
    complexProviderConfigId: prefs?.complexProviderConfigId || null,
    complexModel: prefs?.complexModel || '',
    autoConfirmCreate: prefs?.autoConfirmCreate ?? false,
    language: prefs?.language || 'zh-CN',
    temperature: prefs?.temperature ?? 0.7,
    maxTokens: prefs?.maxTokens ?? 4096,
    maxSteps: prefs?.maxSteps ?? 10,
  }
}

async function loadApiKey(provider: string): Promise<string> {
  // 优先从环境变量读取
  const envKeys: Record<string, string> = {
    openai: process.env.OPENAI_API_KEY || '',
    anthropic: process.env.ANTHROPIC_API_KEY || '',
    deepseek: process.env.DEEPSEEK_API_KEY || '',
    qwen: process.env.QWEN_API_KEY || '',
    zhipu: process.env.ZHIPU_API_KEY || '',
    gemini: process.env.GEMINI_API_KEY || '',
    moonshot: process.env.MOONSHOT_API_KEY || '',
    baichuan: process.env.BAICHUAN_API_KEY || '',
    yi: process.env.YI_API_KEY || '',
    bytedance: process.env.BYTEDANCE_API_KEY || '',
    hunyuan: process.env.HUNYUAN_API_KEY || '',
    minimax: process.env.MINIMAX_API_KEY || '',
    ollama: process.env.OLLAMA_API_KEY || 'ollama',
  }
  if (envKeys[provider]) return envKeys[provider]

  // 回退到 SystemConfig
  try {
    const config = await prisma.systemConfig.findUnique({ where: { key: `ai_key_${provider}` } })
    return config?.value || ''
  } catch {
    return ''
  }
}

async function loadStoredBaseURL(provider: string): Promise<string> {
  try {
    const config = await prisma.systemConfig.findUnique({ where: { key: `ai_baseurl_${provider}` } })
    return config?.value || ''
  } catch {
    return ''
  }
}

async function loadBaseURL(provider: string): Promise<string> {
  // 优先从 SystemConfig 读取用户自定义值
  const stored = await loadStoredBaseURL(provider)
  if (stored) return stored

  // 回退到默认值
  return DEFAULT_BASE_URLS[provider as keyof typeof DEFAULT_BASE_URLS] || ''
}

async function searchMemories(userId: string, query: string, limit: number) {
  // 从查询中提取关键词（简单分词）
  const terms = extractKeywords(query)
  if (terms.length === 0) return []

  const orConditions = terms.flatMap((t) => [
    { keywords: { contains: t } },
    { content: { contains: t } },
  ])

  const memories = await prisma.userMemory.findMany({
    where: { userId, OR: orConditions },
    orderBy: [{ importance: 'desc' }, { lastAccessedAt: 'desc' }],
    take: limit,
    select: { content: true, keywords: true },
  })

  // 更新访问记录
  if (memories.length > 0) {
    const ids = await prisma.userMemory.findMany({
      where: { userId, OR: orConditions },
      select: { id: true },
      take: limit,
    })
    prisma.userMemory.updateMany({
      where: { id: { in: ids.map((m) => m.id) } },
      data: { accessCount: { increment: 1 }, lastAccessedAt: new Date() },
    }).catch(() => {})
  }

  return memories
}

function extractKeywords(text: string): string[] {
  // 简单中文分词：按标点和空格分割，过滤短词
  const split = text.split(/[\s，。！？,\.!\?;；：:]+/).filter(Boolean)
  const keywords: string[] = []
  for (const seg of split) {
    // 保留 >= 2 字符的片段
    if (seg.length >= 2) keywords.push(seg)
    // 也从连续的2-4字窗口提取
    if (seg.length > 4) {
      for (let i = 0; i <= seg.length - 2; i++) {
        keywords.push(seg.slice(i, i + 2))
      }
    }
  }
  return [...new Set(keywords)].slice(0, 20)
}

/** 将 result.data 中超过 batchSize 的数组字段拆分，返回分批发货的 result 数组 */
function splitResultBatches(result: any, batchSize: number): any[] {
  const data = result?.data
  if (!data || typeof data !== 'object') return [result]

  const arrayFields: { key: string; items: any[] }[] = []
  for (const [key, value] of Object.entries(data)) {
    if (Array.isArray(value) && value.length > batchSize) {
      arrayFields.push({ key, items: value as any[] })
    }
  }

  if (arrayFields.length === 0) return [result]

  // 以最长数组为准计算批次数
  const maxLength = Math.max(...arrayFields.map(f => f.items.length))
  const totalBatches = Math.ceil(maxLength / batchSize)

  const batches: any[] = []
  for (let i = 0; i < totalBatches; i++) {
    const batchData: any = { ...data }
    for (const { key, items } of arrayFields) {
      const start = i * batchSize
      const end = start + batchSize
      batchData[key] = items.slice(start, end)
    }
    batches.push({ ...result, data: batchData })
  }

  return batches
}

function buildSystemPrompt(prefs: any, bookId: string, bookName: string, memories: any[]): string {
  const memoryContext = memories.length > 0
    ? `\n\n## 用户长期记忆（供参考）\n${memories.map((m: any, i: number) => `${i + 1}. ${m.content}`).join('\n')}\n`
    : ''

  return `你是 Homibook 家庭记账本的 AI 助手。当前账本为「${bookName}」(ID: ${bookId})。

## 时间
今天是${new Date().toISOString().slice(0, 10)}。

## 能力
你可以通过调用函数工具来完成以下操作：
- 查询和筛选流水记录 → 调用 query_records
- 查看账户余额和变动 → 调用 query_accounts
- 查询和设定预算 → 调用 query_budgets / set_budget
- 生成统计分析报表 → 调用 get_stats
- 查看分类字典 → 调用 query_categories
- 记账和修改流水 → 调用 create_record / update_record / delete_record
- 批量记账 → 调用 batch_create_records（多条记录一次确认）
- 批量修改流水 → 调用 batch_update_records（多条记录一次确认）
- 向用户提问获取信息 → 调用 suggest_options（用户操作意图明确但缺少具体参数时使用）
- 查询已有导入映射 → 调用 query_import_mappings
- 预览导入流水文件(分析) → 调用 preview_import（mode="analyze"，仅返回未匹配数据供 AI 分析，不展示交互卡片）
- 预览导入流水文件(预览) → 调用 preview_import（mode="preview"，传入映射规则，展示交互卡片供用户确认调整，返回全部记录及映射后的分类名称）
- 确认导入流水 → 调用 confirm_import（传入 fileId、source 和映射规则，一次性完成导入）
- 保存导入映射规则 → 调用 save_import_mapping（仅在用户明确要求时调用，日常导入无需调用）

## 导入流水数据（严格按以下顺序调用工具）
当用户发送导入账单消息（包含 fileId 和 source 参数）时，你必须立即按以下顺序调用工具，禁止用文字描述或模拟结果：

1. 调用 preview_import(fileId, source, mode="analyze") 解析文件获取未匹配数据
2. 分析预览结果中的 unmatchedAccounts、unmatchedCategories 和 allDictItems：
   - 为每个未匹配账户生成 accountResolutions：已有候选(candidates) → action="existing" + targetAccountId；无候选 → action="create" + 推断的 targetAccountName + accountType
   - 为每个未匹配分类生成 categoryResolutions：根据源分类名和 allDictItems 中的分类编码/标签进行语义匹配，选择 targetCategoryCode；如有明显交易方特征可加 payerContains/descriptionContains 过滤
3. 调用 preview_import(fileId, source, mode="preview", { accountResolutions, categoryResolutions }) 展示交互卡片供用户确认
4. 用户确认后，直接调用 confirm_import(fileId, source, { accountResolutions, categoryResolutions }) 确认导入,不要输出任何文本
5. 导入完成后用简短文字总结导入记录数和创建账户数

注意：
- 不要调用 save_import_mapping 工具——映射规则由 confirm_import 随导入一起保存
- 不要凭空描述导入预览的统计数字和记录内容——这些数据来自工具返回结果
- accountResolutions 中 action="create" 时的 accountType 必须是以下之一：BANK_DEBIT、CREDIT_CARD、ALIPAY、WECHAT、INVESTMENT、CASH、RECHARGE_CARD、OTHER
- categoryResolutions 的 targetCategoryCode 必须从 allDictItems 中选取，不可臆造编码
- 如果步骤4中反复匹配失败（超过10%的记录仍无法匹配），告知用户具体哪些分类无法匹配并请求用户指导

## 核心规则（必须遵守）
- 当用户请求执行上述操作时，你必须直接调用对应的函数工具，而不是在文字中描述"正在调用"或"将要调用"
- 直接调用工具进行操作,需要用户确认时工具内部会处理,不要再额外确认一次
- 禁止在回复中使用 <tool_call>、<invoke> 等 XML 标签来描述工具调用——直接使用 Function Calling 机制调用工具
- 不要在回复中写出工具调用的参数或过程，直接执行工具后用结果回复用户
- 不要用文字模拟工具的执行结果——必须通过函数调用获取真实数据
- 当用户意图明确但缺少具体参数时（如"记一笔麦当劳50元"但未指定账户），调用 suggest_options 让用户选择，不要直接在文字中追问
- suggest_options 的 options 应基于已查询的真实数据（如已查到的账户列表），而非凭空列举
- 先澄清再执行操作
- 涉及创建、修改、删除操作需要用户确认
- 回答简洁准确，金额保留两位小数
- 使用中文回复
${memoryContext}`
}

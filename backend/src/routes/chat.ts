import type { FastifyInstance } from 'fastify'
import { streamText, stepCountIs, jsonSchema } from 'ai'
import { prisma } from '../app.js'
import { authenticate } from '../middleware/auth.js'
import { createModel, ALL_PROVIDERS, DEFAULT_BASE_URLS, type ProviderType } from '../services/ai/providers.js'
import { routeIntent, classifyWithKeywords } from '../services/ai/model-router.js'
import { assertIsMember } from '../services/ai/security.js'
import { logToolCall } from '../services/ai/audit.js'
import { ALL_TOOLS, registerConfirmation, confirmAction, getPendingConfirmations } from '../services/ai/tools/index.js'
import { buildConfirmPreview } from '../services/ai/confirm-preview.js'
import { sendMessageSchema, createSessionSchema, updateSessionSchema, confirmActionSchema, updatePreferencesSchema, createProviderConfigSchema, updateProviderConfigSchema } from '../schemas/chat.js'

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

    // 构建 system prompt
    const systemPrompt = buildSystemPrompt(prefs, accountBookId, memories)

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

    // SSE headers
    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
    })

    const sendSSE = (event: string, data: unknown) => {
      reply.raw.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
    }

    // 收集工具调用记录，用于持久化
    const toolCallEntries: Array<{ toolCallId: string; toolName: string; args?: unknown; result?: unknown; durationMs?: number; status: string; textOffset: number }> = []
    let fullText = ''

    // 构建 AI SDK 工具格式
    // 从 execute 回调统一发送 tool-call + tool-result，确保 ID 一致
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
            // 需要确认的敏感操作
            if (tool.requireConfirm) {
              const preview = await buildConfirmPreview(tool.name, args, accountBookId)
              sendSSE('tool-confirm-required', { toolCallId, toolName: tool.name, preview })
              const approved = await registerConfirmation(toolCallId, tool.name, preview)
              if (!approved) {
                const entry = toolCallEntries.find((e) => e.toolCallId === toolCallId)
                if (entry) Object.assign(entry, { status: 'error', result: { error: '用户拒绝了此操作' } })
                return { success: false, error: '用户拒绝了此操作', retryable: false }
              }
            }
            const result = await tool.execute(args, { userId, accountBookId })
            const durationMs = Date.now() - start
            const status = result.success ? 'success' : 'error'
            sendSSE('tool-result', { toolCallId, toolName: tool.name, result, durationMs, status })
            logToolCall({ userId, sessionId: session.id, action: 'tool_call', toolName: tool.name, input: args, output: result, durationMs, status })
            // 更新持久化记录
            const entry = toolCallEntries.find((e) => e.toolCallId === toolCallId)
            if (entry) Object.assign(entry, { result, durationMs, status })
            return result
          } catch (err: any) {
            const durationMs = Date.now() - start
            sendSSE('tool-result', { toolCallId, toolName: tool.name, error: err.message, durationMs, status: 'error' })
            logToolCall({ userId, sessionId: session.id, action: 'tool_call', toolName: tool.name, input: args, errorMessage: err.message, durationMs, status: 'error' })
            const entry = toolCallEntries.find((e) => e.toolCallId === toolCallId)
            if (entry) Object.assign(entry, { result: { error: err.message }, durationMs, status: 'error' })
            return { success: false, error: err.message, retryable: false }
          }
        },
      }
    }

    try {
      const activeConfig = route.provider === simpleProvider ? simpleConfig : complexConfig
      const apiKey = activeConfig?.apiKey || (await loadApiKey(route.provider))
      const baseURL = activeConfig?.baseURL || (await loadBaseURL(route.provider))
      const model = createModel(route.provider as ProviderType, route.model, { apiKey, baseURL })
      const result = streamText({
        model,
        system: systemPrompt,
        messages: history,
        tools: aiTools,
        temperature: activeConfig?.temperature ?? prefs.temperature,
        maxOutputTokens: activeConfig?.maxTokens ?? prefs.maxTokens,
        stopWhen: stepCountIs(prefs.maxSteps), // 允许模型多轮工具调用循环
      })

      for await (const part of result.fullStream) {
        if (part.type === 'text-delta') {
          fullText += part.text
          sendSSE('text-delta', { delta: part.text })
        }
      }

      // 保存 assistant 消息（含工具调用记录）
      const assistantMsgDb = await prisma.chatMessage.create({
        data: {
          sessionId: session.id,
          role: 'assistant',
          content: fullText,
          modelProvider: route.provider,
          modelName: route.model,
          toolCalls: toolCallEntries.length > 0 ? JSON.stringify(toolCallEntries) : null,
          parentMessageId: userMsgDb.id,
        },
      })

      sendSSE('finish', { usage: await result.usage, userMessageId: userMsgDb.id, assistantMessageId: assistantMsgDb.id })
    } catch (err: any) {
      sendSSE('error', { message: err.message || 'AI 服务异常' })
    } finally {
      reply.raw.end()
    }
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

  // 确认/拒绝操作
  app.post('/confirm', async (req, reply) => {
    const parsed = confirmActionSchema.safeParse(req.body)
    if (!parsed.success) return reply.status(400).send({ message: parsed.error.issues[0].message })

    const { toolCallId, approved } = parsed.data
    const userId = (req as any).user.id as string

    const handled = confirmAction(toolCallId, approved)
    if (!handled) return reply.status(404).send({ message: '确认已过期或不存在' })

    logToolCall({ userId, action: approved ? 'confirm' : 'reject', toolName: toolCallId })

    return { success: true, approved }
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

  // 待确认列表
  app.get('/pending-confirmations', async () => {
    return { pending: getPendingConfirmations() }
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

function buildSystemPrompt(prefs: any, bookId: string, memories: any[]): string {
  const memoryContext = memories.length > 0
    ? `\n\n## 用户长期记忆（供参考）\n${memories.map((m: any, i: number) => `${i + 1}. ${m.content}`).join('\n')}\n`
    : ''

  return `你是 Homibook 家庭记账本的 AI 助手。当前账本 ID 为 ${bookId}。

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

## 核心规则（必须遵守）
- 当用户请求执行上述操作时，你必须直接调用对应的函数工具，而不是在文字中描述"正在调用"或"将要调用"
- 直接调用工具进行操作,需要用户确认时工具内部会处理,不要再额外确认一次
- 禁止在回复中使用 <tool_call>、<invoke> 等 XML 标签来描述工具调用——直接使用 Function Calling 机制调用工具
- 不要在回复中写出工具调用的参数或过程，直接执行工具后用结果回复用户
- 不要用文字模拟工具的执行结果——必须通过函数调用获取真实数据
- 当用户意图不明确时，主动追问关键信息（时间范围、分类、金额范围等）
- 先澄清再执行操作
- 涉及创建、修改、删除操作需要用户确认
- 回答简洁准确，金额保留两位小数
- 使用中文回复
${memoryContext}`
}

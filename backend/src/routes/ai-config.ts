import type {FastifyInstance} from 'fastify'
import {generateText} from 'ai'
import {prisma} from '../app.js'
import {authenticate, requireAdmin} from '../middleware/auth.js'
import {ALL_PROVIDERS, createModel, DEFAULT_BASE_URLS, type ProviderType} from '../services/ai/providers.js'
import {loadUserProviderConfig} from '../services/ai/security.js'
import {TOOL_GROUPS} from '../services/ai/tools/index.js'
import {
  createProviderConfigSchema,
  updateAIConfigSchema,
  updateProviderConfigSchema
} from '../schemas/chat.js'
import {zSchema} from '../lib/schema-helpers.js'
import {z} from 'zod'
import {loadAIConfig, loadStoredBaseURL, tryFetchModels} from '../services/ai/chat/session.js'
import {deleteMemory, listMemories, updateMemory} from '../services/ai/memory.js'

interface RouteDoc {
  summary: string
  description?: string
  swaggerResponse?: Record<number, unknown>
  bodySchema?: any
  paramsSchema?: any
  querystringSchema?: any
}

const PID_PARAMS = z.object({ id: z.string().describe('配置ID') })
const PROVIDER_PARAMS = z.object({ provider: z.string().describe('供应商类型') })

const ROUTE_DOC: Record<string, RouteDoc> = {
  'GET /provider-configs': {
    summary: '获取供应商配置列表',
    swaggerResponse: {200: {type: 'array', description: '供应商配置列表', items: {type: 'object'}}}
  },
  'POST /provider-configs': {
    summary: '创建供应商配置',
    description: '添加新的AI模型供应商配置',
    bodySchema: createProviderConfigSchema
  },
  'PUT /provider-configs/:id': {
    summary: '更新供应商配置',
    bodySchema: updateProviderConfigSchema,
    paramsSchema: PID_PARAMS
  },
  'DELETE /provider-configs/:id': {summary: '删除供应商配置', paramsSchema: PID_PARAMS},
  'POST /provider-configs/:id/copy': {
    summary: '复制供应商配置',
    description: '复制现有配置为新的供应商配置',
    paramsSchema: PID_PARAMS
  },
  'GET /ai-config': {
    summary: '获取AI配置',
    description: '获取当前用户的AI模型和对话配置',
    swaggerResponse: {200: {type: 'object', description: 'AI配置'}}
  },
  'PUT /ai-config': {
    summary: '更新AI配置',
    description: '更新用户的AI模型选择和行为偏好',
    bodySchema: updateAIConfigSchema
  },
  'GET /tools': {
    summary: '获取可用工具列表',
    description: '获取AI助手所有可用工具，按分类分组',
    swaggerResponse: {200: {type: 'object', description: '工具列表'}}
  },
  'GET /providers': {
    summary: '获取可用供应商',
    description: '获取系统支持的所有AI供应商列表',
    swaggerResponse: {
      200: {
        type: 'object',
        description: '供应商列表',
        properties: {providers: {type: 'array', description: '供应商列表', items: {type: 'object'}}}
      }
    }
  },
  'GET /providers/models': {
    summary: '获取供应商模型列表',
    querystringSchema: PROVIDER_PARAMS,
    swaggerResponse: {
      200: {
        type: 'object',
        description: '模型列表',
        properties: {models: {type: 'array', description: '模型名称列表', items: {type: 'string'}}}
      }
    }
  },
  'GET /providers/baseurl': {
    summary: '获取供应商BaseURL',
    querystringSchema: PROVIDER_PARAMS,
    swaggerResponse: {
      200: {
        type: 'object',
        description: 'BaseURL信息',
        properties: {
          baseURL: {type: 'string', description: 'BaseURL'},
          isCustom: {type: 'boolean', description: '是否为自定义值'}
        }
      }
    }
  },
  'POST /providers/baseurl': {
    summary: '设置供应商BaseURL',
    bodySchema: z.object({provider: z.string().describe('供应商类型'), baseURL: z.string().describe('API基础URL')})
  },
}

/** AI 配置类接口：供应商配置 / 助手偏好 / 记忆 / 供应商探测 / 搜索引擎。
 * 与对话链路（chat.ts）分开注册，但共用同一个 /api/chat 前缀（客户端路径不变）。 */
export async function aiConfigRoutes(app: FastifyInstance) {
  app.addHook('onRoute', (opts) => {
    const key = `${opts.method} ${opts.url}`.replace(/\/api\/chat\//, '/')
    const doc = ROUTE_DOC[key]
    opts.schema = {
      ...(opts.schema || {}),
      tags: ['AI 助手'],
      summary: doc?.summary || opts.schema?.summary,
      ...(doc?.description ? { description: doc.description } : {}),
      ...(doc?.bodySchema ? { body: zSchema(doc.bodySchema) } : {}),
      ...(doc?.paramsSchema ? { params: zSchema(doc.paramsSchema) } : {}),
      ...(doc?.querystringSchema ? { querystring: zSchema(doc.querystringSchema) } : {}),
    }
    // 返回值文档存入 config.swaggerResponse，由 swagger transform 注入
    // 避免 Fastify 将 schema.response 用于序列化导致数据损坏
    if (doc?.swaggerResponse) {
      (opts.config as any) = { ...(opts.config || {}), swaggerResponse: doc.swaggerResponse }
    }
  })
  app.addHook('onRequest', authenticate)

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
    return prisma.userProviderConfig.create({
      data: { userId, ...parsed.data, name: parsed.data.name || parsed.data.provider },
    })
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

    return await prisma.userProviderConfig.update({where: {id}, data: updateData})
  })

  // 删除
  app.delete('/provider-configs/:id', async (req, reply) => {
    const userId = (req as any).user.id as string
    const { id } = req.params as { id: string }

    const existing = await prisma.userProviderConfig.findUnique({ where: { id } })
    if (!existing || existing.userId !== userId) return reply.status(404).send({ message: '配置不存在' })

    await prisma.userProviderConfig.delete({ where: { id } })

    // 同步清理 AI 配置里对它的引用:否则会留下悬空 ID(保存 AI 配置时会因 ID 校验被拒)
    const prefs = await prisma.userAIConfig.findUnique({ where: { userId } })
    if (prefs) {
      const patch: { simpleProviderConfigId?: null; complexProviderConfigId?: null; visionProviderConfigId?: null } = {}
      if (prefs.simpleProviderConfigId === id) patch.simpleProviderConfigId = null
      if (prefs.complexProviderConfigId === id) patch.complexProviderConfigId = null
      if (prefs.visionProviderConfigId === id) patch.visionProviderConfigId = null
      if (Object.keys(patch).length > 0) {
        await prisma.userAIConfig.update({ where: { userId }, data: patch })
      }
    }

    return { success: true }
  })

  // 复制
  app.post('/provider-configs/:id/copy', async (req, reply) => {
    const userId = (req as any).user.id as string
    const { id } = req.params as { id: string }

    const existing = await prisma.userProviderConfig.findUnique({ where: { id } })
    if (!existing || existing.userId !== userId) return reply.status(404).send({ message: '配置不存在' })

    return await prisma.userProviderConfig.create({
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
  })

  // 获取助手配置
  app.get('/ai-config', async (req) => {
    const userId = (req as any).user.id as string
    return await loadAIConfig(userId)
  })

  // 更新助手配置
  app.put('/ai-config', async (req, reply) => {
    const parsed = updateAIConfigSchema.safeParse(req.body)
    if (!parsed.success) return reply.status(400).send({ message: parsed.error.issues[0].message })

    const userId = (req as any).user.id as string

    // 校验引用的供应商配置确实属于当前用户:这些 ID 直接来自客户端,
    // 不校验就能指向他人配置,后续模型调用会用别人的 apiKey(越权)
    const referencedIds = [parsed.data.simpleProviderConfigId, parsed.data.complexProviderConfigId, parsed.data.visionProviderConfigId]
      .filter((id): id is string => !!id)
    if (referencedIds.length > 0) {
      const owned = await prisma.userProviderConfig.findMany({
        where: { id: { in: referencedIds }, userId },
        select: { id: true },
      })
      const ownedIds = new Set(owned.map((c) => c.id))
      if (referencedIds.some((id) => !ownedIds.has(id))) {
        return reply.status(400).send({ message: '选择的供应商配置不存在或无权使用,请重新选择模型' })
      }
    }

    const { disabledTools, ...rest } = parsed.data
    const data: Record<string, unknown> = { ...rest }
    if (disabledTools) {
      data.disabledTools = JSON.stringify(disabledTools)
    }

    await prisma.userAIConfig.upsert({
      where: { userId },
      create: { userId, ...data },
      update: data,
    })
    return { success: true }
  })

  // 获取可用工具列表
  app.get('/tools', async () => {
    return {
      groups: TOOL_GROUPS.map(g => ({
        label: g.label,
        tools: g.tools.map(t => ({ name: t.name, displayName: t.displayName, description: t.description, requireConfirm: t.requireConfirm ?? false })),
      })),
    }
  })

  // ---- 记忆管理 ----

  app.get('/memories', async (req) => {
    const userId = (req as any).user.id as string
    return { memories: await listMemories(userId) }
  })

  app.delete('/memories/:id', async (req, reply) => {
    const userId = (req as any).user.id as string
    const { id } = req.params as { id: string }
    const deleted = await deleteMemory(userId, id)
    if (!deleted) return reply.status(404).send({ message: '记忆不存在' })
    return { success: true }
  })

  const updateMemorySchema = z.object({
    content: z.string().min(1).optional(),
    importance: z.number().min(0).max(1).optional(),
  })

  app.patch('/memories/:id', async (req, reply) => {
    const userId = (req as any).user.id as string
    const { id } = req.params as { id: string }
    const parsed = updateMemorySchema.safeParse(req.body)
    if (!parsed.success) return reply.status(400).send({ message: '参数错误' })
    const result = await updateMemory(userId, id, parsed.data)
    if (result.count === 0) return reply.status(404).send({ message: '记忆不存在' })
    return { success: true }
  })

  // 可用模型列表
  app.get('/providers', async () => {
    const { ALL_PROVIDERS } = await import('../services/ai/providers.js')
    return { providers: ALL_PROVIDERS }
  })

  // 动态获取供应商模型列表（代理调用供应商 /v1/models）
  app.get('/providers/models', async (req, reply) => {
    const { provider, baseURL: customBaseURL, apiKey: directApiKey, configId } = req.query as { provider?: string; baseURL?: string; apiKey?: string; configId?: string }

    if (!provider) return reply.status(400).send({ message: '缺少 provider 参数' })

    const providerConfig = ALL_PROVIDERS.find((p) => p.value === provider)
    if (!providerConfig) return reply.status(400).send({ message: '无效的供应商' })

    const userId = (req as any).user.id as string

    // 获取 API Key：优先前端直传，其次从已保存的 UserProviderConfig 读取
    let apiKey = directApiKey || ''
    let savedBaseURL = ''
    if (!apiKey && configId) {
      const saved = await prisma.userProviderConfig.findFirst({ where: { id: configId, userId } })
      if (saved) {
        apiKey = saved.apiKey
        savedBaseURL = saved.baseURL
      }
    }

    // 获取 baseURL
    const baseURL = customBaseURL || savedBaseURL || DEFAULT_BASE_URLS[provider as keyof typeof DEFAULT_BASE_URLS] || ''
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

  // 获取供应商 baseURL（存储值或默认值）
  app.get('/providers/baseurl', async (req, reply) => {
    const { provider } = req.query as { provider?: string }
    if (!provider) return reply.status(400).send({ message: '缺少 provider 参数' })

    const stored = await loadStoredBaseURL(provider)
    const defaultURL = DEFAULT_BASE_URLS[provider as keyof typeof DEFAULT_BASE_URLS] || ''
    return { baseURL: stored || defaultURL, isCustom: !!stored }
  })

  // 测试供应商连接
  app.post('/providers/test', async (req, reply) => {
    const { provider, apiKey, baseURL, model, configId } = req.body as { provider?: string; apiKey?: string; baseURL?: string; model?: string; configId?: string }
    if (!provider) return reply.status(400).send({ message: '缺少 provider 参数' })

    const validProviders = ALL_PROVIDERS.map((p) => p.value)
    if (!validProviders.includes(provider as any)) return reply.status(400).send({ message: '无效的供应商' })

    const userId = (req as any).user.id as string

    // configId 归属校验:否则可用他人配置 ID 触发写回(testStatus / lastTestedAt,下方 finishTest)
    if (configId && !(await loadUserProviderConfig(userId, configId))) {
      return reply.status(404).send({ message: '配置不存在' })
    }

    // apiKey 为空时，从已保存的 UserProviderConfig 读取（编辑场景：apiKey 被掩码为 ****）
    let key = apiKey || ''
    let savedBaseURL = ''
    let savedModel = ''
    if (!key && configId) {
      const saved = await prisma.userProviderConfig.findFirst({ where: { id: configId, userId } })
      if (saved) {
        key = saved.apiKey
        savedBaseURL = saved.baseURL
        savedModel = saved.models
      }
    }

    const url = baseURL || savedBaseURL || DEFAULT_BASE_URLS[provider as keyof typeof DEFAULT_BASE_URLS] || ''
    if (!url) return reply.status(400).send({ message: '无法获取 API 端点 URL，请手动填写' })

    const providerConfig = ALL_PROVIDERS.find((p) => p.value === provider)!

    // 测试结果持久化：有 configId 时写回 testStatus
    const finishTest = async (result: { success: boolean; message: string; models?: string[] }) => {
      if (configId) {
        await prisma.userProviderConfig.update({
          where: { id: configId },
          data: { testStatus: result.success ? 'pass' : 'fail', lastTestedAt: new Date() },
        }).catch(() => {})
      }
      return result
    }

    try {
      // 1. 确定用于聊天测试的模型名：优先用前端传入的 model，回退到已保存配置中的模型
      let testModel = model?.trim() || savedModel || providerConfig.defaultModels[0] || ''
      let discoveredModels: string[] = []

      // Ollama: 通过 /api/tags 获取已安装模型（OpenAI 兼容端点不暴露模型列表）
      if (provider === 'ollama') {
        const ollamaBase = url.replace(/\/v1\/?$/, '')
        const tagsRes = await fetch(`${ollamaBase}/api/tags`, { signal: AbortSignal.timeout(10000) })
        if (!tagsRes.ok) {
          return finishTest({ success: false, message: `Ollama 连接失败: HTTP ${tagsRes.status}` })
        }
        const tagsData = (await tagsRes.json()) as { models?: { name: string }[] }
        discoveredModels = (tagsData.models || []).map((m) => m.name)
        if (discoveredModels.length === 0) {
          return finishTest({ success: false, message: 'Ollama 未安装任何模型，请先拉取模型' })
        }
        if (!testModel) testModel = discoveredModels[0]
      }

      // Custom 等无默认模型的供应商且前端未传 model：尝试 /models 端点发现可用模型
      if (!testModel) {
        discoveredModels = await tryFetchModels(url, key, provider)
        if (discoveredModels.length === 0) {
          return finishTest({ success: false, message: '无法获取模型列表，请确认 baseURL 和 apiKey 是否正确' })
        }
        testModel = discoveredModels[0]
      }

      // 2. 连通性测试：调用聊天接口做简短测试
      try {
        const languageModel = createModel(provider as ProviderType, testModel, { apiKey: key, baseURL: url })
        await generateText({
          model: languageModel,
          messages: [{ role: 'user', content: 'hi' }],
          maxOutputTokens: 5,
        })
      } catch (err: any) {
        return finishTest({ success: false, message: `连接失败: ${err.message || '聊天接口调用失败'}` })
      }

      // 3. 连通成功，获取模型列表（已发现的直接用；否则尝试 /models 端点，失败返回空）
      const models = discoveredModels.length > 0
        ? discoveredModels
        : await tryFetchModels(url, key, provider)

      return finishTest({
        success: true,
        message: models.length > 0
          ? `连接成功，找到 ${models.length} 个模型`
          : '连接成功（模型列表接口不可用，请手动填写模型名）',
        models,
      })
    } catch (err: any) {
      return finishTest({ success: false, message: `连接失败: ${err.message || '网络错误'}` })
    }
  })

  // 保存供应商 baseURL
  // 服务端全局配置(systemConfig.ai_baseurl_*),影响所有用户 → 仅管理员可改
  app.post('/providers/baseurl', { onRequest: [authenticate, requireAdmin] }, async (req, reply) => {
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

  // 搜索引擎配置
  app.get('/search-engine', async () => {
    const row = await prisma.systemConfig.findUnique({ where: { key: 'search_engine' } })
    return { engine: row?.value || 'bing' }
  })

  // 服务端全局配置(systemConfig.search_engine),影响所有用户 → 仅管理员可改
  app.post('/search-engine', { onRequest: [authenticate, requireAdmin] }, async (req, reply) => {
    const { engine } = req.body as { engine?: string }
    const valid = ['bing', 'baidu', 'google']
    if (!engine || !valid.includes(engine)) return reply.status(400).send({ message: '无效的搜索引擎' }
    )
    await prisma.systemConfig.upsert({
      where: { key: 'search_engine' },
      create: { key: 'search_engine', value: engine },
      update: { value: engine },
    })
    return { success: true, engine }
  })
}

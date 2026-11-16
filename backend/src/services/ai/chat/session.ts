import {prisma} from '../../../app.js'
import {DEFAULT_BASE_URLS, type ProviderType} from '../providers.js'
import {classifyWithKeywords, routeIntent} from '../model-router.js'

/** 取会话；sid 不存在/不属于当前用户时新建一个 */
export async function getOrCreateSession(sid: string | undefined, userId: string, firstMessage?: string) {
  if (sid) {
    const existing = await prisma.chatSession.findUnique({ where: { id: sid } })
    if (existing && existing.userId === userId) return existing
  }
  const title = firstMessage
    ? firstMessage.length > 30 ? firstMessage.slice(0, 30) + '...' : firstMessage
    : ''
  return prisma.chatSession.create({
    data: { userId, title },
  })
}

/** 读取用户 AI 偏好(缺省值集中在这里,调用方不再各自兜底) */
export async function loadAIConfig(userId: string) {
  const prefs = await prisma.userAIConfig.findUnique({ where: { userId } })
  return {
    enabled: prefs?.enabled ?? false,
    simpleProviderConfigId: prefs?.simpleProviderConfigId || null,
    simpleModel: prefs?.simpleModel || '',
    complexProviderConfigId: prefs?.complexProviderConfigId || null,
    complexModel: prefs?.complexModel || '',
    autoConfirmCreate: prefs?.autoConfirmCreate ?? false,
    language: prefs?.language || 'zh-CN',
    temperature: prefs?.temperature ?? 0.7,
    maxTokens: prefs?.maxTokens ?? 4096,
    maxSteps: prefs?.maxSteps ?? 10,
    visionProviderConfigId: prefs?.visionProviderConfigId || null,
    visionModel: prefs?.visionModel || '',
    disabledTools: prefs?.disabledTools ? JSON.parse(prefs.disabledTools) : [],
  }
}

/**
 * 尝试获取模型列表，失败返回空数组。
 * /models 端点并非所有服务商都支持（如 Anthropic），不支持时返回空列表，不报错。
 */
export async function tryFetchModels(url: string, key: string, provider: string): Promise<string[]> {
  try {
    if (provider === 'ollama') {
      const ollamaBase = url.replace(/\/v1\/?$/, '')
      const res = await fetch(`${ollamaBase}/api/tags`, { signal: AbortSignal.timeout(10000) })
      if (!res.ok) return []
      const data = (await res.json()) as { models?: { name: string }[] }
      return (data.models || []).map((m) => m.name)
    }

    // OpenAI 兼容: GET {baseURL}/models
    const modelsURL = url.replace(/\/$/, '') + '/models'
    const res = await fetch(modelsURL, {
      headers: {
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json',
      },
      signal: AbortSignal.timeout(10000),
    })
    if (!res.ok) return []
    const data = (await res.json()) as { data?: { id: string }[] }
    return (data.data || []).map((m) => m.id)
  } catch {
    return []
  }
}

export async function loadStoredBaseURL(provider: string): Promise<string> {
  try {
    const config = await prisma.systemConfig.findUnique({ where: { key: `ai_baseurl_${provider}` } })
    return config?.value || ''
  } catch {
    return ''
  }
}

export async function loadBaseURL(provider: string): Promise<string> {
  // 优先从 SystemConfig 读取用户自定义值
  const stored = await loadStoredBaseURL(provider)
  if (stored) return stored

  // 回退到默认值
  return DEFAULT_BASE_URLS[provider as keyof typeof DEFAULT_BASE_URLS] || ''
}

/**
 * 解析本轮使用的模型：配了简单模型就用它做意图分类，否则退回关键词判断。
 * 校验失败返回 `{ error }`，由调用方转成 400（辅助函数不直接 reply）。
 */
export async function resolveModelRoute(opts: {
  message: string
  hasSimple: boolean
  simpleProvider: string
  complexProvider: string
  simpleModel: string
  complexModel: string
  simpleApiKey: string
}): Promise<
  | { route: { intent: 'simple' | 'complex'; provider: string; model: string } }
  | { error: string }
> {
  let route: { intent: 'simple' | 'complex'; provider: string; model: string }
  if (opts.hasSimple) {
    route = await routeIntent(
      opts.message,
      opts.simpleProvider as ProviderType,
      opts.simpleModel,
      opts.complexProvider as ProviderType,
      opts.complexModel,
      { apiKey: opts.simpleApiKey },
    )
  } else {
    const intent = classifyWithKeywords(opts.message)
    route = {
      intent,
      provider: intent === 'complex' ? opts.complexProvider : opts.simpleProvider,
      model: intent === 'complex' ? opts.complexModel : opts.simpleModel,
    }
  }
  if (!route.model || !route.provider) {
    const taskType = route.intent === 'complex' ? '复杂任务' : '简单任务'
    return { error: `未配置${taskType}模型，请在 AI 设置中选择模型后重试` }
  }
  return { route }
}

/**
 * 视觉模型配置加载(OCR 工具 / 图片文字化 共用)。
 *
 * 优先用「视觉模型」配置,回退到简单任务模型;按归属读取 provider 配置,
 * 避免 AI 配置里的 ID 指向他人配置从而用其 apiKey。
 */
import { prisma } from '../../app.js'
import { loadUserProviderConfig } from './security.js'
import { DEFAULT_BASE_URLS, type ProviderType } from './providers.js'

export interface VisionConfig {
  provider: string
  model: string
  apiKey: string
  baseURL: string
}

export async function loadVisionConfig(userId: string): Promise<VisionConfig | null> {
  const prefs = await prisma.userAIConfig.findUnique({ where: { userId } })

  // 优先使用视觉模型配置
  if (prefs?.visionProviderConfigId && prefs?.visionModel) {
    const config = await loadUserProviderConfig(userId, prefs.visionProviderConfigId)
    if (config) {
      return {
        provider: config.provider,
        model: prefs.visionModel,
        apiKey: config.apiKey,
        baseURL: config.baseURL || DEFAULT_BASE_URLS[config.provider as ProviderType] || '',
      }
    }
  }

  // 回退到简单任务模型
  if (prefs?.simpleProviderConfigId && prefs?.simpleModel) {
    const config = await loadUserProviderConfig(userId, prefs.simpleProviderConfigId)
    if (config) {
      return {
        provider: config.provider,
        model: prefs.simpleModel,
        apiKey: config.apiKey,
        baseURL: config.baseURL || DEFAULT_BASE_URLS[config.provider as ProviderType] || '',
      }
    }
  }

  return null
}

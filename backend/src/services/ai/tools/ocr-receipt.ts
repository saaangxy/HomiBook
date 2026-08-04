import { readFileSync, existsSync } from 'fs'
import path from 'path'
import type { ToolDef } from './types.js'
import { prisma } from '../../../app.js'
import { assertIsMember } from '../security.js'
import { createModel, DEFAULT_BASE_URLS, type ProviderType } from '../providers.js'
import { generateText } from 'ai'

async function loadVisionConfig(userId: string) {
  const prefs = await prisma.userAIConfig.findUnique({ where: { userId } })
  // 优先使用视觉模型配置，回退到简单任务模型
  if (prefs?.visionProviderConfigId && prefs?.visionModel) {
    const config = await prisma.userProviderConfig.findUnique({ where: { id: prefs.visionProviderConfigId } })
    if (config) {
      const baseURL = config.baseURL || DEFAULT_BASE_URLS[config.provider as ProviderType] || ''
      return { provider: config.provider, model: prefs.visionModel, apiKey: config.apiKey, baseURL }
    }
  }
  // 回退到简单任务模型
  if (prefs?.simpleProviderConfigId && prefs?.simpleModel) {
    const config = await prisma.userProviderConfig.findUnique({ where: { id: prefs.simpleProviderConfigId } })
    if (config) {
      const baseURL = config.baseURL || DEFAULT_BASE_URLS[config.provider as ProviderType] || ''
      return { provider: config.provider, model: prefs.simpleModel, apiKey: config.apiKey, baseURL }
    }
  }
  return null
}

export const ocrReceiptTool: ToolDef = {
  name: 'ocr_receipt',
  displayName: '小票识别',
  promptHint: '识别小票/收据图片中的金额、日期等信息',
  description: '识别小票/收据图片，提取金额、日期、交易方、分类等信息。传入 attachmentId 即可。',
  parameters: {
    type: 'object',
    properties: {
      attachmentId: { type: 'string', description: '附件 ID（从消息中的附件信息获取）' },
    },
    required: ['attachmentId'],
  } as Record<string, unknown>,
  requireConfirm: false,
  execute: async (args: { attachmentId: string }, ctx: { userId: string; accountBookId: string }) => {
    const { attachmentId } = args
    const { userId, accountBookId } = ctx

    await assertIsMember(accountBookId, userId)

    // 1. 查询附件记录
    const attachment = await prisma.recordAttachment.findUnique({
      where: { id: attachmentId },
      select: { id: true, path: true, originalFilename: true, recordId: true },
    })
    if (!attachment) return { success: false, error: '附件不存在', retryable: false }

    // 如果附件已关联记录，验证记录属于当前账本
    if (attachment.recordId) {
      const record = await prisma.record.findUnique({
        where: { id: attachment.recordId },
        select: { accountBookId: true },
      })
      if (record?.accountBookId !== accountBookId) {
        return { success: false, error: '无权访问该附件', retryable: false }
      }
    }

    // 2. 读取图片文件
    const filePath = path.join(process.cwd(), attachment.path.replace(/^\/api\//, ''))
    if (!existsSync(filePath)) return { success: false, error: '图片文件不存在', retryable: false }

    let imageData: Buffer
    try {
      imageData = readFileSync(filePath)
    } catch {
      return { success: false, error: '读取图片文件失败', retryable: false }
    }

    // 3. 获取视觉模型配置
    const visionConfig = await loadVisionConfig(userId)
    if (!visionConfig) return { success: false, error: '未配置视觉模型，请在 AI 设置中配置', retryable: false }

    // 4. 查询账户列表和分类字典（供视觉模型匹配）
    const accounts = await prisma.account.findMany({
      where: { accountBookId },
      select: { id: true, name: true, type: true },
    })
    const categories = await prisma.dictionary.findMany({
      where: {
        group: { in: ['transaction_category_expense', 'transaction_category_income'] },
      },
      select: { code: true, label: true },
      orderBy: { order: 'asc' },
    })

    const accountsContext = accounts.length > 0
      ? accounts.map(a => `- ${a.name}（${a.type}）`).join('\n')
      : '无可用账户'
    const categoriesContext = categories.length > 0
      ? categories.map(c => `- ${c.code} ${c.label}`).join('\n')
      : '无可用分类'

    // 5. 检测图片类型
    const ext = path.extname(attachment.originalFilename).toLowerCase()
    const mediaTypeMap: Record<string, string> = {
      '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png',
      '.webp': 'image/webp', '.gif': 'image/gif', '.bmp': 'image/bmp',
    }
    const mediaType = mediaTypeMap[ext] || 'image/jpeg'

    // 6. 调用视觉模型识别
    try {
      const model = createModel(visionConfig.provider as ProviderType, visionConfig.model, {
        apiKey: visionConfig.apiKey,
        baseURL: visionConfig.baseURL,
      })

      const result = await generateText({
        model,
        system: '你是一个专业的OCR识别助手，请准确识别图片中的文字内容，并以JSON格式返回。只返回JSON，不要添加其他说明文字。',
        messages: [{
          role: 'user',
          content: [
            { type: 'text', text: `请识别这张小票/收据图片，提取以下信息（无法确定的字段返回 null）：

## 可用账户列表（仅用于参考名称）
${accountsContext}

## 可用分类（仅用于参考分类编码和名称）
${categoriesContext}

## 提取要求
- amount: 总金额（数字，单位元，如 50.00）
- date: 日期（YYYY-MM-DD 格式，未标明年份默认当年 ${new Date().getFullYear()}）
- counterparty: 交易方/商户名称
- accountName: 最可能的账户名称（从上面可用账户中选最匹配的）
- categoryCode: 最可能的分类编码（从上面可用分类中选最匹配的）
- rawText: 图片中识别到的所有原始文本内容（用于存入备注）

请以 JSON 格式返回，不要添加其他说明文字。` },
            { type: 'image', image: imageData.toString('base64'), mediaType },
          ],
        }],
        maxOutputTokens: 1000,
        temperature: 0.1,
      })

      // 7. 解析结果
      const text = result.text.trim()
      // 去除可能的 markdown 代码块包裹
      const jsonStr = text.replace(/^```(?:json)?\s*\n?/i, '').replace(/\n?```\s*$/i, '')
      let parsed: any
      try {
        parsed = JSON.parse(jsonStr)
      } catch {
        // 尝试提取 JSON 对象
        const match = text.match(/\{[\s\S]*\}/)
        if (match) {
          try { parsed = JSON.parse(match[0]) } catch { parsed = { rawText: text } }
        } else {
          parsed = { rawText: text }
        }
      }

      return {
        success: true,
        data: {
          amount: parsed.amount ?? null,
          date: parsed.date ?? null,
          counterparty: parsed.counterparty ?? null,
          accountName: parsed.accountName ?? null,
          categoryCode: parsed.categoryCode ?? null,
          rawText: parsed.rawText ?? text,
        },
        retryable: false,
      }
    } catch (err: any) {
      return { success: false, error: `OCR 识别失败: ${err.message}`, retryable: true }
    }
  },
}

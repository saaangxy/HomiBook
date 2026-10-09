/**
 * 图片内容的「文字化」——  图片资源化 + 摘要 + 按需加载(见 docs: 多模态上下文方案)。
 *
 * 背景:图片本身早已是磁盘资源(RecordAttachment + attachmentId),但此前图片只在
 * **上传的那一轮**以 base64 进上下文 —— 之后的历史轮次只剩纯文本,模型看不到图,
 * 只能重新调 ocr_receipt 去读,用户感知为「AI 忘了刚才那张图」;追问视觉细节更是无从记起。
 *
 * 这里在**附件进入会话时**就把图片读成文字(描述 + OCR 全文 + 关键结构化字段),并在
 * 附件的 vision* 列上缓存:
 *   - 本轮:摘要进入「附件信息」注入段一起下发 ⇒ 注入消息**落库**,下一轮从 DB 重放历史时
 *     模型凭这段文本就「记得」图片内容,无需重发 base64(省 token,也不打断前缀缓存);
 *   - 追问**视觉细节**(布局/位置/印章/商品外观等文字描述不了的东西):由 view_image 工具
 *     把图片按需重新注入当轮;
 *   - 同一附件只花一次视觉调用(visionAt 非空即缓存命中)。
 */
import { readFileSync, existsSync } from 'fs'
import path from 'path'
import { generateText } from 'ai'
import { prisma } from '../../app.js'
import { createModel, type ProviderType } from './providers.js'
import { detectImageFormat, VISION_MEDIA_TYPES, IMAGE_FORMAT_LABELS } from './image-format.js'
import { loadVisionConfig } from './vision.js'

export interface ImageTextContext {
  /** 一句话描述(后续轮次凭它「记得」这张图) */
  summary: string
  /** 图中识别到的全部文字 */
  text: string
  /** 关键结构化字段(金额/日期/交易方/关键对象等,按图片类型而定) */
  meta: Record<string, unknown> | null
}

/** 附件路径 → 磁盘绝对路径(与 ocr-receipt 同口径:path 形如 /api/uploads/xxx) */
function toDiskPath(attachmentPath: string): string {
  return path.join(process.cwd(), attachmentPath.replace(/^\/api\//, ''))
}

const ANALYZE_SYSTEM = '你是图片信息提取助手。请阅读图片并严格按要求的 JSON 格式输出,不要添加任何额外说明文字。'

const ANALYZE_PROMPT = `请阅读这张图片,输出 JSON(只输出 JSON):

{
  "summary": "一句话说明这是什么(如:一张星巴克的小票,合计 38.00 元)",
  "text": "图中识别到的全部文字,按阅读顺序保留",
  "meta": { "把图片里最关键的字段结构化列出,如 amount/date/counterparty/items/账号 等,没有的字段不要写" }
}

要求:
- summary 要能让没看过图的人知道「这张图里有什么、和什么账务相关」
- text 尽量完整(后续可能用于填充备注)
- meta 只放确凿读到的值,不要猜测`

/**
 * 生成(或取缓存)单张图片的文字化结果。失败返回 null —— 调用方按「没有摘要」降级即可,
 * 不能因为图片读不出来而阻断整轮对话。
 */
async function ensureOne(
  attachment: { id: string; path: string; originalFilename: string },
  userId: string,
): Promise<ImageTextContext | null> {
  // 1. 缓存命中(visionAt 非空即已生成过)
  const cached = await prisma.recordAttachment.findUnique({
    where: { id: attachment.id },
    select: { visionSummary: true, visionText: true, visionMeta: true, visionAt: true },
  })
  if (cached?.visionAt && cached.visionSummary) {
    return {
      summary: cached.visionSummary,
      text: cached.visionText || '',
      meta: cached.visionMeta ? safeParse(cached.visionMeta) : null,
    }
  }

  // 2. 读图(与下面的「视觉问答」共用同一套读取/格式校验)
  const img = loadImageForVision(attachment)
  if ('error' in img) {
    console.warn(`[image-context] 跳过 ${attachment.originalFilename}:${img.error}`)
    return null
  }

  // 3. 调视觉模型
  const vision = await loadVisionConfig(userId)
  if (!vision) return null

  try {
    const model = createModel(vision.provider as ProviderType, vision.model, {
      apiKey: vision.apiKey,
      baseURL: vision.baseURL,
    })
    const result = await generateText({
      model,
      system: ANALYZE_SYSTEM,
      messages: [{
        role: 'user',
        content: [
          { type: 'text', text: ANALYZE_PROMPT },
          { type: 'image', image: img.buf.toString('base64'), mediaType: img.mediaType },
        ],
      }],
      maxOutputTokens: 1500,
      temperature: 0.1,
    })

    const parsed = parseAnalyzeResult(result.text)
    if (!parsed.summary) return null

    // 4. 落库缓存(失败不影响本轮使用)
    await prisma.recordAttachment.update({
      where: { id: attachment.id },
      data: {
        visionSummary: parsed.summary,
        visionText: parsed.text || null,
        visionMeta: parsed.meta ? JSON.stringify(parsed.meta) : null,
        visionAt: new Date(),
      },
    }).catch((e) => console.warn('[image-context] 摘要落库失败(不影响本轮):', e?.message))

    return parsed
  } catch (e: any) {
    console.warn(`[image-context] 图片文字化失败 ${attachment.originalFilename}:`, e?.message)
    return null
  }
}

/**
 * 批量:返回 附件id → 文字化结果。只处理传入的图片附件(调用方已按扩展名筛过),
 * 逐张并发;单张失败不会影响其余。
 */
export async function ensureImageTextContexts(
  attachments: { id: string; path: string; originalFilename: string }[],
  userId: string,
): Promise<Map<string, ImageTextContext>> {
  const out = new Map<string, ImageTextContext>()
  if (attachments.length === 0) return out

  const results = await Promise.all(
    attachments.map(async (att) => ({ id: att.id, ctx: await ensureOne(att, userId) })),
  )
  for (const r of results) {
    if (r.ctx) out.set(r.id, r.ctx)
  }
  return out
}

function safeParse(raw: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(raw)
    return parsed && typeof parsed === 'object' ? parsed : null
  } catch {
    return null
  }
}

/** 解析模型输出(容错:去 markdown 包裹、截取首个 JSON 对象) */
function parseAnalyzeResult(text: string): ImageTextContext {
  const trimmed = (text || '').trim()
  const jsonStr = trimmed.replace(/^```(?:json)?\s*\n?/i, '').replace(/\n?```\s*$/i, '')
  let parsed: any
  try {
    parsed = JSON.parse(jsonStr)
  } catch {
    const match = trimmed.match(/\{[\s\S]*\}/)
    parsed = match ? (() => { try { return JSON.parse(match[0]) } catch { return null } })() : null
  }
  if (!parsed || typeof parsed !== 'object') {
    // 完全解析不出来时,把原文当摘要(总比没有强)
    return { summary: trimmed.slice(0, 120), text: trimmed, meta: null }
  }
  const meta = parsed.meta && typeof parsed.meta === 'object' && !Array.isArray(parsed.meta) ? parsed.meta : null
  return {
    summary: typeof parsed.summary === 'string' ? parsed.summary : '',
    text: typeof parsed.text === 'string' ? parsed.text : '',
    meta,
  }
}

/** 读图 + 格式校验(视觉调用前的统一入口) */
function loadImageForVision(
  attachment: { path: string; originalFilename: string },
): { buf: Buffer; mediaType: string } | { error: string } {
  const filePath = toDiskPath(attachment.path)
  if (!existsSync(filePath)) return { error: '文件不存在' }

  let buf: Buffer
  try {
    buf = readFileSync(filePath)
  } catch {
    return { error: '读取文件失败' }
  }

  const fmt = detectImageFormat(buf)
  const mediaType = VISION_MEDIA_TYPES[fmt]
  if (!mediaType) return { error: `非视觉格式(${IMAGE_FORMAT_LABELS[fmt]})` }

  return { buf, mediaType }
}

/**
 * 针对图片的**视觉问答**:让视觉模型看图后回答一个具体问题,返回**文字**给主模型。
 *
 * 为什么不是「把图片作为 tool-result 的 content 回给主模型」(即 ToolDef.toModelOutput):
 * openai-compatible 的 tool 消息**不支持图片 content** —— base64 会被当作文本塞进 messages,
 * 实测单次请求炸到 **320 万 token**(远超 1M 上限,上游直接 400,整轮对话中断)。
 * 改成「视觉模型作答、主模型读文字」与供应商能力解耦,也不受上下文长度限制。
 */
export async function askImage(
  attachment: { id: string; path: string; originalFilename: string },
  question: string,
  userId: string,
): Promise<{ answer: string } | { error: string }> {
  const img = loadImageForVision(attachment)
  if ('error' in img) return { error: img.error }

  const vision = await loadVisionConfig(userId)
  if (!vision) return { error: '未配置视觉模型，请在 AI 设置中配置' }

  // 已有的文字化结果作为背景:模型不必重新通读全文,专注回答被问的细节
  const cached = await prisma.recordAttachment.findUnique({
    where: { id: attachment.id },
    select: { visionSummary: true, visionText: true },
  }).catch(() => null)

  const background = [
    cached?.visionSummary ? `此前已提取的摘要:${cached.visionSummary}` : '',
    cached?.visionText ? `此前已提取的文本(仅供参考):${cached.visionText.slice(0, 1500)}` : '',
  ].filter(Boolean).join('\n')

  try {
    const model = createModel(vision.provider as ProviderType, vision.model, {
      apiKey: vision.apiKey,
      baseURL: vision.baseURL,
    })
    const result = await generateText({
      model,
      system: '你正在回答关于这张图片的具体问题。请直接看图作答,聚焦被问的细节;看不清或图中没有就照实说,不要猜测。回答简短(3 句以内)。',
      messages: [{
        role: 'user',
        content: [
          { type: 'text', text: `${background ? `${background}\n\n` : ''}问题:${question}` },
          { type: 'image', image: img.buf.toString('base64'), mediaType: img.mediaType },
        ],
      }],
      maxOutputTokens: 500,
      temperature: 0.1,
    })
    const answer = result.text.trim()
    return { answer: answer || '（视觉模型未给出有效回答）' }
  } catch (e: any) {
    return { error: `查看图片失败:${e?.message || '未知错误'}` }
  }
}

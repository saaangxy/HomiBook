import path from 'path'
import {prisma} from '../../../app.js'
import {VISION_MAX_SIDE} from '../image-tile.js'
import {loadVisionWindow, logVisionImage} from '../vision-window.js'

/**
 * 待注入的图片召回请求。
 * fromPart/toPart 是模型指定的分段区间(从 1 开始数,含端点):首次默认前 6 段,
 * 模型可接着往后看,或直接跳到任意区间。
 *
 * ⚠️ 这是**进程内**会话状态,全进程只能有这一份:拆文件时不要在各入口各建一个 Map。
 */
const pendingImageInjections = new Map<
  string,
  { attachmentId: string; at: number; fromPart?: number; toPart?: number }
>()
const IMAGE_INJECTION_TTL_MS = 10 * 60 * 1000

export const IMAGE_EXT_RE = /\.(jpe?g|png|webp|gif|bmp)$/i
/** 扩展名 → 声明 MIME(仅用于「扩展名与真实内容不一致」的告警,实际发送以内容判定为准) */
const IMAGE_MEDIA_TYPES: Record<string, string> = {
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png',
  '.webp': 'image/webp', '.gif': 'image/gif', '.bmp': 'image/bmp',
}

/**
 * 登记「下一轮把这张图作为 user message 注入一次」。
 * 为什么不能直接放进 tool-result:openai-compatible 的 tool 消息不支持图片 content,
 * base64 会被当文本计入 token —— 实测单图就能把请求撑到 320 万 token。
 */
export function requestImageInjection(
  sessionId: string,
  req: { attachmentId: string; fromPart?: number; toPart?: number },
): void {
  pendingImageInjections.set(sessionId, { attachmentId: req.attachmentId, at: Date.now(), fromPart: req.fromPart, toPart: req.toPart })
}

/**
 * 把 view_image 请求过的图片作为 user message 注入一次。
 *
 * 约束(与方案一致):只在下一轮注入一次、单轮最多 1 张、长边压缩由 prepareVisionImage 负责;
 * 任何失败都静默跳过 —— 工具返回的文字答案已经足够。
 */
export async function buildPendingImageMessage(sessionId: string): Promise<any | null> {
  const pending = pendingImageInjections.get(sessionId)
  if (!pending) return null
  // 一次性:无论成功与否都消费掉,避免同一张图反复注入撑大上下文
  pendingImageInjections.delete(sessionId)
  if (Date.now() - pending.at > IMAGE_INJECTION_TTL_MS) return null
  console.log(`图片召回`)
  try {
    const att = await prisma.recordAttachment.findUnique({
      where: { id: pending.attachmentId },
      select: { path: true, originalFilename: true },
    })
    if (!att?.path) return null

    const disk = path.join(process.cwd(), att.path.replace(/^\/api\//, ''))
    // 与首轮注入共用同一套「读盘 → 切段 → 取窗口 → 段落文案 → 日志」,
    // 差异只有 fromPart(续看的起点)和 verb。
    const loaded = await loadVisionWindow(disk, {
      filename: att.originalFilename,
      attachmentId: pending.attachmentId,
      // 1 基区间:模型说「看第 5 段」就传 5
      fromPart: pending.fromPart ?? 1,
      toPart: pending.toPart,
      verb: '注入',
    })
    if ('error' in loaded || loaded.window.parts.length === 0) return null
    logVisionImage(loaded.meta, '注入')

    return {
      role: 'user',
      content: [
        {
          type: 'text',
          text: `（系统注入）你上一步请求直接查看这张图片${att.originalFilename ? `：${att.originalFilename}` : ''}。${loaded.note}`,
        },
        ...loaded.window.parts.map((p) => ({ type: 'image' as const, image: p.image, mediaType: p.mediaType })),
      ],
    }
  } catch {
    // 注入失败不影响文字答案
    return null
  }
}

/** 跨轮兜底:上一次请求里标记了要注入、但本轮开始前还没被 prepareStep 消费掉 */
export async function applyPendingImageInjection(sessionId: string, messages: any[]) {
  const msg = await buildPendingImageMessage(sessionId)
  if (msg) messages.push(msg)
}

/**
 * 多模态主模型：把图片附件以 base64 注入最后一条用户消息（ai SDK 多模态 content 数组）。
 * 视觉模型按内容字节判定格式,故这里按魔数判定真实格式;非白名单格式不入上下文(会触发 400 且该错误
 * 在历史重发时持续复现),改为追加一段文本说明,让模型/用户知道是哪张图、为什么不识别。
 * 超出单边尺寸上限(手机长截图常见)的图片先纵向切片再发送,否则上游同样会报错且内容不可读。
 */
export async function injectImagesToLastUserMessage(messages: any[], imageAttachments: { id?: string; url: string; originalFilename: string }[]): Promise<any[]> {
  const msgs = [...messages]
  for (let i = msgs.length - 1; i >= 0; i--) {
    if (msgs[i].role !== 'user') continue
    const text = typeof msgs[i].content === 'string' ? msgs[i].content : ''
    const parts: any[] = [{ type: 'text', text }]
    const unsupported: string[] = []
    /** 非错误类提示(长图分段、同图多段说明),单独收敛后追加,避免和「无法识别」混在一起 */
    const notes: string[] = []
    for (const att of imageAttachments) {
      // 读盘、格式校验、超限切段、取窗口、段落文案全部收敛在 vision-window 里,
      // 与 view_image 召回路径共用同一份实现(PARTS_PER_CALL / 文案 / 日志都只有一处)。
      const filePath = path.join(process.cwd(), att.url.replace(/^\/api\//, ''))
      const loaded = await loadVisionWindow(filePath, {
        filename: att.originalFilename,
        attachmentId: att.id,
        verb: '发送',
      })
      if ('error' in loaded) {
        // error 自带完整说明(可能已含括号),这里用冒号拼接避免嵌套括号
        unsupported.push(`${att.originalFilename}：${loaded.error}`)
        continue
      }
      logVisionImage(loaded.meta, '发送')
      // 扩展名与真实内容不符时告警:上游只认内容,但用户会照扩展名困惑
      const ext = path.extname(att.originalFilename).toLowerCase()
      const actualType = loaded.window.parts[0]?.mediaType
      if (IMAGE_MEDIA_TYPES[ext] && actualType && IMAGE_MEDIA_TYPES[ext] !== actualType) {
        console.warn(`[多模态] ${att.originalFilename} 扩展名与内容不符(${IMAGE_MEDIA_TYPES[ext]} → ${actualType}),按内容发送`)
      }
      for (const p of loaded.window.parts) parts.push({ type: 'image', ...p })
      if (loaded.note) notes.push(loaded.note)
    }
    if (unsupported.length > 0) {
      // 明确要求模型把原因转述给用户:图片被跳过时,聊天界面里也要能看到原因
      parts.push({
        type: 'text',
        text: `[系统提示:以下图片无法识别,请在回复中明确告知用户原因 — ${unsupported.join('、')};当前视觉模型仅支持 JPEG/PNG/GIF/WebP 格式且单边不超过 ${VISION_MAX_SIDE}px,请处理后重新上传。这些图片已被跳过,不要凭空猜测图片内容]`,
      })
    }
    if (notes.length > 0) {
      parts.push({ type: 'text', text: `[系统提示:${notes.join(' ')}]` })
    }
    msgs[i] = { ...msgs[i], content: parts }
    break
  }
  return msgs
}

/**
 * 这些图片是否都已有文字化缓存(visionAt 非空)。
 * 用于判断本轮是否要强制先调 save_image_content：无缓存 = 需要。
 * 查询失败按「无缓存」处理(与原逻辑一致)。
 */
export async function hasVisionCache(attachmentIds: string[]): Promise<boolean> {
  if (attachmentIds.length === 0) return true
  const rows = await prisma.recordAttachment
    .findMany({
      where: { id: { in: attachmentIds }, visionAt: { not: null } },
      select: { id: true },
    })
    .catch(() => [])
  return rows.length >= attachmentIds.length
}

import { existsSync, readFileSync } from 'node:fs'
import { detectImageFormat, getImageSize, IMAGE_FORMAT_LABELS } from './image-format.js'
import { prepareVisionImage } from './image-tile.js'

/**
 * 图片注入窗口:同一张长截图「这一次该发哪几段、该怎么向模型解释」的唯一实现。
 *
 * 收敛前有两条各自实现的路径:
 *   - 首轮新消息带图(routes/chat.ts 的 injectImagesToLastUserMessage):手写
 *     detectImageFormat → getImageSize → needsTiling → fitOversizedImage,自己 slice 前 6 段
 *   - 按需续看(buildPendingImageMessage):走 prepareVisionImage,自己 slice 偏移窗口
 * 两份 PARTS_PER_CALL、两套文案、两套日志 —— 改一处漏一处。
 *
 * 现在两条路径都只调本模块,差异只剩「从哪拿文件」和「结果塞进哪条消息」。
 */

/** 单次注入的长图分段上限:首轮与按需续看共用,改这里即全局生效 */
export const PARTS_PER_CALL = 6

/** 本次要发送的图片段 + 窗口位置 */
export interface VisionWindow {
  parts: { image: string; mediaType: string }[]
  /** 原图总共被切成几段 */
  total: number
  /** 起始段下标(0-based) */
  fromPart: number
  /** 结束段(1-based,用于文案里的人类可读区间) */
  endIndex: number
  /** 后面是否还有未发送的段 */
  hasMore: boolean
}

/**
 * 取一次窗口。`fromPart` / `toPart` 都是 **0 基下标**,`toPart` 含端点。
 *
 * 两个约束:
 *   · 单次最多 `PARTS_PER_CALL` 段 —— 模型要「1~100」也只给 6 段,避免一次把上下文打满
 *   · 越界自动收敨,保证至少返回一段(空数组会让上游 400)
 */
export function sliceVisionWindow(
  all: { image: string; mediaType: string }[],
  fromPart = 0,
  toPart?: number,
): VisionWindow {
  const total = all.length
  if (total === 0) {
    return { parts: [], total: 0, fromPart: 0, endIndex: 0, hasMore: false }
  }
  const from = Math.max(0, Math.min(fromPart, total - 1))
  const requested = toPart === undefined ? total - 1 : Math.max(from, Math.min(toPart, total - 1))
  const lastIncluded = Math.min(requested, from + PARTS_PER_CALL - 1)
  const end = lastIncluded + 1 // slice 的 exclusive 上界,数值上等于 1 基的末段序号
  return {
    parts: all.slice(from, end),
    total,
    fromPart: from,
    endIndex: end,
    hasMore: end < total,
  }
}

export interface DescribeOptions {
  /** 文件名,用于文案里指明是哪张图 */
  filename: string
  /** 附件 id;有值且还有后续时,文案会给出续看所需的完整调用参数 */
  attachmentId?: string
  /** 动词:首轮用「发送」,召回用「注入」 */
  verb?: '发送' | '注入'
}

/**
 * 生成段落说明。三态:
 *   1. 还有后续 → 说明区间 + 同一张图 + 续看方式(带 attachmentId 时给出完整参数)
 *   2. 续看到末尾 → 说明区间 + 与前文合并理解
 *   3. 一次给全  → 强调同一张图,不要当成多张独立图片
 */
export function describeVisionWindow(win: VisionWindow, opts: DescribeOptions): string {
  const verb = opts.verb ?? '发送'
  const label = `「${opts.filename}」`

  if (win.total <= 1) return ''

  if (win.hasMore) {
    const ask = opts.attachmentId
      ? `若判断还需要后面的内容,请调用 view_image(needImage=true, attachmentId="${opts.attachmentId}", fromPart=${win.endIndex + 1}) 获取；` +
        `也可以指定区间,如 fromPart=${win.endIndex + 1} toPart=${Math.min(win.total, win.endIndex + PARTS_PER_CALL)}。` +
        `不要凭猜测补全没有看到的部分。`
      : '若判断还需要后面的内容,请再次调用 view_image(needImage=true) 继续获取；不要凭猜测补全没有看到的部分。'
    return (
      `${label}是**同一张**长截图,按从上到下切分为 ${win.total} 段,本次${verb}第 ${win.fromPart + 1}~${win.endIndex} 段。` +
      `这些段落是同一张图的不同部分,请拼起来当作一张完整的图理解,不要当成多张独立截图。` +
      ask
    )
  }

  if (win.fromPart > 0) {
    return `这是同一张长截图的第 ${win.fromPart + 1}~${win.endIndex} 段(共 ${win.total} 段),已经到图片末尾,请与之前看到的段落合起来理解。`
  }

  return `${label}是**同一张**长截图,已按从上到下切分为 ${win.total} 段全部${verb},请拼合理解,不要当成多张独立图片。`
}

/** 日志所需的图片元信息 */
export interface VisionImageMeta {
  filename: string
  bytes: number
  size: { width: number; height: number } | null
  /** 文件头前 16 字节 hex —— 排查上游 400 时唯一可靠的格式依据 */
  headerHex: string
  formatLabel: string
  total: number
  sent: number
  fromPart: number
}

/** 统一的送图日志:字段与收敛前 injectImagesToLastUserMessage 保持一致,不因归一而变弱 */
export function logVisionImage(meta: VisionImageMeta, verb: '发送' | '注入' = '发送'): void {
  const sizeText = meta.size ? `${meta.size.width}x${meta.size.height}` : '尺寸未知'
  const range = meta.total > 1 ? `切分 ${meta.total} 段,本次${verb}第 ${meta.fromPart + 1}~${meta.fromPart + meta.sent} 段` : '单张'
  console.log(
    `[多模态] ${meta.filename} | ${meta.bytes}B | ${sizeText} | 表头 ${meta.headerHex} | 格式 ${meta.formatLabel} | ${range}`,
  )
}

export interface LoadVisionOptions extends DescribeOptions {
  /** 起始段:第 1 段传 1(从 1 开始数,不是 0);不传 = 第 1 段。模型视角的「看第几段」直接传这个 */
  fromPart?: number
  /** 结束段(含这一段);不传 = 从起始段往后最多 PARTS_PER_CALL 段 */
  toPart?: number
}

export interface LoadedVisionWindow {
  window: VisionWindow
  /** 段落说明,空串表示无需额外解释(单段图) */
  note: string
  meta: VisionImageMeta
}

/**
 * 读盘 → 出站准备(格式白名单 + 超限切段) → 取窗口 → 生成文案。
 *
 * 失败返回 `{ error }`,由调用方决定降级(主流程跳过并提示用户 / 工具返回错误)。
 */
export async function loadVisionWindow(
  filePath: string,
  opts: LoadVisionOptions,
): Promise<LoadedVisionWindow | { error: string }> {
  if (!existsSync(filePath)) {
    return { error: `文件不存在` }
  }

  const buf = readFileSync(filePath)
  // 日志用的轻量解析(格式/尺寸):prepareVisionImage 内部还会再解析一次,
  // 但那一次不暴露表头 hex,排查上游 400 时这份信息是唯一依据。
  const fmt = detectImageFormat(buf)
  const size = getImageSize(fmt, buf)

  const prep = await prepareVisionImage(buf)
  if ('error' in prep) return { error: prep.error }

  // 调用方传的是 1 基(模型说「第 3 段」就传 3),这里转成 0 基给切片函数
  const from0 = Math.max(0, Math.floor(opts.fromPart ?? 1) - 1)
  const to0 = opts.toPart === undefined ? undefined : Math.max(0, Math.floor(opts.toPart) - 1)
  const window = sliceVisionWindow(prep.parts, from0, to0)
  const note = describeVisionWindow(window, opts)
  const meta: VisionImageMeta = {
    filename: opts.filename,
    bytes: buf.length,
    size: prep.size ?? size,
    headerHex: buf.subarray(0, 16).toString('hex'),
    formatLabel: IMAGE_FORMAT_LABELS[fmt],
    total: window.total,
    sent: window.parts.length,
    fromPart: window.fromPart,
  }

  return { window, note, meta }
}

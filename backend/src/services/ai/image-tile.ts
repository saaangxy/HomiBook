import type { Page } from 'puppeteer'
import { getBrowser } from './browser-fetch.js'

/**
 * 超限图片适配:切片或缩放。
 *
 * 视觉模型有单边尺寸上限(DeepSeek 文档:每边最多 8192px,请求含 ≥15 张图时降为 4096px),
 * 手机长截图动辄 1000x17000+,直接发送会被上游 400 拒绝(报错文案是误导性的 "unsupported image");
 * 而且上游会把大图降采样到约 800x800 的像素总量,即使勉强压进上限,长截图里的文字也已糊到不可读。
 * 因此:
 * - 高度超限(长截图,常见)→ 纵向切片,每片控制在合理像素量,让模型能看清内容;
 * - 宽度超限(少见)→ 整体等比缩放(左右切片会破坏版面)。
 *
 * 复用 browser-fetch 的共享 Chromium 做「解码 → 裁剪/缩放 → 重编码 JPEG」,不为图像处理新增原生依赖。
 */

/** 视觉模型单边尺寸上限(px) */
export const VISION_MAX_SIDE = 8192
/** 单片目标像素总量:上游会把每张图降采样到约 800x800 量级,超过该量级再大也没有收益 */
const TARGET_TILE_PIXELS = 700_000
/** 切片数量上限:每张图都要传输与计费,同时避开「≥15 张图上限降为 4096px」的档位 */
const MAX_TILES = 12
/** 相邻切片重叠像素:避免正好把一行文字切在边界上(少量重复比误读一行金额安全) */
const OVERLAP = 48
/** 重编码 JPEG 质量 */
const JPEG_QUALITY = 0.85

/** 单张输出的绘制计划:源矩形 → 目标尺寸 */
export interface FitSlice {
  sx: number
  sy: number
  sw: number
  sh: number
  dw: number
  dh: number
}

/** 是否超出单边尺寸上限(需要适配) */
export function needsTiling(size: { width: number; height: number }): boolean {
  return size.width > VISION_MAX_SIDE || size.height > VISION_MAX_SIDE
}

/**
 * 纵向切片高度(px)。
 * 切片按「步进 = 片高 - 重叠」推进,故先按数量上限反推片高(含重叠补偿),再按目标像素量细化。
 */
export function tileHeight(width: number, height: number): number {
  const byCount = Math.ceil(height / MAX_TILES) + OVERLAP
  const byPixels = Math.floor(TARGET_TILE_PIXELS / Math.max(width, 1))
  return Math.max(1, Math.min(VISION_MAX_SIDE, Math.max(byCount, byPixels)))
}

/** 计算适配计划;未超限返回空数组 */
export function planImageFit(size: { width: number; height: number }): FitSlice[] {
  const { width, height } = size
  if (!needsTiling(size)) return []
  if (width > VISION_MAX_SIDE) {
    const scale = VISION_MAX_SIDE / width
    return [{ sx: 0, sy: 0, sw: width, sh: height, dw: VISION_MAX_SIDE, dh: Math.max(1, Math.round(height * scale)) }]
  }
  const sliceH = tileHeight(width, height)
  const out: FitSlice[] = []
  for (let y = 0; y < height; y += sliceH - OVERLAP) {
    const sh = Math.min(sliceH, height - y)
    out.push({ sx: 0, sy: y, sw: width, sh, dw: width, dh: sh })
  }
  return out
}

/** 页面内执行:解码一次,按计划逐张裁剪/缩放并重编码为 JPEG base64 */
async function renderSlices(page: Page, dataUrl: string, plan: FitSlice[]): Promise<string[]> {
  return page.evaluate(async (url: string, slices: FitSlice[], quality: number) => {
    const g = globalThis as any
    const img = new g.Image()
    img.src = url
    await img.decode()
    const canvas = g.document.createElement('canvas')
    const ctx = canvas.getContext('2d')
    const out: string[] = []
    for (const s of slices) {
      canvas.width = s.dw
      canvas.height = s.dh
      ctx.clearRect(0, 0, s.dw, s.dh)
      ctx.drawImage(img, s.sx, s.sy, s.sw, s.sh, 0, 0, s.dw, s.dh)
      out.push(canvas.toDataURL('image/jpeg', quality).split(',')[1] as string)
    }
    return out
  }, dataUrl, plan, JPEG_QUALITY)
}

/**
 * 超限图片适配为多张 JPEG base64;失败返回 null,由调用方降级(跳过并提示用户)。
 */
export async function fitOversizedImage(buf: Buffer, mediaType: string, size: { width: number; height: number }): Promise<string[] | null> {
  const plan = planImageFit(size)
  if (plan.length === 0) return null

  const dataUrl = `data:${mediaType};base64,${buf.toString('base64')}`
  let page: Page | null = null
  try {
    const browser = await getBrowser()
    page = await browser.newPage()
    const images = await renderSlices(page, dataUrl, plan)
    return images.length > 0 ? images : null
  } catch (e: any) {
    console.warn('[多模态] 图片适配(切片/缩放)失败,将跳过该图:', e?.message || e)
    return null
  } finally {
    await page?.close().catch(() => {})
  }
}

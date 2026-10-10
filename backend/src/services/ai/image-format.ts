/**
 * 图片真实格式判定 + 视觉模型格式白名单。
 *
 * 背景:视觉模型(DeepSeek 视觉模型等)按「文件内容字节」识别图片格式,不认扩展名、也不认请求里声明的 MIME;
 * 非 JPEG/PNG/GIF/WebP 会直接返回 400(如 "You have uploaded an unsupported image")。
 * 而扩展名与实际内容不一致在真实场景很常见(手机拍的 HEIC 照片经常被命名为 .jpg、导出工具改后缀等),
 * 所以出站前统一按魔数判定真实格式,只放行白名单格式,避免把坏图写进上下文导致持续报错。
 */

/** 常见图片格式(按魔数判定) */
export type ImageFormat = 'jpeg' | 'png' | 'gif' | 'webp' | 'bmp' | 'heic' | 'avif' | 'tiff' | 'svg' | 'unknown'

/** 视觉模型普遍支持的格式 → 多模态 content part 的 mediaType */
export const VISION_MEDIA_TYPES: Partial<Record<ImageFormat, string>> = {
  jpeg: 'image/jpeg',
  png: 'image/png',
  gif: 'image/gif',
  webp: 'image/webp',
}

/** 格式中文展示名(错误提示用) */
export const IMAGE_FORMAT_LABELS: Record<ImageFormat, string> = {
  jpeg: 'JPEG', png: 'PNG', gif: 'GIF', webp: 'WebP',
  bmp: 'BMP', heic: 'HEIC', avif: 'AVIF', tiff: 'TIFF', svg: 'SVG', unknown: '未知格式',
}

/** 按文件头魔数判定图片真实格式(无法识别返回 unknown) */
export function detectImageFormat(buf: Buffer): ImageFormat {
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'jpeg'
  if (buf.length >= 8 && buf.readUInt32BE(0) === 0x89504e47 && buf.readUInt32BE(4) === 0x0d0a1a0a) return 'png'
  if (buf.length >= 6) {
    const sig = buf.toString('latin1', 0, 6)
    if (sig === 'GIF87a' || sig === 'GIF89a') return 'gif'
  }
  if (buf.length >= 12 && buf.toString('latin1', 0, 4) === 'RIFF' && buf.toString('latin1', 8, 12) === 'WEBP') return 'webp'
  if (buf.length >= 2 && buf.toString('latin1', 0, 2) === 'BM') return 'bmp'
  // ISO-BMFF(ftyp box):HEIC/HEIF/AVIF 同族,用 brand 区分
  if (buf.length >= 12 && buf.toString('latin1', 4, 8) === 'ftyp') {
    const brand = buf.toString('latin1', 8, 12)
    return brand.startsWith('avif') || brand.startsWith('avis') ? 'avif' : 'heic'
  }
  if (buf.length >= 4) {
    const sig = buf.readUInt32BE(0)
    if (sig === 0x49492a00 || sig === 0x4d4d002a) return 'tiff' // "II*\0" / "MM\0*"
  }
  // SVG/XML 等文本型图片(视觉模型不支持)
  const head = buf.toString('utf8', 0, Math.min(buf.length, 256)).trimStart().toLowerCase()
  if (head.startsWith('<svg') || head.startsWith('<?xml')) return 'svg'
  return 'unknown'
}

/**
 * 读取图片像素尺寸(仅解析文件头,不解码像素)。
 * 用于判断是否触发视觉模型的单边尺寸上限;格式无法判定返回 null。
 */
export function getImageSize(fmt: ImageFormat, buf: Buffer): { width: number; height: number } | null {
  try {
    if (fmt === 'png' && buf.length >= 24) {
      // IHDR:8 字节签名 + 长度(4) + 'IHDR'(4) + width(4) + height(4)
      return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) }
    }
    if (fmt === 'gif' && buf.length >= 10) {
      // 逻辑屏幕宽高:偏移 6/8 的 LE16
      return { width: buf.readUInt16LE(6), height: buf.readUInt16LE(8) }
    }
    if (fmt === 'jpeg') {
      // 扫描段找 SOF0..SOF15(排除 DHT/DNL/DAC),布局:FF Cn len(2) precision(1) height(2) width(2)
      let o = 2
      while (o + 9 <= buf.length) {
        if (buf[o] !== 0xff) { o++; continue }
        const marker = buf[o + 1]
        if (marker === 0xff || marker === 0x00) { o++; continue } // 填充字节
        if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) { o += 2; continue } // 无长度字段
        if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
          return { height: buf.readUInt16BE(o + 5), width: buf.readUInt16BE(o + 7) }
        }
        o += 2 + buf.readUInt16BE(o + 2)
      }
    }
  } catch { /* 头部不完整/越界:按未知处理 */ }
  return null
}

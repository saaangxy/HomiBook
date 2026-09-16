import { describe, expect, it } from 'vitest'
import { detectImageFormat, isImageComplete, getImageSize, VISION_MEDIA_TYPES, IMAGE_FORMAT_LABELS } from '../src/services/ai/image-format.js'
import { needsTiling, tileHeight, planImageFit, VISION_MAX_SIDE } from '../src/services/ai/image-tile.js'

// 视觉模型(DeepSeek 视觉模型等)按「文件内容字节」判定图片格式,不认扩展名与声明的 MIME,
// 故按魔数判定真实格式:非 JPEG/PNG/GIF/WebP 一律不放行(否则上游 400 unsupported image);
// 另外魔数合法但文件被截断的图片在上游解码阶段同样会失败,所以再做一次结束标记校验。

// 仅头部合法(截断/未写完的形态)
const jpegHead = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46])
const pngHead = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d])
const gifHead = Buffer.from('GIF89a\x10\x00\x10\x00', 'latin1')
const webpHead = Buffer.concat([Buffer.from('RIFF'), Buffer.from([0x24, 0x00, 0x00, 0x00]), Buffer.from('WEBP')])

// 完整形态(带结束标记)
const jpegFull = Buffer.concat([jpegHead, Buffer.from([0xff, 0xd9])])
const pngFull = Buffer.concat([pngHead, Buffer.from('IEND'), Buffer.from([0xae, 0x42, 0x60, 0x82])])
const gifFull = Buffer.concat([gifHead, Buffer.from([0x3b])])
// RIFF 声明长度 = 文件长度 - 8:body 4 字节 → 总长 16 → 声明 8
const webpFull = Buffer.concat([Buffer.from('RIFF'), Buffer.from([0x08, 0x00, 0x00, 0x00]), Buffer.from('WEBP'), Buffer.from([0x00, 0x00, 0x00, 0x00])])

const bmp = Buffer.from('BM\x36\x00\x00\x00', 'latin1')
const heic = Buffer.concat([Buffer.from([0x00, 0x00, 0x00, 0x18]), Buffer.from('ftypheic'), Buffer.from([0x00, 0x00, 0x00, 0x00])])
const avif = Buffer.concat([Buffer.from([0x00, 0x00, 0x00, 0x1c]), Buffer.from('ftypavif'), Buffer.from([0x00, 0x00, 0x00, 0x00])])
const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><rect/></svg>')

describe('detectImageFormat(按内容魔数判定)', () => {
  it('识别视觉模型支持的四种格式', () => {
    expect(detectImageFormat(jpegHead)).toBe('jpeg')
    expect(detectImageFormat(pngHead)).toBe('png')
    expect(detectImageFormat(gifHead)).toBe('gif')
    expect(detectImageFormat(webpHead)).toBe('webp')
  })

  it('识别常见的不支持格式', () => {
    expect(detectImageFormat(bmp)).toBe('bmp')
    expect(detectImageFormat(heic)).toBe('heic')
    expect(detectImageFormat(avif)).toBe('avif')
    expect(detectImageFormat(Buffer.from([0x49, 0x49, 0x2a, 0x00]))).toBe('tiff') // "II*\0"
    expect(detectImageFormat(Buffer.from([0x4d, 0x4d, 0x00, 0x2a]))).toBe('tiff') // "MM\0*"
    expect(detectImageFormat(svg)).toBe('svg')
  })

  it('空文件/非图片内容归为 unknown', () => {
    expect(detectImageFormat(Buffer.alloc(0))).toBe('unknown')
    expect(detectImageFormat(Buffer.from('id,amount\n1,2\n'))).toBe('unknown')
  })

  it('内容与扩展名不一致时以内容为准(HEIC 照片被命名为 .jpg 的场景)', () => {
    // 调用方使用判定结果,而不是文件名后缀
    expect(detectImageFormat(heic)).not.toBe('jpeg')
    expect(VISION_MEDIA_TYPES[detectImageFormat(heic)]).toBeUndefined()
    // 反向:PNG 内容命名为 .jpg,按内容判定为 png 仍可发送
    expect(VISION_MEDIA_TYPES[detectImageFormat(pngHead)]).toBe('image/png')
  })

  it('白名单只含上游接受的四种 mediaType', () => {
    expect(VISION_MEDIA_TYPES).toEqual({
      jpeg: 'image/jpeg',
      png: 'image/png',
      gif: 'image/gif',
      webp: 'image/webp',
    })
  })

  it('每种格式都有中文展示名(错误提示用)', () => {
    for (const fmt of ['jpeg', 'png', 'gif', 'webp', 'bmp', 'heic', 'avif', 'tiff', 'svg', 'unknown'] as const) {
      expect(IMAGE_FORMAT_LABELS[fmt]).toBeTruthy()
    }
  })
})

describe('isImageComplete(结束标记校验)', () => {
  it('带结束标记的完整文件通过', () => {
    expect(isImageComplete('jpeg', jpegFull)).toBe(true)
    expect(isImageComplete('png', pngFull)).toBe(true)
    expect(isImageComplete('gif', gifFull)).toBe(true)
    expect(isImageComplete('webp', webpFull)).toBe(true)
  })

  it('头部合法但被截断的文件判为不完整', () => {
    expect(isImageComplete('jpeg', jpegHead)).toBe(false)      // 缺 FFD9
    expect(isImageComplete('png', pngHead)).toBe(false)        // 缺 IEND
    expect(isImageComplete('gif', gifHead)).toBe(false)        // 缺 0x3B
    expect(isImageComplete('webp', webpHead)).toBe(false)      // RIFF 声明长度大于实际字节
  })

  it('极短文件不会误判为完整', () => {
    expect(isImageComplete('jpeg', Buffer.from([0xff, 0xd8]))).toBe(false)
    expect(isImageComplete('png', Buffer.from([0x89, 0x50]))).toBe(false)
  })

  it('非白名单格式不参与完整性判断', () => {
    expect(isImageComplete('heic', heic)).toBe(true)
    expect(isImageComplete('unknown', Buffer.alloc(0))).toBe(true)
  })
})

// 真实场景:手机银行 App 的长截图 1220x17588,超过单边 8192px 上限被上游拒绝
describe('getImageSize(只解析头部)', () => {
  it('解析 JPEG 的 SOF 段尺寸(与真实长截图同结构)', () => {
    const jpegWithSof = Buffer.concat([
      Buffer.from([0xff, 0xd8]),                                  // SOI
      Buffer.from([0xff, 0xe1, 0x00, 0x04, 0xaa, 0xbb]),          // APP1(EXIF)
      Buffer.from([0xff, 0xc0, 0x00, 0x11, 0x08]),                // SOF0 + 精度
      Buffer.from([0x00, 0x44, 0x00, 0x2c]),                      // 高 68,宽 44
      Buffer.from([0x03, 0x01, 0x11, 0x00, 0x02, 0x11, 0x01, 0x03, 0x11, 0x01]),
      Buffer.from([0xff, 0xd9]),
    ])
    expect(getImageSize('jpeg', jpegWithSof)).toEqual({ width: 44, height: 68 })
  })

  it('解析 PNG 的 IHDR 尺寸', () => {
    const pngIhdr = Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      Buffer.from([0x00, 0x00, 0x00, 0x0d]),
      Buffer.from('IHDR'),
      Buffer.from([0x00, 0x00, 0x04, 0x04]),                      // 宽 1028
      Buffer.from([0x00, 0x00, 0x0a, 0x2c]),                      // 高 2604
      Buffer.from([0x08, 0x06, 0x00, 0x00, 0x00]),
      Buffer.from('IEND'), Buffer.from([0xae, 0x42, 0x60, 0x82]),
    ])
    expect(getImageSize('png', pngIhdr)).toEqual({ width: 1028, height: 2604 })
  })

  it('解析 GIF 逻辑屏幕尺寸', () => {
    expect(getImageSize('gif', Buffer.from('GIF89a\x10\x00\x20\x00', 'latin1'))).toEqual({ width: 16, height: 32 })
  })

  it('头部信息不足时返回 null(不抛错)', () => {
    expect(getImageSize('jpeg', Buffer.from([0xff, 0xd8]))).toBeNull()
    expect(getImageSize('png', Buffer.from([0x89, 0x50]))).toBeNull()
    expect(getImageSize('webp', webpFull)).toBeNull() // WebP 未解析尺寸,按未知处理
  })
})

describe('超限判定与适配计划', () => {
  it('单边超过 8192px 才需要适配', () => {
    expect(needsTiling({ width: 1220, height: 2656 })).toBe(false)
    expect(needsTiling({ width: 1220, height: VISION_MAX_SIDE })).toBe(false)
    expect(needsTiling({ width: 1220, height: 17588 })).toBe(true)
    expect(needsTiling({ width: 9000, height: 200 })).toBe(true)
  })

  it('未超限时不产生任何输出片', () => {
    expect(planImageFit({ width: 1220, height: 2656 })).toEqual([])
    expect(planImageFit({ width: 1220, height: VISION_MAX_SIDE })).toEqual([])
  })

  it('长截图(真实案例 1220x17588)纵向切片:≤12 片、每片不超单边上限、首片从顶到末片到底', () => {
    const size = { width: 1220, height: 17588 }
    const plan = planImageFit(size)
    expect(plan.length).toBeGreaterThan(1)
    expect(plan.length).toBeLessThanOrEqual(12)
    expect(plan[0]).toMatchObject({ sx: 0, sy: 0, sw: 1220, dw: 1220 })
    for (const s of plan) {
      expect(s.dw).toBeLessThanOrEqual(VISION_MAX_SIDE)
      expect(s.dh).toBeLessThanOrEqual(VISION_MAX_SIDE)
      // 片数上限优先于单片像素量:长截图单片约 1.85MP,上游会再降采样到约 800x800 量级
      expect(s.dw * s.dh).toBeLessThanOrEqual(2_000_000)
    }
    const last = plan[plan.length - 1]
    expect(last.sy + last.sh).toBe(size.height)
  })

  it('超宽图整体等比缩放(左右切片会破坏版面)', () => {
    const plan = planImageFit({ width: 9000, height: 200 })
    expect(plan).toHaveLength(1)
    expect(plan[0]).toMatchObject({ sx: 0, sy: 0, sw: 9000, sh: 200, dw: VISION_MAX_SIDE })
    // 等比:9000→8192 时高度按同比例缩小
    expect(plan[0].dh).toBe(Math.round(200 * (VISION_MAX_SIDE / 9000)))
  })

  it('切片高度不超过单边上限', () => {
    expect(tileHeight(1220, 17588)).toBeLessThanOrEqual(VISION_MAX_SIDE)
    expect(tileHeight(5000, 20000)).toBeLessThanOrEqual(VISION_MAX_SIDE)
  })
})

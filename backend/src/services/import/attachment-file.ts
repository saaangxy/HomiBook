import fs from 'fs'
import path from 'path'
import { prisma } from '../../app.js'
import { detectBillSource, parseAlipayCSV, parseJdCSV, parseWechatXlsx, type BillSource } from './parsers.js'
import type { ParsedRow } from './shared.js'

/**
 * AI 读账单文件 = 读**附件**(RecordAttachment) —— 导入链路已统一到 attachmentId。
 *
 * 历史包袱:导入曾有一条独立通道(`/import/upload` 只写物理文件、发一个 fileId,不落库),
 * 与聊天附件的 attachmentId 是两套互不相通的 id,模型经常拿 attachmentId 当 fileId 传,
 * 必然报「文件不存在或已过期」。现在两个上传入口都建 RecordAttachment,AI 一律只认 attachmentId。
 *
 * 解析必须**经 path**:attachmentId 与磁盘文件名是两个独立 uuid(见 routes/record.ts 的 upload),
 * 按文件名前缀匹配永远匹配不上。
 */

export interface ImportFile {
  attachmentId: string
  originalFilename: string
  /** 磁盘绝对路径 */
  filePath: string
  buffer: Buffer
}

/** 查不到附件 / 实体文件丢失时的错误文案(给模型,让它能自纠而不是原地重试) */
export const IMPORT_FILE_MISSING =
  '找不到该 attachmentId 对应的账单附件(或其实体文件已丢失)。attachmentId 只能取自本轮消息的附件清单'
  + '(形如「attachmentId: xxx」),不能填文件名、也不能填旧版账单消息里的 fileId —— 若用户手上还有该账单,请让他重新上传。'

/** 无法识别来源时的错误文案 */
export const IMPORT_SOURCE_UNKNOWN =
  '无法识别该账单文件的来源。支持 支付宝(alipay) / 微信(wechat) / 京东(jd) 三种导出账单;'
  + '若确认是其中一种但自动识别失败,可在 source 参数里显式指定后重试。'

/**
 * 按 attachmentId 取出可解析的账单文件。
 * 找不到记录、路径非法、实体文件不存在都返回 null(调用方统一回 IMPORT_FILE_MISSING)。
 */
export async function loadImportFile(attachmentId: unknown): Promise<ImportFile | null> {
  if (typeof attachmentId !== 'string' || !attachmentId) return null
  const att = await prisma.recordAttachment
    .findUnique({ where: { id: attachmentId }, select: { id: true, path: true, originalFilename: true } })
    .catch(() => null)
  if (!att) return null

  const uploadsDir = path.join(process.cwd(), 'uploads')
  const filePath = path.join(uploadsDir, path.basename(att.path || ''))
  // 防路径穿越 + 文件必须真实存在
  if (!filePath.startsWith(uploadsDir) || !fs.existsSync(filePath)) return null

  return {
    attachmentId: att.id,
    originalFilename: att.originalFilename,
    filePath,
    buffer: fs.readFileSync(filePath),
  }
}

export type ImportParseResult =
  /** errors = 逐行解析失败的说明(用于预览里的「跳过 N 行」),不是整体失败 */
  | { ok: true; source: BillSource; rows: ParsedRow[]; errors: string[] }
  | { ok: false; error: string }

function parseWith(source: BillSource, buffer: Buffer): { rows: ParsedRow[]; errors: string[] } {
  if (source === 'alipay') return parseAlipayCSV(buffer)
  if (source === 'wechat') return parseWechatXlsx(buffer)
  if (source === 'jd') return parseJdCSV(buffer)
  return { rows: [], errors: [`不支持的账单来源: ${source}`] }
}

/**
 * 解析账单文件:source 缺省时**按文件内容识别**(detectBillSource)。
 *
 * 显式 source 优先,但解析不出记录时会回退到内容识别出的来源 —— 模型偶尔按文件名猜错来源
 * (例如把微信账单说成 jd),回退能直接救回来,不必让用户重来一遍。
 */
export function parseImportFile(file: ImportFile, source?: unknown): ImportParseResult {
  const explicit = typeof source === 'string' && source ? (source as BillSource) : null
  const detected = detectBillSource(file.buffer, file.originalFilename)
  const candidates = [...new Set([explicit, detected].filter(Boolean) as BillSource[])]
  if (candidates.length === 0) return { ok: false, error: IMPORT_SOURCE_UNKNOWN }

  let firstError = ''
  for (const candidate of candidates) {
    const result = parseWith(candidate, file.buffer)
    if (result.rows.length > 0) return { ok: true, source: candidate, rows: result.rows, errors: result.errors }
    if (!firstError) firstError = result.errors[0] || `账单里没有解析到流水记录(来源: ${candidate})`
  }
  return { ok: false, error: firstError }
}

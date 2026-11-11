import fs from 'node:fs'
import path from 'node:path'
import { prisma } from '../app.js'
import { pickDeletableAttachments, type AttachmentRef } from './attachment-orphan.js'

/** 附件物理存储目录（与上传、备份逻辑保持一致） */
const uploadsDir = path.join(process.cwd(), 'uploads')

/** 取这些流水当前挂着的附件 id（删除流水前调用） */
export async function attachmentIdsOfRecords(recordIds: string[]): Promise<string[]> {
  if (recordIds.length === 0) return []
  const rows = await prisma.recordAttachment.findMany({
    where: { records: { some: { id: { in: recordIds } } } },
    select: { id: true },
  })
  return rows.map((r) => r.id)
}

export interface AttachmentCleanupResult {
  /** 实际删除的附件记录数 */
  deletedRecords: number
  /** 实际删除的物理文件数 */
  deletedFiles: number
}

/**
 * 清理孤儿附件（记录 + 文件）。
 *
 * 传入「删除流水前」取到的候选 id；仍挂在任一流水上、或仍被聊天消息引用的附件一律保留。
 * 文件删除失败（占用/权限）不中断，记录仍会被删除，避免留下永远关不掉的孤儿行。
 */
export async function cleanupOrphanAttachments(candidateIds: string[]): Promise<AttachmentCleanupResult> {
  const empty = { deletedRecords: 0, deletedFiles: 0 }
  if (candidateIds.length === 0) return empty

  const candidates = await prisma.recordAttachment.findMany({
    where: { id: { in: candidateIds } },
    select: { id: true, path: true },
  })
  if (candidates.length === 0) return empty

  const [byRecord, byChat] = await Promise.all([
    prisma.recordAttachment.findMany({
      where: { id: { in: candidateIds }, records: { some: {} } },
      select: { id: true },
    }),
    prisma.recordAttachment.findMany({
      where: { id: { in: candidateIds }, chatMessages: { some: {} } },
      select: { id: true },
    }),
  ])

  const deletable: AttachmentRef[] = pickDeletableAttachments(
    candidates,
    byRecord.map((r) => r.id),
    byChat.map((r) => r.id),
  )
  if (deletable.length === 0) return empty

  let deletedFiles = 0
  for (const att of deletable) {
    const filePath = path.join(uploadsDir, path.basename(att.path))
    if (!fs.existsSync(filePath)) continue
    try {
      fs.unlinkSync(filePath)
      deletedFiles++
    } catch {
      // 单个文件删除失败不中断整体清理
    }
  }

  // 再带一次条件删除：并发下附件若被重新挂回流水/聊天，这里不会误删
  const result = await prisma.recordAttachment.deleteMany({
    where: {
      id: { in: deletable.map((a) => a.id) },
      records: { none: {} },
      chatMessages: { none: {} },
    },
  })
  return { deletedRecords: result.count, deletedFiles }
}

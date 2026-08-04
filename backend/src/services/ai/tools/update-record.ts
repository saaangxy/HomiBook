import { prisma } from '../../../app.js'
import { assertIsMember, retryable, desensitize, type ToolResult } from '../security.js'
import type { ToolDef, ToolContext } from './types.js'
import { resolveAccountId } from './helpers.js'
import fs from 'fs'
import path from 'path'

export const updateRecordTool: ToolDef = {
  name: 'update_record',
  displayName: '修改流水',
  promptHint: '需要用户确认',
  description: '修改一条已有的流水记录。敏感操作，需要用户确认。',
  parameters: {
    type: 'object',
    properties: {
      recordId: { type: 'string', description: '要修改的记录 ID' },
      type: { type: 'string', enum: ['INCOME', 'EXPENSE', 'TRANSFER'], description: '流水类型' },
      amount: { type: 'number', description: '金额' },
      date: { type: 'string', description: '日期 YYYY-MM-DD' },
      accountId: { type: 'string', description: '账户 ID' },
      categoryCode: { type: 'string', description: '分类编码' },
      remark: { type: 'string', description: '备注' },
      payer: { type: 'string', description: '交易对方' },
      fromAccountId: { type: 'string', description: '转账源账户 ID' },
      toAccountId: { type: 'string', description: '转账目标账户 ID' },
      attachmentIds: { type: 'array', items: { type: 'string' }, description: '替换全部附件：传入新的附件 ID 列表，将删除旧附件并关联新附件' },
      addAttachmentIds: { type: 'array', items: { type: 'string' }, description: '追加附件：保留现有附件，额外关联这些附件 ID' },
      removeAttachmentIds: { type: 'array', items: { type: 'string' }, description: '删除指定附件：从附件列表中移除这些 ID' },
    },
    required: ['recordId'],
  },
  requireConfirm: true,

  async execute(args: any, ctx: ToolContext): Promise<ToolResult> {
    const existing = await prisma.record.findUnique({ where: { id: args.recordId } })
    if (!existing) return { success: false, error: '记录不存在', retryable: false }

    await assertIsMember(existing.accountBookId, ctx.userId)
    if (existing.accountBookId !== ctx.accountBookId) {
      return { success: false, error: '无权操作该记录', retryable: false }
    }

    // 解析账户标识符（支持 accountNo 或 UUID）
    let resolvedAccountId: string | null | undefined
    if (args.accountId) {
      resolvedAccountId = await resolveAccountId(args.accountId, ctx.accountBookId)
      if (!resolvedAccountId) {
        return { success: false, error: `账户不存在: ${args.accountId}`, retryable: false }
      }
    }
    let resolvedFromId: string | null | undefined
    if (args.fromAccountId) {
      resolvedFromId = await resolveAccountId(args.fromAccountId, ctx.accountBookId)
      if (!resolvedFromId) {
        return { success: false, error: `转出账户不存在: ${args.fromAccountId}`, retryable: false }
      }
    }
    let resolvedToId: string | null | undefined
    if (args.toAccountId) {
      resolvedToId = await resolveAccountId(args.toAccountId, ctx.accountBookId)
      if (!resolvedToId) {
        return { success: false, error: `转入账户不存在: ${args.toAccountId}`, retryable: false }
      }
    }

    // 附件操作
    const attOps: Array<() => Promise<void>> = []
    const uploadsDir = path.join(process.cwd(), 'uploads')

    if (args.attachmentIds !== undefined) {
      attOps.push(async () => {
        const oldAtts = await prisma.recordAttachment.findMany({ where: { recordId: args.recordId } })
        for (const att of oldAtts) {
          const filePath = path.join(uploadsDir, path.basename(att.path))
          if (fs.existsSync(filePath)) fs.unlinkSync(filePath)
        }
        if (oldAtts.length > 0) {
          await prisma.recordAttachment.deleteMany({ where: { recordId: args.recordId } })
        }
        if (args.attachmentIds.length > 0) {
          await prisma.recordAttachment.updateMany({
            where: { id: { in: args.attachmentIds as string[] } },
            data: { recordId: args.recordId },
          })
        }
      })
    } else {
      if (args.removeAttachmentIds?.length > 0) {
        attOps.push(async () => {
          const toRemove = await prisma.recordAttachment.findMany({
            where: { id: { in: args.removeAttachmentIds as string[] }, recordId: args.recordId },
          })
          for (const att of toRemove) {
            const filePath = path.join(uploadsDir, path.basename(att.path))
            if (fs.existsSync(filePath)) fs.unlinkSync(filePath)
          }
          await prisma.recordAttachment.deleteMany({
            where: { id: { in: args.removeAttachmentIds as string[] }, recordId: args.recordId },
          })
        })
      }
      if (args.addAttachmentIds?.length > 0) {
        attOps.push(async () => {
          await prisma.recordAttachment.updateMany({
            where: { id: { in: args.addAttachmentIds as string[] } },
            data: { recordId: args.recordId },
          })
        })
      }
    }

    return retryable(async () => {
      for (const op of attOps) await op()

      const data: Record<string, unknown> = {}
      if (args.type) data.type = args.type
      if (args.amount != null) data.amount = Number(args.amount)
      if (args.date) data.date = new Date(args.date)
      if (resolvedAccountId) data.accountId = resolvedAccountId
      if (args.categoryCode !== undefined) data.categoryCode = args.categoryCode
      if (args.remark !== undefined) data.remark = args.remark
      if (args.payer !== undefined) data.payer = args.payer
      if (resolvedFromId !== undefined) data.fromAccountId = resolvedFromId
      if (resolvedToId !== undefined) data.toAccountId = resolvedToId

      const record = await prisma.record.update({
        where: { id: args.recordId },
        data,
        include: { account: { select: { name: true } } },
      })

      return desensitize({
        id: record.id,
        type: record.type,
        amount: record.amount,
        date: record.date.toISOString().slice(0, 10),
        accountName: record.account.name,
        categoryCode: record.categoryCode,
        remark: record.remark,
        updated: true,
      })
    }, 'update_record')
  },
}

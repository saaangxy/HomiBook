import { prisma } from '../../../app.js'
import { assertIsMember, retryable, desensitize, type ToolResult } from '../security.js'
import type { ToolDef, ToolContext } from './types.js'
import { refreshAccountBalance } from '../../account.js'
import path from 'path'
import fs from 'fs'

export const batchDeleteRecordsTool: ToolDef = {
  name: 'batch_delete_records',
  description: '批量删除流水记录及关联附件。',
  parameters: {
    type: 'object',
    properties: {
      ids: { type: 'array', items: { type: 'string' }, description: '要删除的记录 ID 列表' },
    },
    required: ['ids'],
  },
  requireConfirm: true,

  async execute(args: { ids: string[] }, ctx: ToolContext): Promise<ToolResult> {
    await assertIsMember(ctx.accountBookId, ctx.userId)

    if (!args.ids?.length) {
      return { success: false, error: '请提供要删除的记录 ID 列表', retryable: false }
    }

    return retryable(async () => {
      const records = await prisma.record.findMany({
        where: { id: { in: args.ids } },
        include: { recordAttachments: true },
      })

      if (records.length === 0) return { success: false, error: '没有找到匹配的记录', retryable: false }

      // 检查所有记录都属于当前账本
      const allSame = records.every((r) => r.accountBookId === ctx.accountBookId)
      if (!allSame) return { success: false, error: '部分记录不属于当前账本', retryable: false }

      // 删除附件文件
      const uploadsDir = path.join(process.cwd(), 'uploads')
      for (const r of records) {
        for (const att of r.recordAttachments) {
          const filePath = path.join(uploadsDir, path.basename(att.path))
          if (fs.existsSync(filePath)) {
            try { fs.unlinkSync(filePath) } catch { /* skip */ }
          }
        }
      }

      await prisma.record.deleteMany({ where: { id: { in: args.ids } } })

      // 刷新受影响账户的余额
      const affectedAccounts = new Set<string>()
      for (const r of records) {
        affectedAccounts.add(r.accountId)
        if (r.fromAccountId) affectedAccounts.add(r.fromAccountId)
        if (r.toAccountId) affectedAccounts.add(r.toAccountId)
      }
      for (const accId of affectedAccounts) {
        await refreshAccountBalance(accId)
      }

      return desensitize({ deleted: records.length })
    }, 'batch_delete_records')
  },
}

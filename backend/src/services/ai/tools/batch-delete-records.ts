import { prisma } from '../../../app.js'
import { desensitize, ToolError } from '../security.js'
import { genericPreview, recordToRow, type ConfirmPreview } from '../runtime/preview-format.js'
import type { PreviewScope } from '../runtime/preview-scope.js'
import type { ToolDef, ToolContext } from './types.js'
import { refreshAccountBalance } from '../../account.js'
import { attachmentIdsOfRecords, cleanupOrphanAttachments } from '../../attachment.js'

export const batchDeleteRecordsTool: ToolDef = {
  name: 'batch_delete_records',
  displayName: '批量删除流水',
  promptHint: '需要用户确认',
  description: '批量删除流水记录及关联附件。',
  parameters: {
    type: 'object',
    properties: {
      ids: { type: 'array', items: { type: 'string' }, description: '要删除的记录 ID 列表' },
    },
    required: ['ids'],
  },
  requireConfirm: true,

  /** 确认卡：只列当前账本内能删到的记录，其余按「未找到」计入说明 */
  async confirmation(args: { ids?: string[] }, _ctx: ToolContext, scope: PreviewScope): Promise<string> {
    const ids = Array.isArray(args?.ids) ? args.ids.filter(Boolean) : []
    if (ids.length === 0) return genericPreview('批量删除流水', { error: '未提供记录 ID' })

    const records = await scope.records(ids)
    if (records.length === 0) return genericPreview('批量删除流水', { error: '未找到匹配的记录' })

    const notFound = ids.filter((id) => !records.some((r) => r.id === id))
    const preview: ConfirmPreview = {
      type: 'records-table',
      title: `确认批量删除 ${records.length} 条流水记录`,
      description: `此操作不可撤销，账户余额将相应调整${notFound.length > 0 ? `\n有 ${notFound.length} 条记录未找到（可能已被删除，或不属于当前账本），本次不会处理它们` : ''}`,
      columns: ['日期', '类型', '账户', '分类', '金额', '备注'],
      rows: records.map((r) => recordToRow(r)).flat(),
    }
    return JSON.stringify(preview)
  },

  async execute(args: { ids: string[] }, ctx: ToolContext) {

    if (!args.ids?.length) {
      throw new ToolError('请提供要删除的记录 ID 列表', false)
    }

    const records = await prisma.record.findMany({
      where: { id: { in: args.ids } },
    })

    if (records.length === 0) throw new ToolError('没有找到匹配的记录', false)

    // 检查所有记录都属于当前账本
    const allSame = records.every((r) => r.accountBookId === ctx.accountBookId)
    if (!allSame) throw new ToolError('部分记录不属于当前账本', false)

    // 多对多:先记下这些流水挂的附件,删完后只清理不再被任何流水/聊天引用的
    const attachedIds = await attachmentIdsOfRecords(args.ids)

    await prisma.record.deleteMany({ where: { id: { in: args.ids } } })

    await cleanupOrphanAttachments(attachedIds)

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
  },
}

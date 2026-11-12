import { prisma } from '../../../app.js'
import { refreshAccountBalance } from '../../account.js'
import { ToolError } from '../security.js'
import { genericPreview, recordToRow, type ConfirmPreview } from '../runtime/preview-format.js'
import type { PreviewScope } from '../runtime/preview-scope.js'
import type { ToolDef, ToolContext } from './types.js'

export const deleteRecordTool: ToolDef = {
  name: 'delete_record',
  displayName: '删除流水',
  promptHint: '需要用户确认',
  description: '删除一条流水记录。敏感操作，需要用户确认。',
  parameters: {
    type: 'object',
    properties: {
      recordId: { type: 'string', description: '要删除的记录 ID' },
    },
    required: ['recordId'],
  },
  requireConfirm: true,

  /** 确认卡：只读当前账本内的记录，查不到就解释原因 */
  async confirmation(args: { recordId?: string; id?: string }, _ctx: ToolContext, scope: PreviewScope): Promise<string> {
    const recordId = args.recordId || args.id || ''
    const record = await scope.record(recordId)
    if (!record) return genericPreview('删除流水', { error: `记录不存在: ${recordId}` })

    const preview: ConfirmPreview = {
      type: 'records-table',
      title: '确认删除以下流水记录',
      description: '此操作不可撤销，账户余额将相应调整',
      columns: ['日期', '类型', '账户', '分类', '金额', '备注'],
      rows: recordToRow(record),
    }
    return JSON.stringify(preview)
  },

  async execute(args: any, ctx: ToolContext) {
    const existing = await prisma.record.findUnique({ where: { id: args.recordId } })
    if (!existing) throw new ToolError('记录不存在')

    if (existing.accountBookId !== ctx.accountBookId) {
      throw new ToolError('禁止跨账本操作记录，先切换账本')
    }

    await prisma.record.delete({ where: { id: args.recordId } })

    // 删除后就查不到这条记录属于谁了，余额缓存只能在删之前拿到
    const touched = new Set(
      [existing.accountId, existing.fromAccountId, existing.toAccountId].filter(Boolean) as string[],
    )
    for (const accId of touched) await refreshAccountBalance(accId)

    return { deleted: true, id: args.recordId }
  },
}

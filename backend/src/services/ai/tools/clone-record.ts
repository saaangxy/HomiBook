import { prisma } from '../../../app.js'
import { desensitize, ToolError } from '../security.js'
import { genericPreview, recordToRow, type ConfirmPreview } from '../runtime/preview-format.js'
import type { PreviewScope } from '../runtime/preview-scope.js'
import type { ToolDef, ToolContext } from './types.js'
import { refreshAccountBalance } from '../../account.js'
import { normalizeRecordType } from '@homibook/core'
import { dateKey } from '../../../lib/date-time.js'

export const cloneRecordTool: ToolDef = {
  name: 'clone_record',
  displayName: '复制流水',
  promptHint: '复制已有流水创建新记录',
  description: '克隆一条流水记录，复制其所有字段但归属人设为当前用户。',
  parameters: {
    type: 'object',
    properties: {
      id: { type: 'string', description: '要克隆的记录 ID' },
    },
    required: ['id'],
  },
  requireConfirm: true,

  /** 确认卡：只读当前账本内的记录 */
  async confirmation(args: { id?: string }, _ctx: ToolContext, scope: PreviewScope): Promise<string> {
    const recordId = args?.id || ''
    const record = await scope.record(recordId)
    if (!record) return genericPreview('复制流水', { error: `记录不存在: ${recordId}` })

    const preview: ConfirmPreview = {
      type: 'records-table',
      title: '确认克隆以下流水记录',
      description: '将复制记录的所有字段，归属人设为当前用户',
      columns: ['日期', '类型', '账户', '分类', '金额', '备注'],
      rows: recordToRow(record),
    }
    return JSON.stringify(preview)
  },

  async execute(args: { id: string }, ctx: ToolContext) {

    const existing = await prisma.record.findUnique({ where: { id: args.id } })
    if (!existing) throw new ToolError('记录不存在', false)
    if (existing.accountBookId !== ctx.accountBookId) {
      throw new ToolError('无权访问该记录', false)
    }

    const cloned = await prisma.record.create({
      data: {
        accountBookId: existing.accountBookId,
        // 归一化:复制来源若为历史脏数据,新记录也不应继承非法类型
        type: normalizeRecordType(existing.type),
        amount: existing.amount,
        date: existing.date,
        remark: existing.remark,
        tags: existing.tags,
        accountId: existing.accountId,
        fromAccountId: existing.fromAccountId,
        toAccountId: existing.toAccountId,
        categoryCode: existing.categoryCode,
        payer: existing.payer,
        ownerId: ctx.userId,
      },
      include: { account: { select: { name: true } } },
    })

    const affectedAccounts = [existing.accountId, existing.fromAccountId, existing.toAccountId].filter(Boolean) as string[]
    for (const accId of [...new Set(affectedAccounts)]) {
      await refreshAccountBalance(accId)
    }

    return desensitize({
      id: cloned.id,
      type: cloned.type,
      amount: cloned.amount,
      date: dateKey(cloned.date),
      accountName: cloned.account.name,
      categoryCode: cloned.categoryCode,
      remark: cloned.remark,
      cloned: true,
    })
  },
}

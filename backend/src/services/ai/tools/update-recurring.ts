import { prisma } from '../../../app.js'
import { Prisma } from '@prisma/client'
import { assertIsMember, retryable, desensitize, type ToolResult } from '../security.js'
import { ensureFixedTag, getNextTriggerTime } from '../../recurring.js'
import type { ToolDef, ToolContext } from './types.js'

export const updateRecurringTool: ToolDef = {
  name: 'update_recurring',
  description: '更新固定收支/贷款配置。参数同创建，所有字段均可选。',
  parameters: {
    type: 'object',
    properties: {
      id: { type: 'string', description: '固定收支 ID' },
      name: { type: 'string', description: '名称' },
      amount: { type: 'number', description: '金额' },
      cron: { type: 'string', description: 'Cron 表达式' },
      accountId: { type: 'string', description: '账户 ID' },
      toAccountId: { type: 'string', description: '转账目标账户 ID' },
      categoryCode: { type: 'string', description: '分类编码' },
      payer: { type: 'string', description: '交易对方' },
      remark: { type: 'string', description: '备注' },
      tags: { type: 'array', items: { type: 'string' }, description: '标签' },
    },
    required: ['id'],
  },
  requireConfirm: true,

  async execute(args: any, ctx: ToolContext): Promise<ToolResult> {
    await assertIsMember(ctx.accountBookId, ctx.userId)

    return retryable(async () => {
      const existing = await prisma.recurringTransaction.findUnique({ where: { id: args.id } })
      if (!existing) return { success: false, error: '固定收支记录不存在', retryable: false }
      if (existing.accountBookId !== ctx.accountBookId) {
        return { success: false, error: '无权访问该记录', retryable: false }
      }

      const data: Prisma.RecurringTransactionUncheckedUpdateInput = {}
      if (args.name !== undefined) data.name = args.name
      if (args.amount !== undefined) data.amount = args.amount
      if (args.cron !== undefined) {
        data.cron = args.cron
        data.nextGenerateAt = getNextTriggerTime(args.cron)
      }
      if (args.accountId !== undefined) data.accountId = args.accountId
      if (args.toAccountId !== undefined) data.toAccountId = args.toAccountId
      if (args.categoryCode !== undefined) data.categoryCode = args.categoryCode
      if (args.payer !== undefined) data.payer = args.payer
      if (args.remark !== undefined) data.remark = args.remark
      if (args.tags !== undefined) data.tags = JSON.stringify(ensureFixedTag(args.tags))

      if (Object.keys(data).length === 0) {
        return { success: false, error: '没有提供需要更新的字段', retryable: false }
      }

      await prisma.recurringTransaction.update({ where: { id: args.id }, data })

      return desensitize({ updated: true })
    }, 'update_recurring')
  },
}

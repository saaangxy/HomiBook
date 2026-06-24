import { prisma } from '../../../app.js'
import { assertIsMember, retryable, desensitize, type ToolResult } from '../security.js'
import type { ToolDef, ToolContext } from './types.js'

export const updateRecordTool: ToolDef = {
  name: 'update_record',
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
    },
    required: ['recordId'],
  },
  requireConfirm: true,

  async execute(args: any, ctx: ToolContext): Promise<ToolResult> {
    const existing = await prisma.record.findUnique({ where: { id: args.recordId } })
    if (!existing) return { success: false, error: '记录不存在', retryable: false }

    await assertIsMember(existing.accountBookId, ctx.userId)

    return retryable(async () => {
      const data: Record<string, unknown> = {}
      if (args.type) data.type = args.type
      if (args.amount != null) data.amount = Number(args.amount)
      if (args.date) data.date = new Date(args.date)
      if (args.accountId) data.accountId = args.accountId
      if (args.categoryCode !== undefined) data.categoryCode = args.categoryCode
      if (args.remark !== undefined) data.remark = args.remark
      if (args.payer !== undefined) data.payer = args.payer
      if (args.fromAccountId !== undefined) data.fromAccountId = args.fromAccountId
      if (args.toAccountId !== undefined) data.toAccountId = args.toAccountId

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

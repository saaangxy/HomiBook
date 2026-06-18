import { prisma } from '../../../app.js'
import { assertIsMember, retryable, desensitize, type ToolResult } from '../security.js'
import type { ToolDef, ToolContext } from './types.js'

export const createRecordTool: ToolDef = {
  name: 'create_record',
  description: '创建一条新的收支流水记录。敏感操作，需要用户确认。参数：type(INCOME|EXPENSE|TRANSFER)、amount(金额)、date(日期YYYY-MM-DD)、accountId(账户ID)、categoryCode(分类编码)、remark(备注)、payer(交易方)、fromAccountId/toAccountId(转账专用)',
  parameters: {
    type: 'object',
    properties: {
      type: { type: 'string', enum: ['INCOME', 'EXPENSE', 'TRANSFER'], description: '流水类型' },
      amount: { type: 'number', description: '金额，必须大于0' },
      date: { type: 'string', description: '日期，格式 YYYY-MM-DD' },
      accountId: { type: 'string', description: '主账户 ID' },
      categoryCode: { type: 'string', description: '分类编码，如 餐饮、工资' },
      remark: { type: 'string', description: '备注' },
      payer: { type: 'string', description: '交易对方' },
      fromAccountId: { type: 'string', description: '转账源账户 ID（TRANSFER 类型必填）' },
      toAccountId: { type: 'string', description: '转账目标账户 ID（TRANSFER 类型必填）' },
      tags: { type: 'array', items: { type: 'string' }, description: '标签列表' },
    },
    required: ['type', 'amount', 'date', 'accountId'],
  },
  requireConfirm: true,

  async execute(args: any, ctx: ToolContext): Promise<ToolResult> {
    await assertIsMember(ctx.accountBookId, ctx.userId)

    if (!['INCOME', 'EXPENSE', 'TRANSFER'].includes(args.type)) {
      return { success: false, error: '无效的流水类型，应为 INCOME、EXPENSE 或 TRANSFER', retryable: false }
    }
    if (typeof args.amount !== 'number' || args.amount <= 0) {
      return { success: false, error: '金额必须大于0', retryable: false }
    }

    // 转账校验
    if (args.type === 'TRANSFER') {
      if (!args.fromAccountId || !args.toAccountId) {
        return { success: false, error: '转账需要填写源账户和目标账户', retryable: false }
      }
    }

    return retryable(async () => {
      const record = await prisma.record.create({
        data: {
          accountBookId: ctx.accountBookId,
          type: args.type,
          amount: args.amount,
          date: new Date(args.date),
          remark: args.remark,
          tags: JSON.stringify(args.tags ?? []),
          accountId: args.accountId,
          fromAccountId: args.fromAccountId,
          toAccountId: args.toAccountId,
          categoryCode: args.categoryCode,
          payer: args.payer,
          ownerId: ctx.userId,
        },
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
        created: true,
      })
    }, 'create_record')
  },
}

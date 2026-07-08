import { prisma } from '../../../app.js'
import { assertIsMember, retryable, desensitize, type ToolResult } from '../security.js'
import type { ToolDef, ToolContext } from './types.js'
import { resolveAccountId } from './helpers.js'

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
      attachmentIds: { type: 'array', items: { type: 'string' }, description: '关联的附件 ID 列表（小票图片等）' },
    },
    required: ['type', 'amount', 'date', 'accountId'],
  },
  requireConfirm: true,

  async execute(args: any, ctx: ToolContext): Promise<ToolResult> {
    await assertIsMember(ctx.accountBookId, ctx.userId)

    if (!['INCOME', 'EXPENSE', 'TRANSFER'].includes(args.type)) {
      return { success: false, error: '无效的流水类型，应为 INCOME、EXPENSE 或 TRANSFER', retryable: false }
    }
    const amount = Number(args.amount)
    if (isNaN(amount) || amount <= 0) {
      return { success: false, error: '金额必须大于0', retryable: false }
    }

    // 转账校验
    if (args.type === 'TRANSFER') {
      if (!args.fromAccountId || !args.toAccountId) {
        return { success: false, error: '转账需要填写源账户和目标账户', retryable: false }
      }
    }

    // 解析账户标识符（支持 accountNo 或 UUID）
    const resolvedAccountId = await resolveAccountId(args.accountId, ctx.accountBookId)
    if (!resolvedAccountId) {
      return { success: false, error: `账户不存在: ${args.accountId}`, retryable: false }
    }
    const resolvedFromId = args.fromAccountId
      ? await resolveAccountId(args.fromAccountId, ctx.accountBookId)
      : null
    if (args.fromAccountId && !resolvedFromId) {
      return { success: false, error: `转出账户不存在: ${args.fromAccountId}`, retryable: false }
    }
    const resolvedToId = args.toAccountId
      ? await resolveAccountId(args.toAccountId, ctx.accountBookId)
      : null
    if (args.toAccountId && !resolvedToId) {
      return { success: false, error: `转入账户不存在: ${args.toAccountId}`, retryable: false }
    }

    return retryable(async () => {
      const record = await prisma.record.create({
        data: {
          accountBookId: ctx.accountBookId,
          type: args.type,
          amount,
          date: new Date(args.date),
          remark: args.remark,
          tags: JSON.stringify(args.tags ?? []),
          accountId: resolvedAccountId,
          fromAccountId: resolvedFromId,
          toAccountId: resolvedToId,
          categoryCode: args.categoryCode,
          payer: args.payer,
          ownerId: ctx.userId,
        },
        include: { account: { select: { name: true } } },
      })

      // 关联附件
      if (args.attachmentIds && args.attachmentIds.length > 0) {
        await prisma.recordAttachment.updateMany({
          where: { id: { in: args.attachmentIds } },
          data: { recordId: record.id },
        })
      }

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

import { prisma } from '../../../app.js'
import { assertIsMember, retryable, desensitize, type ToolResult } from '../security.js'
import type { ToolDef, ToolContext } from './types.js'
import { resolveAccountId } from './helpers.js'

interface RecordInput {
  type: string
  amount: number
  date: string
  accountId: string
  categoryCode?: string
  remark?: string
  payer?: string
  fromAccountId?: string
  toAccountId?: string
  tags?: string[]
}

interface BatchCreateArgs {
  records: RecordInput[]
  attachmentIds?: string[]
}

export const batchCreateRecordsTool: ToolDef = {
  name: 'batch_create_records',
  description: '批量创建多条收支流水记录。敏感操作，需要用户确认。records 数组每项包含：type(INCOME|EXPENSE|TRANSFER)、amount(金额>0)、date(YYYY-MM-DD)、accountId、categoryCode(可选)、remark(可选)、payer(可选)、tags(可选)',
  parameters: {
    type: 'object',
    properties: {
      records: {
        type: 'array',
        description: '要创建的记录列表',
        items: {
          type: 'object',
          properties: {
            type: { type: 'string', enum: ['INCOME', 'EXPENSE', 'TRANSFER'], description: '流水类型' },
            amount: { type: 'number', description: '金额' },
            date: { type: 'string', description: '日期 YYYY-MM-DD' },
            accountId: { type: 'string', description: '账户 ID' },
            categoryCode: { type: 'string', description: '分类编码' },
            remark: { type: 'string', description: '备注' },
            payer: { type: 'string', description: '交易对方' },
            fromAccountId: { type: 'string', description: '转账源账户 ID' },
            toAccountId: { type: 'string', description: '转账目标账户 ID' },
            tags: { type: 'array', items: { type: 'string' }, description: '标签' },
          },
          required: ['type', 'amount', 'date', 'accountId'],
        },
      },
      attachmentIds: { type: 'array', items: { type: 'string' }, description: '关联的附件 ID 列表（小票图片等）' },
    },
    required: ['records'],
  },
  requireConfirm: true,

  async execute(args: BatchCreateArgs, ctx: ToolContext): Promise<ToolResult> {
    await assertIsMember(ctx.accountBookId, ctx.userId)

    if (!args.records || !Array.isArray(args.records) || args.records.length === 0) {
      return { success: false, error: 'records 必须是非空数组', retryable: false }
    }

    // 逐条校验
    const errors: string[] = []
    for (let i = 0; i < args.records.length; i++) {
      const r = args.records[i]
      if (!['INCOME', 'EXPENSE', 'TRANSFER'].includes(r.type)) {
        errors.push(`第${i + 1}条: 无效的流水类型`)
      }
      const amount = Number(r.amount)
      if (isNaN(amount) || amount <= 0) {
        errors.push(`第${i + 1}条: 金额必须大于0`)
      }
      if (r.type === 'TRANSFER' && (!r.fromAccountId || !r.toAccountId)) {
        errors.push(`第${i + 1}条: 转账需要源账户和目标账户`)
      }
    }
    if (errors.length > 0) {
      return { success: false, error: errors.join('; '), retryable: false }
    }

    // 解析所有账户标识符（支持 accountNo 或 UUID）
    const resolved: { accountId: string; fromAccountId?: string; toAccountId?: string }[] = []
    for (let i = 0; i < args.records.length; i++) {
      const r = args.records[i]
      const resolvedAccountId = await resolveAccountId(r.accountId, ctx.accountBookId)
      if (!resolvedAccountId) {
        errors.push(`第${i + 1}条: 账户不存在 ${r.accountId}`)
        continue
      }
      let resolvedFromId: string | undefined
      if (r.fromAccountId) {
        resolvedFromId = (await resolveAccountId(r.fromAccountId, ctx.accountBookId)) || undefined
        if (!resolvedFromId) {
          errors.push(`第${i + 1}条: 转出账户不存在 ${r.fromAccountId}`)
          continue
        }
      }
      let resolvedToId: string | undefined
      if (r.toAccountId) {
        resolvedToId = (await resolveAccountId(r.toAccountId, ctx.accountBookId)) || undefined
        if (!resolvedToId) {
          errors.push(`第${i + 1}条: 转入账户不存在 ${r.toAccountId}`)
          continue
        }
      }
      resolved.push({ accountId: resolvedAccountId, fromAccountId: resolvedFromId, toAccountId: resolvedToId })
    }
    if (errors.length > 0) {
      return { success: false, error: errors.join('; '), retryable: false }
    }

    return retryable(async () => {
      const created = await prisma.$transaction(
        args.records.map((r, i) =>
          prisma.record.create({
            data: {
              accountBookId: ctx.accountBookId,
              type: r.type,
              amount: Number(r.amount),
              date: new Date(r.date),
              remark: r.remark,
              tags: JSON.stringify(r.tags ?? []),
              accountId: resolved[i].accountId,
              fromAccountId: resolved[i].fromAccountId,
              toAccountId: resolved[i].toAccountId,
              categoryCode: r.categoryCode,
              payer: r.payer,
              ownerId: ctx.userId,
            },
            include: { account: { select: { name: true } } },
          }),
        ),
      )

      // 关联附件到第一条记录
      if (args.attachmentIds && args.attachmentIds.length > 0 && created.length > 0) {
        await prisma.recordAttachment.updateMany({
          where: { id: { in: args.attachmentIds } },
          data: { recordId: created[0].id },
        })
      }

      return desensitize({
        created: created.length,
        records: created.map((r) => ({
          id: r.id,
          type: r.type,
          amount: r.amount,
          date: r.date.toISOString().slice(0, 10),
          accountName: r.account.name,
          categoryCode: r.categoryCode,
          remark: r.remark,
        })),
      })
    }, 'batch_create_records')
  },
}

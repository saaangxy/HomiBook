import { prisma } from '../../../app.js'
import { assertIsMember, retryable, desensitize, type ToolResult } from '../security.js'
import type { ToolDef, ToolContext } from './types.js'
import { resolveAccountId } from './helpers.js'

interface UpdateInput {
  recordId: string
  type?: string
  amount?: number
  date?: string
  accountId?: string
  categoryCode?: string
  remark?: string
  payer?: string
  fromAccountId?: string
  toAccountId?: string
}

export const batchUpdateRecordsTool: ToolDef = {
  name: 'batch_update_records',
  displayName: '批量修改流水',
  promptHint: '多条记录一次确认',
  description: '批量修改多条流水记录。敏感操作，需要用户确认。updates 数组每项包含：recordId(必填)、以及要修改的字段：type、amount、date、accountId、categoryCode、remark、payer',
  parameters: {
    type: 'object',
    properties: {
      updates: {
        type: 'array',
        description: '要修改的记录列表',
        items: {
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
      },
    },
    required: ['updates'],
  },
  requireConfirm: true,

  async execute(args: { updates: UpdateInput[] }, ctx: ToolContext): Promise<ToolResult> {
    await assertIsMember(ctx.accountBookId, ctx.userId)

    if (!args.updates || !Array.isArray(args.updates) || args.updates.length === 0) {
      return { success: false, error: 'updates 必须是非空数组', retryable: false }
    }

    // 先校验所有记录存在且属于当前账本
    const ids = args.updates.map((u) => u.recordId)
    const existing = await prisma.record.findMany({
      where: { id: { in: ids }, accountBookId: ctx.accountBookId },
      select: { id: true },
    })
    const existingIds = new Set(existing.map((r) => r.id))
    const missing = ids.filter((id) => !existingIds.has(id))
    if (missing.length > 0) {
      return { success: false, error: `记录不存在: ${missing.join(', ')}`, retryable: false }
    }

    // 解析所有账户标识符（支持 accountNo 或 UUID）
    const resolvedIds: Record<string, string> = {}
    for (const u of args.updates) {
      for (const key of ['accountId', 'fromAccountId', 'toAccountId'] as const) {
        const val = u[key]
        if (!val) continue
        if (resolvedIds[val] !== undefined) continue // 已解析过，跳过
        const resolved = await resolveAccountId(val, ctx.accountBookId)
        if (!resolved) {
          return { success: false, error: `账户不存在: ${val}`, retryable: false }
        }
        resolvedIds[val] = resolved
      }
    }

    return retryable(async () => {
      const updated = await prisma.$transaction(
        args.updates.map((u) => {
          const data: Record<string, unknown> = {}
          if (u.type) data.type = u.type
          if (u.amount != null) data.amount = Number(u.amount)
          if (u.date) data.date = new Date(u.date)
          if (u.accountId) data.accountId = resolvedIds[u.accountId]
          if (u.categoryCode !== undefined) data.categoryCode = u.categoryCode
          if (u.remark !== undefined) data.remark = u.remark
          if (u.payer !== undefined) data.payer = u.payer
          if (u.fromAccountId !== undefined) data.fromAccountId = resolvedIds[u.fromAccountId]
          if (u.toAccountId !== undefined) data.toAccountId = resolvedIds[u.toAccountId]
          return prisma.record.update({
            where: { id: u.recordId },
            data,
            include: { account: { select: { name: true } } },
          })
        }),
      )

      return desensitize({
        updated: updated.length,
        records: updated.map((r) => ({
          id: r.id,
          type: r.type,
          amount: r.amount,
          date: r.date.toISOString().slice(0, 10),
          accountName: r.account.name,
          categoryCode: r.categoryCode,
          remark: r.remark,
        })),
      })
    }, 'batch_update_records')
  },
}

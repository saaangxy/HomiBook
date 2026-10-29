import { prisma } from '../../../app.js'
import { assertIsMember, retryable, desensitize, type ToolResult } from '../security.js'
import { refreshAccountBalance } from '../../account.js'
import { dateKey } from '../../../lib/date-time.js'
import type { ToolDef, ToolContext } from './types.js'

interface OffsetRecordsArgs {
  /** 要平账 / 取消平账的流水 ID */
  recordIds: string[]
  /** true = 平账（默认），false = 取消平账 */
  offset?: boolean
}

/**
 * 平账:把「购物支出 + 退款收入」这类金额相等、方向相反的流水标记为互相抵消。
 *
 * 约束:平账必须严格收支相等 —— 否则会改变净额,失去「只消除虚高」的语义,
 * 所以这里直接拒绝不等额请求,把差额回报给模型。
 */
export const offsetRecordsTool: ToolDef = {
  name: 'offset_records',
  displayName: '平账',
  promptHint: '把支出与收入标记为互相抵消',
  description: '平账或取消平账。把「购物支出 + 退款收入」这类金额相等、方向相反的流水标记为已平账；标记后不计入收支统计与账户余额。平账时要求所选记录的收入合计 = 支出合计，否则会被拒绝。',
  parameters: {
    type: 'object',
    properties: {
      recordIds: {
        type: 'array',
        items: { type: 'string' },
        description: '要处理的流水 ID（平账时通常是 2 条：一笔支出 + 一笔等额退款收入）',
      },
      offset: {
        type: 'boolean',
        description: 'true = 平账（默认），false = 取消平账',
      },
    },
    required: ['recordIds'],
  },

  async execute(args: OffsetRecordsArgs, ctx: ToolContext): Promise<ToolResult> {
    const ids = (args.recordIds ?? []).filter(Boolean)
    if (ids.length === 0) return { success: false, error: 'recordIds 不能为空', retryable: false }
    const offset = args.offset !== false

    await assertIsMember(ctx.accountBookId, ctx.userId)

    // 查询与校验放在 retryable 之外:包装器会把返回值塞进 data,
    // 内部返回的错误对象会变成「success: true + data.error」,模型读不到
    const records = await prisma.record.findMany({
      where: { id: { in: ids }, accountBookId: ctx.accountBookId },
      select: {
        id: true, type: true, amount: true, date: true, remark: true,
        accountId: true, fromAccountId: true, toAccountId: true, offsetAt: true,
      },
    })
    if (records.length === 0) {
      return { success: false, error: '没有找到这些流水（可能不属于当前账本）', retryable: false }
    }
    if (records.length !== ids.length) {
      return {
        success: false,
        error: `有 ${ids.length - records.length} 条流水不存在或不属于当前账本`,
        retryable: false,
      }
    }

    const income = records.filter((r) => r.type === 'INCOME').reduce((s, r) => s + r.amount, 0)
    const expense = records.filter((r) => r.type === 'EXPENSE').reduce((s, r) => s + r.amount, 0)

    if (offset && Math.abs(income - expense) > 0.005) {
      return {
        success: false,
        error: `平账要求收入合计 = 支出合计：当前收入 ${income.toFixed(2)}、支出 ${expense.toFixed(2)}，差额 ${(income - expense).toFixed(2)}。`
          + '请改为等额的组合，或改用一次单条处理。',
        retryable: false,
      }
    }

    const affected = new Set<string>()
    for (const r of records) {
      if (r.accountId) affected.add(r.accountId)
      if (r.fromAccountId) affected.add(r.fromAccountId)
      if (r.toAccountId) affected.add(r.toAccountId)
    }

    return retryable(async () => {
      await prisma.record.updateMany({
        where: { id: { in: ids }, accountBookId: ctx.accountBookId },
        data: { offsetAt: offset ? new Date() : null },
      })

      // 平账会改变统计口径 → 涉及账户的余额缓存重算
      for (const accId of affected) await refreshAccountBalance(accId)

      return desensitize({
        offset,
        updated: records.length,
        amount: Math.round(Math.max(income, expense) * 100) / 100,
        records: records.map((r) => ({
          id: r.id,
          type: r.type,
          amount: r.amount,
          date: dateKey(r.date),
          remark: r.remark,
        })),
      })
    }, 'offset_records')
  },
}

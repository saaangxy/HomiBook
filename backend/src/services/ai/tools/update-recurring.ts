import { prisma } from '../../../app.js'
import type { Prisma } from '../../../generated/sqlite/client.js'
import { desensitize, ToolError } from '../security.js'
import { ensureFixedTag, getNextTriggerTime } from '../../recurring.js'
import { TYPE_LABELS, genericPreview, type ConfirmPreview } from '../runtime/preview-format.js'
import type { PreviewScope } from '../runtime/preview-scope.js'
import type { ToolDef, ToolContext } from './types.js'

export const updateRecurringTool: ToolDef = {
  name: 'update_recurring',
  displayName: '修改固定收支',
  promptHint: '需要用户确认',
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

  /** 确认卡：逐项对比旧值与新值，只列真正变化的字段 */
  async confirmation(args: any, _ctx: ToolContext, scope: PreviewScope): Promise<string> {
    const rt = await scope.recurring(args?.id || '')
    if (!rt) return genericPreview('修改固定收支', { error: `固定收支记录不存在: ${args?.id}` })

    const newCodes: string[] = [args.categoryCode].filter(Boolean)
    const newAccountIds: string[] = [args.accountId, args.toAccountId].filter(Boolean)
    const [categoryMap, accountMap] = await Promise.all([
      scope.categoryLabels([...newCodes, rt.categoryCode || ''].filter(Boolean)),
      scope.accountNames([...newAccountIds, rt.accountId, rt.toAccountId || ''].filter(Boolean)),
    ])

    const fieldDefs: { key: string; label: string; format: (v: any) => string }[] = [
      { key: 'name', label: '名称', format: (v) => v || '-' },
      { key: 'amount', label: '金额', format: (v) => Number(v).toFixed(2) },
      { key: 'cron', label: '触发规则', format: (v) => v || '-' },
      { key: 'accountId', label: '账户', format: (v) => accountMap.get(v) || v },
      { key: 'toAccountId', label: '目标账户', format: (v) => accountMap.get(v) || v },
      { key: 'categoryCode', label: '分类', format: (v) => categoryMap.get(v) || v },
      { key: 'payer', label: '交易方', format: (v) => v || '-' },
      { key: 'remark', label: '备注', format: (v) => v || '-' },
    ]

    const fields: { label: string; before: string; after: string }[] = []
    for (const f of fieldDefs) {
      const newVal = args[f.key]
      if (newVal === undefined || newVal === null) continue
      const before = f.format((rt as unknown as Record<string, unknown>)[f.key])
      const after = f.format(newVal)
      if (before !== after) fields.push({ label: f.label, before, after })
    }

    if (fields.length === 0) {
      return JSON.stringify({
        type: 'generic',
        title: '修改固定收支',
        description: '未检测到任何字段变更',
      } satisfies ConfirmPreview)
    }

    const preview: ConfirmPreview = {
      type: 'record-changes',
      title: '确认修改固定收支',
      description: `${rt.name} · 当前 ${TYPE_LABELS[rt.type] || rt.type} ${rt.amount.toFixed(2)} · 账户 ${rt.accountName || '-'}`,
      changes: [{ id: rt.id, date: '', fields }],
    }
    return JSON.stringify(preview)
  },

  async execute(args: any, ctx: ToolContext) {

    const existing = await prisma.recurringTransaction.findUnique({ where: { id: args.id } })
    if (!existing) throw new ToolError('固定收支记录不存在', false)
    if (existing.accountBookId !== ctx.accountBookId) {
      throw new ToolError('无权访问该记录', false)
    }

    const data: Prisma.RecurringTransactionUncheckedUpdateInput = {}
    if (args.name !== undefined) data.name = args.name
    if (args.amount !== undefined) {
      // 贷款的 amount 只是月供的冗余副本：单独改它会让「列表金额」与「还款计划」脱钩
      if (existing.recurringType === 'LOAN') {
        throw new ToolError(
          '贷款的月供由本金/利率/期数决定，不能单独修改 amount；要调整请重建贷款',
          false,
        )
      }
      data.amount = args.amount
    }
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
      throw new ToolError('没有提供需要更新的字段', false)
    }

    await prisma.recurringTransaction.update({ where: { id: args.id }, data })

    return desensitize({ updated: true })
  },
}

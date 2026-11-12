import { prisma } from '../../../app.js'
import { checkEnumList, desensitize, ToolError } from '../security.js'
import { TYPE_LABELS, type ConfirmPreview } from '../runtime/preview-format.js'
import type { PreviewRecordRow, PreviewScope } from '../runtime/preview-scope.js'
import type { ToolDef, ToolContext } from './types.js'
import { resolveAccountId } from './helpers.js'
import { RECORD_TYPES, normalizeRecordType } from '@homibook/core'
import { dateKey } from '../../../lib/date-time.js'

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

/** 入参枚举校验:逐条校验待改类型,非法值直接回报给模型(带上条目下标)。弹确认卡前与执行时共用 */
const validateArgs = (args: { updates: UpdateInput[] }) =>
  checkEnumList('updates[].type', (args.updates ?? []).map((u) => u.type), RECORD_TYPES)

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
            type: { type: 'string', enum: [...RECORD_TYPES], description: '流水类型' },
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
  validateArgs,

  /** 确认卡：逐条列出真正变化的字段；辨识摘要一律取修改前的原值 */
  async confirmation(args: { updates?: UpdateInput[] }, _ctx: ToolContext, scope: PreviewScope): Promise<string> {
    const updates = Array.isArray(args?.updates) ? args.updates : []
    const ids = updates.map((u) => u.recordId).filter(Boolean)
    const records = await scope.records(ids)
    const recordMap = new Map(records.map((r) => [r.id, r]))

    const allCodes = new Set<string>()
    const allAccountIds = new Set<string>()
    for (const r of records) {
      if (r.categoryCode) allCodes.add(r.categoryCode)
      if (r.accountId) allAccountIds.add(r.accountId)
      if (r.fromAccountId) allAccountIds.add(r.fromAccountId)
      if (r.toAccountId) allAccountIds.add(r.toAccountId)
    }
    for (const u of updates) {
      if (u.categoryCode) allCodes.add(u.categoryCode)
      if (u.accountId) allAccountIds.add(u.accountId)
      if (u.fromAccountId) allAccountIds.add(u.fromAccountId)
      if (u.toAccountId) allAccountIds.add(u.toAccountId)
    }
    const [categoryMap, accountMap] = await Promise.all([
      scope.categoryLabels([...allCodes]),
      scope.accountNames([...allAccountIds]),
    ])

    const dateStr = (d: Date | string) => (typeof d === 'string' ? d : dateKey(d))

    const fieldDefs: { key: string; label: string; format: (v: any) => string }[] = [
      { key: 'type', label: '类型', format: (v) => TYPE_LABELS[v] || v },
      { key: 'amount', label: '金额', format: (v) => Number(v).toFixed(2) },
      { key: 'date', label: '日期', format: (v) => dateStr(v) },
      { key: 'accountId', label: '账户', format: (v) => accountMap.get(v) || v },
      { key: 'fromAccountId', label: '转出账户', format: (v) => accountMap.get(v) || v },
      { key: 'toAccountId', label: '转入账户', format: (v) => accountMap.get(v) || v },
      { key: 'categoryCode', label: '分类', format: (v) => categoryMap.get(v) || v },
      { key: 'remark', label: '备注', format: (v) => v || '-' },
      { key: 'payer', label: '交易方', format: (v) => v || '-' },
    ]

    const accountText = (r: PreviewRecordRow) =>
      r.type === 'TRANSFER'
        ? `${r.fromAccountName || '-'} → ${r.toAccountName || '-'}`
        : r.accountName || '-'

    // 批量改常见「同日、同分类」的一批，只给日期无法分辨改的是哪条
    const summarize = (r: PreviewRecordRow) => {
      const parts = [
        accountText(r),
        categoryMap.get(r.categoryCode || '') || '无分类',
        `${TYPE_LABELS[r.type] || r.type} ${Number(r.amount).toFixed(2)}`,
      ]
      if (r.remark) parts.push(r.remark)
      return parts.join(' · ')
    }

    const changes: NonNullable<ConfirmPreview['changes']> = []
    for (const u of updates) {
      const record = recordMap.get(u.recordId)
      if (!record) {
        changes.push({
          id: u.recordId,
          date: '-',
          fields: [{ label: '错误', before: '', after: '记录不存在' }],
        })
        continue
      }
      const fields: { label: string; before: string; after: string }[] = []
      for (const f of fieldDefs) {
        const newVal = (u as unknown as Record<string, unknown>)[f.key]
        if (newVal === undefined || newVal === null) continue
        const before = f.format((record as unknown as Record<string, unknown>)[f.key])
        const after = f.format(newVal)
        if (before !== after) fields.push({ label: f.label, before, after })
      }
      if (fields.length > 0) {
        changes.push({ id: record.id, date: dateStr(record.date), summary: summarize(record), fields })
      }
    }

    if (changes.length === 0) {
      return JSON.stringify({
        type: 'generic',
        title: '批量修改流水记录',
        description: '未检测到任何字段变更',
        text: `共 ${updates.length} 条记录`,
      } satisfies ConfirmPreview)
    }

    const preview: ConfirmPreview = {
      type: 'record-changes',
      title: `确认批量修改 ${changes.length} 条流水记录`,
      changes,
    }
    return JSON.stringify(preview)
  },

  async execute(args: { updates: UpdateInput[] }, ctx: ToolContext) {
    // 入参枚举校验(与弹确认卡前同一份规则)
    const badEnum = validateArgs(args)
    if (badEnum) throw new ToolError(badEnum.error ?? '参数非法', badEnum.retryable)

    if (!args.updates || !Array.isArray(args.updates) || args.updates.length === 0) {
      throw new ToolError('updates 必须是非空数组', false)
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
      throw new ToolError(`记录不存在: ${missing.join(', ')}`, false)
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
          throw new ToolError(`账户不存在: ${val}`, false)
        }
        resolvedIds[val] = resolved
      }
    }

    const updated = await prisma.$transaction(
      args.updates.map((u) => {
        const data: Record<string, unknown> = {}
        if (u.type) data.type = normalizeRecordType(u.type)
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
        date: dateKey(r.date),
        accountName: r.account.name,
        categoryCode: r.categoryCode,
        remark: r.remark,
      })),
    })
  },
}

import { prisma } from '../../../app.js'
import { checkEnums, desensitize, ToolError } from '../security.js'
import { TYPE_LABELS, genericPreview, type ConfirmPreview } from '../runtime/preview-format.js'
import type { PreviewScope } from '../runtime/preview-scope.js'
import type { ToolDef, ToolContext } from './types.js'
import { resolveAccountId } from './helpers.js'
import { refreshAccountBalance } from '../../account.js'
import { RECORD_TYPES, normalizeRecordType } from '@homibook/core'
import { parseDayStart, dateKey } from '../../../lib/date-time.js'
import { cleanupOrphanAttachments } from '../../attachment.js'

/** 入参枚举校验:非法类型直接回报给模型。弹确认卡前与执行时共用 */
const validateArgs = (args: any) => checkEnums({ type: [args.type, RECORD_TYPES] })

export const updateRecordTool: ToolDef = {
  name: 'update_record',
  displayName: '修改流水',
  promptHint: '需要用户确认',
  description: '修改一条已有的流水记录。敏感操作，需要用户确认。',
  parameters: {
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
      attachmentIds: { type: 'array', items: { type: 'string' }, description: '替换全部附件：传入新的附件 ID 列表，将删除旧附件并关联新附件' },
      addAttachmentIds: { type: 'array', items: { type: 'string' }, description: '追加附件：保留现有附件，额外关联这些附件 ID' },
      removeAttachmentIds: { type: 'array', items: { type: 'string' }, description: '删除指定附件：从附件列表中移除这些 ID' },
    },
    required: ['recordId'],
  },
  requireConfirm: true,
  validateArgs,

  /** 确认卡：旧值取当前记录，新值取入参，只在真正变化时列出来 */
  async confirmation(args: any, _ctx: ToolContext, scope: PreviewScope): Promise<string> {
    const recordId = args.recordId || ''
    const record = await scope.record(recordId)
    if (!record) return genericPreview('修改流水', { error: `记录不存在: ${recordId}` })

    const newCodes: string[] = [args.categoryCode].filter(Boolean)
    const newAccountIds: string[] = [args.accountId, args.fromAccountId, args.toAccountId].filter(Boolean)
    const [categoryMap, accountMap] = await Promise.all([
      scope.categoryLabels([...newCodes, record.categoryCode || ''].filter(Boolean)),
      scope.accountNames([
        ...newAccountIds,
        record.accountId || '',
        record.fromAccountId || '',
        record.toAccountId || '',
      ].filter(Boolean)),
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

    const fields: { label: string; before: string; after: string }[] = []
    for (const f of fieldDefs) {
      const newVal = args[f.key]
      if (newVal === undefined || newVal === null) continue
      const before = f.format((record as unknown as Record<string, unknown>)[f.key])
      const after = f.format(newVal)
      if (before !== after) fields.push({ label: f.label, before, after })
    }

    // 附件三种语义互斥：删除 / 追加 / 整体替换
    const attRemoveCount = args.removeAttachmentIds?.length || 0
    const attAddCount = args.addAttachmentIds?.length || 0
    const hasAttReplace = Array.isArray(args.attachmentIds)
    if (attRemoveCount > 0) fields.push({ label: '附件', before: '-', after: `删除 ${attRemoveCount} 个` })
    if (attAddCount > 0) fields.push({ label: '附件', before: '-', after: `追加 ${attAddCount} 个` })
    if (hasAttReplace) fields.push({ label: '附件', before: '-', after: `替换为 ${args.attachmentIds.length} 个` })

    if (fields.length === 0) {
      return JSON.stringify({
        type: 'generic',
        title: '修改流水记录',
        description: '未检测到任何字段变更',
        text: `记录 ID: ${record.id}`,
      } satisfies ConfirmPreview)
    }

    const preview: ConfirmPreview = {
      type: 'record-changes',
      title: '确认修改流水记录',
      description: `${record.accountName || '-'} · ${categoryMap.get(record.categoryCode || '') || '无分类'} · ${TYPE_LABELS[record.type] || record.type} ${record.amount.toFixed(2)} · ${dateStr(record.date)}`,
      changes: [{
        id: record.id,
        date: dateStr(record.date),
        fields,
      }],
    }
    return JSON.stringify(preview)
  },

  async execute(args: any, ctx: ToolContext) {
    // 入参枚举校验(与弹确认卡前同一份规则)
    const badEnum = validateArgs(args)
    if (badEnum) throw new ToolError(badEnum.error ?? '参数非法', badEnum.retryable)

    const existing = await prisma.record.findUnique({ where: { id: args.recordId } })
    if (!existing) throw new ToolError('记录不存在', false)

    if (existing.accountBookId !== ctx.accountBookId) {
      throw new ToolError('无权操作该记录', false)
    }

    // 解析账户标识符（支持 accountNo 或 UUID）
    let resolvedAccountId: string | null | undefined
    if (args.accountId) {
      resolvedAccountId = await resolveAccountId(args.accountId, ctx.accountBookId)
      if (!resolvedAccountId) {
        throw new ToolError(`账户不存在: ${args.accountId}`, false)
      }
    }
    let resolvedFromId: string | null | undefined
    if (args.fromAccountId) {
      resolvedFromId = await resolveAccountId(args.fromAccountId, ctx.accountBookId)
      if (!resolvedFromId) {
        throw new ToolError(`转出账户不存在: ${args.fromAccountId}`, false)
      }
    }
    let resolvedToId: string | null | undefined
    if (args.toAccountId) {
      resolvedToId = await resolveAccountId(args.toAccountId, ctx.accountBookId)
      if (!resolvedToId) {
        throw new ToolError(`转入账户不存在: ${args.toAccountId}`, false)
      }
    }

    // 附件操作
    const attOps: Array<() => Promise<void>> = []

    if (args.attachmentIds !== undefined) {
      attOps.push(async () => {
        const current = await prisma.record.findUnique({
          where: { id: args.recordId },
          select: { recordAttachments: { select: { id: true } } },
        })
        const kept = new Set(args.attachmentIds as string[])
        const removedIds = (current?.recordAttachments ?? []).map((a) => a.id).filter((attId) => !kept.has(attId))
        // set 只替换本条流水的关联,同一附件挂在别的流水上的记录不受影响
        await prisma.record.update({
          where: { id: args.recordId },
          data: { recordAttachments: { set: (args.attachmentIds as string[]).map((attId) => ({ id: attId })) } },
        })
        // 只清理不再被任何流水/聊天引用的附件
        await cleanupOrphanAttachments(removedIds)
      })
    } else {
      if (args.removeAttachmentIds?.length > 0) {
        attOps.push(async () => {
          const removeIds = args.removeAttachmentIds as string[]
          // 只断开本条流水的关联;附件本身留着(可能还挂在别的流水上)
          await prisma.record.update({
            where: { id: args.recordId },
            data: { recordAttachments: { disconnect: removeIds.map((attId) => ({ id: attId })) } },
          })
          // 只清理不再被任何流水/聊天引用的附件
          await cleanupOrphanAttachments(removeIds)
        })
      }
      if (args.addAttachmentIds?.length > 0) {
        attOps.push(async () => {
          await prisma.record.update({
            where: { id: args.recordId },
            data: { recordAttachments: { connect: (args.addAttachmentIds as string[]).map((attId) => ({ id: attId })) } },
          })
        })
      }
    }

    for (const op of attOps) await op()

    const data: Record<string, unknown> = {}
    if (args.type) data.type = normalizeRecordType(args.type)
    if (args.amount != null) data.amount = Number(args.amount)
    if (args.date) data.date = parseDayStart(args.date)
    if (resolvedAccountId) data.accountId = resolvedAccountId
    if (args.categoryCode !== undefined) data.categoryCode = args.categoryCode
    if (args.remark !== undefined) data.remark = args.remark
    if (args.payer !== undefined) data.payer = args.payer
    if (resolvedFromId !== undefined) data.fromAccountId = resolvedFromId
    if (resolvedToId !== undefined) data.toAccountId = resolvedToId

    // 与 create_record 同口径:转账的 accountId 必须以 fromAccountId 为准。
    // 只改 fromAccountId 而不动 accountId,会让这条记录重新变成脏数据。
    const nextType = (data.type as string | undefined) ?? existing.type
    const nextFrom = (data.fromAccountId as string | null | undefined) ?? existing.fromAccountId
    if (nextType === 'TRANSFER' && nextFrom) data.accountId = nextFrom

    const record = await prisma.record.update({
      where: { id: args.recordId },
      data,
      include: { account: { select: { name: true } } },
    })

    // 刷新余额缓存:新旧账户都要刷(改金额/改账户/改方向都会影响)
    const touched = new Set(
      [existing.accountId, existing.fromAccountId, existing.toAccountId,
       record.accountId, record.fromAccountId, record.toAccountId].filter(Boolean) as string[],
    )
    for (const accId of touched) await refreshAccountBalance(accId)

    return desensitize({
      id: record.id,
      type: record.type,
      amount: record.amount,
      date: dateKey(record.date),
      accountName: record.account.name,
      categoryCode: record.categoryCode,
      remark: record.remark,
      updated: true,
    })
  },
}

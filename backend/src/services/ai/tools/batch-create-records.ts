import { prisma } from '../../../app.js'
import { checkEnumList, desensitize, ToolError } from '../security.js'
import { TYPE_LABELS, type ConfirmPreview } from '../runtime/preview-format.js'
import type { PreviewScope } from '../runtime/preview-scope.js'
import type { ToolDef, ToolContext } from './types.js'
import { resolveAccountId } from './helpers.js'
import { refreshAccountBalance } from '../../account.js'
import { dateKey } from '../../../lib/date-time.js'
import { RECORD_TYPES } from '@homibook/core'

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

/** 入参枚举校验:逐条校验类型,非法值直接回报给模型(带上条目下标)。弹确认卡前与执行时共用 */
const validateArgs = (args: BatchCreateArgs) =>
  checkEnumList('records[].type', (args.records ?? []).map((r) => r.type), RECORD_TYPES)

export const batchCreateRecordsTool: ToolDef = {
  name: 'batch_create_records',
  displayName: '批量创建流水',
  promptHint: '多条记录一次确认',
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
            type: { type: 'string', enum: [...RECORD_TYPES], description: '流水类型' },
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
  validateArgs,

  /** 确认卡：批量列出行，账户与分类名由 scope 一次解出 */
  async confirmation(args: BatchCreateArgs, _ctx: ToolContext, scope: PreviewScope): Promise<string> {
    const records = Array.isArray(args?.records) ? args.records : []
    const codes = records.map((r) => r.categoryCode).filter(Boolean) as string[]
    const accountIds = records
      .flatMap((r) => [r.accountId, r.fromAccountId, r.toAccountId])
      .filter(Boolean) as string[]
    const [categoryMap, accountMap] = await Promise.all([
      scope.categoryLabels(codes),
      scope.accountNames(accountIds),
    ])

    const rows = records.map((r) => {
      let accountText = accountMap.get(r.accountId) || r.accountId || '-'
      if (r.type === 'TRANSFER') {
        const from = accountMap.get(r.fromAccountId || '') || r.fromAccountId || '-'
        const to = accountMap.get(r.toAccountId || '') || r.toAccountId || '-'
        accountText = `${from} → ${to}`
      }
      const color = r.type === 'INCOME' ? ('green' as const) : r.type === 'EXPENSE' ? ('red' as const) : undefined
      return [[
        { text: r.date || '-' },
        { text: TYPE_LABELS[r.type] || r.type, color },
        { text: accountText },
        { text: categoryMap.get(r.categoryCode || '') || r.categoryCode || '-' },
        { text: Number(r.amount).toFixed(2), color },
        { text: r.remark || '-' },
      ]]
    })

    // 批量创建的附件是**整体**的（工具只关联到第 1 条），加列会误导成每条都有
    const attCount = Array.isArray(args.attachmentIds) ? args.attachmentIds.length : 0
    const preview: ConfirmPreview = {
      type: 'records-table',
      title: `确认批量创建 ${records.length} 条流水记录`,
      description: attCount > 0 ? `${attCount} 个附件将关联到第 1 条记录` : undefined,
      columns: ['日期', '类型', '账户', '分类', '金额', '备注'],
      rows: rows.flat(),
    }
    return JSON.stringify(preview)
  },

  async execute(args: BatchCreateArgs, ctx: ToolContext) {
    // 入参枚举校验(与弹确认卡前同一份规则)
    const badEnum = validateArgs(args)
    if (badEnum) throw new ToolError(badEnum.error ?? '参数非法', badEnum.retryable)

    if (!args.records || !Array.isArray(args.records) || args.records.length === 0) {
      throw new ToolError('records 必须是非空数组', false)
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
      throw new ToolError(errors.join('; '), false)
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
      // 转账的 accountId 以 fromAccountId 为准(与 create_record 同口径),
      // 否则 accountId 会被传成转入账户,账户筛选与汇总都会错位
      const finalAccountId = r.type === 'TRANSFER' && resolvedFromId ? resolvedFromId : resolvedAccountId
      resolved.push({ accountId: finalAccountId, fromAccountId: resolvedFromId, toAccountId: resolvedToId })
    }
    if (errors.length > 0) {
      throw new ToolError(errors.join('; '), false)
    }

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

    // 关联附件到本批【全部】记录:一张账单截图里往往有多笔,每笔都应能追溯到同一张凭证
    if (args.attachmentIds && args.attachmentIds.length > 0 && created.length > 0) {
      await prisma.$transaction(
        created.map((rec) =>
          prisma.record.update({
            where: { id: rec.id },
            data: { recordAttachments: { connect: args.attachmentIds!.map((id) => ({ id })) } },
          }),
        ),
      )
    }

    // 刷新余额缓存(AI 工具不走 routes/record 的刷新逻辑,不补会让 query_accounts 读到旧值)
    const touched = new Set<string>()
    for (const x of resolved) {
      if (x.accountId) touched.add(x.accountId)
      if (x.toAccountId) touched.add(x.toAccountId)
    }
    for (const accId of touched) await refreshAccountBalance(accId)

    return desensitize({
      created: created.length,
      records: created.map((r) => ({
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

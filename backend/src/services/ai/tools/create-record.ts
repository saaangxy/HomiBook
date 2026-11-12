import { prisma } from '../../../app.js'
import { checkEnums, desensitize, ToolError } from '../security.js'
import { TYPE_LABELS, type ConfirmPreview } from '../runtime/preview-format.js'
import type { PreviewScope } from '../runtime/preview-scope.js'
import type { ToolDef, ToolContext } from './types.js'
import { resolveAccountId } from './helpers.js'
import { refreshAccountBalance } from '../../account.js'
import { parseDayStart, dateKey } from '../../../lib/date-time.js'
import { RECORD_TYPES } from '@homibook/core'

/** 入参枚举校验:非法类型直接回报给模型(否则会被归一化悄悄记成 EXPENSE)。弹确认卡前与执行时共用 */
const validateArgs = (args: any) => checkEnums({ type: [args.type, RECORD_TYPES] })

export const createRecordTool: ToolDef = {
  name: 'create_record',
  displayName: '创建流水',
  promptHint: '需要用户确认',
  description: '创建一条新的收支流水记录。敏感操作，需要用户确认。',
  parameters: {
    type: 'object',
    properties: {
      type: { type: 'string', enum: [...RECORD_TYPES], description: '流水类型' },
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
  validateArgs,

  /** 确认卡：账户与分类名由 scope 解出，附件数直接读入参 */
  async confirmation(args: any, _ctx: ToolContext, scope: PreviewScope): Promise<string> {
    const accountIds: string[] = [args.accountId, args.fromAccountId, args.toAccountId].filter(Boolean)
    const [accountMap, categoryMap] = await Promise.all([
      scope.accountNames(accountIds),
      scope.categoryLabels([args.categoryCode].filter(Boolean)),
    ])

    let accountText = accountMap.get(args.accountId) || args.accountId || '-'
    if (args.type === 'TRANSFER') {
      const from = accountMap.get(args.fromAccountId) || args.fromAccountId || '-'
      const to = accountMap.get(args.toAccountId) || args.toAccountId || '-'
      accountText = `${from} → ${to}`
    }

    const attCount = Array.isArray(args.attachmentIds) ? args.attachmentIds.length : 0
    const color = args.type === 'INCOME' ? ('green' as const) : args.type === 'EXPENSE' ? ('red' as const) : undefined

    const preview: ConfirmPreview = {
      type: 'records-table',
      title: '确认创建以下流水记录',
      columns: ['日期', '类型', '账户', '分类', '金额', '备注', '附件'],
      rows: [[
        { text: args.date || '-' },
        { text: TYPE_LABELS[args.type] || args.type, color },
        { text: accountText },
        { text: categoryMap.get(args.categoryCode) || args.categoryCode || '-' },
        { text: Number(args.amount).toFixed(2), color },
        { text: args.remark || '-' },
        { text: attCount > 0 ? `${attCount} 个` : '-' },
      ]],
    }
    return JSON.stringify(preview)
  },

  async execute(args: any, ctx: ToolContext) {
    // 入参枚举校验(与弹确认卡前同一份规则,此处兜底客户端覆盖后的参数)
    const badEnum = validateArgs(args)
    if (badEnum) throw new ToolError(badEnum.error ?? '参数非法', badEnum.retryable)

    if (!['INCOME', 'EXPENSE', 'TRANSFER'].includes(args.type)) {
      throw new ToolError('无效的流水类型，应为 INCOME、EXPENSE 或 TRANSFER', false)
    }
    const amount = Number(args.amount)
    if (isNaN(amount) || amount <= 0) {
      throw new ToolError('金额必须大于0', false)
    }

    // 转账校验
    if (args.type === 'TRANSFER') {
      if (!args.fromAccountId || !args.toAccountId) {
        throw new ToolError('转账需要填写源账户和目标账户', false)
      }
    }

    // 解析账户标识符（支持 accountNo 或 UUID）
    const resolvedAccountId = await resolveAccountId(args.accountId, ctx.accountBookId)
    if (!resolvedAccountId) {
      throw new ToolError(`账户不存在: ${args.accountId}`, false)
    }
    const resolvedFromId = args.fromAccountId
      ? await resolveAccountId(args.fromAccountId, ctx.accountBookId)
      : null
    if (args.fromAccountId && !resolvedFromId) {
      throw new ToolError(`转出账户不存在: ${args.fromAccountId}`, false)
    }
    const resolvedToId = args.toAccountId
      ? await resolveAccountId(args.toAccountId, ctx.accountBookId)
      : null
    if (args.toAccountId && !resolvedToId) {
      throw new ToolError(`转入账户不存在: ${args.toAccountId}`, false)
    }

    const record = await prisma.record.create({
      data: {
        accountBookId: ctx.accountBookId,
        type: args.type,
        amount,
        date: parseDayStart(args.date),
        remark: args.remark,
        tags: JSON.stringify(args.tags ?? []),
        // 转账的 accountId 必须等于转出账户:它是「记账归属账户」,余额、账户筛选、汇总都按它走。
        // 模型可能把它传成转入账户(实测产生过 19 条 accountId = toAccountId 的脏数据,
        // 表现是「账户筛选选转入账户时,额外筛出这批转账」)。
        accountId: args.type === 'TRANSFER' ? (resolvedFromId ?? resolvedAccountId) : resolvedAccountId,
        fromAccountId: resolvedFromId,
        toAccountId: resolvedToId,
        categoryCode: args.categoryCode,
        payer: args.payer,
        ownerId: ctx.userId,
      },
      include: { account: { select: { name: true } } },
    })

    // 刷新账户余额缓存:AI 工具是独立入口,不走 routes/record 的那套刷新,
    // 不补的话 account.balance 会一直是旧值(query_accounts 之前就吃过这个亏)
    await refreshAccountBalance(record.accountId)
    if (record.toAccountId) await refreshAccountBalance(record.toAccountId)

    // 关联附件(多对多,用 connect 累加:同一附件可被多笔流水引用,不会覆盖别人的关联)
    if (args.attachmentIds && args.attachmentIds.length > 0) {
      await prisma.record.update({
        where: { id: record.id },
        data: { recordAttachments: { connect: args.attachmentIds.map((id: string) => ({ id })) } },
      })
    }

    return desensitize({
      id: record.id,
      type: record.type,
      amount: record.amount,
      date: dateKey(record.date),
      accountName: record.account.name,
      categoryCode: record.categoryCode,
      remark: record.remark,
      created: true,
    })
  },
}

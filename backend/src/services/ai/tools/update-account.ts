import { prisma } from '../../../app.js'
import type { Prisma } from '../../../generated/sqlite/client.js'
import { checkEnums, desensitize, ToolError } from '../security.js'
import type { ToolDef, ToolContext } from './types.js'
import { computeAccountBalance, assertCanManageAccount } from '../../account.js'
import {
  ACCOUNT_STATUS_LABELS,
  ACCOUNT_STATUSES,
  ACCOUNT_TYPE_LABELS,
  ACCOUNT_TYPES,
  ACCOUNT_VISIBILITY_LABELS,
  ACCOUNT_VISIBILITIES,
  normalizeAccountType,
} from '@homibook/core'
import { genericPreview, type ConfirmPreview } from '../runtime/preview-format.js'
import type { PreviewScope } from '../runtime/preview-scope.js'

/** 入参枚举校验:非法类型/可见性/状态直接回报给模型。弹确认卡前与执行时共用 */
const validateArgs = (args: any) =>
  checkEnums({
    type: [args.type, ACCOUNT_TYPES],
    visibility: [args.visibility, ACCOUNT_VISIBILITIES],
    status: [args.status, ACCOUNT_STATUSES],
  })

export const updateAccountTool: ToolDef = {
  name: 'update_account',
  displayName: '修改账户',
  promptHint: '需要用户确认',
  description: '更新账户元数据（名称、类型、可见性等）。',
  parameters: {
    type: 'object',
    properties: {
      id: { type: 'string', description: '账户 ID' },
      name: { type: 'string', description: '账户名称' },
      type: { type: 'string', enum: [...ACCOUNT_TYPES], description: '账户类型：BANK_DEBIT(借记卡)/CREDIT_CARD(信用卡)/ALIPAY/WECHAT/CASH(现金)/RECHARGE_CARD(充值卡)/INVESTMENT(投资)/OTHER' },
      currency: { type: 'string', description: '货币代码' },
      accountNo: { type: 'string', description: '账号' },
      bankName: { type: 'string', description: '银行名称' },
      visibility: { type: 'string', enum: [...ACCOUNT_VISIBILITIES], description: '可见性' },
      status: { type: 'string', enum: [...ACCOUNT_STATUSES], description: '状态' },
    },
    required: ['id'],
  },
  requireConfirm: true,
  validateArgs,

  /** 确认卡：账户字段逐项对比，只列真正变化的部分 */
  async confirmation(args: any, _ctx: ToolContext, scope: PreviewScope): Promise<string> {
    const account = await scope.account(args?.id || '')
    if (!account) return genericPreview('修改账户', { error: `账户不存在: ${args?.id}` })

    const typeLabels = ACCOUNT_TYPE_LABELS as Record<string, string>
    const visibilityLabels = ACCOUNT_VISIBILITY_LABELS as Record<string, string>
    const statusLabels = ACCOUNT_STATUS_LABELS as Record<string, string>

    const fieldDefs: { key: string; label: string; format: (v: any) => string }[] = [
      { key: 'name', label: '名称', format: (v) => v || '-' },
      { key: 'type', label: '类型', format: (v) => typeLabels[v] || v },
      { key: 'currency', label: '货币', format: (v) => v || '-' },
      { key: 'accountNo', label: '账号', format: (v) => v || '-' },
      { key: 'bankName', label: '银行', format: (v) => v || '-' },
      { key: 'visibility', label: '可见性', format: (v) => visibilityLabels[v] || v || '-' },
      { key: 'status', label: '状态', format: (v) => statusLabels[v] || v || '-' },
    ]

    const fields: { label: string; before: string; after: string }[] = []
    for (const f of fieldDefs) {
      const newVal = (args as Record<string, unknown>)[f.key]
      if (newVal === undefined || newVal === null) continue
      const before = f.format((account as unknown as Record<string, unknown>)[f.key])
      const after = f.format(newVal)
      if (before !== after) fields.push({ label: f.label, before, after })
    }

    if (fields.length === 0) {
      return JSON.stringify({
        type: 'generic',
        title: '修改账户',
        description: '未检测到任何字段变更',
      } satisfies ConfirmPreview)
    }

    const preview: ConfirmPreview = {
      type: 'record-changes',
      title: '确认修改账户',
      description: `${account.name} · 当前余额 ${account.balance.toFixed(2)}`,
      changes: [{ id: account.id, date: '', fields }],
    }
    return JSON.stringify(preview)
  },

  async execute(args: any, ctx: ToolContext) {
    // 入参枚举校验(与弹确认卡前同一份规则)
    const badEnum = validateArgs(args)
    if (badEnum) throw new ToolError(badEnum.error ?? '参数非法', badEnum.retryable)

    const account = await assertCanManageAccount(args.id, ctx.userId)
    if (account.accountBookId !== ctx.accountBookId) {
      throw new ToolError('无权操作该账户', false)
    }

    if (args.type === 'CREDIT_CARD') {
      const computedBalance = await computeAccountBalance(args.id)
      if (computedBalance > 0) {
        throw new ToolError('信用卡余额不能大于0', false)
      }
    }

    const data: Prisma.AccountUpdateInput = {}
    if (args.name !== undefined) data.name = args.name
    if (args.type !== undefined) data.type = normalizeAccountType(args.type)
    if (args.currency !== undefined) data.currency = args.currency
    if (args.accountNo !== undefined) data.accountNo = args.accountNo
    if (args.bankName !== undefined) data.bankName = args.bankName
    if (args.visibility !== undefined) data.visibility = args.visibility
    if (args.status !== undefined) data.status = args.status

    await prisma.account.update({ where: { id: args.id }, data })

    return desensitize({ updated: true })
  },
}

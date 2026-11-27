import { prisma } from '../../../app.js'
import { desensitize, ToolError } from '../security.js'
import type { ToolDef, ToolContext } from './types.js'
import { assertCanManageAccount, countAccountRecords } from '../../account.js'
import { genericPreview, type ConfirmPreview } from '../runtime/preview-format.js'
import type { PreviewScope } from '../runtime/preview-scope.js'

export const deleteAccountTool: ToolDef = {
  name: 'delete_account',
  displayName: '删除账户',
  promptHint: '需要用户确认',
  description: '删除账户。账户下仍有流水（收入/支出/转账转入转出）时不允许删除。',
  parameters: {
    type: 'object',
    properties: {
      id: { type: 'string', description: '账户 ID' },
    },
    required: ['id'],
  },
  requireConfirm: true,

  /** 确认卡：展示账户关键信息与当前余额，删除会连带余额调整记录 */
  async confirmation(args: { id?: string }, _ctx: ToolContext, scope: PreviewScope): Promise<string> {
    const account = await scope.account(args?.id || '')
    if (!account) return genericPreview('删除账户', { error: `账户不存在: ${args?.id}` })

    const fields: { label: string; value: string }[] = [
      { label: '名称', value: account.name },
      { label: '类型', value: account.type },
      { label: '当前余额', value: account.balance.toFixed(2) },
      { label: '货币', value: account.currency },
    ]
    if (account.accountNo) fields.push({ label: '账号', value: account.accountNo })
    if (account.bankName) fields.push({ label: '银行', value: account.bankName })

    const preview: ConfirmPreview = {
      type: 'budget-card',
      title: '确认删除账户',
      description: '将同时删除该账户的余额调整记录',
      budgetFields: fields,
    }
    return JSON.stringify(preview)
  },

  async execute(args: { id: string }, ctx: ToolContext) {
    const account = await assertCanManageAccount(args.id, ctx.userId)
    if (account.accountBookId !== ctx.accountBookId) {
      throw new ToolError('无权删除该账户', false)
    }

    // 与手动删除同一道校验:账户下还有流水时不允许删除,否则流水会指向已删除的账户
    const recordCount = await countAccountRecords(args.id)
    if (recordCount > 0) {
      throw new ToolError(`该账户下还有 ${recordCount} 条流水（收入/支出/转账），无法删除`, false)
    }

    await prisma.account.update({
      where: { id: args.id },
      data: { status: 'ARCHIVED', deletedAt: new Date() },
    })

    return desensitize({ deleted: true })
  },
}

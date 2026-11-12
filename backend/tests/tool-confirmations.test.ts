import { describe, expect, it } from 'vitest'
import { ALL_TOOLS } from '../src/services/ai/tools/index.js'
import type { ToolDef } from '../src/services/ai/tools/types.js'
import { classifyToolError } from '../src/services/ai/security.js'
import type {
  PreviewAccountRow,
  PreviewBudgetRow,
  PreviewRecordRow,
  PreviewRecurringRow,
  PreviewScope,
} from '../src/services/ai/runtime/preview-scope.js'

// ---- fake scope：固定行数据，验证确认卡的渲染而不碰数据库 ----

const recordRow: PreviewRecordRow = {
  id: 'r1',
  type: 'EXPENSE',
  amount: 100,
  date: new Date('2026-01-01T00:00:00Z'),
  remark: '午饭',
  payer: null,
  categoryCode: '餐饮',
  accountId: 'a1',
  fromAccountId: null,
  toAccountId: null,
  accountName: '现金',
  categoryLabel: '餐饮',
}

const recurringRow: PreviewRecurringRow = {
  id: 't1',
  name: '房租',
  type: 'EXPENSE',
  amount: 1000,
  cron: '0 0 1 * *',
  recurringType: 'PERIODIC',
  active: true,
  accountId: 'a1',
  toAccountId: null,
  categoryCode: '住宿',
  payer: null,
  remark: null,
  loanTotalAmount: null,
  loanRemainingAmount: null,
  loanInterestMethod: null,
  accountName: '现金',
  categoryLabel: '住宿',
}

const accountRow: PreviewAccountRow = {
  id: 'a1',
  name: '现金',
  type: 'CASH',
  balance: 100,
  currency: 'CNY',
  accountNo: '6222',
  bankName: '招商银行',
  visibility: 'PRIVATE',
  status: 'ACTIVE',
  ownerId: 'u1',
}

const budgetRow: PreviewBudgetRow = {
  id: 'b1',
  name: '餐饮预算',
  type: 'FIXED',
  year: 2026,
  month: 1,
  amount: 1000,
  startDate: null,
  endDate: null,
  categoryCode: '餐饮',
  remark: '每月餐费',
  categoryLabel: '餐饮',
}

const fakeScope: PreviewScope = {
  record: async () => recordRow,
  records: async (ids) => ids.map((id) => ({ ...recordRow, id })),
  accountNames: async (ids) => new Map(ids.map((id) => [id, id === 'a1' ? '现金' : id])),
  categoryLabels: async (codes) => new Map(codes.map((c) => [c, c === '餐饮' ? '餐饮' : c])),
  recurring: async () => recurringRow,
  account: async () => accountRow,
  budget: async () => budgetRow,
  budgetsByMonth: async () => [budgetRow],
}

const ctx = { userId: 'u1', accountBookId: 'b1' }

// ---- 各工具确认卡的最小入参 ----

const CONFIRM_ARGS: Record<string, Record<string, unknown>> = {
  delete_record: { recordId: 'r1' },
  batch_delete_records: { ids: ['r1', 'r2'] },
  clone_record: { id: 'r1' },
  create_record: { type: 'EXPENSE', amount: 12.5, date: '2026-01-01', accountId: 'a1', categoryCode: '餐饮' },
  update_record: { recordId: 'r1', amount: 20 },
  batch_create_records: {
    records: [{ type: 'EXPENSE', amount: 12.5, date: '2026-01-01', accountId: 'a1', categoryCode: '餐饮' }],
    attachmentIds: ['att1'],
  },
  batch_update_records: { updates: [{ recordId: 'r1', amount: 20 }] },
  set_budget: { name: '餐饮预算', type: 'FIXED', year: 2026, month: 1, amount: 1000, categoryCode: '餐饮' },
  delete_budget: { id: 'b1' },
  copy_budgets: { sourceYear: 2026, sourceMonth: 1, targetMonths: [{ year: 2026, month: 2 }] },
  batch_create_budgets: { name: '餐饮预算', type: 'FIXED', year: 2026, months: [1, 2], amount: 1000 },
  create_recurring: {
    name: '房租',
    type: 'EXPENSE',
    cron: '0 0 1 * *',
    accountId: 'a1',
    recurringType: 'PERIODIC',
    amount: 1000,
  },
  update_recurring: { id: 't1', amount: 2000 },
  toggle_recurring: { id: 't1' },
  delete_recurring: { id: 't1' },
  create_account: { name: '现金', type: 'CASH' },
  update_account: { id: 'a1', name: '现金钱包' },
  adjust_balance: { accountId: 'a1', date: '2026-01-01', balanceAfter: 500 },
  delete_account: { id: 'a1' },
  create_book: { name: '旅行账本' },
  save_import_mapping: {
    mappingType: 'account',
    source: 'alipay',
    mappings: [{ sourceAccountName: '支付宝', targetAccountName: '支付宝余额' }],
  },
}

const VALID_PREVIEW_TYPES = ['records-table', 'record-changes', 'budget-card', 'generic']

const confirmTools = ALL_TOOLS.filter((t): t is ToolDef & { confirmation: NonNullable<ToolDef['confirmation']> } =>
  typeof t.confirmation === 'function',
)

describe('工具确认卡', () => {
  it('每个 requireConfirm 的工具都自带 confirmation', () => {
    const missing = ALL_TOOLS.filter((t) => t.requireConfirm && !t.confirmation).map((t) => t.name)
    expect(missing).toEqual([])
  })

  it('confirmation 覆盖所有需确认工具（防止新增工具漏测）', () => {
    const declared = ALL_TOOLS.filter((t) => t.requireConfirm).map((t) => t.name).sort()
    const tested = confirmTools.map((t) => t.name).sort()
    expect(tested).toEqual(declared)
  })

  it.each(confirmTools.map((t) => [t.name, t] as const))('%s 产出合法确认卡', async (name, tool) => {
    const args = CONFIRM_ARGS[name]
    expect(args, `${name} 缺少测试入参，请在 CONFIRM_ARGS 里补一条`).toBeTruthy()

    const json = await tool.confirmation(args, ctx, fakeScope)
    const preview = JSON.parse(json) as { type?: string; title?: string; rows?: unknown[]; budgetFields?: unknown[] }

    expect(VALID_PREVIEW_TYPES).toContain(preview.type)
    expect(preview.title).toBeTruthy()

    // 表格卡必须有列和行；卡片必须有字段
    if (preview.type === 'records-table') {
      expect(Array.isArray(preview.rows)).toBe(true)
    }
    if (preview.type === 'budget-card') {
      expect(Array.isArray(preview.budgetFields)).toBe(true)
    }
  })

  it('查不到目标数据时返回兜底卡而不是抛错', async () => {
    const emptyScope: PreviewScope = {
      ...fakeScope,
      record: async () => null,
      recurring: async () => null,
      account: async () => null,
      budget: async () => null,
      budgetsByMonth: async () => [],
    }
    const missingIds: [string, Record<string, unknown>][] = [
      ['delete_record', { recordId: 'nope' }],
      ['delete_recurring', { id: 'nope' }],
      ['delete_account', { id: 'nope' }],
      ['delete_budget', { id: 'nope' }],
      ['adjust_balance', { accountId: 'nope', date: '2026-01-01', balanceAfter: 0 }],
      ['copy_budgets', { sourceYear: 2026, sourceMonth: 9, targetMonths: [{ year: 2026, month: 10 }] }],
    ]

    for (const [name, args] of missingIds) {
      const tool = confirmTools.find((t) => t.name === name)!
      const json = await tool.confirmation(args, ctx, emptyScope)
      const preview = JSON.parse(json) as { type: string; title: string }
      expect(preview.type, name).toBe('generic')
      expect(preview.title, name).toBeTruthy()
    }
  })
})

describe('工具挂起声明', () => {
  it('pause 取值合法且不与 requireConfirm 冲突', () => {
    for (const tool of ALL_TOOLS) {
      if (!tool.pause) continue
      expect(['suggestion', 'switch-book']).toContain(tool.pause)
      expect(tool.requireConfirm, `${tool.name} 不能同时声明 pause 与 requireConfirm`).toBeFalsy()
    }
  })

  it('preview_import 只在 preview 模式挂起', () => {
    const tool = ALL_TOOLS.find((t) => t.name === 'preview_import')!
    expect(tool.pauseAfter?.({ mode: 'preview' }, { success: true, retryable: false })).toBe('confirm')
    expect(tool.pauseAfter?.({ mode: 'analyze' }, { success: true, retryable: false })).toBeNull()
    expect(tool.pauseAfter?.({ mode: 'preview' }, { success: false, retryable: false })).toBeNull()
  })

  it('confirm_import 只在 confirm_preview 结果上挂起', () => {
    const tool = ALL_TOOLS.find((t) => t.name === 'confirm_import')!
    expect(tool.pauseAfter?.({}, { success: true, data: { mode: 'confirm_preview' }, retryable: false })).toBe('confirm')
    expect(tool.pauseAfter?.({}, { success: true, data: { mode: 'imported' }, retryable: false })).toBeNull()
  })
})

describe('classifyToolError', () => {
  it('超时/网络类错误可重试', () => {
    expect(classifyToolError(new Error('request timeout')).retryable).toBe(true)
    expect(classifyToolError(new Error('ECONNRESET')).retryable).toBe(true)
    expect(classifyToolError(new Error('fetch failed')).retryable).toBe(true)
  })

  it('权限/冲突类状态码不可重试', () => {
    for (const code of [401, 403, 404, 409]) {
      expect(classifyToolError(Object.assign(new Error('denied'), { statusCode: code })).retryable).toBe(false)
    }
  })

  it('普通业务错误不可重试，且保留原始消息', () => {
    const info = classifyToolError(new Error('记录不存在'))
    expect(info).toEqual({ message: '记录不存在', retryable: false })
  })

  it('非 Error 也能转成字符串', () => {
    expect(classifyToolError('boom').message).toBe('boom')
  })
})

describe('工具入参校验', () => {
  it('create_record 拒绝非法流水类型', () => {
    const tool = ALL_TOOLS.find((t) => t.name === 'create_record')!
    const bad = tool.validateArgs?.({ type: '收入', amount: 1, date: '2026-01-01', accountId: 'a1' })
    expect(bad).toMatchObject({ success: false, retryable: true })
    expect(tool.validateArgs?.({ type: 'EXPENSE', amount: 1, date: '2026-01-01', accountId: 'a1' })).toBeNull()
  })

  it('batch_update_records 逐条校验并带下标', () => {
    const tool = ALL_TOOLS.find((t) => t.name === 'batch_update_records')!
    const bad = tool.validateArgs?.({ updates: [{ recordId: 'r1', type: '收入' }] })
    // checkEnumList 的键形如 updates[].type[0]（字段名 + 数组下标）
    expect(bad?.error).toContain('updates[].type[0]')
    expect(bad?.error).toContain('收入')
  })

  it('set_budget 拒绝非法预算类型', () => {
    const tool = ALL_TOOLS.find((t) => t.name === 'set_budget')!
    expect(tool.validateArgs?.({ type: 'MONTHLY' })).toMatchObject({ success: false })
    expect(tool.validateArgs?.({ type: 'FIXED' })).toBeNull()
  })
})

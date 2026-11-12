import { describe, expect, it, vi } from 'vitest'
import { resolveToolAvailability } from '../src/services/ai/runtime/availability.js'
import { runTool } from '../src/services/ai/runtime/run-tool.js'
import { suggestOptionsTool } from '../src/services/ai/tools/suggest-options.js'
import type { ToolDef } from '../src/services/ai/tools/types.js'

const ctx = { userId: 'u1', accountBookId: 'b1' }

function makeDeps(overrides: Partial<Parameters<typeof runTool>[0]['deps']> = {}) {
  return {
    assertMember: async () => {},
    logToolCall: async () => {},
    buildLegacyPreview: async () => '{"type":"generic"}',
    scope: {
      record: async () => null,
      records: async () => [],
      accountNames: async () => new Map<string, string>(),
      categoryLabels: async () => new Map<string, string>(),
    },
    ...overrides,
  }
}

const okTool: ToolDef = {
  name: 't_ok',
  displayName: 'ok',
  description: '',
  parameters: {},
  execute: async () => ({ success: true, data: { n: 1 }, retryable: false }),
}

describe('runTool', () => {
  it('普通工具执行成功返回 result', async () => {
    const outcome = await runTool({ tool: okTool, args: {}, ctx, deps: makeDeps() })
    expect(outcome).toMatchObject({ kind: 'result', status: 'success' })
  })

  it('成员校验失败时拒绝执行', async () => {
    const execute = vi.fn(async () => ({ success: true, retryable: false }))
    const outcome = await runTool({
      tool: { ...okTool, execute },
      args: {},
      ctx,
      deps: makeDeps({ assertMember: async () => { throw new Error('不是账本成员') } }),
    })
    expect(outcome).toMatchObject({ kind: 'result', status: 'error' })
    expect(execute).not.toHaveBeenCalled()
  })

  it('validateArgs 拦截时不下发到 execute', async () => {
    const execute = vi.fn(async () => ({ success: true, retryable: false }))
    const outcome = await runTool({
      tool: { ...okTool, validateArgs: () => ({ success: false, error: '参数非法', retryable: true }), execute },
      args: {},
      ctx,
      deps: makeDeps(),
    })
    expect(outcome).toMatchObject({ kind: 'result', status: 'error' })
    if (outcome.kind === 'result') expect(outcome.result.error).toBe('参数非法')
    expect(execute).not.toHaveBeenCalled()
  })

  it('suggest_options 真实实现返回问题列表', async () => {
    const outcome = await runTool({
      tool: suggestOptionsTool,
      args: {
        questions: [
          { question: '请选择账户', field: 'accountId', options: ['现金', { label: '微信 · 张三', value: 'a1' }] },
          { question: '备注', field: 'remark', options: [], allowCustom: false },
        ],
      },
      ctx,
      deps: makeDeps(),
    })
    expect(outcome).toMatchObject({ kind: 'paused', reason: 'suggestion', status: 'suggesting' })
    if (outcome.kind !== 'paused') return
    const questions = (outcome.payload as { questions: { question: string; allowCustom: boolean }[] }).questions
    expect(questions).toHaveLength(2)
    expect(questions[0]).toMatchObject({ question: '请选择账户', allowCustom: true })
    expect(questions[1]).toMatchObject({ question: '备注', allowCustom: false })
  })

  it('requireConfirm 但未声明确认卡时返回错误且不执行', async () => {
    const execute = vi.fn(async () => ({ success: true, retryable: false }))
    const outcome = await runTool({
      tool: { ...okTool, requireConfirm: true, execute },
      args: {},
      ctx,
      deps: makeDeps(),
    })
    expect(outcome).toMatchObject({ kind: 'result', status: 'error' })
    expect(execute).not.toHaveBeenCalled()
  })

  it('requireConfirm 且有 confirmation 时用工具自带的预览', async () => {
    const legacy = vi.fn(async () => '{"type":"legacy"}')
    const confirmation = vi.fn(async () => '{"type":"own"}')
    const outcome = await runTool({
      tool: { ...okTool, requireConfirm: true, confirmation },
      args: {},
      ctx,
      deps: makeDeps({ buildLegacyPreview: legacy }),
    })
    expect(outcome).toMatchObject({ kind: 'paused', reason: 'confirm' })
    if (outcome.kind === 'paused') expect(outcome.preview).toBe('{"type":"own"}')
    expect(legacy).not.toHaveBeenCalled()
  })

  it('autoConfirm 跳过确认卡直接执行', async () => {
    const outcome = await runTool({
      tool: { ...okTool, requireConfirm: true },
      args: {},
      ctx,
      deps: makeDeps(),
      autoConfirm: true,
    })
    expect(outcome).toMatchObject({ kind: 'result', status: 'success' })
  })

  it('执行抛错被转成 error 结果并带工具名前缀', async () => {
    const outcome = await runTool({
      tool: { ...okTool, execute: async () => { throw new Error('boom') } },
      args: {},
      ctx,
      deps: makeDeps(),
    })
    expect(outcome).toMatchObject({ kind: 'result', status: 'error' })
    if (outcome.kind === 'result') {
      expect(outcome.result.error).toContain('boom')
      expect(outcome.result.error).toContain('ok') // displayName 前缀
      expect(outcome.result.retryable).toBe(false)
    }
  })

  it('超时类异常标记为可重试', async () => {
    const outcome = await runTool({
      tool: { ...okTool, execute: async () => { throw new Error('request timeout') } },
      args: {},
      ctx,
      deps: makeDeps(),
    })
    if (outcome.kind === 'result') expect(outcome.result.retryable).toBe(true)
  })

  it('pauseAfter 命中时挂起并携带执行结果', async () => {
    const outcome = await runTool({
      tool: {
        ...okTool,
        pauseAfter: (_args, result) => (result.success ? 'confirm' : null),
      },
      args: {},
      ctx,
      deps: makeDeps(),
    })
    expect(outcome).toMatchObject({ kind: 'paused', reason: 'confirm', status: 'confirming' })
    if (outcome.kind === 'paused') expect(outcome.result?.success).toBe(true)
  })
})

describe('resolveToolAvailability', () => {
  const a: ToolDef = { ...okTool, name: 'tool_a' }
  const web: ToolDef = { ...okTool, name: 'web_search' }
  const always: ToolDef = { ...okTool, name: 'save_image_content' }

  it('用户禁用的工具不下发', () => {
    const { enabled, disabled } = resolveToolAvailability([a], { userDisabled: ['tool_a'] })
    expect(enabled).toHaveLength(0)
    expect(disabled.get('tool_a')).toBe('user-disabled')
  })

  it('运行时禁用的工具照发但标记为执行时拒绝', () => {
    const { enabled, runtimeBlocked } = resolveToolAvailability([web], { runtimeDisabled: ['web_search'] })
    expect(enabled.map((t) => t.name)).toEqual(['web_search'])
    expect(runtimeBlocked.has('web_search')).toBe(true)
  })

  it('白名单覆盖用户设置', () => {
    const { enabled, disabled } = resolveToolAvailability([always], {
      userDisabled: ['save_image_content'],
      alwaysEnabled: new Set(['save_image_content']),
    })
    expect(enabled.map((t) => t.name)).toEqual(['save_image_content'])
    expect(disabled.size).toBe(0)
  })
})

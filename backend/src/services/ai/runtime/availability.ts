import type { ToolDef } from '../tools/types.js'

/** 工具完全不可用的原因：用户在设置里关掉了 */
export type DisableReason = 'user-disabled'

/** 受「联网开关」控制的工具 */
export const WEB_SEARCH_TOOL_NAMES = ['web_search', 'read_webpage'] as const

export interface ToolAvailabilityInput {
  /** 用户设置里禁用的工具名 —— 直接从 tools 列表移除 */
  userDisabled?: readonly string[]
  /**
   * 本轮临时禁用（如关闭联网）—— **保留在 tools 列表里**，执行时静默拒绝。
   * 保留是为了让请求里的 tools 前缀逐字节稳定，否则每切一次开关就丢一次前缀缓存。
   */
  runtimeDisabled?: readonly string[]
  /** 不可禁用的工具名（不出现在设置列表，也不受用户开关影响） */
  alwaysEnabled?: ReadonlySet<string>
}

export interface ToolAvailability {
  /** 实际下发给模型的工具 */
  enabled: ToolDef[]
  /** 被用户设置彻底禁用的工具 → 原因 */
  disabled: Map<string, DisableReason>
  /** 在列表里但执行时必须拒绝的工具（保前缀稳定的运行时禁用） */
  runtimeBlocked: Set<string>
}

/**
 * 工具可用性判定：三层优先级从高到低 ——
 * 永久启用白名单 → 用户设置禁用 → 本轮运行时禁用 → 默认启用。
 *
 * 注意「用户禁用」与「运行时禁用」的差别：前者不下发，后者照发但在执行前拒绝。
 */
export function resolveToolAvailability(
  tools: readonly ToolDef[],
  input: ToolAvailabilityInput = {},
): ToolAvailability {
  const userDisabled = new Set(input.userDisabled ?? [])
  const runtimeDisabled = new Set(input.runtimeDisabled ?? [])
  const alwaysEnabled = input.alwaysEnabled ?? new Set<string>()

  const enabled: ToolDef[] = []
  const disabled = new Map<string, DisableReason>()
  const runtimeBlocked = new Set<string>()

  for (const tool of tools) {
    if (alwaysEnabled.has(tool.name)) {
      enabled.push(tool)
      continue
    }
    if (userDisabled.has(tool.name)) {
      disabled.set(tool.name, 'user-disabled')
      continue
    }
    if (runtimeDisabled.has(tool.name)) runtimeBlocked.add(tool.name)
    enabled.push(tool)
  }

  return { enabled, disabled, runtimeBlocked }
}

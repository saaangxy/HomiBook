/**
 * 导入决议的统一应用(C 项)。
 *
 * 目标:让「第二步看到的 = 实际落库的」。决议的应用(账户/分类/未识别行)此前只存在于前端
 * buildImportData(web ImportDialog / mobile ImportSheet),服务端在 /import 时只看到最终 records,
 * 两边口径容易漂移。这里把「对未识别行的处置」抽成服务端也能跑的纯函数,
 * 后续 preview 接口复用同一函数即可让两端第二步都改成"服务端算"。
 *
 * 账户/分类决议的合并仍走 shared.ts 的 applyAccountMappings / applyCategoryMappings(单一来源)。
 */
import type { ParsedRow } from './shared.js'

/** 未识别行的处置(前端 unrecognizedResolutions / AI overrides 同形) */
export interface UnrecognizedResolutionInput {
  rowIndex: number
  /** 目标收支类型;空表示未处置 */
  type?: string
  accountId?: string
  toAccountId?: string
  categoryCode?: string
}

export interface ApplyUnrecognizedResult {
  /** 处置完成的记录(已获得类型/账户,与正常行同形) */
  resolved: ParsedRow[]
  /** 仍未处置(或转账缺转入)的行号:导入时会被跳过 */
  unresolvedRowIndexes: number[]
}

/**
 * 把「未识别行 + 用户/AI 的处置」合并进待导入记录。
 * 未处置的行不进 resolved(unresolvedRowIndexes 回传,供前端提示"将跳过 N 条")。
 */
export function applyUnrecognizedResolutions(
  rows: ParsedRow[],
  resolutions: UnrecognizedResolutionInput[] | undefined,
): ApplyUnrecognizedResult {
  const byRow = new Map<number, UnrecognizedResolutionInput>()
  for (const r of resolutions ?? []) byRow.set(r.rowIndex, r)

  const resolved: ParsedRow[] = []
  const unresolvedRowIndexes: number[] = []

  for (const r of rows) {
    // 正常行原样保留
    if (r.type !== 'UNKNOWN') {
      resolved.push(r)
      continue
    }

    const rowIndex = r.rowIndex ?? -1
    const res = byRow.get(rowIndex)
    // 类型 + 账户必填;转账还需转入账户(与前端/校验口径一致)
    if (!res?.type || !res.accountId || (res.type === 'TRANSFER' && !res.toAccountId)) {
      unresolvedRowIndexes.push(rowIndex)
      continue
    }

    resolved.push({
      ...r,
      type: res.type as ParsedRow['type'],
      accountId: res.accountId,
      toAccountId: res.toAccountId ?? null,
      categoryCode: res.categoryCode ?? r.categoryCode,
      mappedCategoryCode: res.categoryCode ?? r.mappedCategoryCode,
    })
  }

  return { resolved, unresolvedRowIndexes }
}

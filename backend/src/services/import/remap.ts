/**
 * 导入决议的服务端统一应用(C 项)。
 *
 * **手动与 AI 两条链路共用的唯一入口** —— 调用方:
 *   - routes/import-export.ts:GET/POST /preview(手动向导第一步与第二步)、POST /import/check(AI 卡片改决议后复核)
 *   - services/ai/tools/preview-import.ts:preview_import(mode=preview)
 *   - services/ai/tools/confirm-import.ts:confirm_import(peek 展示 + execute 执行)
 * 此前 AI 工具各自组合 shared.ts 的函数,导致「同一份账单两种入口结论不同」反复出现;现在统一到这里。
 *
 * 流程:解析后的原始行 → 账户决议 → 分类决议 → 未识别行处置
 *   → 「实际会写入的流水」(finalRows) + 未决清单 + 进度计数 + 阻断项 + 服务端裁决(canProceed/blockReasons)。
 *
 * 目的:让第二步页面 / 预览卡看到的就是实际落库的(消除客户端本地拼装与服务端口径的漂移)。
 * 账户/分类决议的合并算法仍走 shared.ts(单一来源),未识别行处置走 apply-decisions.ts。
 */
import { canProceedImport, computeImportProgress } from '@homibook/core'
import { applyAccountMappings, applyCategoryMappings, type ParsedRow } from './shared.js'
import { resolveImportAccounts } from './pipeline.js'
import { applyUnrecognizedResolutions, type UnrecognizedResolutionInput } from './apply-decisions.js'
import { collectPreviewBlocking } from './blocking.js'

export interface RemapAccountResolutionInput {
  sourceAccountName: string
  action: 'create' | 'existing'
  targetAccountId?: string
  targetAccountName?: string
  accountType?: string
}

export interface RemapCategoryResolutionInput {
  sourceCategory: string
  targetCategoryCode: string
  recordType?: string
  payerContains?: string
  descriptionContains?: string
}

export interface RemapOptions {
  source: string
  rows: ParsedRow[]
  accountBookId: string
  /** 归属人(第二步可切换);缺省按当前用户 */
  ownerId?: string
  accountResolutions?: RemapAccountResolutionInput[]
  categoryResolutions?: RemapCategoryResolutionInput[]
  unrecognizedResolutions?: UnrecognizedResolutionInput[]
  /** 用户已显式同意跳过未处置的未识别行(与 /import 的 confirmSkipUnrecognized 同义) */
  confirmSkipUnrecognized?: boolean
}

export async function remapImportRows(opts: RemapOptions) {
  const {
    source,
    rows,
    accountBookId,
    ownerId,
    accountResolutions,
    categoryResolutions,
    unrecognizedResolutions,
    confirmSkipUnrecognized,
  } = opts

  // 账户:DB 规则 + 本次决议合并 → 名称包含匹配
  const { idMap, nameRecord, newAccountCreations } = await applyAccountMappings(source, rows, accountBookId, accountResolutions, ownerId)
  const { unmatched: rawUnmatched, nameMatched } = await resolveImportAccounts(accountBookId, rows, idMap, ownerId)

  // 已由 create 决议覆盖的源账户名 ⇒ 导入时会新建账户,属于「已决策」而非「未决」。
  // 不剔除的话第二步会被误报成「账户不存在(必然失败)」并禁用确认按钮。
  const willCreateNames = new Set(newAccountCreations.map(c => c.sourceAccountName))
  const unmatchedAccounts = rawUnmatched.filter(ua => !willCreateNames.has(ua.csvName))

  // 新建账户清单(按目标名合并同组的多个 CSV 变体)供第二步展示
  const creationByName = new Map<string, { name: string; type: string; sourceAccountNames: string[] }>()
  for (const c of newAccountCreations) {
    const existing = creationByName.get(c.name)
    if (existing) existing.sourceAccountNames.push(c.sourceAccountName)
    else creationByName.set(c.name, { name: c.name, type: c.type, sourceAccountNames: [c.sourceAccountName] })
  }
  const toCreate = [...creationByName.values()]

  // 注:同账户转账(转出 === 转入)当前**保持转账、余额净 0**。
  // 账户合并(网商卡/蚂蚁财富 → 支付宝)后,"内部搬运"与"真实资金流出"在数据上无法区分,
  // 是否按支出处理留待产品口径确定,这里不做静默降级。

  // 分类:DB 规则 + 本次决议合并
  const { unmatched: unmatchedCategories, allDictItems } = await applyCategoryMappings(source, rows, categoryResolutions)

  // 未识别行按处置补全(未处置/转账缺转入的留在未决清单)
  const { resolved, unresolvedRowIndexes } = applyUnrecognizedResolutions(rows, unrecognizedResolutions)

  const unrecognizedRecords = rows.filter(r => r.type === 'UNKNOWN')
  // finalRows = 实际会写入的流水(UNKNOWN 已处置的也在内)
  const finalRows = resolved.filter(r => r.type !== 'UNKNOWN')

  // 阻断项只针对「仍未处置」的未识别行:已处置的行不该再报(D 项口径与 skipped.unrecognized 一致)
  const unresolvedSet = new Set(unresolvedRowIndexes)
  const blocking = collectPreviewBlocking({
    unmatchedAccounts,
    unmatchedCategories,
    unrecognizedRecords: unrecognizedRecords.filter(r => unresolvedSet.has(r.rowIndex ?? -1)),
  })
  const unresolvedUnrecognized = unrecognizedRecords.filter(r => unresolvedSet.has(r.rowIndex ?? -1))
  const counts = computeImportProgress({
    unmatchedAccounts,
    categoryResolutions: unmatchedCategories.map(uc => ({ sourceCategory: uc.sourceCategory, targetCode: '' })),
    unrecognizedRecords: unresolvedUnrecognized,
  })

  // ---- 服务端唯一裁决(前端不再自行判定,避免两侧口径漂移) ----
  // 能否进入下一步 / 确认导入:账户与分类都不能有未决项,未识别行要么没有要么已同意跳过,
  // 且确实有可写入的流水。判定函数复用 core canProceedImport(与计数同源)。
  const canProceed =
    finalRows.length > 0 && canProceedImport(counts, { agreeSkipUnrecognized: confirmSkipUnrecognized })
  const blockReasons: string[] = [
    ...blocking.filter(b => b.willFailAtImport).map(b => b.reason),
    ...unmatchedCategories.map(uc => `分类「${uc.sourceCategory}」未映射到系统分类`),
  ]
  if (counts.willSkip > 0 && !confirmSkipUnrecognized) {
    blockReasons.push(`有 ${counts.willSkip} 条未识别记录未处理（勾选「同意跳过」后可继续）`)
  }
  if (finalRows.length === 0) blockReasons.push('没有可导入的流水记录')

  // 转账必须有转入账户:否则这笔钱在目标账户上永远不出现(只在源账户扣款),
  // 余额会对不上。转账的 accountId 已确认恒等于 fromAccountId,不能拿它兜底。
  const transfersMissingTo = finalRows.filter(r => r.type === 'TRANSFER' && !r.toAccountId)
  if (transfersMissingTo.length > 0) {
    blockReasons.push(`有 ${transfersMissingTo.length} 条转账缺少转入账户，请先指定`)
  }

  // 最终流水里的分类必须落在字典中:否则 /import 的严格校验会 400(这里用同一句文案,
  // 让用户在被拦下时看到的原因与实际报错一致)。
  // 必须比对「最终写入的值」= mappedCategoryCode ?? categoryCode(与前端提交的字段同口径):
  // categoryCode 只是源分类名,直接拿它比字典会把"已正确映射"的行也误判。
  const dictCodes = new Set(allDictItems.map(d => d.code))
  const invalidCategoryNames = [...new Set(
    finalRows.map(r => r.mappedCategoryCode ?? r.categoryCode).filter((c): c is string => !!c && !dictCodes.has(c)),
  )]
  if (invalidCategoryNames.length > 0) {
    blockReasons.push(`分类不在字典中：${invalidCategoryNames.slice(0, 5).join('、')}`)
  }

  return {
    finalRows,
    unrecognizedRecords,
    unmatchedAccounts,
    /** 将新建的账户(按目标名合并同组源账户名) */
    toCreate,
    unmatchedCategories,
    allDictItems,
    /** 源账户名 → 目标账户名(名称包含匹配 + 规则命中 + 本次将新建的账户) */
    nameMatched: {
      ...nameMatched,
      ...nameRecord,
      ...Object.fromEntries(toCreate.flatMap(c => c.sourceAccountNames.map(sn => [sn, c.name]))),
    },
    unresolved: {
      accounts: unmatchedAccounts.map(ua => ua.csvName),
      categories: unmatchedCategories.map(uc => uc.sourceCategory),
      /** 未处置(含转账缺转入)的未识别行号 */
      unrecognized: unresolvedRowIndexes,
    },
    blocking,
    counts,
    /** 服务端裁决:能否进入下一步 / 确认导入(前端直接采用,不再自行判定) */
    canProceed,
    /** canProceed 为 false 时的逐条原因(人类可读) */
    blockReasons,
  }
}

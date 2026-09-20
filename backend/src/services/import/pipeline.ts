/**
 * 导入管线「解析成结构化数据之后」的公共阶段 —— 文件导入与短信导入共用。
 *
 * 分层边界:
 *   上传文件(fileId/uploads) + parsers.ts  →  ParsedRow[]   ← 文件专属,短信路径不经过
 *   ParsedRow[] → 账户匹配(本模块) → 分类映射(本模块) → 预览组装 / 批量入账
 *
 * 调用方:routes/import-export.ts(手动向导与 /import 预览)、routes/sms.ts(短信候选直入)。
 * AI 工具链(preview_import / confirm_import)另有自己的 AI 决议合并逻辑,但同样复用 shared.ts 的映射应用。
 */
import { prisma } from '../../app.js'
import { dateKey } from '../../lib/date-time.js'
import { applyCategoryMappings, inferAccount, matchAccountByName, type ParsedRow } from './shared.js'

// ======================== 账户匹配 ========================

/** 未匹配/歧义账户(前端口径:csvName 是源账户名,也是决议的 key) */
export interface UnmatchedImportAccount {
  csvName: string
  suggestedType: string
  suggestedName: string
  bankName?: string
  accountNo?: string
  candidates?: { id: string; name: string }[]
}

export interface ResolvedImportAccounts {
  unmatched: UnmatchedImportAccount[]
  /** 源账户名 → 实际匹配到的账户名(展示用) */
  nameMatched: Record<string, string>
}

/**
 * 账户匹配(解析后阶段):先吃映射表预解析的 idMap,再按名称包含匹配。
 * 传入 ownerId 时只在本人(及未设归属人)账户中匹配,避免多成员账本下误匹配他人同名账户。
 * 副作用:就地填充 rows[].accountId / toAccountId。
 */
export async function resolveImportAccounts(
  bookId: string,
  rows: ParsedRow[],
  idMap?: Map<string, string | null>,
  ownerId?: string,
): Promise<ResolvedImportAccounts> {
  // 收集所有唯一账户名
  const accountNames = new Set<string>()
  for (const r of rows) {
    accountNames.add(r.accountName)
    if (r.toAccountName) accountNames.add(r.toAccountName)
  }

  // 从映射中收集已预解析的 ID
  const mappedCsvNameToId = new Map<string, string>()
  if (idMap) {
    for (const [csvName, id] of idMap) {
      if (id) mappedCsvNameToId.set(csvName, id)
    }
  }

  // 加载活跃账户(多成员账本下只匹配本人账户)
  const namesToLookup = Array.from(accountNames).filter(n => !mappedCsvNameToId.has(n))
  const allAccounts = await prisma.account.findMany({
    where: { accountBookId: bookId, status: 'ACTIVE', ...(ownerId ? { ownerId } : {}) },
    select: { id: true, name: true },
  })

  // 用包含匹配查找,记录多候选的账户
  const nameToId = new Map<string, string>()
  const nameMatched: Record<string, string> = {}
  const candidatesMap = new Map<string, { id: string; name: string }[]>()
  for (const name of namesToLookup) {
    const result = matchAccountByName(name, allAccounts, ownerId)
    if (result.matched) {
      nameToId.set(name, result.id)
      nameMatched[name] = result.name
    } else if (result.ambiguous) {
      candidatesMap.set(name, result.candidates)
    }
  }

  // 未匹配的账户(含多候选的)
  const unmatched: UnmatchedImportAccount[] = []
  const seen = new Set<string>()

  for (const name of accountNames) {
    if (mappedCsvNameToId.has(name)) continue
    if (nameToId.has(name)) continue
    if (seen.has(name)) continue
    seen.add(name)
    const ambCandidates = candidatesMap.get(name)
    const inferred = inferAccount(name)
    if (inferred || ambCandidates) {
      unmatched.push({
        csvName: name,
        suggestedType: inferred?.type || '',
        suggestedName: inferred?.defaultName || name,
        bankName: inferred?.bankName,
        accountNo: inferred?.accountNo,
        ...(ambCandidates ? { candidates: ambCandidates } : {}),
      })
    }
  }

  // 填充 accountId / toAccountId
  for (const r of rows) {
    r.accountId = mappedCsvNameToId.get(r.accountName) || nameToId.get(r.accountName) || null
    if (r.toAccountName) {
      r.toAccountId = mappedCsvNameToId.get(r.toAccountName) || nameToId.get(r.toAccountName) || null
    }
  }

  return { unmatched, nameMatched }
}

// ======================== 分类映射 ========================

/** 分类映射(解析后阶段):读导入映射表 + 字典,就地填充 rows[].mappedCategoryCode */
export async function resolveImportCategories(source: string, rows: ParsedRow[]) {
  return applyCategoryMappings(source, rows)
}

// ======================== 预览行 ========================

/** ParsedRow → 预览行(HTTP 预览与短信预览共用同一形状,对应前端 ImportPreviewResult.records) */
export function toImportPreviewRow(r: ParsedRow) {
  return {
    date: r.date,
    type: r.type,
    amount: r.amount,
    accountName: r.accountName,
    accountId: r.accountId,
    toAccountName: r.toAccountName,
    toAccountId: r.toAccountId,
    categoryCode: r.categoryCode,
    mappedCategoryCode: r.mappedCategoryCode,
    payer: r.payer,
    remark: r.remark,
    tags: r.tags,
    rowIndex: r.rowIndex,
  }
}

// ======================== 弱校验(疑似已存在的流水) ========================

/**
 * 弱校验键:同账户 + 同一业务日 + 同金额 + 同方向。
 * 只做提示用(命中 → 前端默认不勾选),**不硬拦** —— 真实场景存在同日同额两笔(如两杯咖啡),
 * 是否导入由用户决定。与 dedup.ts 的 buildDuplicateKey 分工不同:那里是「账户内分组查重」的可配置口径。
 */
export function existingRecordKey(accountId: string, date: Date | string, amount: number, type: string): string {
  const d = date instanceof Date ? date : new Date(date)
  return [accountId, isNaN(d.getTime()) ? '' : dateKey(d), amount.toFixed(2), type].join('|')
}

/**
 * 查本账本内可能已存在的流水键集合(一次查询,覆盖候选涉及的全部账户与日期区间)。
 * 只取账户/金额/方向/日期四列,命中判定在内存完成。
 */
export async function findExistingRecordKeys(accountBookId: string, rows: ParsedRow[]): Promise<Set<string>> {
  const withAccount = rows.filter(r => r.accountId)
  if (withAccount.length === 0) return new Set()

  const accountIds = [...new Set(withAccount.map(r => r.accountId!))]
  const times = rows.map(r => new Date(r.date).getTime()).filter(t => !isNaN(t))
  if (times.length === 0) return new Set()

  // 日期区间按自然日放宽(业务时区),避免跨时区把边界日漏掉
  const gte = new Date(Math.min(...times))
  gte.setHours(0, 0, 0, 0)
  const lte = new Date(Math.max(...times))
  lte.setHours(23, 59, 59, 999)

  const existing = await prisma.record.findMany({
    where: { accountBookId, accountId: { in: accountIds }, date: { gte, lte } },
    select: { accountId: true, amount: true, type: true, date: true },
  })

  return new Set(existing.map(r => existingRecordKey(r.accountId, r.date, r.amount, r.type)))
}

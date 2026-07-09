import { refreshAccountBalance } from '../record.js'

// ---- 类型 ----

export interface ImportRecord {
  date: string
  type: 'INCOME' | 'EXPENSE' | 'TRANSFER'
  amount: number
  accountId: string
  toAccountId?: string
  categoryCode?: string | null
  payer?: string | null
  remark?: string
  tags?: string[]
  ownerId?: string
}

export interface AccountCreationInput {
  csvName: string
  name: string
  type: string
  bankName?: string | null
  accountNo?: string | null
}

export interface CategoryMappingInput {
  sourceCategory: string
  targetCategoryCode: string
  payerContains?: string
  descriptionContains?: string
  recordType?: string
}

export interface AccountMappingInput {
  sourceAccountName: string
  targetAccountName: string
  payerContains?: string
  descriptionContains?: string
}

// ---- 交易内：创建新账户 ----

export async function createAccountsInTx(
  tx: any,
  accountBookId: string,
  ownerId: string,
  creations: AccountCreationInput[],
): Promise<{ accountMap: Map<string, string>; accountsCreated: number }> {
  const accountMap = new Map<string, string>()
  let accountsCreated = 0

  for (const acct of creations) {
    const existing = await tx.account.findFirst({
      where: { accountBookId, name: acct.name },
    })
    if (existing) {
      for (const sn of acct.csvName.split(', ')) {
        accountMap.set(sn, existing.id)
      }
      accountMap.set(acct.name, existing.id)
      continue
    }
    accountsCreated++
    const created = await tx.account.create({
      data: {
        accountBookId,
        ownerId,
        name: acct.name,
        type: acct.type,
        bankName: acct.bankName || null,
        accountNo: acct.accountNo || null,
        balance: 0,
      },
    })
    for (const sn of acct.csvName.split(', ')) {
      accountMap.set(sn, created.id)
    }
    accountMap.set(acct.name, created.id)
  }

  return { accountMap, accountsCreated }
}

// ---- 交易内：保存分类映射 ----

export async function saveCategoryMappingsInTx(
  tx: any,
  source: string,
  mappings: CategoryMappingInput[],
): Promise<void> {
  for (const m of mappings) {
    const recordType = m.recordType || ''
    const payerContains = m.payerContains || ''
    const descriptionContains = m.descriptionContains || ''
    await tx.importCategoryMapping.upsert({
      where: {
        source_sourceCategory_payerContains_descriptionContains_recordType: {
          source,
          sourceCategory: m.sourceCategory,
          payerContains,
          descriptionContains,
          recordType,
        },
      },
      create: {
        source,
        sourceCategory: m.sourceCategory,
        payerContains,
        descriptionContains,
        recordType,
        targetCategoryCode: m.targetCategoryCode,
      },
      update: { targetCategoryCode: m.targetCategoryCode },
    })
  }
}

// ---- 交易内：保存账户映射 ----

export async function saveAccountMappingsInTx(
  tx: any,
  source: string,
  mappings: AccountMappingInput[],
): Promise<void> {
  for (const m of mappings) {
    const payerContains = m.payerContains || ''
    const descriptionContains = m.descriptionContains || ''
    await tx.importAccountMapping.upsert({
      where: {
        source_sourceAccountName_payerContains_descriptionContains: {
          source,
          sourceAccountName: m.sourceAccountName,
          payerContains,
          descriptionContains,
        },
      },
      create: {
        source,
        sourceAccountName: m.sourceAccountName,
        payerContains,
        descriptionContains,
        targetAccountName: m.targetAccountName,
      },
      update: { targetAccountName: m.targetAccountName },
    })
  }
}

// ---- 交易内：解析账户 ID ----

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export class AccountResolver {
  private nameCache = new Map<string, string>()

  constructor(
    private tx: any,
    private accountMap: Map<string, string>,
    private accountBookId: string,
  ) {}

  async resolve(idOrName: string): Promise<string> {
    if (this.accountMap.has(idOrName)) return this.accountMap.get(idOrName)!
    if (UUID_RE.test(idOrName)) return idOrName
    if (this.nameCache.has(idOrName)) return this.nameCache.get(idOrName)!
    const acc = await this.tx.account.findFirst({
      where: { accountBookId: this.accountBookId, name: idOrName },
    })
    if (acc) {
      this.nameCache.set(idOrName, acc.id)
      return acc.id
    }
    throw Object.assign(new Error(`账户不存在: ${idOrName}`), { statusCode: 400 })
  }
}

// ---- 交易内：批量创建记录 ----

export async function batchCreateRecordsInTx(
  tx: any,
  accountBookId: string,
  ownerId: string,
  records: ImportRecord[],
  resolveAccount: (idOrName: string) => Promise<string>,
): Promise<Set<string>> {
  const affectedAccounts = new Set<string>()
  const batchSize = 100

  for (let i = 0; i < records.length; i += batchSize) {
    const batch = records.slice(i, i + batchSize)
    const resolved = await Promise.all(batch.map(async r => ({
      accountId: await resolveAccount(r.accountId),
      toAccountId: r.toAccountId ? await resolveAccount(r.toAccountId) : null,
    })))

    const createData = batch.map((r, idx) => {
      const accountId = resolved[idx].accountId
      const toAccountId = resolved[idx].toAccountId
      affectedAccounts.add(accountId)
      if (toAccountId) affectedAccounts.add(toAccountId)

      return {
        accountBookId,
        type: r.type,
        amount: r.amount,
        date: new Date(r.date),
        remark: r.remark || null,
        tags: JSON.stringify(r.tags ?? []),
        accountId,
        fromAccountId: r.type === 'TRANSFER' ? accountId : null,
        toAccountId: r.type === 'TRANSFER' ? toAccountId : null,
        categoryCode: r.categoryCode || null,
        payer: r.payer || null,
        ownerId: r.ownerId || ownerId,
      }
    })

    await Promise.all(createData.map((d: any) => tx.record.create({ data: d })))
  }

  return affectedAccounts
}

// ---- 刷新账户余额 ----

export async function refreshBalances(accountIds: Set<string>): Promise<void> {
  for (const accId of accountIds) {
    try { await refreshAccountBalance(accId) } catch { /* ignore */ }
  }
}

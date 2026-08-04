import type { ToolDef, ToolContext } from './types.js'
import { prisma } from '../../../app.js'
import { assertIsMember } from '../security.js'
import { parseAlipayCSV, parseWechatXlsx, parseJdCSV } from '../../import/parsers.js'
import { applyAccountMappings, applyCategoryMappings, matchAccountByName, inferAccount, type ParsedRow } from '../../import/shared.js'
import { createAccountsInTx, saveCategoryMappingsInTx, saveAccountMappingsInTx, AccountResolver, batchCreateRecordsInTx, refreshBalances } from '../../import/execute.js'
import { consumeImportOverrides, peekImportOverrides } from './index.js'
import fs from 'fs'
import path from 'path'

export const confirmImportTool: ToolDef = {
  name: 'confirm_import',
  displayName: '确认导入',
  promptHint: '传入 fileId、source 和映射规则，一次性完成导入',
  description: '确认导入账单数据。传入 fileId、source 和经过用户确认的映射规则，展示导入预览后可执行导入。',
  requireConfirm: false,
  parameters: {
    type: 'object',
    properties: {
      fileId: { type: 'string', description: '上传文件后获得的 fileId' },
      source: { type: 'string', enum: ['alipay', 'wechat', 'jd'], description: '账单来源类型' },
      ownerId: { type: 'string', description: '记录归属人ID，不填默认本人' },
      accountResolutions: {
        type: 'array',
        description: 'AI 提供的账户匹配规则',
        items: {
          type: 'object',
          properties: {
            sourceAccountName: { type: 'string' },
            action: { type: 'string', enum: ['existing', 'create'] },
            targetAccountId: { type: 'string' },
            targetAccountName: { type: 'string' },
            accountType: { type: 'string' },
          },
          required: ['sourceAccountName', 'action'],
        },
      },
      categoryResolutions: {
        type: 'array',
        description: 'AI 提供的分类映射规则',
        items: {
          type: 'object',
          properties: {
            sourceCategory: { type: 'string' },
            targetCategoryCode: { type: 'string' },
            recordType: { type: 'string', enum: ['INCOME', 'EXPENSE', 'TRANSFER'] },
            payerContains: { type: 'string', description: '交易方名称正则过滤条件（可选），如 燃气|电力|汇通 匹配任一关键词' },
            descriptionContains: { type: 'string', description: '说明字段正则过滤条件（可选），如 燃气|电力|汇通 匹配任一关键词' },
          },
          required: ['sourceCategory', 'targetCategoryCode'],
        },
      },
    },
    required: ['fileId', 'source'],
  },

  async execute(args: any, ctx: ToolContext) {
    await assertIsMember(ctx.accountBookId, ctx.userId)
    const { fileId, source, ownerId, accountResolutions, categoryResolutions, _execute } = args as {
      fileId: string
      source: 'alipay' | 'wechat' | 'jd'
      ownerId?: string
      accountResolutions?: { sourceAccountName: string; action: 'existing' | 'create'; targetAccountId?: string; targetAccountName?: string; accountType?: string }[]
      categoryResolutions?: { sourceCategory: string; targetCategoryCode: string; recordType?: string; payerContains?: string; descriptionContains?: string }[]
      _execute?: boolean
    }

    const effectiveOwnerId = ownerId || ctx.userId

    // 查找并解析文件
    const uploadDir = path.resolve('uploads')
    const files = fs.readdirSync(uploadDir)
    const targetFile = files.find(f => f.startsWith(fileId))
    if (!targetFile) {
      return { success: false, error: '文件不存在或已过期，请重新上传', retryable: false }
    }

    const filePath = path.join(uploadDir, targetFile)
    const buffer = fs.readFileSync(filePath)

    let parseResult: { rows: ParsedRow[]; errors: string[] }
    if (source === 'alipay') {
      parseResult = parseAlipayCSV(buffer)
    } else if (source === 'wechat') {
      parseResult = parseWechatXlsx(buffer)
    } else if (source === 'jd') {
      parseResult = parseJdCSV(buffer)
    } else {
      return { success: false, error: `不支持的账单来源: ${source}`, retryable: false }
    }

    if (parseResult.rows.length === 0 && parseResult.errors.length > 0) {
      return { success: false, error: parseResult.errors[0], retryable: false }
    }

    // ---- 合并映射规则：用户覆盖 > LLM 参数 ----
    // Phase 1 (preview): peek 不删除，Phase 2 (execute) 才 consume 删除
    const userOverrides = _execute ? consumeImportOverrides(fileId) : peekImportOverrides(fileId)
    const effectiveAccountResolutions = userOverrides?.accountResolutions ?? accountResolutions
    const effectiveCategoryResolutions = userOverrides?.categoryResolutions ?? categoryResolutions

    // 应用用户指定的未识别记录处理
    if (userOverrides?.unrecognizedResolutions && userOverrides.unrecognizedResolutions.length > 0) {
      const unresMap = new Map(userOverrides.unrecognizedResolutions.map(u => [u.rowIndex, u]))
      for (const r of parseResult.rows) {
        const unres = unresMap.get(r.rowIndex)
        if (unres && r.type === 'UNKNOWN') {
          r.type = unres.type as 'INCOME' | 'EXPENSE' | 'TRANSFER'
          r.accountId = unres.accountId || null
          if (unres.categoryCode) r.mappedCategoryCode = unres.categoryCode
        }
      }
    }

    // DB + AI 分类映射合并应用（AI 按唯一键覆盖/补充 DB，统一走评分匹配）
    await applyCategoryMappings(source, parseResult.rows, effectiveCategoryResolutions)

    // 应用 DB 账户映射 + AI 覆盖
    const { idMap: accountMappings, newAccountCreations } = await applyAccountMappings(source, parseResult.rows, ctx.accountBookId, effectiveAccountResolutions)

    // 匹配账户
    const allAccounts = await prisma.account.findMany({
      where: { accountBookId: ctx.accountBookId, status: 'ACTIVE' },
      select: { id: true, name: true },
    })

    const nameToId = new Map<string, string>()
    for (const row of parseResult.rows) {
      const names = [row.accountName]
      if (row.toAccountName) names.push(row.toAccountName)
      for (const name of names) {
        if (accountMappings.has(name) || nameToId.has(name)) continue
        const result = matchAccountByName(name, allAccounts)
        if (result.matched) {
          nameToId.set(name, result.id)
        }
      }
    }

    // 构建 accountCreations（按 targetName 合并，避免多个源账户映射到同一目标时重复创建）
    const creationByName = new Map<string, { csvNames: Set<string>; name: string; type: string; bankName?: string; accountNo?: string }>()
    for (const nac of newAccountCreations) {
      const existing = creationByName.get(nac.name)
      if (existing) {
        existing.csvNames.add(nac.sourceAccountName)
      } else {
        creationByName.set(nac.name, { csvNames: new Set([nac.sourceAccountName]), name: nac.name, type: nac.type })
      }
    }

    // 自动推断未匹配账户（跳过已被 AI 映射覆盖的源账户名）
    const mappedSourceNames = new Set([...creationByName.values()].flatMap(c => [...c.csvNames]))
    const seenAccounts = new Set<string>()
    for (const row of parseResult.rows) {
      if (seenAccounts.has(row.accountName)) continue
      seenAccounts.add(row.accountName)
      if (accountMappings.has(row.accountName)) continue
      if (nameToId.has(row.accountName)) continue
      if (mappedSourceNames.has(row.accountName)) continue
      const inferred = inferAccount(row.accountName)
      if (inferred) {
        const existing = creationByName.get(inferred.defaultName)
        if (existing) {
          existing.csvNames.add(row.accountName)
          if (inferred.bankName) existing.bankName = inferred.bankName
          if (inferred.accountNo) existing.accountNo = inferred.accountNo
        } else {
          creationByName.set(inferred.defaultName, {
            csvNames: new Set([row.accountName]),
            name: inferred.defaultName,
            type: inferred.type,
            bankName: inferred.bankName,
            accountNo: inferred.accountNo,
          })
        }
      }
    }

    const accountCreations = [...creationByName.values()].map(c => ({
      csvName: [...c.csvNames].join(', '),
      name: c.name,
      type: c.type,
      bankName: c.bankName,
      accountNo: c.accountNo,
    }))

    const newAccountMappings = [...creationByName.values()].flatMap(c =>
      [...c.csvNames].map(sn => ({ sourceAccountName: sn, targetAccountName: c.name })),
    )

    // 构建 newMappings
    const newMappings: { sourceCategory: string; targetCategoryCode: string; payerContains?: string; descriptionContains?: string; recordType?: string }[] = []
    if (effectiveCategoryResolutions) {
      for (const cr of effectiveCategoryResolutions) {
        newMappings.push({
          sourceCategory: cr.sourceCategory,
          targetCategoryCode: cr.targetCategoryCode,
          payerContains: cr.payerContains,
          descriptionContains: cr.descriptionContains,
          recordType: cr.recordType,
        })
      }
    }

    // 构建记录列表（只包含正常记录）
    const normalRecords = parseResult.rows.filter(r => r.type !== 'UNKNOWN')

    // 填充 accountId / toAccountId
    for (const r of normalRecords) {
      if (!r.accountId) {
        r.accountId = accountMappings.get(r.accountName) || nameToId.get(r.accountName) || null
      }
      if (r.toAccountName && !r.toAccountId) {
        r.toAccountId = accountMappings.get(r.toAccountName) || nameToId.get(r.toAccountName) || null
      }
    }

    // ---- 获取账本成员（供归属人选择） ----
    const members = await prisma.accountBookMember.findMany({
      where: { accountBookId: ctx.accountBookId },
      select: { user: { select: { id: true, nickname: true, email: true } } },
    })
    const bookOwner = await prisma.accountBook.findUnique({
      where: { id: ctx.accountBookId },
      select: { owner: { select: { id: true, nickname: true, email: true } } },
    })
    const bookOwnerId = bookOwner?.owner.id

    const formatDate = (d: string) => {
      try {
        const dt = new Date(d)
        if (isNaN(dt.getTime())) return d
        return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')} ${String(dt.getHours()).padStart(2, '0')}:${String(dt.getMinutes()).padStart(2, '0')}:${String(dt.getSeconds()).padStart(2, '0')}`
      } catch { return d }
    }

    // ---- 阶段1：返回预览数据 ----
    if (!_execute) {
      // 查询分类标签
      const categoryCodes = new Set<string>()
      for (const r of normalRecords) {
        if (r.categoryCode) categoryCodes.add(r.categoryCode)
        if (r.mappedCategoryCode) categoryCodes.add(r.mappedCategoryCode)
      }
      const dictEntries = categoryCodes.size > 0
        ? await prisma.dictionary.findMany({ where: { code: { in: [...categoryCodes] } }, select: { code: true, label: true } })
        : []
      const labelMap = new Map(dictEntries.map(d => [d.code, d.label]))

      const ACCOUNT_TYPE_LABELS: Record<string, string> = {
        BANK_DEBIT: '储蓄卡', CREDIT_CARD: '信用卡', ALIPAY: '支付宝',
        WECHAT: '微信', INVESTMENT: '投资', CASH: '现金', RECHARGE_CARD: '充值卡', OTHER: '其他',
      }

      return {
        success: true,
        retryable: false,
        data: {
          mode: 'confirm_preview',
          source,
          fileId,
          accountsToCreate: accountCreations.map(a => ({
            name: a.name,
            type: a.type,
            typeLabel: ACCOUNT_TYPE_LABELS[a.type] || a.type,
          })),
          records: normalRecords.map(r => ({
            rowIndex: r.rowIndex,
            date: formatDate(r.date),
            type: r.type,
            amount: r.amount,
            accountName: r.accountName,
            accountId: r.accountId,
            toAccountName: r.toAccountName,
            toAccountId: r.toAccountId,
            categoryCode: r.categoryCode,
            categoryLabel: r.categoryCode ? (labelMap.get(r.categoryCode) || r.categoryCode) : null,
            mappedCategoryCode: r.mappedCategoryCode,
            mappedCategoryLabel: r.mappedCategoryCode ? (labelMap.get(r.mappedCategoryCode) || r.mappedCategoryCode) : null,
            payer: r.payer,
            remark: r.remark,
            tags: r.tags,
          })),
          stats: {
            totalRecords: normalRecords.length,
            incomeCount: normalRecords.filter(r => r.type === 'INCOME').length,
            expenseCount: normalRecords.filter(r => r.type === 'EXPENSE').length,
            transferCount: normalRecords.filter(r => r.type === 'TRANSFER').length,
            accountsToCreate: accountCreations.length,
          },
          ownerId: effectiveOwnerId,
          owners: [
            ...(bookOwner ? [{ id: bookOwner.owner.id, name: bookOwner.owner.nickname || bookOwner.owner.email, isOwner: true }] : []),
            ...members.filter(m => m.user.id !== bookOwnerId).map(m => ({ id: m.user.id, name: m.user.nickname || m.user.email, isOwner: false })),
          ],
          accountBookId: ctx.accountBookId,
        },
      }
    }

    // ---- 阶段2：执行导入 ----

    // 构建源账户名 → 新建账户名映射（csvName 已合并为逗号分隔）
    const csvNameToNewName = new Map<string, string>()
    for (const c of creationByName.values()) {
      for (const sn of c.csvNames) {
        csvNameToNewName.set(sn, c.name)
      }
    }

    const records = normalRecords.map(r => ({
      date: r.date,
      type: r.type as 'INCOME' | 'EXPENSE' | 'TRANSFER',
      amount: r.amount,
      accountId: r.accountId || csvNameToNewName.get(r.accountName) || r.accountName,
      toAccountId: r.toAccountId || undefined,
      categoryCode: r.mappedCategoryCode || r.categoryCode,
      payer: r.payer,
      remark: r.remark,
      tags: r.tags,
    }))

    const { accountMap, accountsCreated, affectedAccounts } = await prisma.$transaction(async (tx) => {
      const { accountMap, accountsCreated } = await createAccountsInTx(tx, ctx.accountBookId, effectiveOwnerId, accountCreations)
      await saveCategoryMappingsInTx(tx, source, newMappings)
      await saveAccountMappingsInTx(tx, source, newAccountMappings)
      const resolver = new AccountResolver(tx, accountMap, ctx.accountBookId)
      const affectedAccounts = await batchCreateRecordsInTx(tx, ctx.accountBookId, effectiveOwnerId, records, idOrName => resolver.resolve(idOrName))
      return { accountMap, accountsCreated, affectedAccounts }
    })

    await refreshBalances(affectedAccounts)

    // 清理临时文件
    try {
      fs.unlinkSync(filePath)
    } catch { /* ignore */ }

    return {
      success: true,
      data: {
        imported: records.length,
        accountsCreated,
      },
      retryable: false,
    }
  },
}

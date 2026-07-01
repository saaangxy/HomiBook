import type { ToolDef, ToolContext } from './types.js'
import { prisma } from '../../../app.js'
import { parseAlipayCSV, parseWechatXlsx, parseJdCSV, parseCsvWithMapping } from '../../../routes/import-export.js'
import { applyAccountMappings, matchAccountByName, inferAccount, type ParsedRow } from '../../import/shared.js'
import { refreshAccountBalance } from '../../../routes/account.js'
import fs from 'fs'
import path from 'path'

export const confirmImportTool: ToolDef = {
  name: 'confirm_import',
  description: '确认导入账单数据。传入 fileId、source 和 AI 生成的映射规则，将解析后的流水记录写入数据库。应在 preview_import 返回无未匹配项后调用。',
  requireConfirm: true,
  parameters: {
    type: 'object',
    properties: {
      fileId: { type: 'string', description: '上传文件后获得的 fileId' },
      source: { type: 'string', enum: ['alipay', 'wechat', 'csv', 'jd'], description: '账单来源类型' },
      columnMapping: {
        type: 'object',
        description: 'CSV 来源时的列映射',
      },
      typeMapping: {
        type: 'object',
        description: 'CSV 来源时的类型值映射',
      },
      headerRow: { type: 'number', description: 'CSV 来源时的表头行号（从1开始）' },
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
            payerContains: { type: 'string' },
            descriptionContains: { type: 'string' },
          },
          required: ['sourceCategory', 'targetCategoryCode'],
        },
      },
    },
    required: ['fileId', 'source'],
  },

  async execute(args: any, ctx: ToolContext) {
    const { fileId, source, columnMapping, typeMapping, headerRow, ownerId, accountResolutions, categoryResolutions } = args as {
      fileId: string
      source: 'alipay' | 'wechat' | 'csv' | 'jd'
      columnMapping?: Record<string, string>
      typeMapping?: Record<string, string>
      headerRow?: number
      ownerId?: string
      accountResolutions?: { sourceAccountName: string; action: 'existing' | 'create'; targetAccountId?: string; targetAccountName?: string; accountType?: string }[]
      categoryResolutions?: { sourceCategory: string; targetCategoryCode: string; recordType?: string; payerContains?: string; descriptionContains?: string }[]
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
      if (!columnMapping || !typeMapping) {
        return { success: false, error: 'CSV 来源需要 columnMapping 和 typeMapping 参数', retryable: false }
      }
      parseResult = parseCsvWithMapping(buffer, columnMapping, typeMapping, headerRow)
    }

    if (parseResult.rows.length === 0 && parseResult.errors.length > 0) {
      return { success: false, error: parseResult.errors[0], retryable: false }
    }

    // 应用 AI 分类映射
    if (categoryResolutions && categoryResolutions.length > 0) {
      const aiCategoryMap = new Map<string, typeof categoryResolutions[number]>()
      for (const cr of categoryResolutions) {
        const key = cr.recordType ? `${cr.sourceCategory}::${cr.recordType}` : cr.sourceCategory
        aiCategoryMap.set(key, cr)
      }
      for (const r of parseResult.rows) {
        const keyWithType = `${r.categoryCode}::${r.type}`
        const cr = aiCategoryMap.get(keyWithType) || aiCategoryMap.get(r.categoryCode || '')
        if (cr) {
          if (cr.payerContains && r.payer && !r.payer.includes(cr.payerContains)) continue
          if (cr.descriptionContains && r.remark && !r.remark.includes(cr.descriptionContains)) continue
          r.mappedCategoryCode = cr.targetCategoryCode
        }
      }
    }

    // 构建 AI 账户预映射
    const aiPreMappings = new Map<string, string | null>()
    const newAccountCreations: { sourceAccountName: string; name: string; type: string }[] = []
    if (accountResolutions) {
      for (const ar of accountResolutions) {
        if (ar.action === 'existing' && ar.targetAccountId) {
          aiPreMappings.set(ar.sourceAccountName, ar.targetAccountId)
        } else if (ar.action === 'create' && ar.targetAccountName && ar.accountType) {
          aiPreMappings.set(ar.sourceAccountName, `__new__${ar.targetAccountName}`)
          newAccountCreations.push({ sourceAccountName: ar.sourceAccountName, name: ar.targetAccountName, type: ar.accountType })
        }
      }
    }

    // 应用 DB 账户映射
    const { idMap: accountMappings } = await applyAccountMappings(source, parseResult.rows, ctx.accountBookId)
    for (const [csvName, id] of aiPreMappings) {
      accountMappings.set(csvName, id)
    }

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

    // 构建 accountCreations 和 newAccountMappings
    const accountCreations: { csvName: string; name: string; type: string; bankName?: string; accountNo?: string }[] = []
    const newAccountMappings: { sourceAccountName: string; targetAccountName: string }[] = []

    const createdNames = new Set<string>()
    for (const nac of newAccountCreations) {
      if (createdNames.has(nac.sourceAccountName)) continue
      createdNames.add(nac.sourceAccountName)
      accountCreations.push({
        csvName: nac.sourceAccountName,
        name: nac.name,
        type: nac.type,
      })
      newAccountMappings.push({
        sourceAccountName: nac.sourceAccountName,
        targetAccountName: nac.name,
      })
    }

    // 检查未匹配账户（不在 aiPreMappings 中的）
    const seenAccounts = new Set<string>()
    for (const row of parseResult.rows) {
      if (seenAccounts.has(row.accountName)) continue
      seenAccounts.add(row.accountName)
      if (accountMappings.has(row.accountName)) continue
      if (nameToId.has(row.accountName)) continue
      // 仍有未匹配账户 → 用推断信息创建
      const inferred = inferAccount(row.accountName)
      if (inferred) {
        accountCreations.push({
          csvName: row.accountName,
          name: inferred.defaultName,
          type: inferred.type,
          bankName: inferred.bankName,
          accountNo: inferred.accountNo,
        })
        newAccountMappings.push({
          sourceAccountName: row.accountName,
          targetAccountName: inferred.defaultName,
        })
      }
    }

    // 构建 newMappings
    const newMappings: { sourceCategory: string; targetCategoryCode: string; payerContains?: string; descriptionContains?: string; recordType?: string }[] = []
    if (categoryResolutions) {
      for (const cr of categoryResolutions) {
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
      r.accountId = accountMappings.get(r.accountName) || nameToId.get(r.accountName) || null
      if (r.toAccountName) {
        r.toAccountId = accountMappings.get(r.toAccountName) || nameToId.get(r.toAccountName) || null
      }
    }

    // 导入记录
    const records = normalRecords.map(r => ({
      date: r.date,
      type: r.type as 'INCOME' | 'EXPENSE' | 'TRANSFER',
      amount: r.amount,
      accountId: r.accountId || (accountCreations.find(a => a.csvName === r.accountName)?.name || r.accountName),
      toAccountId: r.toAccountId || undefined,
      categoryCode: r.mappedCategoryCode || r.categoryCode,
      payer: r.payer,
      remark: r.remark,
      tags: r.tags,
    }))

    const accountMap = new Map<string, string>()
    let accountsCreated = 0
    const affectedAccounts = new Set<string>()

    await prisma.$transaction(async (tx) => {
      // 创建新账户
      for (const acct of accountCreations) {
        const existing = await tx.account.findFirst({
          where: { accountBookId: ctx.accountBookId, name: acct.name },
        })
        if (existing) {
          accountMap.set(acct.csvName, existing.id)
          accountMap.set(acct.name, existing.id)
          continue
        }
        accountsCreated++
        const created = await tx.account.create({
          data: {
            accountBookId: ctx.accountBookId,
            ownerId: effectiveOwnerId,
            name: acct.name,
            type: acct.type,
            bankName: acct.bankName || null,
            accountNo: acct.accountNo || null,
            balance: 0,
          },
        })
        accountMap.set(acct.csvName, created.id)
        accountMap.set(acct.name, created.id)
      }

      // 保存分类映射
      for (const m of newMappings) {
        await tx.importCategoryMapping.upsert({
          where: {
            source_sourceCategory_payerContains_descriptionContains_recordType: {
              source,
              sourceCategory: m.sourceCategory,
              payerContains: m.payerContains || '',
              descriptionContains: m.descriptionContains || '',
              recordType: m.recordType || '',
            },
          },
          create: {
            source,
            sourceCategory: m.sourceCategory,
            payerContains: m.payerContains || '',
            descriptionContains: m.descriptionContains || '',
            recordType: m.recordType || '',
            targetCategoryCode: m.targetCategoryCode,
          },
          update: { targetCategoryCode: m.targetCategoryCode },
        })
      }

      // 保存账户映射
      for (const m of newAccountMappings) {
        await tx.importAccountMapping.upsert({
          where: {
            source_sourceAccountName_payerContains_descriptionContains: {
              source,
              sourceAccountName: m.sourceAccountName,
              payerContains: '',
              descriptionContains: '',
            },
          },
          create: {
            source,
            sourceAccountName: m.sourceAccountName,
            payerContains: '',
            descriptionContains: '',
            targetAccountName: m.targetAccountName,
          },
          update: { targetAccountName: m.targetAccountName },
        })
      }

      // 解析账户 ID
      const nameCache = new Map<string, string>()
      const resolveAccountId = async (idOrName: string): Promise<string> => {
        if (accountMap.has(idOrName)) return accountMap.get(idOrName)!
        if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(idOrName)) return idOrName
        if (nameCache.has(idOrName)) return nameCache.get(idOrName)!
        const acc = await tx.account.findFirst({ where: { accountBookId: ctx.accountBookId, name: idOrName } })
        if (acc) {
          nameCache.set(idOrName, acc.id)
          return acc.id
        }
        throw Object.assign(new Error(`账户不存在: ${idOrName}`), { statusCode: 400 })
      }

      // 批量创建记录
      const batchSize = 100
      for (let i = 0; i < records.length; i += batchSize) {
        const batch = records.slice(i, i + batchSize)
        const resolvedAccounts = await Promise.all(batch.map(async r => ({
          accountId: await resolveAccountId(r.accountId),
          toAccountId: r.toAccountId ? await resolveAccountId(r.toAccountId) : null,
        })))

        const createData = batch.map((r, idx) => {
          const accountId = resolvedAccounts[idx].accountId
          const toAccountId = resolvedAccounts[idx].toAccountId
          affectedAccounts.add(accountId)
          if (toAccountId) affectedAccounts.add(toAccountId)

          return {
            accountBookId: ctx.accountBookId,
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
            ownerId: effectiveOwnerId,
          }
        })

        await Promise.all(
          createData.map(d =>
            tx.record.create({ data: d })
          )
        )
      }
    })

    // 刷新账户余额
    for (const accId of affectedAccounts) {
      try {
        await refreshAccountBalance(accId)
      } catch { /* ignore */ }
    }

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

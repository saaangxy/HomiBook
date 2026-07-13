import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { parse } from 'csv-parse/sync'
import iconv from 'iconv-lite'
import crypto from 'crypto'
import fs from 'fs'
import path from 'path'
import { prisma } from '../app.js'
import { authenticate, assertIsMember } from '../middleware/auth.js'
import { zSchema } from '../lib/schema-helpers.js'
import {
  matchAccountByName,
  applyAccountMappings,
  applyCategoryMappings,
  inferAccount,
  type ParsedRow,
} from '../services/import/shared.js'
import {
  createAccountsInTx,
  saveCategoryMappingsInTx,
  saveAccountMappingsInTx,
  AccountResolver,
  batchCreateRecordsInTx,
  refreshBalances,
} from '../services/import/execute.js'
import {
  parseAlipayCSV,
  parseWechatXlsx,
  parseJdCSV,
  parseCsvWithMapping,
  detectHeaderIndex,
  detectEncoding,
} from '../services/import/parsers.js'

// ======================== 账户匹配 & 分类映射 ========================

async function resolveAccounts(bookId: string, rows: ParsedRow[], idMap?: Map<string, string | null>) {
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

  // 加载账本全部活跃账户
  const namesToLookup = Array.from(accountNames).filter(n => !mappedCsvNameToId.has(n))
  const allAccounts = await prisma.account.findMany({
    where: { accountBookId: bookId, status: 'ACTIVE' },
    select: { id: true, name: true },
  })

  // 用包含匹配查找，记录多候选的账户
  const nameToId = new Map<string, string>()
  const nameMatched: Record<string, string> = {}
  const candidatesMap = new Map<string, { id: string; name: string }[]>()
  for (const name of namesToLookup) {
    const result = matchAccountByName(name, allAccounts)
    if (result.matched) {
      nameToId.set(name, result.id)
      nameMatched[name] = result.name
    } else if (result.ambiguous) {
      candidatesMap.set(name, result.candidates)
    }
  }

  // 未匹配的账户（含多候选的）
  const unmatched: { csvName: string; suggestedType: string; suggestedName: string; bankName?: string; accountNo?: string; candidates?: { id: string; name: string }[] }[] = []
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

async function resolveCategories(source: string, rows: ParsedRow[]) {
  return applyCategoryMappings(source, rows)
}

// ======================== 路由 ========================

// ======================== 路由 ========================

const previewSchema = z.object({
  source: z.enum(['alipay', 'wechat', 'csv', 'jd']),
  accountBookId: z.string().min(1),
})

const importConfirmSchema = z.object({
  accountBookId: z.string().min(1),
  source: z.enum(['alipay', 'wechat', 'csv', 'jd']),
  records: z.array(z.object({
    date: z.string(),
    type: z.enum(['INCOME', 'EXPENSE', 'TRANSFER']),
    amount: z.number().positive(),
    accountId: z.string().min(1),
    toAccountId: z.string().optional(),
    categoryCode: z.string().optional().nullable(),
    payer: z.string().optional().nullable(),
    remark: z.string().optional(),
    tags: z.array(z.string()).optional(),
    ownerId: z.string().optional(),
  })).min(1),
  accountCreations: z.array(z.object({
    csvName: z.string(),
    name: z.string().min(1).max(30),
    type: z.string().min(1),
    bankName: z.string().optional(),
    accountNo: z.string().optional(),
  })).optional(),
  newMappings: z.array(z.object({
    sourceCategory: z.string(),
    targetCategoryCode: z.string(),
    payerContains: z.string().optional(),
    descriptionContains: z.string().optional(),
    recordType: z.string().optional(),
  })).optional(),
  newAccountMappings: z.array(z.object({
    sourceAccountName: z.string(),
    targetAccountName: z.string(),
    payerContains: z.string().optional(),
    descriptionContains: z.string().optional(),
  })).optional(),
})

export async function importExportRoutes(app: FastifyInstance) {
  app.addHook('onRequest', authenticate)

  // ===== 临时文件上传（供 AI 导入工具使用） =====
  app.post('/import/upload', {
    schema: {
      description: '上传导入文件到临时存储，返回 fileId 供 preview_import 工具使用',
      tags: ['导入导出'],
      consumes: ['multipart/form-data'],
    },
  }, async (req, reply) => {
    const data = await req.file()
    if (!data) return reply.status(400).send({ message: '缺少文件' })
    const buffer = await data.toBuffer()
    if (buffer.length === 0) return reply.status(400).send({ message: '文件为空' })

    const uploadDir = path.resolve('uploads')
    if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true })

    const fileId = crypto.randomUUID()
    const ext = path.extname(data.filename) || '.tmp'
    const filename = `${fileId}${ext}`
    fs.writeFileSync(path.join(uploadDir, filename), buffer)

    return { fileId, filename: data.filename, size: buffer.length }
  })

  // ===== CSV 文件分析 =====
  app.post('/import/csv/analyze', {
    schema: {
      description: '分析CSV文件，返回表头列名和样本数据',
      tags: ['导入导出'],
      consumes: ['multipart/form-data'],
    },
  }, async (req, reply) => {
    const data = await req.file()
    if (!data) return reply.status(400).send({ message: '缺少文件' })
    const buffer = await data.toBuffer()
    if (buffer.length === 0) return reply.status(400).send({ message: '文件为空' })

    const encoding = detectEncoding(buffer)
    const text = encoding === 'utf8' ? buffer.toString('utf8') : iconv.decode(buffer, 'gbk')

    const fields = data.fields as unknown as Record<string, { value: string }>
    const headerRowRaw = (fields.headerRow?.value || '').trim()

    const rawLines = text.split(/\r?\n/)
    let headerIndex = 0
    let lines: string[]

    if (headerRowRaw) {
      // 用户指定表头行号 — 使用未过滤的原始行号（与 parseCsvWithMapping 一致）
      const hr = parseInt(headerRowRaw, 10)
      if (isNaN(hr) || hr < 1) return reply.status(400).send({ message: '表头行号必须为正整数' })
      if (hr > rawLines.length) return reply.status(400).send({ message: `表头行号 ${hr} 超出文件总行数 ${rawLines.length}` })
      headerIndex = hr - 1
      lines = rawLines
    } else {
      // 自动检测 — 过滤空行后按表头特征评分
      lines = rawLines.filter(l => l.trim())
      if (lines.length === 0) return reply.status(400).send({ message: '文件无数据' })
      headerIndex = detectHeaderIndex(lines)
    }

    const csvContent = lines.slice(headerIndex).join('\n')
    let records: string[][]
    try {
      records = parse(csvContent, {
        columns: true,
        skip_empty_lines: true,
        trim: true,
        relax_column_count: true,
      })
    } catch (e: any) {
      return reply.status(400).send({ message: `CSV解析失败: ${e.message}` })
    }

    if (records.length === 0) return reply.status(400).send({ message: '文件无数据' })

    const headers = Object.keys(records[0] as unknown as Record<string, string>).filter(h => h !== '')
    const sampleRows = records.slice(0, 5).map(r =>
      Object.fromEntries(
        Object.entries(r as unknown as Record<string, string>)
          .map(([k, v]) => [k, v || ('' as string)])
      )
    )

    return { encoding, headers, sampleRows, totalRows: records.length }
  })

  // ===== 预览导入 =====
  app.post('/import/preview', {
    schema: {
      description: '上传CSV文件并预览解析结果',
      tags: ['导入导出'],
      consumes: ['multipart/form-data'],
    },
  }, async (req, reply) => {
    const payload = req.user as { id: string }

    // 读取 multipart 数据
    const data = await req.file()
    if (!data) return reply.status(400).send({ message: '请上传CSV文件' })

    const buffer = await data.toBuffer()
    const fields = data.fields as unknown as Record<string, { value: string }>

    const source = (fields.source?.value || '').trim()
    const accountBookId = (fields.accountBookId?.value || '').trim()

    const parsedQuery = previewSchema.safeParse({ source, accountBookId })
    if (!parsedQuery.success) {
      return reply.status(400).send({ message: '参数无效', details: parsedQuery.error.issues.map(i => `${i.path.join('.')}: ${i.message}`) })
    }

    await assertIsMember(accountBookId, payload.id)

    // 解析 CSV
    let parseResult: { rows: ParsedRow[]; errors: string[] }
    if (source === 'alipay') {
      parseResult = parseAlipayCSV(buffer)
    } else if (source === 'wechat') {
      parseResult = parseWechatXlsx(buffer)
    } else if (source === 'jd') {
      parseResult = parseJdCSV(buffer)
    } else if (source === 'csv') {
      const columnMappingRaw = fields.columnMapping?.value
      const typeMappingRaw = fields.typeMapping?.value
      if (!columnMappingRaw || !typeMappingRaw) {
        return reply.status(400).send({ message: '缺少 columnMapping 或 typeMapping 参数' })
      }
      let columnMapping: Record<string, string>
      let typeMapping: Record<string, string>
      try {
        columnMapping = JSON.parse(columnMappingRaw)
        typeMapping = JSON.parse(typeMappingRaw)
      } catch {
        return reply.status(400).send({ message: 'columnMapping 或 typeMapping JSON 格式错误' })
      }
      if (!columnMapping.date || !columnMapping.amount || !columnMapping.type) {
        return reply.status(400).send({ message: 'columnMapping 必须包含 date, amount, type' })
      }
      const validTypes = ['INCOME', 'EXPENSE', 'TRANSFER']
      for (const v of Object.values(typeMapping)) {
        if (!validTypes.includes(v)) {
          return reply.status(400).send({ message: `typeMapping 包含无效类型: ${v}` })
        }
      }
      const headerRowRaw = (fields.headerRow?.value || '').trim()
      const headerRow = headerRowRaw ? parseInt(headerRowRaw, 10) : undefined
      if (headerRow !== undefined && (isNaN(headerRow) || headerRow < 1)) {
        return reply.status(400).send({ message: '表头行号必须为正整数' })
      }
      parseResult = parseCsvWithMapping(buffer, columnMapping, typeMapping, headerRow)
    } else {
      return reply.status(400).send({ message: '不支持的来源' })
    }

    if (parseResult.rows.length === 0 && parseResult.errors.length > 0) {
      return reply.status(400).send({ message: parseResult.errors[0] })
    }

    // 应用账户映射规则
    const { idMap: accountMappings, nameRecord: accountMappingNames } = await applyAccountMappings(source, parseResult.rows, accountBookId)

    // 匹配账户（传入映射结果）
    const { unmatched: unmatchedAccounts, nameMatched: nameMatchedByContains } = await resolveAccounts(accountBookId, parseResult.rows, accountMappings)

    // 匹配分类
    const { unmatched: unmatchedCategories, allDictItems } = await resolveCategories(source, parseResult.rows)

    // 分离正常记录和无法自动识别的记录
    const normalRecords = parseResult.rows.filter(r => r.type !== 'UNKNOWN')
    const unrecognizedRecords = parseResult.rows.filter(r => r.type === 'UNKNOWN')

    const mapRow = (r: ParsedRow) => ({
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
    })

    return {
      records: normalRecords.map(mapRow),
      unrecognizedRecords: unrecognizedRecords.map(mapRow),
      unmatchedAccounts,
      unmatchedCategories,
      allDictItems,
      accountMappings: { ...nameMatchedByContains, ...accountMappingNames },
      stats: {
        totalRows: parseResult.rows.length + parseResult.errors.length,
        parsedRows: normalRecords.length,
        skippedRows: parseResult.errors.length,
        unrecognizedCount: unrecognizedRecords.length,
        errors: parseResult.errors,
      },
    }
  })

  // ===== 确认导入 =====
  app.post('/import', {
    schema: {
      description: '确认导入流水记录',
      tags: ['导入导出'],
      body: zSchema(importConfirmSchema),
    },
  }, async (req, reply) => {
    const payload = req.user as { id: string }
    const parsed = importConfirmSchema.safeParse(req.body)
    if (!parsed.success) {
      return reply.status(400).send({ message: '请求参数无效' })
    }

    const { accountBookId, source, records, accountCreations = [], newMappings = [], newAccountMappings = [] } = parsed.data

    await assertIsMember(accountBookId, payload.id)

    const { accountMap, accountsCreated, affectedAccounts } = await prisma.$transaction(async (tx) => {
      const { accountMap, accountsCreated } = await createAccountsInTx(tx, accountBookId, payload.id, accountCreations)
      await saveCategoryMappingsInTx(tx, source, newMappings)
      await saveAccountMappingsInTx(tx, source, newAccountMappings)
      const resolver = new AccountResolver(tx, accountMap, accountBookId)
      const affectedAccounts = await batchCreateRecordsInTx(tx, accountBookId, payload.id, records, idOrName => resolver.resolve(idOrName))
      return { accountMap, accountsCreated, affectedAccounts }
    })

    await refreshBalances(affectedAccounts)

    return {
      imported: records.length,
      accountsCreated,
      newAccountIds: Object.fromEntries(accountMap),
    }
  })

  // ===== 分类映射 CRUD =====
  app.get('/import/mappings', {
    schema: {
      description: '获取导入分类映射列表',
      tags: ['导入导出'],
      response: {
        200: {
          type: 'object',
          description: '分类映射列表',
          properties: {
            mappings: {
              type: 'array',
              description: '分类映射列表',
              items: {
                type: 'object',
                properties: {
                  id: { type: 'string', description: '映射ID' },
                  source: { type: 'string', description: '来源' },
                  sourceCategory: { type: 'string', description: '源分类名' },
                  payerContains: { type: 'string', description: '交易方匹配条件' },
                  descriptionContains: { type: 'string', description: '描述匹配条件' },
                  recordType: { type: 'string', description: '记录类型匹配条件' },
                  targetCategoryCode: { type: 'string', description: '目标分类编码' },
                  createdAt: { type: 'string', description: '创建时间' },
                  updatedAt: { type: 'string', description: '更新时间' },
                },
              },
            },
          },
        },
      },
    },
  }, async (req) => {
    const { source } = req.query as { source?: string }
    const where = source ? { source } : {}
    const mappings = await prisma.importCategoryMapping.findMany({
      where,
      orderBy: { createdAt: 'desc' },
    })
    return { mappings }
  })

  app.post('/import/mappings', {
    schema: {
      description: '批量保存导入分类映射',
      tags: ['导入导出'],
    },
  }, async (req, reply) => {
    const body = req.body as { mappings: { source: string; sourceCategory: string; payerContains?: string; descriptionContains?: string; recordType?: string; targetCategoryCode: string }[] }
    if (!body.mappings || !Array.isArray(body.mappings)) {
      return reply.status(400).send({ message: '参数无效' })
    }

    for (const m of body.mappings) {
      const payerContains = m.payerContains || ''
      const descriptionContains = m.descriptionContains || ''
      await prisma.importCategoryMapping.upsert({
        where: {
          source_sourceCategory_payerContains_descriptionContains_recordType: {
            source: m.source,
            sourceCategory: m.sourceCategory,
            payerContains,
            descriptionContains,
            recordType: m.recordType || '',
          },
        },
        create: { source: m.source, sourceCategory: m.sourceCategory, payerContains, descriptionContains, recordType: m.recordType || '', targetCategoryCode: m.targetCategoryCode },
        update: { targetCategoryCode: m.targetCategoryCode },
      })
    }

    return { success: true }
  })

  app.delete('/import/mappings/:id', {
    schema: {
      description: '删除导入分类映射',
      tags: ['导入导出'],
    },
  }, async (req) => {
    const { id } = req.params as { id: string }
    await prisma.importCategoryMapping.delete({ where: { id } })
    return { success: true }
  })

  // ===== 账户映射 CRUD =====
  app.get('/import/account-mappings', {
    schema: {
      description: '获取导入账户映射列表',
      tags: ['导入导出'],
      response: {
        200: {
          type: 'object',
          description: '账户映射列表',
          properties: {
            mappings: {
              type: 'array',
              description: '账户映射列表',
              items: {
                type: 'object',
                properties: {
                  id: { type: 'string', description: '映射ID' },
                  source: { type: 'string', description: '来源' },
                  sourceAccountName: { type: 'string', description: '源账户名' },
                  payerContains: { type: 'string', description: '交易方匹配条件' },
                  descriptionContains: { type: 'string', description: '描述匹配条件' },
                  targetAccountName: { type: 'string', description: '目标账户名' },
                  createdAt: { type: 'string', description: '创建时间' },
                  updatedAt: { type: 'string', description: '更新时间' },
                },
              },
            },
          },
        },
      },
    },
  }, async (req) => {
    const { source } = req.query as { source?: string }
    const where = source ? { source } : {}
    const mappings = await prisma.importAccountMapping.findMany({
      where,
      orderBy: { createdAt: 'desc' },
    })
    return { mappings }
  })

  app.post('/import/account-mappings', {
    schema: {
      description: '批量保存导入账户映射',
      tags: ['导入导出'],
    },
  }, async (req, reply) => {
    const body = req.body as { mappings: { source: string; sourceAccountName: string; payerContains?: string; descriptionContains?: string; targetAccountName: string }[] }
    if (!body.mappings || !Array.isArray(body.mappings)) {
      return reply.status(400).send({ message: '参数无效' })
    }

    for (const m of body.mappings) {
      const payerContains = m.payerContains || ''
      const descriptionContains = m.descriptionContains || ''
      await prisma.importAccountMapping.upsert({
        where: {
          source_sourceAccountName_payerContains_descriptionContains: {
            source: m.source,
            sourceAccountName: m.sourceAccountName,
            payerContains,
            descriptionContains,
          },
        },
        create: { source: m.source, sourceAccountName: m.sourceAccountName, payerContains, descriptionContains, targetAccountName: m.targetAccountName },
        update: { targetAccountName: m.targetAccountName },
      })
    }

    return { success: true }
  })

  app.delete('/import/account-mappings/:id', {
    schema: {
      description: '删除导入账户映射',
      tags: ['导入导出'],
    },
  }, async (req) => {
    const { id } = req.params as { id: string }
    await prisma.importAccountMapping.delete({ where: { id } })
    return { success: true }
  })

  // ===== 导出 CSV =====
  app.get('/export', {
    schema: {
      description: '导出流水记录为CSV文件',
      tags: ['导入导出'],
      response: {
        200: { type: 'string' },
      },
    },
  }, async (req, reply) => {
    const payload = req.user as { id: string }
    const query = req.query as Record<string, string>
    const bookId = query.bookId

    if (!bookId) return reply.status(400).send({ message: '缺少bookId参数' })
    await assertIsMember(bookId, payload.id)

    // 构建查询条件
    const where: any = { accountBookId: bookId }
    if (query.type) {
      where.type = { in: query.type.split(',') }
    }
    if (query.accountId) {
      where.accountId = { in: query.accountId.split(',') }
    }
    if (query.categoryCode) {
      where.categoryCode = { in: query.categoryCode.split(',') }
    }
    if (query.dateFrom || query.dateTo) {
      where.date = {}
      if (query.dateFrom) where.date.gte = new Date(query.dateFrom)
      if (query.dateTo) where.date.lte = new Date(query.dateTo)
    }

    const records = await prisma.record.findMany({
      where,
      orderBy: { date: 'desc' },
      include: {
        account: { select: { name: true } },
        fromAccount: { select: { name: true } },
        toAccount: { select: { name: true } },
        owner: { select: { nickname: true, email: true } },
      },
      take: 10000,
    })

    // 构建 CSV
    const typeLabels: Record<string, string> = { INCOME: '收入', EXPENSE: '支出', TRANSFER: '转账' }
    const header = '日期,类型,金额,账户,转账来源,转账目标,分类,交易方,备注,归属人,标签'
    const csvRows = records.map(r => {
      const tags = JSON.parse(r.tags || '[]') as string[]
      const owner = r.owner.nickname || r.owner.email
      return [
        r.date.toISOString().slice(0, 10),
        typeLabels[r.type] || r.type,
        String(r.amount),
        r.account?.name || '',
        r.fromAccount?.name || '',
        r.toAccount?.name || '',
        r.categoryCode || '',
        r.payer || '',
        (r.remark || '').replace(/,/g, '，'),
        owner,
        tags.join('、'),
      ].map(f => f.includes(',') || f.includes('"') ? `"${f.replace(/"/g, '""')}"` : f).join(',')
    })

    const csv = [header, ...csvRows].join('\n')
    const filename = `records_export_${new Date().toISOString().slice(0, 10)}.csv`

    reply.header('Content-Type', 'text/csv; charset=utf-8')
    reply.header('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`)
    return reply.send('\uFEFF' + csv) // BOM for Excel
  })
}

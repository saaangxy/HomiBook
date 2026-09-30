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
import { dateKey } from '../lib/date-time.js'
import type { ParsedRow } from '../services/import/shared.js'
import { toImportPreviewRow } from '../services/import/pipeline.js'
import { buildValidAccountRefs, CATEGORY_DICT_GROUPS, validateImportRecords } from '../services/import/blocking.js'
import { remapImportRows } from '../services/import/remap.js'
import { loadImportFile, parseImportFile } from '../services/import/attachment-file.js'
import { normalizeAccountMappings, normalizeCategoryMappings, normalizeCondition } from '../services/import/mapping-normalize.js'
import { ACCOUNT_TYPES, IMPORT_SOURCES, RECORD_TYPES, RECORD_TYPE_LABELS } from '@homibook/core'
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
  detectBillSource,
} from '../services/import/parsers.js'

// ======================== 路由 ========================

const previewSchema = z.object({
  source: z.enum(IMPORT_SOURCES),
  accountBookId: z.string().min(1),
})

/**
 * 预览(第二步)可选的决议入参:multipart 字段是字符串,数组需 JSON.parse。
 * 与 AI 链路保持同形(existing/create 的账户决议、条件化分类决议、未识别行处置)。
 */
function parseRemapFields(fields: Record<string, { value: string } | undefined>) {
  const out: {
    ownerId?: string
    confirmSkipUnrecognized?: boolean
    accountResolutions?: any[]
    categoryResolutions?: any[]
    unrecognizedResolutions?: any[]
  } = {}

  for (const key of ['accountResolutions', 'categoryResolutions', 'unrecognizedResolutions'] as const) {
    const raw = fields[key]?.value
    if (!raw) continue
    try {
      const parsed = JSON.parse(raw)
      if (!Array.isArray(parsed)) return { error: `${key} 必须是数组` }
      out[key] = parsed
    } catch {
      return { error: `${key} JSON 格式错误` }
    }
  }

  const ownerId = (fields.ownerId?.value || '').trim()
  if (ownerId) out.ownerId = ownerId
  // 是否已同意跳过未处置的未识别行:第二步的服务端裁决需要它
  if (fields.confirmSkipUnrecognized?.value === 'true') out.confirmSkipUnrecognized = true
  return { data: out }
}

/** 严格导入校验开关:默认开启;`STRICT_IMPORT_VALIDATION=false` 回退为只阻断必然失败的项 */
const STRICT_IMPORT_VALIDATION = process.env.STRICT_IMPORT_VALIDATION !== 'false'

const importConfirmSchema = z.object({
  accountBookId: z.string().min(1),
  source: z.enum(IMPORT_SOURCES),
  records: z.array(z.object({
    date: z.string(),
    type: z.enum(RECORD_TYPES),
    amount: z.number().positive(),
    accountId: z.string().min(1),
    toAccountId: z.string().optional(),
    categoryCode: z.string().optional().nullable(),
    payer: z.string().optional().nullable(),
    remark: z.string().optional(),
    tags: z.array(z.string()).optional(),
    ownerId: z.string().optional(),
    /** 原始行号(预览行携带;用于把阻断项指回具体行) */
    rowIndex: z.number().optional(),
  })).min(1),
  /** 客户端跳过的未识别行数;>0 时必须显式确认 */
  skippedUnrecognized: z.number().int().min(0).optional(),
  confirmSkipUnrecognized: z.boolean().optional(),
  accountCreations: z.array(z.object({
    csvName: z.string(),
    name: z.string().min(1).max(30),
    type: z.enum(ACCOUNT_TYPES),
    bankName: z.string().optional(),
    accountNo: z.string().optional(),
    ownerId: z.string().optional(),
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

  // ===== 导入账单上传（供 AI 导入工具使用） =====
  // 与 /records/upload 一样产出**附件**(RecordAttachment):AI 侧只认 attachmentId,不再有 fileId。
  // 磁盘名与 attachmentId 是两个 uuid,解析一律经 RecordAttachment.path(见 services/import/attachment-file.ts)。
  app.post('/import/upload', {
    schema: {
      description: '上传导入账单文件，落为附件并返回 attachmentId 供 preview_import / confirm_import 使用',
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

    const ext = path.extname(data.filename) || '.tmp'
    const diskName = `${crypto.randomUUID()}${ext}`
    fs.writeFileSync(path.join(uploadDir, diskName), buffer)

    const attachment = await prisma.recordAttachment.create({
      data: { path: `/api/uploads/${diskName}`, originalFilename: data.filename },
    })

    // detectedSource 与 preview_import 的自动识别用同一函数(detectBillSource),调用方可据此提示用户
    return {
      attachmentId: attachment.id,
      url: `/api/uploads/${diskName}`,
      filename: data.filename,
      size: buffer.length,
      detectedSource: detectBillSource(buffer, data.filename),
    }
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

    // C 项:第二步可以带上当前决议(账户/分类/未识别行处置)与归属人,由服务端统一重映射
    const remapFields = parseRemapFields(fields)
    if ('error' in remapFields) {
      return reply.status(400).send({ message: remapFields.error })
    }

    const remapped = await remapImportRows({
      source,
      rows: parseResult.rows,
      accountBookId,
      ownerId: remapFields.data.ownerId || payload.id,
      confirmSkipUnrecognized: remapFields.data.confirmSkipUnrecognized,
      accountResolutions: remapFields.data.accountResolutions,
      categoryResolutions: remapFields.data.categoryResolutions,
      unrecognizedResolutions: remapFields.data.unrecognizedResolutions,
    })

    // 分离正常记录和无法自动识别的记录
    const normalRecords = parseResult.rows.filter(r => r.type !== 'UNKNOWN')

    // 预览行形状与短信预览统一(见 services/import/pipeline.ts)
    const mapRow = toImportPreviewRow

    return {
      records: normalRecords.map(mapRow),
      unrecognizedRecords: remapped.unrecognizedRecords.map(mapRow),
      unmatchedAccounts: remapped.unmatchedAccounts,
      unmatchedCategories: remapped.unmatchedCategories,
      allDictItems: remapped.allDictItems,
      accountMappings: remapped.nameMatched,
      // 将新建的账户:create 决议覆盖的源账户已从 unmatchedAccounts 剔除,这里单独回报
      toCreate: remapped.toCreate,
      // 阻断项与「会被跳过」计数:让"必然失败/写脏"在预览阶段就显性化(客户端据此禁用确认)
      blocking: remapped.blocking,
      skipped: { unrecognized: remapped.unresolved.unrecognized.length },
      // C 项:实际会写入的流水 + 未决清单 + 进度计数(第二步据此校验"零残留")
      finalRecords: remapped.finalRows.map(mapRow),
      unresolved: remapped.unresolved,
      counts: remapped.counts,
      // 服务端唯一裁决:客户端直接采用(不再自行判定口径)
      canProceed: remapped.canProceed,
      blockReasons: remapped.blockReasons,
      stats: {
        totalRows: parseResult.rows.length + parseResult.errors.length,
        parsedRows: normalRecords.length,
        skippedRows: parseResult.errors.length,
        unrecognizedCount: remapped.unrecognizedRecords.length,
        errors: parseResult.errors,
      },
    }
  })

  // ===== 校验(不执行导入) =====

  /**
   * AI 卡片用:按当前决议做与 /preview 同一套服务端裁决,但**不执行导入**。
   * 与手动向导的「下一步」同口径 —— 未通过就停在卡片上让用户处理或勾选「同意跳过」。
   */
  const importCheckSchema = z.object({
    accountBookId: z.string().min(1),
    attachmentId: z.string().min(1),
    ownerId: z.string().optional(),
    confirmSkipUnrecognized: z.boolean().optional(),
    accountResolutions: z.array(z.any()).optional(),
    categoryResolutions: z.array(z.any()).optional(),
    unrecognizedResolutions: z.array(z.any()).optional(),
  })

  app.post('/import/check', {
    schema: {
      description: '按当前决议校验导入可行性(不执行导入)',
      tags: ['导入导出'],
      body: zSchema(importCheckSchema),
    },
  }, async (req, reply) => {
    const payload = req.user as { id: string }
    const parsed = importCheckSchema.safeParse(req.body)
    if (!parsed.success) return reply.status(400).send({ message: '请求参数无效' })
    const body = parsed.data

    await assertIsMember(body.accountBookId, payload.id)

    const file = await loadImportFile(body.attachmentId)
    if (!file) return reply.status(404).send({ message: '账单文件不存在或已过期' })
    const fileParsed = parseImportFile(file, undefined)
    if (!fileParsed.ok) return reply.status(400).send({ message: fileParsed.error })

    const remapped = await remapImportRows({
      source: fileParsed.source,
      rows: fileParsed.rows,
      accountBookId: body.accountBookId,
      ownerId: body.ownerId || payload.id,
      confirmSkipUnrecognized: body.confirmSkipUnrecognized,
      accountResolutions: body.accountResolutions,
      categoryResolutions: body.categoryResolutions,
      unrecognizedResolutions: body.unrecognizedResolutions,
    })

    return {
      canProceed: remapped.canProceed,
      blockReasons: remapped.blockReasons,
      counts: remapped.counts,
      finalCount: remapped.finalRows.length,
      skippedUnrecognized: remapped.unresolved.unrecognized.length,
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

    const {
      accountBookId,
      source,
      records,
      accountCreations = [],
      newMappings = [],
      newAccountMappings = [],
      skippedUnrecognized = 0,
      confirmSkipUnrecognized,
    } = parsed.data

    await assertIsMember(accountBookId, payload.id)

    // ---- 前置校验:把"必然失败/会写脏"的项挡在事务外,并回传 blocking 明细 ----
    if (skippedUnrecognized > 0 && !confirmSkipUnrecognized) {
      return reply.status(400).send({
        message: `有 ${skippedUnrecognized} 条未识别记录将被跳过，请确认后再导入`,
        blocking: [{ kind: 'unrecognized', ref: '', reason: '未识别记录未确认跳过', willFailAtImport: true }],
      })
    }

    const [bookAccounts, dictItems] = await Promise.all([
      prisma.account.findMany({ where: { accountBookId, status: 'ACTIVE' }, select: { id: true } }),
      prisma.dictionary.findMany({ where: { group: { in: CATEGORY_DICT_GROUPS } }, select: { code: true } }),
    ])
    // 本次将创建的账户也算「合法引用」:账户在事务内才创建,而校验发生在事务外
    const validAccountRefs = buildValidAccountRefs(
      bookAccounts.map(a => a.id),
      accountCreations,
    )
    const blocking = validateImportRecords({
      records,
      validAccountIds: validAccountRefs,
      validCategoryCodes: new Set(dictItems.map(d => d.code)),
      strict: STRICT_IMPORT_VALIDATION,
    })
    if (blocking.length > 0) {
      return reply.status(400).send({ message: blocking[0].reason, blocking })
    }

    const { accountMap, accountsCreated, affectedAccounts, createdIds } = await prisma.$transaction(async (tx) => {
      const { accountMap, accountsCreated } = await createAccountsInTx(tx, accountBookId, payload.id, accountCreations)
      await saveCategoryMappingsInTx(tx, source, newMappings)
      await saveAccountMappingsInTx(tx, source, newAccountMappings)
      const resolver = new AccountResolver(tx, accountMap, accountBookId)
      const { affectedAccounts, createdIds } = await batchCreateRecordsInTx(tx, accountBookId, payload.id, records, idOrName => resolver.resolve(idOrName))
      return { accountMap, accountsCreated, affectedAccounts, createdIds }
    })

    await refreshBalances(affectedAccounts)

    return {
      imported: records.length,
      accountsCreated,
      newAccountIds: Object.fromEntries(accountMap),
      // 创建出的流水 id:客户端用于「撤销最近一次自动记账」等场景
      ids: createdIds,
    }
  })

  /** 清理目标分类不在字典中的分类映射(脏规则):早期 AI 会把源分类名直接当编码写进来 */
  app.post('/import/mappings/cleanup', {
    schema: {
      description: '清理目标分类不在字典中的导入分类映射',
      tags: ['导入导出'],
    },
  }, async () => {
    const dictItems = await prisma.dictionary.findMany({
      where: { group: { in: [...CATEGORY_DICT_GROUPS] } },
      select: { code: true },
    })
    const validCodes = new Set(dictItems.map(d => d.code))
    const all = await prisma.importCategoryMapping.findMany({ select: { id: true, sourceCategory: true, targetCategoryCode: true } })
    // 无效 = 目标分类不在字典中,或源分类与目标分类同名(等于没映射)
    const invalidIds = all.filter(m => {
      const src = m.sourceCategory.trim()
      return !validCodes.has(m.targetCategoryCode) || (!!src && src === m.targetCategoryCode.trim())
    }).map(m => m.id)
    if (invalidIds.length > 0) {
      await prisma.importCategoryMapping.deleteMany({ where: { id: { in: invalidIds } } })
    }
    return { removed: invalidIds.length }
  })

  // ===== 分类映射 CRUD =====
  app.get('/import/mappings', {
    schema: {
      description: '获取导入分类映射列表',
      tags: ['导入导出'],
    },
    config: {
      swaggerResponse: {
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
    // 标记无效规则:设置页据此标红 + 提供一键清理
    // 无效的两种情形:① 目标分类不在字典中;② 源分类与目标分类同名(等于没映射)
    const dictItems = await prisma.dictionary.findMany({
      where: { group: { in: [...CATEGORY_DICT_GROUPS] } },
      select: { code: true },
    })
    const validCodes = new Set(dictItems.map(d => d.code))
    return {
      mappings: mappings.map(m => {
        const src = m.sourceCategory.trim()
        const reason = !validCodes.has(m.targetCategoryCode)
          ? '目标分类不在字典中'
          : (src && src === m.targetCategoryCode.trim())
            ? '源分类与目标分类同名（等于未映射）'
            : undefined
        return { ...m, invalidReason: reason }
      }),
    }
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

    for (const raw of body.mappings) {
      // 归一化条件后再落库(H 项):避免"看起来不同、实际等价"的条件写成两条规则
      const [m] = normalizeCategoryMappings([raw])
      await prisma.importCategoryMapping.upsert({
        where: {
          source_sourceCategory_payerContains_descriptionContains_recordType: {
            source: raw.source,
            sourceCategory: m.sourceCategory,
            payerContains: m.payerContains,
            descriptionContains: m.descriptionContains,
            recordType: m.recordType,
          },
        },
        create: {
          source: raw.source,
          sourceCategory: m.sourceCategory,
          payerContains: m.payerContains,
          descriptionContains: m.descriptionContains,
          recordType: m.recordType,
          targetCategoryCode: m.targetCategoryCode,
        },
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

  // ===== 规则体检:列出等价重复规则 =====
  // 唯一键含条件字段,历史数据里可能存在"条件只是空格/全角不同"的等价重复 —— 归一化后同键即为一组。
  app.get('/import/mappings/duplicates', {
    schema: {
      description: '列出等价的重复导入映射规则(按归一化后的唯一键分组)',
      tags: ['导入导出'],
    },
  }, async (req) => {
    const kind = ((req.query as { kind?: string }).kind ?? 'category')

    if (kind === 'account') {
      const rows = await prisma.importAccountMapping.findMany({ orderBy: { createdAt: 'asc' } })
      const groups = new Map<string, typeof rows>()
      for (const m of rows) {
        const key = [m.source, m.sourceAccountName, normalizeCondition(m.payerContains), normalizeCondition(m.descriptionContains)].join('\u0000')
        const list = groups.get(key)
        if (list) list.push(m)
        else groups.set(key, [m])
      }
      return {
        kind,
        groups: Array.from(groups.entries())
          .filter(([, items]) => items.length > 1)
          .map(([, items]) => ({ ids: items.map(i => i.id), items })),
      }
    }

    const rows = await prisma.importCategoryMapping.findMany({ orderBy: { createdAt: 'asc' } })
    const groups = new Map<string, typeof rows>()
    for (const m of rows) {
      const key = [m.source, m.sourceCategory, normalizeCondition(m.payerContains), normalizeCondition(m.descriptionContains), m.recordType].join('\u0000')
      const list = groups.get(key)
      if (list) list.push(m)
      else groups.set(key, [m])
    }
    return {
      kind,
      groups: Array.from(groups.entries())
        .filter(([, items]) => items.length > 1)
        .map(([, items]) => ({ ids: items.map(i => i.id), items })),
    }
  })

  // ===== 规则体检:合并重复规则 =====
  app.post('/import/mappings/merge', {
    schema: {
      description: '合并同一组重复的导入映射规则(保留一条,删除其余)',
      tags: ['导入导出'],
    },
  }, async (req, reply) => {
    const body = req.body as { kind?: 'category' | 'account'; ids?: string[]; strategy?: 'keep-first' | 'keep-target'; target?: string }
    const ids = body.ids ?? []
    if (!body.kind || ids.length < 2) {
      return reply.status(400).send({ message: '至少选择两条同组规则' })
    }
    const strategy = body.strategy ?? 'keep-first'

    if (body.kind === 'category') {
      const rows = await prisma.importCategoryMapping.findMany({ where: { id: { in: ids } }, orderBy: { createdAt: 'asc' } })
      if (rows.length < 2) return reply.status(400).send({ message: '规则不存在' })
      const keeper = strategy === 'keep-target' && body.target
        ? (rows.find(r => r.targetCategoryCode === body.target) ?? rows[0])
        : (strategy === 'keep-first' ? rows[0] : rows[rows.length - 1])
      const targetCategoryCode = strategy === 'keep-target' && body.target ? body.target : keeper.targetCategoryCode
      const removed = rows.filter(r => r.id !== keeper.id).map(r => r.id)
      await prisma.$transaction([
        prisma.importCategoryMapping.update({ where: { id: keeper.id }, data: { targetCategoryCode } }),
        prisma.importCategoryMapping.deleteMany({ where: { id: { in: removed } } }),
      ])
      return { keptId: keeper.id, merged: removed.length }
    }

    const rows = await prisma.importAccountMapping.findMany({ where: { id: { in: ids } }, orderBy: { createdAt: 'asc' } })
    if (rows.length < 2) return reply.status(400).send({ message: '规则不存在' })
    const keeper = strategy === 'keep-target' && body.target
      ? (rows.find(r => r.targetAccountName === body.target) ?? rows[0])
      : (strategy === 'keep-first' ? rows[0] : rows[rows.length - 1])
    const targetAccountName = strategy === 'keep-target' && body.target ? body.target : keeper.targetAccountName
    const removed = rows.filter(r => r.id !== keeper.id).map(r => r.id)
    await prisma.$transaction([
      prisma.importAccountMapping.update({ where: { id: keeper.id }, data: { targetAccountName } }),
      prisma.importAccountMapping.deleteMany({ where: { id: { in: removed } } }),
    ])
    return { keptId: keeper.id, merged: removed.length }
  })

  // ===== 账户映射 CRUD =====
  app.get('/import/account-mappings', {
    schema: {
      description: '获取导入账户映射列表',
      tags: ['导入导出'],
    },
    config: {
      swaggerResponse: {
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

    for (const raw of body.mappings) {
      // 归一化条件后再落库(H 项):与导入路径共用同一口径
      const [m] = normalizeAccountMappings([raw])
      await prisma.importAccountMapping.upsert({
        where: {
          source_sourceAccountName_payerContains_descriptionContains: {
            source: raw.source,
            sourceAccountName: m.sourceAccountName,
            payerContains: m.payerContains,
            descriptionContains: m.descriptionContains,
          },
        },
        create: {
          source: raw.source,
          sourceAccountName: m.sourceAccountName,
          payerContains: m.payerContains,
          descriptionContains: m.descriptionContains,
          targetAccountName: m.targetAccountName,
        },
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
        toAccount: { select: { name: true } },
        owner: { select: { nickname: true, email: true } },
      },
      take: 10000,
    })

    // 构建 CSV(列名与系统字段/导入列映射一致;转账来源恒等于账户故不导出)
    const typeLabels = RECORD_TYPE_LABELS as Record<string, string>
    const header = '日期,类型,金额,账户,转账目标,分类,交易方,备注,归属人,标签'
    const csvRows = records.map(r => {
      const tags = JSON.parse(r.tags || '[]') as string[]
      const owner = r.owner.nickname || r.owner.email
      return [
        dateKey(r.date),
        typeLabels[r.type] || r.type,
        String(r.amount),
        r.account?.name || '',
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

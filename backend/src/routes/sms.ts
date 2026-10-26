// 短信记账路由(仅 Android 客户端使用)。
// 移动端在本机完成采集 + 预筛 + 字段提取,这里只做「结构化候选 → 解析后公共管线」的预览;
// 确认入账复用通用的 POST /api/records/import(客户端提交已定型的 records/creations/mappings)。
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { authenticate, assertIsMember } from '../middleware/auth.js'
import { zSchema } from '../lib/schema-helpers.js'
import { applyAccountMappings, type ParsedRow } from '../services/import/shared.js'
import {
  existingRecordKey,
  findExistingRecordKeys,
  resolveImportAccounts,
  resolveImportCategories,
  toImportPreviewRow,
} from '../services/import/pipeline.js'
import { smsCandidatesToRows } from '../services/import/sms.js'
import { remapImportRows } from '../services/import/remap.js'
import { extractSmsItems } from '../services/ai/sms-extract.js'
import { SMS_AI_MAX_ITEMS, SMS_CANDIDATE_MAX, SMS_IMPORT_SOURCE } from '@homibook/core'

/** 单条候选:字段与 core SmsTransactionCandidate 对齐(见 packages/core/src/sms-parse.ts) */
const candidateSchema = z.object({
  sourceId: z.string().optional(),
  date: z.string().min(1),
  type: z.string().min(1),
  amount: z.number(),
  payer: z.string().nullish(),
  remark: z.string().nullish(),
  tradeKind: z.string().nullish(),
  bankName: z.string().nullish(),
  cardTail: z.string().nullish(),
  accountName: z.string().nullish(),
  /** 客户端确认卡的行号:只提交部分行时靠它对齐 unrecognizedResolutions */
  rowIndex: z.number().optional(),
})

const previewSchema = z.object({
  accountBookId: z.string().min(1),
  // 上限防超长请求:与客户端读取上限同源(core 的 SMS_FETCH_MAX + AI 兜底余量)。
  // 移动端时间区间可放到 3000 天以上、候选上千条,写死 500 会把长时间扫描的预览直接挡掉
  candidates: z.array(candidateSchema).min(1).max(SMS_CANDIDATE_MAX),
})

/** 决议(与 /records/import 的 resolutions 同形,供 /sms/check 复核) */
const resolutionSchema = z.object({
  ownerId: z.string().nullish(),
  accountResolutions: z.array(z.object({
    sourceAccountName: z.string(),
    action: z.enum(['create', 'existing']),
    targetAccountId: z.string().nullish(),
    targetAccountName: z.string().nullish(),
    accountType: z.string().nullish(),
  })).optional(),
  categoryResolutions: z.array(z.object({
    sourceCategory: z.string(),
    targetCategoryCode: z.string(),
    recordType: z.string().nullish(),
    payerContains: z.string().nullish(),
    descriptionContains: z.string().nullish(),
  })).optional(),
  unrecognizedResolutions: z.array(z.object({
    rowIndex: z.number(),
    type: z.string().nullish(),
    accountId: z.string().nullish(),
    toAccountId: z.string().nullish(),
    categoryCode: z.string().nullish(),
  })).optional(),
  confirmSkipUnrecognized: z.boolean().optional(),
})

const checkSchema = z.object({
  accountBookId: z.string().min(1),
  candidates: z.array(candidateSchema).min(1).max(SMS_CANDIDATE_MAX),
  resolutions: resolutionSchema.optional(),
})

/** AI 兜底解析:送解析的一条原文(仅未命中本地规则的内容才会送到这里) */
const extractItemSchema = z.object({
  sourceId: z.string().min(1),
  // 单条正文上限:超长内容对字段抽取无增益,只烧 token
  text: z.string().min(1).max(2000),
  sender: z.string().nullish(),
  receivedAt: z.string().min(1),
  channel: z.enum(['sms', 'notification']),
})

const extractSchema = z.object({
  accountBookId: z.string().min(1),
  items: z.array(extractItemSchema).min(1).max(SMS_AI_MAX_ITEMS),
})

export async function smsRoutes(app: FastifyInstance) {
  app.addHook('onRequest', authenticate)

  // ===== 短信候选预览(无文件、无 LLM:直接进解析后管线) =====
  app.post('/preview', {
    schema: {
      description: '短信记账:结构化候选预览(账户匹配 + 分类映射)',
      tags: ['短信记账'],
      body: zSchema(previewSchema),
    },
  }, async (req, reply) => {
    const payload = req.user as { id: string }
    const parsed = previewSchema.safeParse(req.body)
    if (!parsed.success) {
      return reply.status(400).send({
        message: '请求参数无效',
        details: parsed.error.issues.map(i => `${i.path.join('.')}: ${i.message}`),
      })
    }

    const { accountBookId, candidates } = parsed.data
    await assertIsMember(accountBookId, payload.id)

    const { rows, errors } = smsCandidatesToRows(candidates)
    if (rows.length === 0) {
      return reply.status(400).send({ message: errors[0] ?? '没有可导入的短信交易' })
    }

    // 与文件导入完全同一条「解析后」管线(services/import/pipeline.ts)
    const { idMap: accountMappings, nameRecord: accountMappingNames } = await applyAccountMappings(
      SMS_IMPORT_SOURCE, rows, accountBookId, undefined, payload.id,
    )
    const { unmatched: unmatchedAccounts, nameMatched: nameMatchedByContains } = await resolveImportAccounts(
      accountBookId, rows, accountMappings, payload.id,
    )
    const { unmatched: unmatchedCategories, allDictItems } = await resolveImportCategories(SMS_IMPORT_SOURCE, rows)

    const normalRecords = rows.filter(r => r.type !== 'UNKNOWN')
    const unrecognizedRecords = rows.filter(r => r.type === 'UNKNOWN')

    // 第三层弱校验:同账户 + 同日 + 同金额 + 同方向已存在 → 标记疑似重复。
    // 只做提示(前端默认不勾选),不硬拦 —— 同日同额两笔是真实存在的。
    const existingKeys = await findExistingRecordKeys(accountBookId, rows)
    const isPossibleDuplicate = (r: ParsedRow) =>
      !!r.accountId && existingKeys.has(existingRecordKey(r.accountId, r.date, r.amount, r.type))
    const withDupFlag = (r: ParsedRow) => ({
      ...toImportPreviewRow(r),
      ...(isPossibleDuplicate(r) ? { possibleDuplicate: true } : {}),
    })

    // 响应形状与 /api/records/import/preview 一致 → 移动端复用同一套类型与确认卡
    return {
      source: SMS_IMPORT_SOURCE,
      records: normalRecords.map(withDupFlag),
      unrecognizedRecords: unrecognizedRecords.map(withDupFlag),
      unmatchedAccounts,
      unmatchedCategories,
      allDictItems,
      accountMappings: { ...nameMatchedByContains, ...accountMappingNames },
      stats: {
        totalRows: candidates.length,
        parsedRows: normalRecords.length,
        skippedRows: errors.length,
        unrecognizedCount: unrecognizedRecords.length,
        errors,
      },
    }
  })

  // ===== 决议复核(服务端唯一裁决) =====
  /**
   * 短信路径没有上传文件,无法调 /records/import/check(multipart 要文件),
   * 但「能否进入下一步 / 确认导入」必须与文件导入同一口径 —— 这里直接复用
   * services/import/remap.ts 的 remapImportRows(内部调 core canProceedImport),
   * 返回同样的 canProceed / blockReasons。
   *
   * 不做这件事的后果:客户端只能本地判定,「待选择」的账户会被静默按源账户名新建。
   */
  app.post('/check', {
    schema: {
      description: '短信记账:按当前决议做服务端裁决(与文件导入同口径)',
      tags: ['短信记账'],
      body: zSchema(checkSchema),
    },
  }, async (req, reply) => {
    const payload = req.user as { id: string }
    const parsed = checkSchema.safeParse(req.body)
    if (!parsed.success) {
      return reply.status(400).send({
        message: '请求参数无效',
        details: parsed.error.issues.map(i => `${i.path.join('.')}: ${i.message}`),
      })
    }

    const { accountBookId, candidates, resolutions } = parsed.data
    await assertIsMember(accountBookId, payload.id)

    const { rows, errors } = smsCandidatesToRows(candidates)
    if (rows.length === 0) {
      return reply.status(400).send({ message: errors[0] ?? '没有可导入的短信交易' })
    }

    // zod 的 nullish() 会产出 null,remapImportRows 的入参是 `?: string` — 统一收敛为 undefined
    const remapped = await remapImportRows({
      source: SMS_IMPORT_SOURCE,
      rows,
      accountBookId,
      ownerId: resolutions?.ownerId ?? undefined,
      accountResolutions: resolutions?.accountResolutions?.map(r => ({
        sourceAccountName: r.sourceAccountName,
        action: r.action,
        targetAccountId: r.targetAccountId ?? undefined,
        targetAccountName: r.targetAccountName ?? undefined,
        accountType: r.accountType ?? undefined,
      })),
      categoryResolutions: resolutions?.categoryResolutions?.map(r => ({
        sourceCategory: r.sourceCategory,
        targetCategoryCode: r.targetCategoryCode,
        recordType: r.recordType ?? undefined,
        payerContains: r.payerContains ?? undefined,
        descriptionContains: r.descriptionContains ?? undefined,
      })),
      unrecognizedResolutions: resolutions?.unrecognizedResolutions?.map(r => ({
        rowIndex: r.rowIndex,
        type: r.type ?? undefined,
        accountId: r.accountId ?? undefined,
        toAccountId: r.toAccountId ?? undefined,
        categoryCode: r.categoryCode ?? undefined,
      })),
      confirmSkipUnrecognized: resolutions?.confirmSkipUnrecognized,
    })

    return {
      canProceed: remapped.canProceed,
      blockReasons: remapped.blockReasons,
      counts: remapped.counts,
      skippedUnrecognized: remapped.unresolved.unrecognized.length,
    }
  })

  // ===== 长尾内容 AI 兜底抽取(仅文本 → 字段,不做账户匹配) =====
  // 客户端把抽取结果并入候选后,再调一次 /preview 走同一条「解析后」管线;
  // 因此这里不碰 DB(除校验身份),也不做去重与分类映射。
  app.post('/extract', {
    schema: {
      description: '短信记账:长尾内容 AI 兜底抽取(结构化字段,账户匹配仍在 /preview)',
      tags: ['短信记账'],
      body: zSchema(extractSchema),
    },
  }, async (req, reply) => {
    const payload = req.user as { id: string }
    const parsed = extractSchema.safeParse(req.body)
    if (!parsed.success) {
      return reply.status(400).send({
        message: '请求参数无效',
        details: parsed.error.issues.map(i => `${i.path.join('.')}: ${i.message}`),
      })
    }
    const { accountBookId, items } = parsed.data
    await assertIsMember(accountBookId, payload.id)

    try {
      const result = await extractSmsItems(
        payload.id,
        items.map(item => ({
          sourceId: item.sourceId,
          text: item.text,
          sender: item.sender ?? null,
          receivedAt: item.receivedAt,
          channel: item.channel,
        })),
      )
      return { source: SMS_IMPORT_SOURCE, ...result }
    } catch (e: unknown) {
      // 未配置模型 / 模型调用失败:如实回给客户端提示,不静默吞掉
      return reply.status(400).send({ message: (e as Error)?.message || 'AI 解析失败' })
    }
  })
}

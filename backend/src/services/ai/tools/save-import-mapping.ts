import type { ToolDef, ToolContext } from './types.js'
import { prisma } from '../../../app.js'
import { IMPORT_SOURCE_DEFS, RECORD_TYPES } from '@homibook/core'
import { checkEnumList, checkEnums, ToolError } from '../security.js'
import type { ConfirmPreview } from '../runtime/preview-format.js'
import type { PreviewScope } from '../runtime/preview-scope.js'

/** 映射类型(本工具专属) */
const MAPPING_TYPES = ['account', 'category'] as const

// 来源取值以 core 的导入来源定义为唯一来源(避免各处硬编码漂移)
const IMPORT_SOURCE_KEYS = IMPORT_SOURCE_DEFS.map((d) => d.key)

/** 入参枚举校验:映射类型/来源/记录类型,非法值直接回报给模型(recordType 允许空串=不限类型)。弹确认卡前与执行时共用 */
const validateArgs = (args: any) =>
  checkEnums({
    mappingType: [args.mappingType, MAPPING_TYPES],
    source: [args.source, IMPORT_SOURCE_KEYS],
  })
  ?? checkEnumList('mappings[].recordType', (args.mappings ?? []).map((m: any) => m.recordType), [...RECORD_TYPES, ''])

export const saveImportMappingTool: ToolDef = {
  name: 'save_import_mapping',
  displayName: '保存导入映射',
  promptHint: '仅在用户明确要求时调用，日常导入无需调用',
  description: '创建或更新导入映射规则（账户映射或分类映射）。保存后的规则会在后续导入时自动应用。应在用户确认映射建议后调用。',
  requireConfirm: true,
  validateArgs,

  /** 确认卡：账户映射直接列出，分类映射要把编码翻成中文标签 */
  async confirmation(args: any, _ctx: ToolContext, scope: PreviewScope): Promise<string> {
    const { mappingType, source, mappings } = args as {
      mappingType: 'account' | 'category'
      source: string
      mappings: any[]
    }

    if (!mappings || mappings.length === 0) {
      return JSON.stringify({
        type: 'generic',
        title: '保存导入映射',
        description: '映射列表为空',
      } satisfies ConfirmPreview)
    }

    const sourceLabel: Record<string, string> = { alipay: '支付宝', wechat: '微信', jd: '京东' }
    const title = mappingType === 'account'
      ? `确认保存 ${mappings.length} 条账户映射规则（来源: ${sourceLabel[source] || source}）`
      : `确认保存 ${mappings.length} 条分类映射规则（来源: ${sourceLabel[source] || source}）`

    if (mappingType === 'account') {
      const preview: ConfirmPreview = {
        type: 'records-table',
        title,
        description: '保存后，后续导入时相同的源账户名将自动匹配到目标账户',
        columns: ['源账户名', '目标账户', '交易方正则', '说明正则'],
        rows: mappings.map((m) => [
          { text: m.sourceAccountName },
          { text: `${m.targetAccountName}` },
          { text: m.payerContains || '-' },
          { text: m.descriptionContains || '-' },
        ]),
      }
      return JSON.stringify(preview)
    }

    const codes = [...new Set(mappings.map((m) => m.targetCategoryCode))] as string[]
    const labelMap = await scope.categoryLabels(codes)

    const preview: ConfirmPreview = {
      type: 'records-table',
      title,
      description: '保存后，后续导入时相同的源分类名将自动映射到目标系统分类',
      columns: ['源分类名', '目标分类', '交易方正则', '说明正则', '记录类型'],
      rows: mappings.map((m) => [
        { text: m.sourceCategory },
        { text: `${labelMap.get(m.targetCategoryCode) || m.targetCategoryCode}` },
        { text: m.payerContains || '-' },
        { text: m.descriptionContains || '-' },
        { text: m.recordType || '-' },
      ]),
    }
    return JSON.stringify(preview)
  },

  parameters: {
    type: 'object',
    properties: {
      mappingType: { type: 'string', enum: [...MAPPING_TYPES], description: '映射类型' },
      source: { type: 'string', enum: [...IMPORT_SOURCE_KEYS], description: '来源标识' },
      mappings: {
        type: 'array',
        description: '要保存的映射规则列表',
        items: {
          type: 'object',
          properties: {
            // 账户映射字段
            sourceAccountName: { type: 'string', description: '源账户名称（账户映射必填）' },
            targetAccountName: { type: 'string', description: '目标账户名称（账户映射必填）' },
            // 分类映射字段
            sourceCategory: { type: 'string', description: '源分类名称（分类映射必填）' },
            targetCategoryCode: { type: 'string', description: '目标系统分类编码（分类映射必填）' },
            // 通用条件字段
            payerContains: { type: 'string', description: '交易方正则过滤条件（可选），如 燃气|电力 匹配任一关键词' },
            descriptionContains: { type: 'string', description: '说明字段正则过滤条件（可选）' },
            recordType: { type: 'string', enum: [...RECORD_TYPES, ''], description: '记录类型过滤（分类映射可选）' },
          },
        },
      },
    },
    required: ['mappingType', 'source', 'mappings'],
  },

  async execute(args: any, _ctx: ToolContext) {
    // 入参枚举校验(与弹确认卡前同一份规则)
    const badEnum = validateArgs(args)
    if (badEnum) throw new ToolError(badEnum.error ?? '参数非法', badEnum.retryable)

    const { mappingType, source, mappings } = args as {
      mappingType: 'account' | 'category'
      source: string
      mappings: any[]
    }

    if (!Array.isArray(mappings) || mappings.length === 0) {
      throw new ToolError('mappings 不能为空', false)
    }

    if (mappingType === 'account') {
      for (const m of mappings) {
        if (!m.sourceAccountName || !m.targetAccountName) {
          throw new ToolError('账户映射需要 sourceAccountName 和 targetAccountName', false)
        }
      }

      const results = []
      for (const m of mappings) {
        const result = await prisma.importAccountMapping.upsert({
          where: {
            source_sourceAccountName_payerContains_descriptionContains: {
              source,
              sourceAccountName: m.sourceAccountName,
              payerContains: m.payerContains || '',
              descriptionContains: m.descriptionContains || '',
            },
          },
          create: {
            source,
            sourceAccountName: m.sourceAccountName,
            targetAccountName: m.targetAccountName,
            payerContains: m.payerContains || '',
            descriptionContains: m.descriptionContains || '',
          },
          update: {
            targetAccountName: m.targetAccountName,
          },
        })
        results.push(result)
      }

      return { saved: results.length, mappingType: 'account' }
    } else {
      for (const m of mappings) {
        if (!m.sourceCategory || !m.targetCategoryCode) {
          throw new ToolError('分类映射需要 sourceCategory 和 targetCategoryCode', false)
        }
      }

      // 验证 targetCategoryCode 存在
      const codes = [...new Set(mappings.map((m: any) => m.targetCategoryCode))]
      const dictEntries = await prisma.dictionary.findMany({
        where: { code: { in: codes } },
        select: { code: true },
      })
      const validCodes = new Set(dictEntries.map(d => d.code))
      for (const m of mappings) {
        if (!validCodes.has(m.targetCategoryCode)) {
          throw new ToolError(`分类编码 "${m.targetCategoryCode}" 不存在`, false)
        }
      }

      const results = []
      for (const m of mappings) {
        const recordType = m.recordType || ''
        const result = await prisma.importCategoryMapping.upsert({
          where: {
            source_sourceCategory_payerContains_descriptionContains_recordType: {
              source,
              sourceCategory: m.sourceCategory,
              payerContains: m.payerContains || '',
              descriptionContains: m.descriptionContains || '',
              recordType,
            },
          },
          create: {
            source,
            sourceCategory: m.sourceCategory,
            targetCategoryCode: m.targetCategoryCode,
            payerContains: m.payerContains || '',
            descriptionContains: m.descriptionContains || '',
            recordType,
          },
          update: {
            targetCategoryCode: m.targetCategoryCode,
          },
        })
        results.push(result)
      }

      return { saved: results.length, mappingType: 'category' }
    }
  },
}

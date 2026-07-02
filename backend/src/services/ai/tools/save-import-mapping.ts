import type { ToolDef, ToolContext } from './types.js'
import { prisma } from '../../../app.js'

export const saveImportMappingTool: ToolDef = {
  name: 'save_import_mapping',
  description: '创建或更新导入映射规则（账户映射或分类映射）。保存后的规则会在后续导入时自动应用。应在用户确认映射建议后调用。',
  requireConfirm: true,
  parameters: {
    type: 'object',
    properties: {
      mappingType: { type: 'string', enum: ['account', 'category'], description: '映射类型' },
      source: { type: 'string', description: '来源标识(alipay|wechat|csv|jd)' },
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
            payerContains: { type: 'string', description: '交易方名称正则过滤条件（可选），如 燃气|电力|汇通 匹配任一关键词' },
            descriptionContains: { type: 'string', description: '说明字段正则过滤条件（可选），如 燃气|电力|汇通 匹配任一关键词' },
            recordType: { type: 'string', enum: ['INCOME', 'EXPENSE', 'TRANSFER', ''], description: '记录类型过滤（分类映射可选）' },
          },
        },
      },
    },
    required: ['mappingType', 'source', 'mappings'],
  },

  async execute(args: any, _ctx: ToolContext) {
    const { mappingType, source, mappings } = args as {
      mappingType: 'account' | 'category'
      source: string
      mappings: any[]
    }

    if (!Array.isArray(mappings) || mappings.length === 0) {
      return { success: false, error: 'mappings 不能为空', retryable: false }
    }

    if (mappingType === 'account') {
      for (const m of mappings) {
        if (!m.sourceAccountName || !m.targetAccountName) {
          return { success: false, error: '账户映射需要 sourceAccountName 和 targetAccountName', retryable: false }
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

      return { success: true, retryable: false, data: { saved: results.length, mappingType: 'account' } }
    } else {
      for (const m of mappings) {
        if (!m.sourceCategory || !m.targetCategoryCode) {
          return { success: false, error: '分类映射需要 sourceCategory 和 targetCategoryCode', retryable: false }
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
          return { success: false, error: `分类编码 "${m.targetCategoryCode}" 不存在`, retryable: false }
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

      return { success: true, retryable: false, data: { saved: results.length, mappingType: 'category' } }
    }
  },
}

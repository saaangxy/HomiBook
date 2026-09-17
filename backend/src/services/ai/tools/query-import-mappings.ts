import type { ToolDef, ToolContext } from './types.js'
import { prisma } from '../../../app.js'
import { checkEnums } from '../security.js'
import { IMPORT_SOURCES } from '@homibook/core'

/** 映射类型(本工具专属) */
const MAPPING_TYPES = ['account', 'category'] as const

export const queryImportMappingsTool: ToolDef = {
  name: 'query_import_mappings',
  displayName: '查询导入映射',
  promptHint: '查看已有导入映射规则',
  description: '查询已有的导入映射规则（账户映射和分类映射）。用于了解当前自动匹配规则，帮助在导入流水时做出正确的映射建议。',
  parameters: {
    type: 'object',
    properties: {
      source: { type: 'string', enum: [...IMPORT_SOURCES], description: '按来源筛选，不填返回全部来源' },
      mappingType: { type: 'string', enum: [...MAPPING_TYPES], description: '映射类型，不填返回两种' },
    },
  },

  async execute(args: any, _ctx: ToolContext) {
    // 入参枚举校验:来源/映射类型非法值直接回报给模型(否则会静默返回全量结果)
    const badEnum = checkEnums({
      source: [args.source, IMPORT_SOURCES],
      mappingType: [args.mappingType, MAPPING_TYPES],
    })
    if (badEnum) return badEnum

    const source = args.source || undefined
    const mappingType = args.mappingType || undefined

    const [accountMappings, categoryMappings] = await Promise.all([
      (!mappingType || mappingType === 'account')
        ? prisma.importAccountMapping.findMany({
            where: source ? { source } : {},
            orderBy: [{ source: 'asc' }, { sourceAccountName: 'asc' }],
            select: { id: true, source: true, sourceAccountName: true, payerContains: true, descriptionContains: true, targetAccountName: true },
          })
        : Promise.resolve([]),

      (!mappingType || mappingType === 'category')
        ? prisma.importCategoryMapping.findMany({
            where: source ? { source } : {},
            orderBy: [{ source: 'asc' }, { sourceCategory: 'asc' }],
            select: { id: true, source: true, sourceCategory: true, payerContains: true, descriptionContains: true, recordType: true, targetCategoryCode: true },
          })
        : Promise.resolve([]),
    ])

    return {
      success: true,
      retryable: false,
      data: { accountMappings, categoryMappings },
    }
  },
}

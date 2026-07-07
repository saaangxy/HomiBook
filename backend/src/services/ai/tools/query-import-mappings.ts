import type { ToolDef, ToolContext } from './types.js'
import { prisma } from '../../../app.js'

export const queryImportMappingsTool: ToolDef = {
  name: 'query_import_mappings',
  description: '查询已有的导入映射规则（账户映射和分类映射）。用于了解当前自动匹配规则，帮助在导入流水时做出正确的映射建议。',
  parameters: {
    type: 'object',
    properties: {
      source: { type: 'string', description: '按来源筛选(alipay|wechat|jd)，不填返回全部来源的映射' },
      mappingType: { type: 'string', enum: ['account', 'category'], description: '映射类型，不填返回两种' },
    },
  },

  async execute(args: any, _ctx: ToolContext) {
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

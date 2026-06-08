import type { ZodType } from 'zod'

/**
 * 将 Zod schema 转换为 JSON Schema，供 Fastify schema 使用
 * Zod 4 内置 toJSONSchema() 方法，输出 Draft 2020-12 格式，兼容 OpenAPI 3.1
 */
export function zSchema(schema: ZodType) {
  const jsonSchema = (schema as any).toJSONSchema() as Record<string, unknown>
  delete jsonSchema.$schema
  return jsonSchema
}

/**
 * 为简单查询参数创建 JSON Schema（不依赖 Zod）
 * 用于只有一个必填 bookId 的简单 GET 接口
 */
export function bookIdQuery() {
  return {
    type: 'object',
    properties: { bookId: { type: 'string' } },
    required: ['bookId'],
  } as const
}

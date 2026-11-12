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

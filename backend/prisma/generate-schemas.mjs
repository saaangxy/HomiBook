/**
 * 从 sqlite 主 schema（schema.prisma）生成 MySQL / PostgreSQL 的 schema 副本。
 *
 * 为什么需要副本而不是一个 schema 切多个 provider：
 * Prisma 的 datasource.provider 必须是字面量，不能读环境变量；
 * 且 Prisma Client 在 generate 时就绑定 provider。因此每个数据库类型
 * 需要独立的 schema 文件，由 prisma/run.mjs 按 DATABASE_PROVIDER 选择。
 *
 * MySQL 的 String 默认是 varchar(191)，长文本字段（AI 消息、工具调用
 * JSON、审计日志等）会被截断，需要追加 @db.Text。PostgreSQL 的 String
 * 本身就是 text，@db.Text 同样合法。SQLite 无长度限制，不需要。
 *
 * 运行：node prisma/generate-schemas.mjs
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))

/** 长文本字段清单：仅 MySQL/PostgreSQL 需要 @db.Text（新增长字段时在此追加） */
const LONG_TEXT_FIELDS = {
  ChatSession: ['summary'],
  ChatMessage: ['content', 'toolCalls'],
  UserMemory: ['content'],
  AgentAuditLog: ['input', 'output'],
  SystemConfig: ['value'],
  UserAIConfig: ['disabledTools'],
}

/**
 * 复合唯一索引字段清单：MySQL 的 utf8mb4 下 varchar(191)×4 = 3056 字节
 * 已接近 3072 上限，5 列时必然超限（"Specified key was too long"）。
 * 这些字段不是长文本，只缩短 varchar 长度使唯一索引合法。
 */
const VAR_CHAR_FIELDS = {
  ImportAccountMapping: {
    source: 20,
    sourceAccountName: 100,
    payerContains: 100,
    descriptionContains: 100,
    targetAccountName: 100,
  },
  ImportCategoryMapping: {
    source: 20,
    sourceCategory: 100,
    payerContains: 100,
    descriptionContains: 100,
    recordType: 20,
    targetCategoryCode: 100,
  },
}

/**
 * 在指定 model 块内给字段追加长文本注解（幂等，重复运行不会叠加）。
 * - MySQL：@db.Text 仅 64KB，导入预览/AI 记忆等大 JSON 会超限，用 @db.MediumText（16MB）
 * - PostgreSQL：text 本身上限，@db.Text 即可
 */
function addTextAnnotations(schema, annotation) {
  let result = schema
  for (const [model, fields] of Object.entries(LONG_TEXT_FIELDS)) {
    const blockPattern = new RegExp(`model ${model} \\{[\\s\\S]*?\\n\\}`)
    const block = result.match(blockPattern)?.[0]
    if (!block) {
      console.warn(`[generate-schemas] 未找到 model ${model}，跳过`)
      continue
    }
    let newBlock = block
    for (const f of fields) {
      const fieldPattern = new RegExp(`^(\\s*${f}\\s+String\\??)(?=[ \\t]*(?:\\/\\/|\\r?\\n|$))`, 'm')
      newBlock = newBlock.replace(fieldPattern, (_m, decl) => `${decl} ${annotation}`)
    }
    result = result.replace(block, newBlock)
  }
  return result
}

/** 给复合唯一索引字段追加 @db.VarChar(n) 缩短索引长度（幂等） */
function addVarCharAnnotations(schema) {
  let result = schema
  for (const [model, fields] of Object.entries(VAR_CHAR_FIELDS)) {
    const blockPattern = new RegExp(`model ${model} \\{[\\s\\S]*?\\n\\}`)
    const block = result.match(blockPattern)?.[0]
    if (!block) {
      console.warn(`[generate-schemas] 未找到 model ${model}，跳过`)
      continue
    }
    let newBlock = block
    for (const [field, len] of Object.entries(fields)) {
      const fieldPattern = new RegExp(
        `^(\\s*${field}\\s+String)(\\s+@default\\([^)]*\\))?(?=[ \\t]*(?:\\/\\/|\\r?\\n|$))`,
        'm',
      )
      newBlock = newBlock.replace(fieldPattern, (_m, decl, def) => `${decl} @db.VarChar(${len})${def || ''}`)
    }
    result = result.replace(block, newBlock)
  }
  return result
}

const base = readFileSync(join(__dirname, 'schema.prisma'), 'utf8')

// 副本输出到独立子目录 prisma/<provider>/schema.prisma：
// Prisma 的 migrations 目录固定在 schema 所在目录下，只有把各 provider 的
// schema 放到不同目录，才能让 sqlite/mysql/postgresql 各自持有独立迁移历史。
for (const provider of ['mysql', 'postgresql']) {
  const dir = join(__dirname, provider)
  mkdirSync(dir, { recursive: true })
  let schema = base.replace(/provider = "sqlite"/, `provider = "${provider}"`)
  // 副本位于 prisma/<provider>/ 二级目录，output 需多上一级才能指向 backend/src/generated/<provider>
  schema = schema.replace('"../src/generated/sqlite"', `"../../src/generated/${provider}"`)
  // MySQL 用 MediumText（16MB）容纳大 JSON；PostgreSQL 保持 Text（无上限）
  schema = addTextAnnotations(schema, provider === 'mysql' ? '@db.MediumText' : '@db.Text')
  schema = addVarCharAnnotations(schema)
  const outPath = join(dir, 'schema.prisma')
  writeFileSync(outPath, schema)
  console.log(`[generate-schemas] 已生成 ${outPath}`)
}

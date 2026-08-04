/**
 * Prisma CLI 包装器：按 DATABASE_PROVIDER 环境变量选择 schema 并转发命令。
 *
 * 用法：node prisma/run.mjs <prisma 子命令及参数>
 *   - DATABASE_PROVIDER=sqlite（默认）  -> schema.prisma
 *   - DATABASE_PROVIDER=mysql          -> schema.mysql.prisma（自动生成）
 *   - DATABASE_PROVIDER=postgresql     -> schema.postgresql.prisma（自动生成）
 *
 * 示例：node prisma/run.mjs db push --accept-data-loss
 *        node prisma/run.mjs generate
 *
 * 说明：Prisma CLI 会自动加载 backend/.env，但本脚本是普通 node 进程，
 * 因此手动加载 .env，让 DATABASE_PROVIDER / DATABASE_URL 可以统一写在 .env 里。
 * 优先级：已存在的环境变量 > .env。
 */
import { execSync } from 'node:child_process'
import { readFileSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))

/** 极简 .env 解析：加载 backend/.env（已存在的环境变量优先，不覆盖） */
function loadEnv(file) {
  if (!existsSync(file)) return
  const content = readFileSync(file, 'utf8')
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const eq = trimmed.indexOf('=')
    if (eq === -1) continue
    const key = trimmed.slice(0, eq).trim()
    let value = trimmed.slice(eq + 1).trim()
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1)
    }
    if (process.env[key] === undefined) process.env[key] = value
  }
}

loadEnv(join(__dirname, '..', '.env'))

const provider = (process.env.DATABASE_PROVIDER || 'sqlite').toLowerCase()
const SCHEMAS = {
  sqlite: 'schema.prisma',
  mysql: 'schema.mysql.prisma',
  postgresql: 'schema.postgresql.prisma',
}

const schemaFile = SCHEMAS[provider]
if (!schemaFile) {
  console.error(`不支持的 DATABASE_PROVIDER: ${provider}（可选 sqlite / mysql / postgresql）`)
  process.exit(1)
}

// mysql/postgresql 的副本始终重新生成，保证与 sqlite 主 schema 同步
if (provider !== 'sqlite') {
  execSync('node prisma/generate-schemas.mjs', { stdio: 'inherit' })
}

const args = process.argv.slice(2).join(' ')
console.log(`[prisma] provider=${provider} schema=prisma/${schemaFile} cmd=${args}`)
execSync(`npx prisma ${args} --schema prisma/${schemaFile}`, { stdio: 'inherit' })

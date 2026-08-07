/**
 * Prisma CLI 包装器：转发命令到 prisma CLI。
 *
 * Prisma 7 通过 prisma.config.ts 按 DATABASE_PROVIDER 选择 schema 与 datasource url，
 * 因此不再需要 --schema 传参，本脚本仅负责：
 *   1. 加载 backend/.env（让 DATABASE_PROVIDER / DATABASE_URL 统一写在 .env 里）
 *   2. mysql/postgresql 时先重新生成 schema 副本（保证与 sqlite 主 schema 同步）
 *   3. 转发命令给 npx prisma
 *
 * 用法：node prisma/run.mjs <prisma 子命令及参数>
 * 示例：npm run db:generate   （node prisma/run.mjs generate）
 *        npm run db:deploy     （node prisma/run.mjs migrate deploy）
 */
import { execSync } from 'node:child_process'
import { loadEnv } from './load-env.mjs'

loadEnv()

const provider = (process.env.DATABASE_PROVIDER || 'sqlite').toLowerCase()
const SCHEMAS = {
  sqlite: 'schema.prisma',
  mysql: 'mysql/schema.prisma',
  postgresql: 'postgresql/schema.prisma',
}

if (!SCHEMAS[provider]) {
  console.error(`不支持的 DATABASE_PROVIDER: ${provider}（可选 sqlite / mysql / postgresql）`)
  process.exit(1)
}

// mysql/postgresql 的副本始终重新生成，保证与 sqlite 主 schema 同步
if (provider !== 'sqlite') {
  execSync('node prisma/generate-schemas.mjs', { stdio: 'inherit' })
}

const args = process.argv.slice(2).join(' ')
console.log(`[prisma] provider=${provider} cmd=${args}`)
execSync(`npx prisma ${args}`, { stdio: 'inherit' })

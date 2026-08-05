/**
 * Prisma CLI 包装器：按 DATABASE_PROVIDER 环境变量选择 schema 并转发命令。
 *
 * 用法：node prisma/run.mjs <prisma 子命令及参数>
 *   - DATABASE_PROVIDER=sqlite（默认）  -> schema.prisma
 *   - DATABASE_PROVIDER=mysql          -> schema.mysql.prisma（自动生成）
 *   - DATABASE_PROVIDER=postgresql     -> schema.postgresql.prisma（自动生成）
 *
 * 示例：node prisma/run.mjs migrate deploy
 *        node prisma/run.mjs generate
 *
 * 说明：Prisma CLI 会自动加载 backend/.env，但本脚本是普通 node 进程，
 * 因此手动加载 .env，让 DATABASE_PROVIDER / DATABASE_URL 可以统一写在 .env 里。
 * 优先级：已存在的环境变量 > .env。
 */
import { execSync } from 'node:child_process'
import { loadEnv } from './load-env.mjs'

loadEnv()

const provider = (process.env.DATABASE_PROVIDER || 'sqlite').toLowerCase()
// mysql/postgresql 的 schema 副本在独立子目录，migrations 历史随之各自分离
const SCHEMAS = {
  sqlite: 'schema.prisma',
  mysql: 'mysql/schema.prisma',
  postgresql: 'postgresql/schema.prisma',
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

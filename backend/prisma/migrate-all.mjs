/**
 * 一键为所有数据库类型生成并应用迁移。
 *
 * 用法：npm run db:migrate:all -- --name <迁移名>
 *   - 先重新生成 mysql/postgresql 的 schema 副本，保证与 sqlite 主 schema 同步
 *   - 再对每个配置了连接串的数据库类型执行 `prisma migrate dev --name <迁移名>`
 *     （prisma.config.ts 根据 DATABASE_PROVIDER 选择对应 schema，DATABASE_URL 由本脚本注入）
 *
 * 各数据库类型的连接串来源：
 *   - sqlite       ：固定使用开发库文件（file:./dev.db）
 *   - mysql        ：backend/.env 中的 MYSQL_DATABASE_URL
 *   - postgresql   ：backend/.env 中的 POSTGRES_DATABASE_URL
 * 未配置连接串的类型会被跳过。migrate dev 会为每种数据库生成独立的迁移文件
 * （sqlite -> prisma/migrations、mysql -> prisma/mysql/migrations、postgresql -> ...）。
 */
import { execSync } from 'node:child_process'
import { loadEnv } from './load-env.mjs'

loadEnv()

// 解析 --name 迁移名
const nameIndex = process.argv.indexOf('--name')
const name = nameIndex !== -1 ? process.argv[nameIndex + 1] : undefined
if (!name) {
  console.error('用法: node prisma/migrate-all.mjs --name <迁移名>')
  console.error('示例: npm run db:migrate:all -- --name add-record-remark')
  process.exit(1)
}

// 重新生成所有 schema 副本，保证与主 schema.prisma 同步后统一提交
execSync('node prisma/generate-schemas.mjs', { stdio: 'inherit' })

const targets = [
  // sqlite 相对路径以 backend/ 为基准，指向 backend/prisma/dev.db
  { label: 'sqlite', provider: 'sqlite', url: 'file:./prisma/dev.db' },
  { label: 'mysql', provider: 'mysql', url: process.env.MYSQL_DATABASE_URL },
  { label: 'postgres', provider: 'postgresql', url: process.env.POSTGRES_DATABASE_URL },
]

let ran = 0
for (const t of targets) {
  if (!t.url) {
    console.log(`[migrate-all] 跳过 ${t.label}（未配置连接串，可在 backend/.env 设置 ${t.label.toUpperCase()}_DATABASE_URL）`)
    continue
  }
  console.log(`[migrate-all] ${t.label}: 生成并应用迁移 "${name}"`)
  execSync(`npx prisma migrate dev --name "${name}"`, {
    env: { ...process.env, DATABASE_PROVIDER: t.provider, DATABASE_URL: t.url },
    stdio: 'inherit',
  })
  ran++
}

if (ran === 0) {
  console.error('[migrate-all] 未执行任何迁移。sqlite 默认执行；mysql/postgresql 需配置连接串')
  process.exit(1)
}

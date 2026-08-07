/**
 * 为所有数据库类型生成 Prisma Client。
 *
 * Prisma 7 的 client 与 schema 的 datasource provider 绑定（driver adapter 必须匹配），
 * 因此 sqlite / mysql / postgresql 各生成一份 client 到 src/generated/<provider>，
 * 运行时按 DATABASE_PROVIDER 选择对应 client（见 src/lib/prisma.ts）。
 *
 * 用法：npm run db:generate （node prisma/generate-all.mjs）
 */
import { execSync } from 'node:child_process'
import { loadEnv } from './load-env.mjs'

loadEnv()

// 先重新生成 mysql/postgresql 的 schema 副本，保证与 sqlite 主 schema 同步
execSync('node prisma/generate-schemas.mjs', { stdio: 'inherit' })

const providers = [
  { label: 'sqlite', provider: 'sqlite' },
  { label: 'mysql', provider: 'mysql' },
  { label: 'postgresql', provider: 'postgresql' },
]

for (const p of providers) {
  console.log(`[generate-all] 生成 ${p.label} client...`)
  // prisma.config.ts 按 DATABASE_PROVIDER 选择对应 schema
  execSync('npx prisma generate', {
    env: { ...process.env, DATABASE_PROVIDER: p.provider },
    stdio: 'inherit',
  })
}
console.log('[generate-all] 全部完成')

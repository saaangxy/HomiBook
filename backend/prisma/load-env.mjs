/**
 * 极简 .env 解析：加载 backend/.env（已存在的环境变量优先，不覆盖）。
 *
 * Prisma CLI 会自动加载 .env，但本项目自定义的 node 脚本（run.mjs、migrate-all.mjs）
 * 是普通进程，需手动加载，让 DATABASE_PROVIDER / DATABASE_URL / *_DATABASE_URL
 * 可以统一写在 backend/.env 里。
 */
import { readFileSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))

export function loadEnv(file = join(__dirname, '..', '.env')) {
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

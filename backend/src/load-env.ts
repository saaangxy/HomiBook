import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

/**
 * 副作用模块：加载 backend/.env（已有环境变量优先）。
 *
 * 必须作为入口文件（index.ts）的**第一个 import**，这样它先于其他模块求值——
 * 因为 lib/prisma.ts 在模块加载时就会按 DATABASE_PROVIDER 创建 driver adapter，
 * 若 .env 尚未加载会误用 sqlite。
 *
 * Docker 等部署场景无 .env 文件，环境变量由外部注入，此处静默跳过。
 */
try {
  process.loadEnvFile(join(dirname(fileURLToPath(import.meta.url)), '..', '.env'))
} catch {
  /* 无 .env 文件时忽略（部署环境变量由外部注入） */
}

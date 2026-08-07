/// <reference types="node" />
import { defineConfig } from 'prisma/config'
import { loadEnv } from './prisma/load-env.mjs'

// 加载 backend/.env（已有环境变量优先）；Docker 等注入场景无 .env 时忽略
loadEnv()

// 按 DATABASE_PROVIDER 选择对应 schema 副本（迁移按 provider 生成 SQL 需字面量 provider）
const provider = (process.env.DATABASE_PROVIDER || 'sqlite').toLowerCase()
const schemaMap: Record<string, string> = {
  sqlite: 'prisma/schema.prisma',
  mysql: 'prisma/mysql/schema.prisma',
  postgresql: 'prisma/postgresql/schema.prisma',
}

export default defineConfig({
  schema: schemaMap[provider] || schemaMap.sqlite,
  datasource: {
    url: process.env.DATABASE_URL || 'file:./prisma/dev.db',
  },
})

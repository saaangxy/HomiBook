import { fileURLToPath } from 'node:url'
import { dirname, isAbsolute, join } from 'node:path'
import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3'
import { PrismaMariaDb } from '@prisma/adapter-mariadb'
import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient } from '../generated/prisma/client.js'

// backend 根目录（源码 src/lib/prisma.ts 与编译产物 dist/lib/prisma.js 均向上两级即 backend/）
const backendDir = join(dirname(fileURLToPath(import.meta.url)), '..', '..')

/**
 * SQLite 相对路径以 backend 根为基准解析，避免受进程 cwd 影响
 * （better-sqlite3 默认按 cwd 解析 `file:./...`，从项目根启动会连错库）。
 */
function resolveSqliteUrl(url: string): string {
  if (url.startsWith('file:')) {
    const body = url.slice('file:'.length)
    return isAbsolute(body) ? url : `file:${join(backendDir, body)}`
  }
  return isAbsolute(url) ? url : join(backendDir, url)
}

/**
 * 按 DATABASE_PROVIDER 选择 driver adapter（Prisma 7 驱动适配器方案）。
 * - sqlite → @prisma/adapter-better-sqlite3（timestampFormat 用 unixepoch-ms 兼容旧引擎写入的日期格式）
 * - mysql  → @prisma/adapter-mariadb（mariadb 驱动，支持 MySQL/MariaDB）
 * - postgresql → @prisma/adapter-pg
 */
function createAdapter() {
  const provider = (process.env.DATABASE_PROVIDER || 'sqlite').toLowerCase()
  const url = process.env.DATABASE_URL || 'file:./prisma/dev.db'
  switch (provider) {
    case 'mysql':
      return new PrismaMariaDb(url)
    case 'postgresql':
      return new PrismaPg(url)
    default:
      return new PrismaBetterSqlite3({ url: resolveSqliteUrl(url) }, { timestampFormat: 'unixepoch-ms' })
  }
}

/**
 * 原始 PrismaClient，不应用软删除过滤。
 *
 * ⚠️ 严禁与 prisma 在同一事务中混用——两者各自管理独立事务，不会共享。
 *   错误示例：rawPrisma.$transaction([prisma.account.delete(...)])  // prisma 不在该事务内
 *   正确做法：事务内全部用 rawPrisma 或全部用 prisma。
 *
 * ⚠️ rawPrisma.user.delete() 是物理删除，不会被转为软删除。
 *
 * 允许的使用场景：
 * 1. 账本硬删除时的级联物理删除（routes/book.ts）——需连同账户/流水一起物理删除
 * 2. 数据迁移/诊断脚本——需查询含软删除记录的全部数据
 *
 * 其他场景请使用 prisma。新增 rawPrisma 引用前请评估是否能用 prisma 替代。
 */
export const rawPrisma = new PrismaClient({ adapter: createAdapter() })

type SoftDeleteModel = 'user' | 'account'

/** 为指定模型构造软删除查询扩展 */
function softDeleteQuery(model: SoftDeleteModel) {
  return {
    // findUnique 使用后置过滤（不支持在 where 中追加非唯一字段）
    async findUnique({ args, query }: any) {
      const result = await query(args)
      return result && result.deletedAt ? null : result
    },
    async findUniqueOrThrow({ args, query }: any) {
      const result = await query(args)
      if (!result || result.deletedAt) {
        const err = new Error(`No ${model} found`)
        ;(err as any).code = 'P2025'
        throw err
      }
      return result
    },
    // 其余查询在 where 中注入 deletedAt: null
    async findFirst({ args, query }: any) {
      return query({ ...args, where: { ...args.where, deletedAt: null } })
    },
    async findFirstOrThrow({ args, query }: any) {
      return query({ ...args, where: { ...args.where, deletedAt: null } })
    },
    async findMany({ args, query }: any) {
      return query({ ...args, where: { ...args.where, deletedAt: null } })
    },
    async count({ args, query }: any) {
      return query({ ...args, where: { ...args.where, deletedAt: null } })
    },
    async aggregate({ args, query }: any) {
      return query({ ...args, where: { ...args.where, deletedAt: null } })
    },
    async groupBy({ args, query }: any) {
      return query({ ...args, where: { ...args.where, deletedAt: null } })
    },
    // delete/deleteMany 转为 update 设置 deletedAt
    async delete({ args }: any): Promise<any> {
      return (prisma as any)[model].update({
        ...args,
        where: { ...args.where, deletedAt: null },
        data: { deletedAt: new Date() },
      })
    },
    async deleteMany({ args }: any): Promise<any> {
      return (prisma as any)[model].updateMany({
        ...args,
        where: { ...args.where, deletedAt: null },
        data: { deletedAt: new Date() },
      })
    },
  }
}

/**
 * 软删除扩展客户端（默认使用）
 *
 * - findUnique/findFirst/findMany/count/aggregate/groupBy：自动过滤 deletedAt
 * - delete/deleteMany：自动转为 update 设置 deletedAt（软删除）
 * - update/updateMany/upsert：未覆盖，需手动在 where 中加 deletedAt: null
 * - include/select 关联数据：不过滤软删除（如 account.owner 可能是软删除用户），需在业务层检查
 *
 * 全项目默认 import { prisma }。rawPrisma 仅在上方注释列出的场景使用。
 */
export const prisma = rawPrisma.$extends({
  query: {
    user: softDeleteQuery('user'),
    account: softDeleteQuery('account'),
  },
})

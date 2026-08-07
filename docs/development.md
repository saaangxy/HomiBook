# 开发指南

> 面向本地开发：环境搭建、启动方式、数据库切换与 DDL 迁移规范。
> 部署相关内容见 [部署指南](deployment.md)。

## 目录

- [环境要求](#环境要求)
- [开发环境启动](#开发环境启动)
- [数据库配置（开发过程切换）](#数据库配置开发过程切换)
  - [变量说明](#变量说明)
  - [为什么切换要重新生成 Client](#为什么切换要重新生成-client)
  - [SQLite（默认，开发首选）](#sqlite默认开发首选)
  - [切换到 MySQL](#切换到-mysql)
  - [切换到 PostgreSQL](#切换到-postgresql)
  - [切回 SQLite](#切回-sqlite)
  - [DDL 变更走 Prisma Migrate](#ddl-变更走-prisma-migrate)
  - [注意事项](#注意事项)
- [AI 助手配置](#ai-助手配置)
- [常用 npm scripts](#常用-npm-scripts)

## 环境要求

- **Node.js 22+**
- npm（后端）、yarn（前端）
- Docker（可选，用于本地启动 MySQL / PostgreSQL）

## 开发环境启动

```bash
# 后端（端口 3002）
cd backend
npm install
npm run dev

# 前端（Vite 默认端口 5173，/api 自动代理到后端 3002）
cd frontend
yarn install
yarn dev
```

打开 http://localhost:5173 即可。

## 数据库配置（开发过程切换）

后端默认使用 **SQLite**（零配置）。数据库类型在 `backend/.env` 中通过两个环境变量控制。

### 变量说明

| 变量 | 说明 | 示例 |
|---|---|---|
| `DATABASE_PROVIDER` | 数据库类型 | `sqlite` / `mysql` / `postgresql` |
| `DATABASE_URL` | 连接串 | `file:./prisma/dev.db` / `mysql://...` / `postgresql://...` |

### 多数据库机制（Prisma 7 驱动适配器）

Prisma 7 使用 **driver adapter**，Client 与数据库类型**解耦**（运行时按 `DATABASE_PROVIDER` 选择 adapter），不再像旧版那样在 generate 时绑定数据库：

- 项目用一个 `schema.prisma`（SQLite）作为唯一源文件，生成**一个** Prisma Client 到 `backend/src/generated/prisma`（已 gitignore）
- `prisma.config.ts` 按 `DATABASE_PROVIDER` 选择 schema 副本与连接串，替代旧版 `--schema` 传参
- `prisma/generate-schemas.mjs` 按需生成 `prisma/mysql/schema.prisma` / `prisma/postgresql/schema.prisma` 副本（迁移按 provider 生成 SQL 仍需字面量 provider；自动处理 MySQL 的 `@db.Text` 长文本、`@db.VarChar` 复合索引限制）
- `prisma/run.mjs` 是 npm scripts 的包装器，自动读取 `.env`，非 sqlite 时先重新生成副本再转发命令

切换数据库只需改 `.env` 后执行迁移/建表即可。

### SQLite（默认，开发首选）

`backend/.env` 保持：

```env
DATABASE_URL="file:./prisma/dev.db"
```

（`DATABASE_PROVIDER` 不写即默认 sqlite。注意：相对路径以 `backend/` 为基准，指向 `backend/prisma/dev.db`）

### 切换到 MySQL
1. 修改 `backend/.env`：

   ```env
   DATABASE_PROVIDER=mysql
   DATABASE_URL=mysql://homibook:homibook@localhost:3306/homibook
   ```

   如果用自己的 MySQL（如远程实例），把 `DATABASE_URL` 指向它即可。

2. 同步表结构（run.mjs 会先自动重新生成 mysql schema 副本）：

   ```bash
   npm run db:push       # 在 MySQL 中创建表（仅限本地开发）
   npm run dev
   ```

### 切换到 PostgreSQL

步骤同上，把 `DATABASE_PROVIDER` 设为 `postgresql`：

```env
DATABASE_PROVIDER=postgresql
DATABASE_URL=postgresql://homibook:homibook@localhost:5432/homibook
```

### 切回 SQLite

```bash
# backend/.env 恢复为：
# DATABASE_URL="file:./prisma/dev.db"
# （删除/注释 DATABASE_PROVIDER 和 mysql 连接串两行）

npm run db:push
npm run dev
```

### Prisma Migrate

**表结构（DDL）变更必须通过迁移管理，禁止 `db push --accept-data-loss` 覆盖数据**。

- **开发（单库）**：修改 `schema.prisma` 后执行 `npm run db:migrate`（`migrate dev`），生成迁移文件并应用到当前开发库
- **开发（多库一键）**：执行 `npm run db:migrate:all -- --name <迁移名>`，脚本会先重新生成所有 schema 副本，再对每个配置了连接串的数据库（sqlite + 可选的 `MYSQL_DATABASE_URL` / `POSTGRES_DATABASE_URL`）各生成一份迁移，未配置的库自动跳过
- **提交内容**：`schema.prisma`、生成的副本 `prisma/mysql/schema.prisma` / `prisma/postgresql/schema.prisma`、以及各自的迁移目录都要**提交 git**（副本每次运行会自动重新生成，保证与主 schema 同步）
- **多库迁移历史各自独立**（由 schema 所在目录决定）：
  - sqlite → `backend/prisma/migrations/`
  - mysql → `backend/prisma/mysql/migrations/`
  - postgresql → `backend/prisma/postgresql/migrations/`

### 注意事项

- **数据不会自动迁移**：切换数据库后表结构和数据都需自行处理。SQLite 与 MySQL 之间的数据不会自动同步
- **`db:push` 仅限本地开发库快速同步**：正式环境（含 Docker 部署）一律走迁移（`db:deploy`），绝不可在正式库用 `db push --accept-data-loss`
- 每个 `db:generate` / `db:push` / `db:migrate` 都会打印 `[prisma] provider=xxx cmd=...`，可据此确认当前用的库
- 新增了长文本字段时，需在 `backend/prisma/generate-schemas.mjs` 的 `LONG_TEXT_FIELDS` 中补充
- Prisma 7 的 sqlite 相对路径以 `backend/` 为基准（`file:./prisma/dev.db`）；迁移配置集中在 `backend/prisma.config.ts`

## 常用 npm scripts

| 命令（在 `backend/` 下执行） | 说明 |
|---|---|
| `npm run dev` | 启动开发服务器（端口 3002） |
| `npm run build` | TypeScript 编译 |
| `npm run db:generate` | 重新生成 Prisma Client 与 schema 副本 |
| `npm run db:push` | 同步表结构（**仅限本地开发**，勿用于正式库） |
| `npm run db:migrate` | 生成并应用迁移（`migrate dev`） |
| `npm run db:migrate:all -- --name <迁移名>` | 对所有已配置数据库一键生成迁移 |
| `npm run db:deploy` | 部署时应用已提交迁移（`migrate deploy`） |

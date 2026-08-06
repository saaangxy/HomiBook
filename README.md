# HomiBook 家庭记账本

前后端分离的家庭记账应用，内置 AI 记账助手（自然语言记账、账单导入、支出分析、网页搜索）。

## 技术栈

| 端 | 技术 |
|---|---|
| 后端 | Node.js + TypeScript (ESM)、Fastify、Prisma 5、Zod |
| 前端 | React 19 + TypeScript、Vite 8、Shadcn/ui、Tailwind CSS 4、React Router DOM 7、Zustand |
| AI | AI SDK（openai/anthropic 协议）、工具调用、Puppeteer 网页抓取 |
| 数据库 | SQLite / MySQL / PostgreSQL（可通过环境变量切换） |
| 部署 | Docker Compose 单容器（Fastify 托管前端静态文件） |

## 目录结构

```
homibook/
├── backend/        # Fastify + Prisma 后端
│   ├── prisma/     # schema.prisma（SQLite 主 schema）+ 多库生成脚本
│   └── src/        # 路由、服务、AI 工具
├── frontend/       # React + Vite 前端
├── docker-compose.yml
└── .env.example    # Docker 部署环境变量模板
```

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

后端默认使用 **SQLite**（零配置）。数据库类型在 `backend/.env` 中通过两个环境变量控制：

| 变量 | 说明 | 示例 |
|---|---|---|
| `DATABASE_PROVIDER` | 数据库类型 | `sqlite` / `mysql` / `postgresql` |
| `DATABASE_URL` | 连接串 | `file:./dev.db` / `mysql://...` / `postgresql://...` |

### 为什么切换要重新生成 Client

Prisma Client 在 `generate` 时即与数据库类型**绑定**，且 schema 的 `provider` 必须是字面量。因此：
- 项目用一个 `schema.prisma`（SQLite）作为唯一源文件
- `prisma/generate-schemas.mjs` 按需生成 `prisma/mysql/schema.prisma` / `prisma/postgresql/schema.prisma` 副本（自动处理 MySQL 的 `@db.Text` 长文本、`@db.VarChar` 复合索引限制）
- `prisma/run.mjs` 是 npm scripts 的包装器，自动读取 `.env` 选择对应 schema

所以切换数据库后**必须重新执行 `npm run db:generate`**，否则运行时会出现 provider 不匹配错误。

### DDL 变更走 Prisma Migrate

**表结构（DDL）变更必须通过迁移管理，禁止 `db push --accept-data-loss` 覆盖数据**。

- **开发（单库）**：修改 `schema.prisma` 后执行 `npm run db:migrate`（`migrate dev`），生成迁移文件并应用到当前开发库
- **开发（多库一键）**：执行 `npm run db:migrate:all -- --name <迁移名>`，脚本会先重新生成所有 schema 副本，再对每个配置了连接串的数据库（sqlite + 可选的 `MYSQL_DATABASE_URL` / `POSTGRES_DATABASE_URL`）各生成一份迁移，未配置的库自动跳过
- **部署**：`docker-entrypoint.sh` 自动执行 `npm run db:deploy`（`migrate deploy`），按序应用已提交的迁移，绝不覆盖数据
- **提交内容**：`schema.prisma`、生成的副本 `prisma/mysql/schema.prisma` / `prisma/postgresql/schema.prisma`、以及各自的迁移目录都要**提交 git**（副本每次运行会自动重新生成，保证与主 schema 同步）
- **多库迁移历史各自独立**（由 schema 所在目录决定）：
  - sqlite → `backend/prisma/migrations/`
  - mysql → `backend/prisma/mysql/migrations/`
  - postgresql → `backend/prisma/postgresql/migrations/`


### SQLite（默认，开发首选）

`backend/.env` 保持：

```env
DATABASE_URL="file:./dev.db"
```

（`DATABASE_PROVIDER` 不写即默认 sqlite）

### 切换到 MySQL

1. 启动一个 MySQL。

   ```bash
   docker compose --profile mysql up -d mysql
   ```

2. 修改 `backend/.env`：

   ```env
   DATABASE_PROVIDER=mysql
   DATABASE_URL=mysql://homibook:homibook@localhost:3306/homibook
   ```

   如果用自己的 MySQL（如远程实例），把 `DATABASE_URL` 指向它即可。

3. 重新生成 Client 并同步表结构：

   ```bash
   npm run db:generate   # 终端应打印 [prisma] provider=mysql
   npm run db:push       # 在 MySQL 中创建表
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
# DATABASE_URL="file:./dev.db"
# （删除/注释 DATABASE_PROVIDER 和 mysql 连接串两行）

npm run db:generate
npm run db:push
npm run dev
```

### 注意事项

- **切换后必须重跑 `db:generate`**，client 与数据库类型绑定，漏跑会报 provider 不匹配
- **数据不会自动迁移**：切换数据库后表结构和数据都需自行处理。SQLite 与 MySQL 之间的数据不会自动同步
- **`db:push` 仅限本地开发库快速同步**：正式环境（含 Docker 部署）一律走迁移（`db:deploy`），绝不可在正式库用 `db push --accept-data-loss`
- 每个 `db:generate` / `db:push` / `db:migrate` 都会打印 `[prisma] provider=xxx schema=...`，可据此确认当前用的库
- 数据库相关命令：`npm run db:generate`、`npm run db:push`（仅开发）、`npm run db:migrate`（开发生成迁移）、`npm run db:deploy`（部署应用迁移）
- 新增了长文本字段时，需在 `backend/prisma/generate-schemas.mjs` 的 `LONG_TEXT_FIELDS` 中补充

## Docker 部署（单容器）

前端和后端打包在一个镜像中，由 Fastify 同时提供 API 和静态文件，无需 Nginx。

### 启动

```bash
cp .env.example .env   # 修改端口、JWT 密钥、数据库类型
docker compose up -d --build
```

访问 http://\<服务器IP\>:8080 即可。

**使用 DockerHub 预构建镜像**（无需本地构建）：把 `docker-compose.yml` 里的 `build: .` 改为 `image: <你的DockerHub用户名>/homibook:latest`。

**数据库表结构**：容器启动时自动执行 `migrate deploy` 应用已提交的迁移。

### 环境变量（.env）

| 变量 | 默认值 | 说明 |
|---|---|---|
| `PORT` | `8080` | 服务端口（内部+对外） |
| `JWT_SECRET` | 默认密钥 | **务必修改** |
| `DATABASE_PROVIDER` | `sqlite` | `sqlite` / `mysql` / `postgresql` |
| `DATABASE_URL` | `file:/app/data/dev.db` | 对应数据库连接串 |

### Docker 中使用 MySQL / PostgreSQL

```bash
# 1. .env 中设置
# DATABASE_PROVIDER=mysql
# DATABASE_URL=mysql://homibook:homibook@mysql:3306/homibook
# （Postgres 同理，host 用 postgres）

# 2. 带 profile 启动，会同时拉起数据库服务
docker compose --profile mysql up -d
# 或
docker compose --profile postgres up -d
```

SQLite 数据库文件和上传文件分别持久化在 `homibook-data`、`homibook-uploads` 卷中，容器重启不丢数据。

## AI 助手说明

- 在「设置 → AI 助手」中配置模型供应商（OpenAI/DeepSeek/Anthropic 等协议兼容接口）
- 支持联网搜索（Bing / 百度 / Google 可切换）、网页内容读取（Puppeteer + 系统 Chrome）
- 支持支付宝/微信/京东账单导入后由 AI 自动分类

## 更多文档

- `docs/agents/`：Agent 协作规范（Issue 追踪、标签、领域模型）

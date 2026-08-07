# 部署指南

> 面向部署用户：如何用 Docker Compose 部署 HomiBook（单容器镜像）。
> 本地开发与数据库切换见 [开发指南](development.md)。

## 目录

- [镜像仓库](#镜像仓库)
- [Docker Compose 部署](#docker-compose-部署)
  - [快速启动](#快速启动)
  - [环境变量（.env）](#环境变量env)
  - [SQLite 说明](#sqlite-说明)
  - [使用已有数据库](#使用已有数据库)
  - [升级与回滚](#升级与回滚)
- [常见问题](#常见问题)

## 镜像仓库

- DockerHub：https://hub.docker.com/repository/docker/saaangxy/homibook
- 镜像名：`saaangxy/homibook`，tag 为 `latest` 与 `v<版本号>`

## Docker Compose 部署

### 快速启动

```bash
cp .env.example .env   # 修改端口、JWT 密钥、数据库类型
docker compose up -d   # 从 DockerHub 拉取镜像启动
```

访问 http://\<服务器IP\>:8080 即可。

**本地构建镜像**（代替拉取）：

```bash
docker compose up -d --build
```

**指定版本 tag**：

```bash
IMAGE_TAG=v0.0.1 docker compose up -d
```

### 环境变量（.env）

| 变量 | 默认值 | 说明 |
|---|---|---|
| `PORT` | `8080` | 服务端口（内部 + 对外） |
| `JWT_SECRET` | 默认密钥 | **务必修改**为随机长字符串 |
| `DATABASE_PROVIDER` | `sqlite` | `sqlite` / `mysql` / `postgresql` |
| `DATABASE_URL` | `file:/app/data/dev.db` | 对应数据库连接串 |

完整模板见项目根目录 [.env.example](../.env.example)。

默认使用 SQLite，**适合个人 / 家庭记账**，无需额外部署数据库服务 简单可靠、零运维。

### 使用已有数据库

应用支持连接外部已有的 MySQL / PostgreSQL 实例（含云数据库），只需把连接串指向它即可，无需额外启动数据库服务：

```bash
# 使用已有的 MySQL
DATABASE_PROVIDER=mysql
DATABASE_URL=mysql://<用户名>:<密码>@<主机>:<端口>/<数据库名>

# 使用已有的 PostgreSQL
DATABASE_PROVIDER=postgresql
DATABASE_URL=postgresql://<用户名>:<密码>@<主机>:<端口>/<数据库名>
```

注意事项：

- 连接串中的数据库需已创建，且账号具备建表权限（容器启动时会自动执行 `migrate deploy` 建表）
- MySQL 连接参数采用 **mariadb 驱动**语法（Prisma 7 的 `@prisma/adapter-mariadb`）：
  - 禁用 SSL：追加 `?ssl=0`（如 `mysql://.../homibook?ssl=0`）
  - 允许服务端获取公钥（`caching_sha2_password` 认证）：追加 `&allowPublicKeyRetrieval=true`
  - ⚠️ 不支持 mysql2 的 `useSSL` / `sslaccept` / `sslverify` 等参数（会被忽略）；若服务器强制 SSL 且证书不可信，需在 `backend/src/lib/prisma.ts` 的 mysql 分支为 adapter 传 `{ ssl: { rejectUnauthorized: false } }`
- 数据库主机名需从容器内可访问：若数据库与容器在同一台机器，用宿主机 IP 而非 `localhost`

### 升级与回滚

```bash
# 升级到最新镜像
docker compose pull && docker compose up -d

# 回滚到指定版本
IMAGE_TAG=v0.0.1 docker compose up -d
```

## 常见问题
**Q：如何查看 API 文档？**
A：部署后访问 `http://<地址>:8080/docs`（Scalar UI），OpenAPI 规范由 Fastify 路由 schema 自动生成。

**Q：SQLite 数据存在哪里？**
A：数据库文件在容器内 `/app/data`。如需长期保留，将 `.env` 中 `DATABASE_URL` 指向持久化路径或改用 MySQL/PostgreSQL（见[使用已有数据库](#使用已有数据库)）。

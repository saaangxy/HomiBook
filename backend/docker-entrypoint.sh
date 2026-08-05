#!/bin/sh
set -e

# 数据库类型：sqlite | mysql | postgresql（默认 sqlite）
DATABASE_PROVIDER="${DATABASE_PROVIDER:-sqlite}"
echo "[homibook] 数据库类型: ${DATABASE_PROVIDER}"

# Prisma Client 在 generate 时即与数据库类型绑定，须按 provider 重新生成
echo "[homibook] 生成 Prisma Client..."
node prisma/run.mjs generate

echo "[homibook] 应用数据库迁移 (prisma migrate deploy)..."
# 正式版：migrate deploy 只按序应用 migrations 中未应用的迁移，绝不覆盖数据。
# 注意：正式部署前必须在开发环境用 migrate dev 生成初始迁移并提交 git，
# 否则 migrations 为空时不会建表、应用启动会因缺少表而失败。
# mysql/postgresql 首次启动需要初始化时间，重试等待数据库就绪
retries=0
until node prisma/run.mjs migrate deploy; do
  retries=$((retries + 1))
  if [ "$retries" -ge 10 ]; then
    echo "[homibook] 数据库迁移失败（已重试 10 次）"
    exit 1
  fi
  echo "[homibook] 数据库未就绪，5 秒后重试 ($retries/10)..."
  sleep 5
done

echo "[homibook] 启动后端服务 (PORT=${PORT:-3002})..."
exec node dist/index.js

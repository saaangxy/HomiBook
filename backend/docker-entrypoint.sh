#!/bin/sh
set -e

# 数据库类型：sqlite | mysql | postgresql（默认 sqlite）
DATABASE_PROVIDER="${DATABASE_PROVIDER:-sqlite}"
echo "[homibook] 数据库类型: ${DATABASE_PROVIDER}"

# Prisma Client 在 generate 时即与数据库类型绑定，须按 provider 重新生成
echo "[homibook] 生成 Prisma Client..."
node prisma/run.mjs generate

echo "[homibook] 同步数据库结构 (prisma db push)..."
# --accept-data-loss：本项目的开发流程用 db push 而非 migrations，
# 容器每次启动幂等同步表结构，避免交互式确认导致挂起
# mysql/postgresql 首次启动需要初始化时间，重试等待数据库就绪
retries=0
until node prisma/run.mjs db push --skip-generate --accept-data-loss; do
  retries=$((retries + 1))
  if [ "$retries" -ge 10 ]; then
    echo "[homibook] 数据库同步失败（已重试 10 次）"
    exit 1
  fi
  echo "[homibook] 数据库未就绪，5 秒后重试 ($retries/10)..."
  sleep 5
done

echo "[homibook] 启动后端服务 (PORT=${PORT:-3002})..."
exec node dist/index.js

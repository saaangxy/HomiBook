#!/bin/sh
set -e

echo "[homibook] 同步数据库结构 (prisma db push)..."
# --accept-data-loss：本项目的开发流程用 db push 而非 migrations，
# 容器每次启动幂等同步表结构，避免交互式确认导致挂起
npx prisma db push --skip-generate --accept-data-loss

echo "[homibook] 启动后端服务 (PORT=${PORT:-3002})..."
exec node dist/index.js

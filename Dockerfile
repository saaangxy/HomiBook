# =========================================================
# 单容器构建：前端 + 后端打包到一个镜像
# 通过 GitHub CI 构建，推送到 DockerHub
# Puppeteer 自带 Chrome for Testing（无需 apt 安装 Chromium）
# =========================================================

# ---- 前端构建 ----
FROM node:22-slim AS frontend-build
WORKDIR /app
COPY frontend/package.json frontend/yarn.lock ./
RUN yarn install --frozen-lockfile
COPY frontend/ .
RUN yarn build

# ---- 后端构建（完整依赖，用于 tsc 编译）----
FROM node:22-slim AS backend-build
WORKDIR /app
ENV PUPPETEER_SKIP_DOWNLOAD=true
# Prisma 7 为纯 JS 客户端 + driver adapter，无需 Rust 引擎二进制（openssl 不再需要）
# build tools：better-sqlite3 原生模块在预编译二进制拉取失败时需源码编译（node-gyp）
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ \
    && rm -rf /var/lib/apt/lists/*
COPY backend/package.json backend/package-lock.json ./
COPY backend/prisma ./prisma
COPY backend/prisma.config.ts ./
RUN npm ci
COPY backend/tsconfig.json ./
COPY backend/src ./src
# 先生成 Prisma Client 到 src/generated，再 tsc 编译
RUN npx prisma generate && npm run build

# ---- 生产依赖（仅 dependencies，Puppeteer 自动下载 Chrome）----
FROM node:22-slim AS prod-deps
WORKDIR /app
ENV PUPPETEER_CACHE_DIR=/app/node_modules/.cache/puppeteer
# unzip：Puppeteer 解压 Chrome；python3/make/g++：better-sqlite3 源码编译兜底；Prisma 7 无引擎二进制
RUN apt-get update && apt-get install -y --no-install-recommends unzip python3 make g++ \
    && rm -rf /var/lib/apt/lists/*
COPY backend/package.json backend/package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

# ---- 运行阶段 ----
FROM node:22-slim AS runtime
ENV NODE_ENV=production
ENV PUPPETEER_CACHE_DIR=/app/node_modules/.cache/puppeteer
# Chrome for Testing 需要的共享库（Puppeteer 自带浏览器本体）
RUN apt-get update && apt-get install -y --no-install-recommends \
      ca-certificates fonts-liberation fonts-wqy-zenhei \
      libasound2 libatk-bridge2.0-0 libatk1.0-0 libcairo2 libcups2 \
      libdbus-1-3 libdrm2 libexpat1 libgbm1 libglib2.0-0 libgtk-3-0 \
      libnspr4 libnss3 libpango-1.0-0 libx11-6 libxcb1 \
      libxcomposite1 libxdamage1 libxext6 libxfixes3 libxkbcommon0 \
      libxrandr2 xdg-utils \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=backend-build /app/dist ./dist
COPY --from=backend-build /app/prisma ./prisma
# prisma.config.ts：运行时 migrate deploy 依赖它按 DATABASE_PROVIDER 选择 schema
COPY --from=backend-build /app/prisma.config.ts ./prisma.config.ts
COPY --from=backend-build /app/package.json ./package.json
COPY --from=frontend-build /app/dist ./public

COPY backend/docker-entrypoint.sh ./docker-entrypoint.sh
RUN chmod +x docker-entrypoint.sh

EXPOSE 8080

ENTRYPOINT ["./docker-entrypoint.sh"]

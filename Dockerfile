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
RUN apt-get update && apt-get install -y --no-install-recommends openssl \
    && rm -rf /var/lib/apt/lists/*
COPY backend/package.json backend/package-lock.json ./
COPY backend/prisma ./prisma
RUN npm ci && npx prisma generate
COPY backend/tsconfig.json ./
COPY backend/src ./src
RUN npm run build

# ---- 生产依赖（仅 dependencies，Puppeteer 自动下载 Chrome）----
FROM node:22-slim AS prod-deps
WORKDIR /app
ENV PUPPETEER_CACHE_DIR=/app/node_modules/.cache/puppeteer
RUN apt-get update && apt-get install -y --no-install-recommends openssl \
    && rm -rf /var/lib/apt/lists/*
COPY backend/package.json backend/package-lock.json ./
COPY backend/prisma ./prisma
RUN npm ci --omit=dev && npx prisma generate && npm cache clean --force

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
COPY --from=backend-build /app/package.json ./package.json
COPY --from=frontend-build /app/dist ./public

COPY backend/docker-entrypoint.sh ./docker-entrypoint.sh
RUN chmod +x docker-entrypoint.sh

EXPOSE 8080

ENTRYPOINT ["./docker-entrypoint.sh"]

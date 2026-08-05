# =========================================================
# 单容器构建：前端 + 后端打包到一个镜像
# Fastify 同时提供 API 和前端静态文件，无需 Nginx
#
# 镜像源默认用国内（本地构建快），GitHub CI 可通过 --build-arg 覆盖为默认源
# =========================================================

# 默认值（国内镜像）；GitHub CI 传 --build-arg APT_MIRROR= 等覆盖为空则用官方源
ARG APT_MIRROR=mirrors.aliyun.com
ARG NPM_REGISTRY=https://registry.npmmirror.com
ARG YARN_REGISTRY=https://registry.npmmirror.com

# ---- 前端构建 ----
FROM node:22-slim AS frontend-build
ARG YARN_REGISTRY
WORKDIR /app
ENV YARN_REGISTRY=${YARN_REGISTRY}
COPY frontend/package.json frontend/yarn.lock ./
RUN yarn install --frozen-lockfile
COPY frontend/ .
RUN yarn build

# ---- 后端构建 ----
FROM node:22-slim AS backend-build
ARG APT_MIRROR
ARG NPM_REGISTRY
WORKDIR /app
ENV PUPPETEER_SKIP_DOWNLOAD=true
ENV npm_config_registry=${NPM_REGISTRY}
# openssl：Prisma 需检测 libssl 版本以选对引擎
RUN if [ -n "$APT_MIRROR" ]; then \
      sed -i "s|deb.debian.org|$APT_MIRROR|g; s|security.debian.org|$APT_MIRROR|g" \
        /etc/apt/sources.list.d/debian.sources; \
    fi \
    && apt-get update && apt-get install -y --no-install-recommends openssl \
    && rm -rf /var/lib/apt/lists/*
COPY backend/package.json backend/package-lock.json ./
RUN npm ci
COPY backend/prisma ./prisma
RUN npx prisma generate
COPY backend/tsconfig.json ./
COPY backend/src ./src
RUN npm run build

# ---- 运行阶段 ----
FROM node:22-slim AS runtime
ARG APT_MIRROR
ENV NODE_ENV=production
# Chromium（Puppeteer 网页抓取用）：Debian 仓库自带，国内外都能下，无需 dl.google.com
# 安装后路径 /usr/bin/chromium，与 browser-config.ts 中的查找路径一致
RUN if [ -n "$APT_MIRROR" ]; then \
      sed -i "s|deb.debian.org|$APT_MIRROR|g; s|security.debian.org|$APT_MIRROR|g" \
        /etc/apt/sources.list.d/debian.sources; \
    fi \
    && apt-get update && apt-get install -y --no-install-recommends \
      ca-certificates chromium fonts-liberation fonts-noto-cjk \
      libasound2 libatk-bridge2.0-0 libcups2 libdbus-1-3 libdrm2 \
      libgbm1 libnspr4 libnss3 libxcomposite1 libxdamage1 libxrandr2 xdg-utils \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# 后端产物
COPY --from=backend-build /app/node_modules ./node_modules
COPY --from=backend-build /app/dist ./dist
COPY --from=backend-build /app/prisma ./prisma
COPY --from=backend-build /app/package.json ./package.json

# 前端产物（作为 public/ 目录，由 Fastify 托管静态文件）
COPY --from=frontend-build /app/dist ./public

# 启动脚本：应用迁移后启动服务
COPY backend/docker-entrypoint.sh ./docker-entrypoint.sh
RUN chmod +x docker-entrypoint.sh

EXPOSE 8080

ENTRYPOINT ["./docker-entrypoint.sh"]

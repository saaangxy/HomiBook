# =========================================================
# 后端构建阶段：安装依赖 + 生成 Prisma Client + 编译 TS
# =========================================================
FROM node:22-slim AS build
WORKDIR /app

# Puppeteer 在运行镜像中通过 apt 安装系统 Chrome，这里跳过其自带浏览器下载
ENV PUPPETEER_SKIP_DOWNLOAD=true

# 安装 openssl（Prisma 需检测 libssl 版本以选对引擎）
RUN apt-get update && apt-get install -y --no-install-recommends openssl \
    && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json ./
RUN npm ci

# 生成 Prisma Client
COPY prisma ./prisma
RUN npx prisma generate

# 编译 TypeScript
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

# =========================================================
# 后端运行阶段：安装 Google Chrome（Puppeteer 网页抓取用）
# =========================================================
FROM node:22-slim AS runtime
ENV NODE_ENV=production

# 安装 Google Chrome stable，路径为 /usr/bin/google-chrome
# 与 backend/src/services/ai/browser-config.ts 中的查找路径一致
RUN apt-get update && apt-get install -y --no-install-recommends \
      ca-certificates \
      gnupg \
      wget \
      fonts-liberation \
      fonts-noto-cjk \
      libasound2 \
      libatk-bridge2.0-0 \
      libcups2 \
      libdbus-1-3 \
      libdrm2 \
      libgbm1 \
      libnspr4 \
      libnss3 \
      libxcomposite1 \
      libxdamage1 \
      libxrandr2 \
      xdg-utils \
    && wget -q -O - https://dl.google.com/linux/linux_signing_key.pub | gpg --dearmor -o /usr/share/keyrings/google-chrome.gpg \
    && echo "deb [arch=amd64 signed-by=/usr/share/keyrings/google-chrome.gpg] http://dl.google.com/linux/chrome/deb/ stable main" > /etc/apt/sources.list.d/google-chrome.list \
    && apt-get update \
    && apt-get install -y --no-install-recommends google-chrome-stable \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# 从构建阶段拷贝产物
# node_modules 包含 devDependencies（prisma CLI），用于容器启动时 migrate deploy
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/prisma ./prisma
COPY --from=build /app/package.json ./package.json

# 启动脚本：应用迁移后启动服务
COPY docker-entrypoint.sh ./docker-entrypoint.sh
RUN chmod +x docker-entrypoint.sh

EXPOSE 3002

ENTRYPOINT ["./docker-entrypoint.sh"]

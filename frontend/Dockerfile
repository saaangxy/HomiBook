# =========================================================
# 前端构建阶段：yarn 安装依赖 + 编译 Vite 产物
# =========================================================
FROM node:22-slim AS build
WORKDIR /app

COPY package.json yarn.lock ./
RUN yarn install --frozen-lockfile

COPY . .
RUN yarn build

# =========================================================
# 前端运行阶段：Nginx 托管静态文件 + 反向代理后端 API
# =========================================================
FROM nginx:alpine

COPY --from=build /app/dist /usr/share/nginx/html

# Nginx 官方镜像会自动用 envsubst 处理 /etc/nginx/templates/*.template，
# 将 ${BACKEND_HOST}/${BACKEND_PORT} 替换为运行时环境变量
COPY nginx.conf.template /etc/nginx/templates/default.conf.template

# 默认值（docker-compose 可覆盖）
ENV BACKEND_HOST=backend \
    BACKEND_PORT=3002

EXPOSE 80

<div align="center">

# 🏠 HomiBook 家庭记账本

前后端分离的家庭记账应用，内置 AI 记账助手，支持自然语言记账、账单导入、支出分析与联网搜索。

<p align="center">
  <img alt="release" src="https://img.shields.io/github/v/release/saaangxy/HomiBook" />
  <img alt="license" src="https://img.shields.io/github/license/saaangxy/HomiBook" />
  <img alt="last-commit" src="https://img.shields.io/github/last-commit/saaangxy/HomiBook" />
  <img alt="stars" src="https://img.shields.io/github/stars/saaangxy/HomiBook" />
  <img alt="docker-pulls" src="https://img.shields.io/docker/pulls/saaangxy/homibook" />
</p>

<p align="center">
  <img alt="TypeScript" src="https://img.shields.io/badge/TypeScript-5.x-blue" />
  <img alt="React" src="https://img.shields.io/badge/React-19-blue" />
  <img alt="Fastify" src="https://img.shields.io/badge/Fastify-5-blue" />
  <img alt="Prisma" src="https://img.shields.io/badge/Prisma-7-blue" />
  <img alt="Tailwind CSS" src="https://img.shields.io/badge/Tailwind%20CSS-4-blue" />
  <img alt="SQLite/MySQL/PostgreSQL" src="https://img.shields.io/badge/DB-SQLite%20%7C%20MySQL%20%7C%20PostgreSQL-green" />
</p>

</div>

---

## 🌐 在线演示

体验地址：**https://homibook-demo.onrender.com**

| 账号 | 密码 |
|---|---|
| `admin` | `Ad123456` |

> 演示站为免费实例，SQLite 数据为临时存储，重启后重置；首次访问加载稍慢属正常现象。

---

## ✨ 功能特点

- 📊 **流水管理**：记录收入与支出，支持多账户、多分类、备注与附件
- 📅 **流水日历**：日历视图直观展示每日收支
- 📈 **统计分析**：多维度的收支统计，了解消费习惯
- 🎯 **预算管理**：设定预算，实时监控支出进度
- 🔁 **固定收支**：周期性的收入/支出自动生成，省去重复记账
- 📚 **多账本管理**：多个账本分类整理不同用途的账目
- 👪 **多人协作**：家庭成员共享账本，支持管理员与成员角色
- 🏦 **多账户管理**：现金、银行卡、微信、支付宝等账户统一管理
- 🤖 **AI 记账助手**：智能财务管理
  - 🗣 自然语言记账：说一句话即可生成一笔流水
  - 📥 账单导入：支付宝 / 微信 / 京东账单一键导入，AI 自动分类
  - 🔍 联网搜索：支持 Bing / 百度 / Google 切换
  - 🌐 网页内容读取：Puppeteer 抓取网页内容辅助分析
  - 💬 问答交互：回答财务与记账相关的问题
- 🎨 **多主题**：深色 / 浅色 / 跟随系统

## 📸 页面预览

<!--
截图待补充：运行应用后在浏览器截图，保存到 screenshots/ 目录并替换下方路径
命名规范见 screenshots/README.md

![首页](screenshots/home.png)
![统计分析](screenshots/stats.png)
![流水日历](screenshots/calendar.png)
![流水管理](screenshots/records.png)
![AI 记账助手](screenshots/ai-assistant.png)
-->

## 🛠 技术栈

| 端 | 技术 |
|---|---|
| 后端 | Node.js + TypeScript (ESM)、Fastify 5、Prisma 7、Zod |
| 前端 | React 19 + TypeScript、Vite、Shadcn/ui、Tailwind CSS 4、React Router DOM 7、Zustand、TanStack Query |
| AI | AI SDK、工具调用、Puppeteer 网页抓取 |
| 数据库 | SQLite / MySQL / PostgreSQL（环境变量切换） |
| 部署 | 单容器镜像（Fastify 托管前端静态文件）、Docker Compose、CI/CD 自动构建 |

## 📂 目录结构

```
homibook/
├── backend/            # Fastify + Prisma 后端
│   ├── prisma/         # schema.prisma（SQLite 主 schema）+ 多库生成脚本
│   └── src/            # 路由、服务、AI 工具
├── frontend/           # React + Vite 前端
├── docs/               # 文档（开发指南、部署指南等）
├── screenshots/        # README 页面截图
├── example/            # 账单导入示例文件
├── docker-compose.yml  # 单容器部署编排
├── Dockerfile          # 单容器镜像构建
├── .env.example        # 部署环境变量模板
├── render.yaml         # Render 演示站配置
└── .gitlab-ci.yml      # GitLab → GitHub 同步
```

## 🚀 快速开始

### 本地开发

需要 Node.js 22+。

```bash
# 1. 后端（端口 3002）
cd backend
npm install
npm run dev

# 2. 前端（Vite 默认端口 5173，/api 自动代理到后端 3002）
cd frontend
yarn install
yarn dev
```

打开 http://localhost:5173 即可。

### Docker 部署

```bash
cp .env.example .env   # 修改端口、JWT 密钥、数据库类型
docker compose up -d   # 或使用 DockerHub 预构建镜像
```

访问 http://\<服务器IP\>:8080 即可。

> 更详细的部署方式（MySQL/PostgreSQL、Render、CI/CD）见 **[部署指南](docs/deployment.md)**

## 🤖 AI 记账助手

- 在「设置 → AI 助手」中配置模型供应商（支持 OpenAI / DeepSeek / Anthropic 等兼容协议）
- 在「设置 → API 密钥」中配置密钥
- 支持联网搜索（Bing / 百度 / Google 可切换）、网页内容读取
- 支持支付宝 / 微信 / 京东账单导入后由 AI 自动分类

## 📚 更多文档

| 文档 | 说明 |
|---|---|
| [开发指南](docs/development.md) | 本地启动、数据库切换（SQLite/MySQL/PostgreSQL）、DDL 迁移规范 |
| [部署指南](docs/deployment.md) | Docker 单容器部署、环境变量、MySQL/PostgreSQL、升级回滚 |
| `docs/agents/` | Agent 协作规范（Issue 追踪、标签、领域模型） |

## 🤝 贡献

欢迎任何形式的贡献！流程：

1. Fork 本仓库
2. 创建功能分支（`git checkout -b feature/AmazingFeature`）
3. 提交修改（`git commit -m 'Add some AmazingFeature'`）
4. 推送分支（`git push origin feature/AmazingFeature`）
5. 发起 Pull Request

## 📄 许可证

本项目采用 MIT 许可证 - 详情请参阅 [LICENSE](LICENSE) 文件。

## 🔗 相关链接

- [在线演示](https://homibook-demo.onrender.com)
- [GitHub 仓库](https://github.com/saaangxy/HomiBook)
- [DockerHub 镜像](https://hub.docker.com/repository/docker/saaangxy/homibook)
- [问题反馈](https://github.com/saaangxy/HomiBook/issues)

---

*HomiBook - 让记账更简单，家庭财务更清晰！*

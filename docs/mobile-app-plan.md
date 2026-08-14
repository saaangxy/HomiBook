# homibook 移动端 App(设计优先)方案

## Context

为项目新增一个移动端 App 客户端。仓库当前是 monorepo(`backend/` + `frontend/`),决定**同仓新建 `mobile/` 文件夹**,延续现有结构。

**本次只做设计优先的纯页面**:页面能看、能点,数据全部用**模拟数据**,先把布局/动画/特效打磨好,再对接后端和写真实逻辑。

**已确认决策**:
1. **位置**:同仓 `mobile/` 文件夹
2. **技术栈**:Expo / React Native + TypeScript + Expo Router(文件路由)
3. **样式**:NativeWind(Tailwind for RN,与 web 的 Tailwind 写法一致)
4. **主题**:先做基础浅色/深色(橙色主色),创意主题后续再加
5. **首版范围**:核心 6 屏(登录/注册、首页、流水、统计、设置、记账新增),全部模拟数据

**设计标杆**:web 端移动视觉——4 Tab 底部导航(首页/流水/统计/设置)、橙色主色 `24 95% 53%`、圆角卡片、安全区适配(`env(safe-area-inset-bottom)`)、HSL 色板 token。

**app 端与 web 的架构差异(必须体现)**:
- web 与后端同源,无需配置;app 是**独立客户端**,必须让用户**配置服务器 Base URL**
- app 需要**本地保存 Base URL 与登录凭证**,支持**自动登录**
- 支持**服务器切换**(如演示站 / 自建站)
- 因此认证流程为:首次启动 → 配置服务器 Base URL → 登录(账号/密码) → 保存凭证 → 后续自动登录;设置里可切换服务器/退出

---

## 新增:服务器配置与登录态(设计优先)

- **登录/注册屏**含 Base URL 输入(或独立的"服务器配置"引导页),账号/密码 + "记住登录"开关
- **凭证持久化**:用 `expo-secure-store`(Keychain/Keystore)加密保存 Base URL + 登录凭证/Token,而非明文 AsyncStorage
- **自动登录**:启动时若已保存凭证→直接进入主界面,跳过登录
- **服务器切换**:设置里维护服务器列表(增/改/删/切换),切换后重新登录
- 本次为设计优先:先做这些屏的 UI 与 mock,持久化/真实鉴权逻辑后续接

---

## 涉及(新建)目录结构

```
mobile/
  app/                    # Expo Router 路由
    _layout.tsx           # 根布局:主题 Provider + 栈
    (auth)/login.tsx      # 登录
    (auth)/register.tsx   # 注册
    (tabs)/_layout.tsx    # 底部 4 Tab
    (tabs)/index.tsx      # 首页
    (tabs)/records.tsx    # 流水
    (tabs)/stats.tsx      # 统计
    (tabs)/settings.tsx   # 设置
    add-record.tsx        # 记账新增(modal/screen)
  src/
    theme/                # 设计 token + 浅/深色板(NativeWind 类)
    components/           # 复用组件(卡片/列表行/图表占位/按数字键盘等)
    mock/                 # 模拟数据(typed)
    services/             # 数据访问层接口(先 mock,后接真实 API)
    types/                # 领域类型(镜像 frontend/src/api)
  global.css / tailwind.config.ts / metro.config.js   # NativeWind 配置
```

## 1. 工程脚手架

- `npx create-expo-app@latest mobile --template default`(默认模板含 expo-router + TS)
- 原生/Expo 依赖一律用 `npx expo install <pkg>` 安装,确保版本与 SDK 匹配;NativeWind/Tailwind 用 npm
- 配置 NativeWind v4:创建 `global.css`、`tailwind.config.ts`、`metro.config.js`(babel 插件、css 支持)
- 安全区:用 `react-native-safe-area-context`(Expo Router 默认带)

### 技术栈版本规划(2026-08,SDK 56 稳定版)

| 依赖 | 版本 | 说明 |
|------|------|------|
| Node.js | v22.23.2(本机) | SDK 56 需 ≥20.19,满足 |
| **Expo SDK** | **~56.0.0** | 当前稳定版(56 分支) |
| React Native | **0.85** | SDK 56 捆绑 |
| React | **19.2.3** | SDK 56 捆绑 |
| expo-router | ~56.2.7 | 文件路由 |
| TypeScript | ~5.9 | Expo SDK 56 默认 |
| react-native-reanimated | **4.5.1** | 动画 |
| react-native-safe-area-context | ~5.7.0 | 安全区 |
| react-native-screens | 4.26.0 | 导航原生屏 |
| react-native-gesture-handler | ~3.1.0 | 手势 |
| @expo/vector-icons | ^15.0.2 | 图标 |
| expo-secure-store | SDK 匹配 | 凭证加密保存 |
| expo-linear-gradient | SDK 匹配 | 渐变 |
| expo-haptics | SDK 匹配 | 触感 |
| react-native-svg | SDK 匹配 | 图表(雷达/趋势) |
| **NativeWind** | **4.2.0** | 稳定版,配 Tailwind v3 |
| **tailwindcss** | **^3.4**(同 web) | NativeWind v4 用 v3;v5(预发布,走 Tailwind v4)暂不用 |

> 全部 `expo/*` 与 RN 原生依赖用 `npx expo install` 安装,由 Expo 自动锁定与 SDK 56 匹配的版本。

## 2. 设计 token(基础浅/深)

在 `src/theme/` 定义映射 web 的 HSL 色板为 RN 颜色,浅/深两套,供 NativeWind 类使用:

| token | 浅色 | 深色 | 说明 |
|-------|------|------|------|
| background | #fff | #0f172a 系 | 背景 |
| card | #fff | #1e293b 系 | 卡片 |
| primary | `#f97316`(24 95% 53%) | 同左 | 主色橙 |
| primary-foreground | #fff | #fff | |
| secondary / muted | #f1f5f9 | #334155 系 | |
| muted-foreground | #64748b | #94a3b8 | 次要文字 |
| border | #e2e8f0 | #334155 系 | 边框 |
| destructive | #ef4444 | 同左 | 删除/超支 |
| 收入绿 / 支出红 | #22c55e / #ef4444 | 同左 | 流水金额 |

- 圆角:卡片 `rounded-2xl`、按钮 `rounded-full`/`rounded-xl`
- 字体:系统默认(PingFang SC / SF),金额用 `tabular-nums`
- 底部 Tab、安全区、状态栏(浅色黑字/深色白字)适配

## 3. 导航与登录态(Expo Router + 持久化)

- 启动引导:读本地凭证(`expo-secure-store`)→ 有则**自动登录**进 tabs;无则进登录/服务器配置
- 路由组:
  - `(auth)`:服务器配置 + 登录 / 注册(可含 Base URL 输入、记住登录)
  - `(tabs)`:4 Tab 底部导航,图标+label,active 主色橙(镜像 web BottomNav)
    - 首页 `/`、流水 `/records`、统计 `/stats`、设置 `/settings`
  - `add-record`:记账新增,从首页/流水 FAB 进入的 modal 或 push screen
  - `(server)`:服务器管理(增/改/删/切换),从设置进入

## 4. 核心 7 屏(纯 UI + 模拟数据)

数据统一从 `src/mock/` 读取,页面不直接发请求。

1. **服务器配置/登录**:Base URL 输入(含示例/快捷填)、账号/密码+可见切换、"记住登录"开关、登录按钮、服务器连接状态提示、入场动画
2. **首页**:问候语+当前账本卡、本日/本月摘要卡(收入/支出/结余)、预算预警条、最近流水预览、AI 助手入口卡
3. **流水**:月份/筛选条、流水卡片列表(分类图标、金额收入绿/支出红、备注)、下拉刷新手势、右下角"记一笔"FAB
4. **统计**:摘要卡 + 财务健康雷达/趋势图(用 `react-native-svg` 或图表占位)、时间范围切换(月/年)
5. **设置**:用户信息、**服务器切换入口**(当前 baseurl + 切换/管理)、主题切换(浅/深)、账本管理入口、AI 配置入口、退出登录(清凭证)
6. **记账新增**:金额数字键盘(大号)、分类图标九宫格、账户选择、日期、备注,保存按钮
7. **服务器管理**:服务器列表(名称+baseurl+当前选中)、增/改/删、切换后重新登录提示

## 5. 模拟数据层 + 配置/登录态

`src/mock/` 提供 typed 数据 + `src/services/` 提供访问接口:

- `types/`:镜像 `frontend/src/api/*.ts` 的领域类型(AccountItem/RecordItem/RecordSummary/BudgetItem 等)
- `mock/data.ts`:账户、流水、预算、统计、分类等示例数据
- `services/`:如 `useRecords()`,内部先返回 mock;`services/server.ts` 管理 Base URL 列表与当前选中(mock),`services/auth.ts` 管理登录态(记住登录)。后续替换为真实 API + `expo-secure-store` 持久化,页面零改动

## 6. 动画与特效

- **Reanimated**:页面入场淡入/上移、列表项 stagger 逐个出现、Tab 切换指示器、FAB 按压缩放、卡片按压缩放反馈
- **expo-linear-gradient**:摘要卡、首页横幅的渐变背景
- **expo-haptics**:按钮/ Tab / 记账确认的触感反馈
- 统一封装 `AnimatedPressable`、`FadeInView` 等可复用动画组件

## 7. 明确不做(本次)

- **后端对接 / 真实 API 调用**(用 mock 占位,接口层已留)
- **登录/注册真实校验逻辑**(含 Base URL 连通性检测、Token 管理)
- **真实持久化**(`expo-secure-store` 加密存凭证、自动登录的具体实现——本次只做 UI,接口层已留)
- **真实数据拉取 / 状态管理(接后端)**
- **创意多主题**(留给后续)

> 本次是**设计优先**:服务器配置、自动登录、服务器切换这些屏的 **UI/交互/动效**先做出来,底层持久化与真实鉴权在后续对接阶段用预留的 `services/server.ts`、`services/auth.ts` 接上 `expo-secure-store` 与真实 API。

---

## 验证

1. **运行**:`cd mobile && npx expo start`,iOS 模拟器 / Android 模拟器 / Expo Go 打开
2. **屏渲染**:服务器配置/登录、首页、流水、统计、设置、记账新增、服务器管理均能用模拟数据正常展示、可点击跳转
3. **登录态 UI**:登录(含 Base URL 输入、记住登录开关)、设置里服务器切换入口、服务器管理增改删切、退出登录清凭证——交互与动效可跑通
4. **动效**:入场动画、列表 stagger、FAB 缩放、按压反馈、Tab 切换指示器均流畅
5. **主题**:浅/深色切换生效,状态栏/安全区适配正确
6. **类型**:`cd mobile && npx tsc --noEmit` 无错误
7. **后续衔接**:`services/` 接口签名与 web `frontend/src/api` 对齐,确保未来替换 mock→真实 API + `expo-secure-store` 无需改页面
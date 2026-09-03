// 移动端多主题调色板 —— 与网页端 frontend/src/themes/index.ts 同源
// 颜色一律 hsl() 字符串(RN 原生支持),token 取自网页端 HSL 变量,保证两端主题长期同步。
// 注意:RN 文字颜色取自 colors.foreground,因此深底主题(如 telegram)的 card 必须为深面,
// 不能像网页端那样用浅色纸卡(否则卡内浅字不可读)——此类差异已逐主题注明。

export type PaletteId = 'light' | 'dark' | 'craft' | 'telegram' | 'botanical' | 'candy' | 'mondrian';
export type ThemeId = 'system' | PaletteId;

export interface ThemeColors {
  background: string;      // 页面底
  card: string;            // 卡片面
  elevated: string;        // 浮层/输入框面
  foreground: string;      // 正文
  muted: string;           // 次要面
  mutedForeground: string; // 次要文字
  border: string;          // 边线
  hairline: string;        // 发丝线
  primary: string;         // 主操作
  primaryForeground: string;
  secondary: string;
  secondaryForeground: string;
  accent: string;          // 点缀
  accentForeground: string;
  destructive: string;
  ring: string;            // 聚焦环
  income: string;          // 收入绿(色相跨主题不变,仅调明度)
  expense: string;         // 支出红
  transfer: string;        // 转账蓝
  white: string;
  /** 图表 6 色板 */
  chart: string[];
  /** 品牌渐变(首页总览卡/主按钮) */
  gradient: [string, string, string];
}

export interface ThemeRadius {
  card: number;
  input: number;
  button: number;   // 999 = pill
  sheet: number;    // 底部弹窗顶角
}

export interface ThemeFonts {
  regular?: string;
  medium?: string;
  bold?: string;
  /** 标题展示字(如 mondrian 的 Bebas Neue) */
  display?: string;
  /** 金额/数字专用(等宽或展示字) */
  numeric?: string;
}

/** 卡片质感策略 */
export interface ThemeCardStyle {
  borderWidth: number;
  /** soft=柔和投影 tinted=彩色投影 none=无阴影(配合实线边框) hard=硬偏移影(方角复古主题) */
  shadow: 'soft' | 'tinted' | 'none' | 'hard';
}

/** 侧边栏专属色组(对齐 web 端 --sidebar-* 变量,让特色主题的 chrome 与内容区拉开层次) */
export interface ThemeSidebarColors {
  background: string;        // web --sidebar-background
  foreground: string;        // web --sidebar-foreground
  primary: string;           // 激活项/Logo → web --sidebar-primary
  primaryForeground: string; // web --sidebar-primary-foreground
  accent: string;            // 用户卡/次级面 → web --sidebar-accent
  accentForeground: string;  // web --sidebar-accent-foreground
  border: string;            // web --sidebar-border
}

/** 记一笔 FAB 主题样式(按主题差异化按钮形态) */
export interface ThemeFab {
  /** 是否叠加品牌渐变(false 用纯 primary 底色) */
  gradient: boolean;
  borderWidth: number;
  /** 边框色;null = 底栏色(sidebar.background),形成嵌入底栏的开口 */
  borderColor: string | null;
  /** glow=品牌色光晕投影 hard=硬偏移影 */
  shadow: 'glow' | 'hard';
  /** 主题专属图片(如糖果铺的糖果罐);设置后优先于渐变/纯色渲染,且不再叠加 Plus 图标 */
  image?: number;
  /** 图片模式下的按钮底色(浅色图片需要衬托时用);缺省透明 */
  backgroundColor?: string;
}

/** 主题装饰声明(数据层,渲染见 decor.tsx) */
export interface ThemeDecor {
  /** 页面背景纹理类型 */
  backdrop: 'none' | 'ledger' | 'scanlines' | 'fiber' | 'grid';
  /** 抽屉遮罩 rgb 三元组(如 '0,0,0') */
  scrim: string;
}

export interface Palette {
  id: PaletteId;
  name: string;
  description: string;
  mode: 'light' | 'dark';
  colors: ThemeColors;
  radius: ThemeRadius;
  fonts: ThemeFonts;
  cardStyle: ThemeCardStyle;
  /** 侧边栏专属色组;未声明的主题由 getPalette 派生回退值(与卡片同面) */
  sidebar?: ThemeSidebarColors;
  /** 记一笔 FAB 样式;未声明的主题由 getPalette 派生回退值(渐变 pill) */
  fab?: ThemeFab;
  /** 装饰声明 */
  decor: ThemeDecor;
}

const hsl = (h: number, s: number, l: number) => `hsl(${h}, ${s}%, ${l}%)`;

// ==================== 浅色(系统默认) ====================
const light: Palette = {
  id: 'light',
  name: '浅色',
  description: '干净清爽的浅色主题',
  mode: 'light',
  colors: {
    background: hsl(210, 40, 96),
    card: hsl(0, 0, 100),
    elevated: hsl(210, 40, 96),
    foreground: hsl(222.2, 47, 11),
    muted: hsl(210, 40, 96),
    mutedForeground: hsl(215, 16, 47),
    border: hsl(214, 32, 91),
    hairline: hsl(210, 40, 96),
    primary: hsl(24, 95, 53),
    primaryForeground: hsl(0, 0, 100),
    secondary: hsl(210, 40, 96),
    secondaryForeground: hsl(222.2, 47, 11),
    accent: hsl(24, 95, 53),
    accentForeground: hsl(0, 0, 100),
    destructive: hsl(0, 72, 51),
    ring: hsl(24, 95, 53),
    income: hsl(142, 71, 45),
    expense: hsl(0, 72, 51),
    transfer: hsl(217, 91, 60),
    white: '#ffffff',
    chart: [hsl(24, 95, 53), hsl(142, 71, 45), hsl(217, 91, 60), hsl(45, 93, 47), hsl(330, 81, 60), hsl(262, 83, 58)],
    gradient: [hsl(32, 95, 58), hsl(24, 95, 53), hsl(17, 88, 45)],
  },
  radius: { card: 20, input: 14, button: 999, sheet: 24 },
  fonts: {},
  cardStyle: { borderWidth: 1, shadow: 'soft' },
  decor: { backdrop: 'none', scrim: '0,0,0' },
};

// ==================== 深色(系统默认) ====================
const dark: Palette = {
  id: 'dark',
  name: '深色',
  description: '深色背景配橙色强调',
  mode: 'dark',
  colors: {
    background: hsl(222.2, 47, 11),
    card: hsl(217, 33, 17),
    elevated: hsl(217, 19, 27),
    foreground: hsl(210, 40, 98),
    muted: hsl(217, 19, 27),
    mutedForeground: hsl(215, 20, 65),
    border: hsl(217, 19, 27),
    hairline: hsl(217, 25, 22),
    primary: hsl(24, 95, 53),
    primaryForeground: hsl(0, 0, 100),
    secondary: hsl(217, 19, 27),
    secondaryForeground: hsl(210, 40, 98),
    accent: hsl(24, 95, 53),
    accentForeground: hsl(0, 0, 100),
    destructive: hsl(0, 72, 51),
    ring: hsl(24, 95, 53),
    income: hsl(142, 69, 58),
    expense: hsl(0, 84, 60),
    transfer: hsl(213, 94, 68),
    white: '#ffffff',
    chart: [hsl(24, 95, 53), hsl(142, 69, 58), hsl(213, 94, 68), hsl(45, 93, 55), hsl(330, 81, 65), hsl(262, 83, 68)],
    gradient: [hsl(32, 95, 58), hsl(24, 95, 53), hsl(17, 88, 45)],
  },
  radius: { card: 20, input: 14, button: 999, sheet: 24 },
  fonts: {},
  cardStyle: { borderWidth: 1, shadow: 'soft' },
  decor: { backdrop: 'none', scrim: '0,0,0' },
};

// ==================== 手工杂货铺 ====================
// 牛皮纸 + 赭石 + 衬线;卡片边框加重模拟票据,圆角略减
const craft: Palette = {
  id: 'craft',
  name: '手工杂货铺',
  description: '牛皮纸、橡皮章、手写票据',
  mode: 'light',
  colors: {
    background: hsl(42, 38, 94),
    card: hsl(42, 30, 98),
    elevated: hsl(42, 18, 90),
    foreground: hsl(215, 28, 20),
    muted: hsl(42, 12, 85),
    mutedForeground: hsl(215, 12, 48),
    border: hsl(215, 12, 65),
    hairline: hsl(42, 18, 88),
    primary: hsl(15, 50, 44),
    primaryForeground: hsl(42, 35, 96),
    secondary: hsl(42, 18, 88),
    secondaryForeground: hsl(215, 28, 22),
    accent: hsl(212, 28, 38),
    accentForeground: hsl(42, 35, 96),
    destructive: hsl(0, 60, 48),
    ring: hsl(15, 50, 44),
    income: hsl(120, 25, 36),
    expense: hsl(0, 60, 48),
    transfer: hsl(212, 28, 38),
    white: '#ffffff',
    chart: ['#c67a4b', '#4a7c9a', '#d4a574', '#9a6b4e', '#c44e3a', '#5c8a7a', '#e0b878', '#8b5e4b', '#4a7c8c', '#b84a3c'],
    gradient: [hsl(15, 55, 48), hsl(15, 50, 44), hsl(15, 46, 36)],
  },
  radius: { card: 16, input: 10, button: 999, sheet: 20 },
  fonts: {
    regular: 'CrimsonText_400Regular',
    medium: 'CrimsonText_600SemiBold',
    bold: 'CrimsonText_700Bold',
    numeric: 'CrimsonText_600SemiBold',
  },
  cardStyle: { borderWidth: 1.5, shadow: 'soft' },
  // 蓝墨水布面侧边栏(对齐 web craft --sidebar-*),与牛皮纸内容区拉开层次
  sidebar: {
    background: hsl(212, 25, 26),
    foreground: hsl(42, 28, 90),
    primary: hsl(15, 55, 48),
    primaryForeground: hsl(42, 35, 96),
    accent: hsl(212, 20, 30),
    accentForeground: hsl(42, 28, 90),
    border: hsl(212, 18, 20),
  },
  // 赭石渐变 + 米白票据描边
  fab: { gradient: true, borderWidth: 2, borderColor: hsl(42, 35, 96), shadow: 'glow' },
  decor: { backdrop: 'ledger', scrim: '0,0,0' },
};

// ==================== 旧式电报机 ====================
// CRT 绿屏终端:色相归一到 120,底色更深、荧光更亮,层次拉开(侧边栏比内容区再深一档);
// 方角 + 硬偏移影 + 扫描线纹理;金额等宽是主题本色
const telegram: Palette = {
  id: 'telegram',
  name: '旧式电报机',
  description: 'CRT 绿屏终端、荧光字符、点阵打印纸',
  mode: 'dark',
  colors: {
    background: hsl(120, 12, 8),
    card: hsl(120, 10, 14),
    elevated: hsl(120, 10, 18),
    foreground: hsl(120, 45, 78),
    muted: hsl(120, 8, 14),
    mutedForeground: hsl(120, 25, 58),
    border: hsl(120, 15, 32),
    hairline: hsl(120, 12, 22),
    primary: hsl(120, 45, 42),
    primaryForeground: hsl(120, 45, 92),
    secondary: hsl(120, 8, 16),
    secondaryForeground: hsl(120, 45, 78),
    accent: hsl(6, 70, 56),
    accentForeground: hsl(0, 0, 95),
    destructive: hsl(6, 70, 50),
    ring: hsl(120, 45, 45),
    income: hsl(120, 55, 55),
    expense: hsl(6, 70, 56),
    transfer: hsl(190, 65, 55),
    white: '#ffffff',
    chart: ['#3b9b3b', '#5cb85c', '#d94a3a', '#c4a44a', '#1a8a3a', '#6b8b5a', '#e0c878', '#4a8a4a', '#f0d060', '#8b7355'],
    gradient: [hsl(120, 45, 36), hsl(120, 42, 28), hsl(120, 38, 20)],
  },
  radius: { card: 4, input: 2, button: 2, sheet: 8 },
  fonts: {
    regular: 'JetBrainsMono_400Regular',
    medium: 'JetBrainsMono_500Medium',
    bold: 'JetBrainsMono_700Bold',
    numeric: 'JetBrainsMono_400Regular',
  },
  cardStyle: { borderWidth: 1.5, shadow: 'hard' },
  sidebar: {
    background: hsl(120, 14, 6),
    foreground: hsl(120, 42, 62),
    primary: hsl(120, 45, 48),
    primaryForeground: hsl(120, 45, 92),
    accent: hsl(120, 14, 12),
    accentForeground: hsl(120, 42, 62),
    border: hsl(120, 14, 16),
  },
  // CRT 荧光按键:纯色底 + 荧光绿描边 + 硬偏移影
  fab: { gradient: false, borderWidth: 2, borderColor: hsl(120, 45, 60), shadow: 'hard' },
  decor: { backdrop: 'scanlines', scrim: '0,0,0' },
};

// ==================== 植物记账簿 ====================
// 明亮奶油纸 + 橄榄绿墨色 + 干花粉点缀;方直信封感(圆角收敛) + 硬偏移影;
// 深橄榄侧边栏比内容区深一档,清新不暗沉
const botanical: Palette = {
  id: 'botanical',
  name: '植物记账簿',
  description: '奶油纸信封、橄榄绿、干花标本',
  mode: 'light',
  colors: {
    background: hsl(45, 40, 92),
    card: hsl(45, 55, 97),
    elevated: hsl(45, 30, 88),
    foreground: hsl(90, 15, 18),
    muted: hsl(45, 25, 88),
    mutedForeground: hsl(90, 10, 42),
    border: hsl(40, 20, 76),
    hairline: hsl(45, 25, 88),
    primary: hsl(95, 25, 32),
    primaryForeground: hsl(45, 55, 96),
    secondary: hsl(45, 30, 88),
    secondaryForeground: hsl(90, 15, 18),
    accent: hsl(345, 35, 55),
    accentForeground: hsl(45, 55, 96),
    destructive: hsl(0, 45, 50),
    ring: hsl(95, 25, 32),
    income: hsl(110, 32, 38),
    expense: hsl(0, 45, 50),
    transfer: hsl(200, 30, 45),
    white: '#ffffff',
    chart: ['#3d664e', '#b46478', '#6b7a4a', '#c98a9a', '#2e3a22', '#9c8b6e', '#5a7a4a', '#c4b89a', '#7a6a4a', '#5a6a3a'],
    gradient: [hsl(95, 28, 40), hsl(95, 25, 32), hsl(95, 22, 24)],
  },
  radius: { card: 8, input: 8, button: 8, sheet: 16 },
  fonts: {
    regular: 'CormorantGaramond_400Regular',
    medium: 'CormorantGaramond_500Medium',
    bold: 'CormorantGaramond_600SemiBold',
    numeric: 'CormorantGaramond_500Medium',
  },
  cardStyle: { borderWidth: 1, shadow: 'hard' },
  sidebar: {
    background: hsl(95, 22, 22),
    foreground: hsl(45, 50, 92),
    primary: hsl(95, 28, 45),
    primaryForeground: hsl(45, 55, 96),
    accent: hsl(95, 18, 28),
    accentForeground: hsl(45, 50, 92),
    border: hsl(95, 16, 30),
  },
  // 橄榄渐变 + 奶油描边 + 墨色硬偏移影(方角由 radius.button 驱动)
  fab: { gradient: true, borderWidth: 1.5, borderColor: hsl(45, 55, 96), shadow: 'hard' },
  decor: { backdrop: 'fiber', scrim: '0,0,0' },
};

// ==================== 糖果铺 ====================
// 奶油底 + 草莓粉 + 圆体;大圆角 + 淡彩阴影
// FAB 使用糖果罐图片(logo/糖果罐.png → assets/images/fab-candy.png)
const candy: Palette = {
  id: 'candy',
  name: '糖果铺',
  description: '玻璃罐、草莓硬糖粉、奶油色',
  mode: 'light',
  colors: {
    background: hsl(39, 88, 97),
    card: hsl(0, 0, 100),
    elevated: hsl(39, 50, 94),
    foreground: hsl(289, 14, 22),
    muted: hsl(39, 40, 94),
    mutedForeground: hsl(283, 9, 40),
    border: hsl(160, 38, 80),
    hairline: hsl(39, 40, 96),
    primary: hsl(0, 77, 74),
    primaryForeground: hsl(0, 0, 100),
    secondary: hsl(160, 38, 75),
    secondaryForeground: hsl(289, 14, 22),
    accent: hsl(45, 86, 72),
    accentForeground: hsl(289, 14, 22),
    destructive: hsl(0, 65, 55),
    ring: hsl(0, 77, 74),
    income: hsl(160, 50, 38),
    expense: hsl(0, 77, 62),
    transfer: hsl(200, 70, 55),
    white: '#ffffff',
    chart: ['#f4a0b8', '#7dd8c5', '#f5d060', '#c4a0e8', '#f09878', '#68c8e8', '#f0b0c8', '#8ad8b8', '#f8d878', '#b8a0e0'],
    gradient: [hsl(0, 80, 78), hsl(0, 77, 74), hsl(350, 75, 68)],
  },
  radius: { card: 24, input: 16, button: 999, sheet: 28 },
  fonts: {
    regular: 'Fredoka_400Regular',
    medium: 'Fredoka_500Medium',
    bold: 'Fredoka_600SemiBold',
    numeric: 'Fredoka_500Medium',
  },
  cardStyle: { borderWidth: 1, shadow: 'tinted' },
  // 糖果罐图片按钮:白底圆 + 草莓粉描边衬托浅色罐身(渲染时隐藏 Plus 图标)
  fab: { gradient: false, borderWidth: 3, borderColor: hsl(0, 77, 74), shadow: 'glow', image: require('../../assets/images/fab-candy.png'), backgroundColor: hsl(0, 0, 100) },
  decor: { backdrop: 'none', scrim: '0,0,0' },
};

// ==================== 原色构成(蒙德里安) ====================
// 原色块 + 黑线分割;无阴影 + 2px 实线边框 + 方角
const mondrian: Palette = {
  id: 'mondrian',
  name: '原色构成',
  description: '蒙德里安几何抽象、红黄蓝原色块',
  mode: 'light',
  colors: {
    background: hsl(0, 0, 96),
    card: hsl(0, 0, 100),
    elevated: hsl(0, 0, 90),
    foreground: hsl(0, 0, 10),
    muted: hsl(0, 0, 88),
    mutedForeground: hsl(0, 0, 40),
    border: hsl(0, 0, 10),
    hairline: hsl(0, 0, 85),
    primary: hsl(355, 78, 56),
    primaryForeground: hsl(0, 0, 100),
    secondary: hsl(0, 0, 92),
    secondaryForeground: hsl(0, 0, 10),
    accent: hsl(203, 100, 36),
    accentForeground: hsl(0, 0, 100),
    destructive: hsl(355, 78, 56),
    ring: hsl(203, 100, 36),
    income: hsl(130, 65, 32),
    expense: hsl(355, 78, 56),
    transfer: hsl(203, 100, 36),
    white: '#ffffff',
    chart: ['#e63946', '#0077b6', '#ffd60a', '#1a1a1a', '#c1121f', '#023e8a', '#e6be0a', '#8d99ae', '#d90429', '#457b9d'],
    gradient: [hsl(355, 78, 56), hsl(45, 95, 55), hsl(203, 100, 36)],
  },
  radius: { card: 4, input: 4, button: 4, sheet: 8 },
  fonts: {
    display: 'BebasNeue_400Regular',
    regular: 'DMSans_400Regular',
    medium: 'DMSans_500Medium',
    bold: 'DMSans_700Bold',
    numeric: 'DMSans_700Bold',
  },
  cardStyle: { borderWidth: 2, shadow: 'none' },
  // 纯白面板 + 黑线(对齐 web mondrian --sidebar-*),面板右缘 3px 黑边由 border 承担
  sidebar: {
    background: hsl(0, 0, 100),
    foreground: hsl(0, 0, 10),
    primary: hsl(355, 78, 56),
    primaryForeground: hsl(0, 0, 100),
    accent: hsl(0, 0, 92),
    accentForeground: hsl(0, 0, 10),
    border: hsl(0, 0, 10),
  },
  // 蒙德里安原色块:纯红 + 粗黑描边 + 黑硬偏移影,零渐变
  fab: { gradient: false, borderWidth: 3, borderColor: hsl(0, 0, 10), shadow: 'hard' },
  decor: { backdrop: 'grid', scrim: '0,0,0' },
};

export const palettes: Record<PaletteId, Palette> = {
  light, dark, craft, telegram, botanical, candy, mondrian,
};

/** 主题选择器展示顺序(system 由 ThemeProvider 单独处理) */
export const paletteOrder: PaletteId[] = ['light', 'dark', 'craft', 'telegram', 'botanical', 'candy', 'mondrian'];

export const defaultThemeId: ThemeId = 'system';

export function getPalette(id: PaletteId): Palette {
  const p = palettes[id] ?? palettes.light;
  if (p.sidebar && p.fab) return p;
  // 未声明的主题(light/dark/candy):侧边栏与卡片同面、FAB 渐变 pill,派生回退值保持原视觉
  return {
    ...p,
    sidebar: p.sidebar ?? {
      background: p.colors.card,
      foreground: p.colors.foreground,
      primary: p.colors.primary,
      primaryForeground: p.colors.primaryForeground,
      accent: p.colors.muted,
      accentForeground: p.colors.foreground,
      border: p.colors.border,
    },
    fab: p.fab ?? { gradient: true, borderWidth: 4, borderColor: null, shadow: 'glow' },
  };
}

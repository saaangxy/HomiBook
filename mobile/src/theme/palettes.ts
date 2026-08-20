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
  /** soft=柔和投影 tinted=彩色投影 none=无阴影(配合实线边框) */
  shadow: 'soft' | 'tinted' | 'none';
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
    chart: [hsl(15, 50, 44), hsl(120, 25, 36), hsl(212, 28, 38), hsl(42, 45, 45), hsl(345, 25, 45), hsl(215, 12, 48)],
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
};

// ==================== 旧式电报机 ====================
// 绿屏显示器 + 等宽字;移动端 card 用深面板(网页端浅纸卡在此不可读),
// 近无圆角 + 发光边框模拟 CRT;金额等宽是主题本色
const telegram: Palette = {
  id: 'telegram',
  name: '旧式电报机',
  description: '绿屏显示器、点阵打印纸、等宽字体',
  mode: 'dark',
  colors: {
    background: hsl(84, 5, 14),
    card: hsl(84, 5, 18),
    elevated: hsl(84, 5, 22),
    foreground: hsl(120, 30, 72),
    muted: hsl(84, 5, 18),
    mutedForeground: hsl(120, 18, 50),
    border: hsl(120, 10, 30),
    hairline: hsl(120, 10, 22),
    primary: hsl(120, 35, 35),
    primaryForeground: hsl(120, 30, 90),
    secondary: hsl(84, 5, 22),
    secondaryForeground: hsl(120, 30, 72),
    accent: hsl(6, 68, 54),
    accentForeground: hsl(0, 0, 95),
    destructive: hsl(6, 68, 48),
    ring: hsl(120, 35, 35),
    income: hsl(120, 40, 50),
    expense: hsl(6, 68, 54),
    transfer: hsl(190, 60, 50),
    white: '#ffffff',
    chart: [hsl(120, 40, 50), hsl(120, 35, 35), hsl(190, 60, 50), hsl(60, 50, 50), hsl(6, 68, 54), hsl(120, 18, 50)],
    gradient: [hsl(120, 40, 40), hsl(120, 35, 35), hsl(120, 32, 27)],
  },
  radius: { card: 8, input: 6, button: 8, sheet: 12 },
  fonts: {
    regular: 'JetBrainsMono_400Regular',
    medium: 'JetBrainsMono_500Medium',
    bold: 'JetBrainsMono_700Bold',
    numeric: 'JetBrainsMono_400Regular',
  },
  cardStyle: { borderWidth: 1, shadow: 'none' },
};

// ==================== 植物记账簿 ====================
// 种子纸 + 橄榄绿 + 衬线;大圆角 + 柔和扩散阴影
const botanical: Palette = {
  id: 'botanical',
  name: '植物记账簿',
  description: '种子纸信封、橄榄绿、干花标本',
  mode: 'light',
  colors: {
    background: hsl(42, 25, 86),
    card: hsl(44, 48, 94),
    elevated: hsl(42, 17, 80),
    foreground: hsl(36, 29, 13),
    muted: hsl(42, 12, 78),
    mutedForeground: hsl(37, 17, 54),
    border: hsl(38, 18, 68),
    hairline: hsl(42, 17, 80),
    primary: hsl(90, 22, 29),
    primaryForeground: hsl(44, 48, 95),
    secondary: hsl(42, 17, 80),
    secondaryForeground: hsl(36, 29, 13),
    accent: hsl(345, 19, 46),
    accentForeground: hsl(44, 48, 95),
    destructive: hsl(0, 43, 48),
    ring: hsl(90, 22, 29),
    income: hsl(100, 30, 34),
    expense: hsl(0, 43, 48),
    transfer: hsl(210, 25, 40),
    white: '#ffffff',
    chart: [hsl(90, 22, 29), hsl(100, 30, 34), hsl(345, 19, 46), hsl(42, 40, 45), hsl(210, 25, 40), hsl(37, 17, 54)],
    gradient: [hsl(90, 26, 36), hsl(90, 22, 29), hsl(90, 20, 22)],
  },
  radius: { card: 24, input: 16, button: 999, sheet: 28 },
  fonts: {
    regular: 'CormorantGaramond_400Regular',
    medium: 'CormorantGaramond_500Medium',
    bold: 'CormorantGaramond_600SemiBold',
    numeric: 'CormorantGaramond_500Medium',
  },
  cardStyle: { borderWidth: 1, shadow: 'soft' },
};

// ==================== 糖果铺 ====================
// 奶油底 + 草莓粉 + 圆体;大圆角 + 淡彩阴影
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
    chart: [hsl(0, 77, 74), hsl(160, 38, 55), hsl(45, 86, 62), hsl(200, 70, 60), hsl(289, 30, 60), hsl(283, 9, 40)],
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
    chart: [hsl(355, 78, 56), hsl(203, 100, 36), hsl(45, 95, 55), hsl(0, 0, 10), hsl(130, 65, 32), hsl(0, 0, 40)],
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
};

export const palettes: Record<PaletteId, Palette> = {
  light, dark, craft, telegram, botanical, candy, mondrian,
};

/** 主题选择器展示顺序(system 由 ThemeProvider 单独处理) */
export const paletteOrder: PaletteId[] = ['light', 'dark', 'craft', 'telegram', 'botanical', 'candy', 'mondrian'];

export const defaultThemeId: ThemeId = 'system';

export function getPalette(id: PaletteId): Palette {
  return palettes[id] ?? palettes.light;
}

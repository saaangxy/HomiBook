export interface Theme {
  id: string
  name: string
  description: string
  vars: Record<string, string>
  fontFamily: string
  mode: 'light' | 'dark'
}

export const themes: Record<string, Theme> = {
  // ==================== 手工杂货铺 ====================
  craft: {
    id: 'craft',
    name: '手工杂货铺',
    description: '手工票据、复古收银机、牛皮纸、橡皮章、手写笔记',
    mode: 'light',
    fontFamily: '"Crimson Text", "Noto Serif SC", "宋体", SimSun, serif',
    vars: {
      '--background': '42 38% 94%',
      '--foreground': '215 28% 20%',
      '--card': '42 30% 98%',
      '--card-foreground': '215 28% 20%',
      '--popover': '42 30% 98%',
      '--popover-foreground': '215 28% 20%',
      '--primary': '15 50% 44%',
      '--primary-foreground': '42 35% 96%',
      '--secondary': '42 18% 88%',
      '--secondary-foreground': '215 28% 22%',
      '--muted': '42 12% 85%',
      '--muted-foreground': '215 12% 48%',
      '--accent': '212 28% 38%',
      '--accent-foreground': '42 35% 96%',
      '--destructive': '0 60% 48%',
      '--destructive-foreground': '42 35% 96%',
      '--border': '215 12% 65%',
      '--input': '42 10% 82%',
      '--ring': '15 50% 44%',
      '--sidebar-background': '22 18% 28%',
      '--sidebar-foreground': '42 28% 88%',
      '--sidebar-primary': '15 55% 48%',
      '--sidebar-primary-foreground': '42 35% 96%',
      '--sidebar-accent': '212 22% 35%',
      '--sidebar-accent-foreground': '42 28% 88%',
      '--sidebar-border': '22 12% 38%',
      '--sidebar-ring': '15 50% 44%',
    },
  },

  // ==================== 旧式电报机·针式打印机 ====================
  telegram: {
    id: 'telegram',
    name: '旧式电报机',
    description: '泛黄纸张、等宽字体、点阵纹理、机械工业风',
    mode: 'light',
    fontFamily: '"JetBrains Mono", "Courier New", monospace',
    vars: {
      '--background': '40 30% 91%',
      '--foreground': '225 35% 15%',
      '--card': '40 25% 95%',
      '--card-foreground': '225 35% 15%',
      '--popover': '40 25% 95%',
      '--popover-foreground': '225 35% 15%',
      '--primary': '225 40% 25%',
      '--primary-foreground': '40 30% 95%',
      '--secondary': '40 15% 85%',
      '--secondary-foreground': '225 35% 15%',
      '--muted': '40 10% 82%',
      '--muted-foreground': '225 15% 50%',
      '--accent': '35 60% 45%',
      '--accent-foreground': '40 30% 95%',
      '--destructive': '0 60% 45%',
      '--destructive-foreground': '40 30% 95%',
      '--border': '225 15% 55%',
      '--input': '40 10% 85%',
      '--ring': '225 40% 25%',
      '--sidebar-background': '40 25% 87%',
      '--sidebar-foreground': '225 35% 15%',
      '--sidebar-primary': '225 40% 25%',
      '--sidebar-primary-foreground': '40 30% 95%',
      '--sidebar-accent': '40 15% 82%',
      '--sidebar-accent-foreground': '225 35% 15%',
      '--sidebar-border': '225 15% 55%',
      '--sidebar-ring': '225 40% 25%',
    },
  },

  // ==================== 植物记账簿·种子纸 ====================
  botanical: {
    id: 'botanical',
    name: '植物记账簿',
    description: '种子纸纹理、衬线字体、自然绿色系、植物装饰',
    mode: 'light',
    fontFamily: '"Noto Serif SC", "宋体", SimSun, serif',
    vars: {
      '--background': '85 22% 91%',
      '--foreground': '85 25% 16%',
      '--card': '85 18% 96%',
      '--card-foreground': '85 25% 16%',
      '--popover': '85 18% 96%',
      '--popover-foreground': '85 25% 16%',
      '--primary': '140 35% 38%',
      '--primary-foreground': '85 22% 96%',
      '--secondary': '85 15% 85%',
      '--secondary-foreground': '85 25% 16%',
      '--muted': '85 12% 82%',
      '--muted-foreground': '85 12% 45%',
      '--accent': '335 40% 50%',
      '--accent-foreground': '85 22% 96%',
      '--destructive': '0 60% 50%',
      '--destructive-foreground': '85 22% 96%',
      '--border': '140 15% 70%',
      '--input': '85 12% 85%',
      '--ring': '140 35% 38%',
      '--sidebar-background': '85 20% 87%',
      '--sidebar-foreground': '85 25% 16%',
      '--sidebar-primary': '140 35% 38%',
      '--sidebar-primary-foreground': '85 22% 96%',
      '--sidebar-accent': '85 15% 82%',
      '--sidebar-accent-foreground': '85 25% 16%',
      '--sidebar-border': '140 15% 70%',
      '--sidebar-ring': '140 35% 38%',
    },
  },

  // ==================== 糖果铺·玻璃罐记账 ====================
  candy: {
    id: 'candy',
    name: '糖果铺',
    description: '玻璃透明质感、圆润字体、糖果色系、漩涡纹理',
    mode: 'light',
    fontFamily: '"ZCOOL KuaiLe", "圆体", "幼圆", YouYuan, sans-serif',
    vars: {
      '--background': '330 25% 97%',
      '--foreground': '330 25% 22%',
      '--card': '0 0% 100%',
      '--card-foreground': '330 25% 22%',
      '--popover': '0 0% 100%',
      '--popover-foreground': '330 25% 22%',
      '--primary': '340 60% 55%',
      '--primary-foreground': '0 0% 100%',
      '--secondary': '330 20% 90%',
      '--secondary-foreground': '330 25% 22%',
      '--muted': '330 15% 88%',
      '--muted-foreground': '330 12% 50%',
      '--accent': '160 45% 48%',
      '--accent-foreground': '0 0% 100%',
      '--destructive': '0 65% 55%',
      '--destructive-foreground': '0 0% 100%',
      '--border': '330 15% 82%',
      '--input': '330 15% 88%',
      '--ring': '340 60% 55%',
      '--sidebar-background': '330 20% 94%',
      '--sidebar-foreground': '330 25% 22%',
      '--sidebar-primary': '340 60% 55%',
      '--sidebar-primary-foreground': '0 0% 100%',
      '--sidebar-accent': '330 15% 88%',
      '--sidebar-accent-foreground': '330 25% 22%',
      '--sidebar-border': '330 15% 82%',
      '--sidebar-ring': '340 60% 55%',
    },
  },

  // ==================== 基础浅色（系统默认浅色） ====================
  light: {
    id: 'light',
    name: '浅色',
    description: '干净清爽的浅色主题',
    mode: 'light',
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "PingFang SC", "Microsoft YaHei", sans-serif',
    vars: {
      '--background': '0 0% 100%',
      '--foreground': '222.2 47% 11%',
      '--card': '0 0% 100%',
      '--card-foreground': '222.2 47% 11%',
      '--popover': '0 0% 100%',
      '--popover-foreground': '222.2 47% 11%',
      '--primary': '24 95% 53%',
      '--primary-foreground': '0 0% 100%',
      '--secondary': '210 40% 96%',
      '--secondary-foreground': '222.2 47% 11%',
      '--muted': '210 40% 96%',
      '--muted-foreground': '215 16% 47%',
      '--accent': '210 40% 96%',
      '--accent-foreground': '222.2 47% 11%',
      '--destructive': '0 72% 51%',
      '--destructive-foreground': '210 40% 98%',
      '--border': '214 32% 91%',
      '--input': '214 32% 91%',
      '--ring': '24 95% 53%',
      '--sidebar-background': '0 0% 98%',
      '--sidebar-foreground': '222.2 47% 11%',
      '--sidebar-primary': '24 95% 53%',
      '--sidebar-primary-foreground': '0 0% 100%',
      '--sidebar-accent': '210 40% 96%',
      '--sidebar-accent-foreground': '222.2 47% 11%',
      '--sidebar-border': '214 32% 91%',
      '--sidebar-ring': '24 95% 53%',
    },
  },

  // ==================== 基础深色（系统默认深色） ====================
  dark: {
    id: 'dark',
    name: '深色',
    description: '深色背景配橙色强调',
    mode: 'dark',
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "PingFang SC", "Microsoft YaHei", sans-serif',
    vars: {
      '--background': '222.2 47% 11%',
      '--foreground': '210 40% 98%',
      '--card': '217 33% 17%',
      '--card-foreground': '210 40% 98%',
      '--popover': '217 33% 17%',
      '--popover-foreground': '210 40% 98%',
      '--primary': '24 95% 53%',
      '--primary-foreground': '0 0% 100%',
      '--secondary': '217 19% 27%',
      '--secondary-foreground': '210 40% 98%',
      '--muted': '217 19% 27%',
      '--muted-foreground': '215 20% 65%',
      '--accent': '217 19% 27%',
      '--accent-foreground': '210 40% 98%',
      '--destructive': '0 72% 51%',
      '--destructive-foreground': '210 40% 98%',
      '--border': '217 19% 27%',
      '--input': '217 19% 27%',
      '--ring': '24 95% 53%',
      '--sidebar-background': '222.2 47% 11%',
      '--sidebar-foreground': '210 40% 98%',
      '--sidebar-primary': '24 95% 53%',
      '--sidebar-primary-foreground': '0 0% 100%',
      '--sidebar-accent': '217 19% 27%',
      '--sidebar-accent-foreground': '210 40% 98%',
      '--sidebar-border': '217 19% 27%',
      '--sidebar-ring': '24 95% 53%',
    },
  },
}

/** 用户可选的创意主题 ID 列表（不含基础 light/dark） */
export const creativeThemeIds = ['craft', 'telegram', 'botanical', 'candy']

/** 所有可选主题 ID（含 system 选项） */
export const selectableThemeIds = ['system', ...creativeThemeIds]

export const defaultTheme = 'dark'

export function getTheme(id: string): Theme {
  return themes[id] || themes[defaultTheme]
}

/** 检测系统是否为深色模式 */
export function getSystemThemeId(): string {
  if (typeof window === 'undefined') return 'light'
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

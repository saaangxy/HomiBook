import { createContext, useContext } from 'react';
import {
  defaultThemeId,
  getPalette,
  type Palette,
  type PaletteId,
  type ThemeColors,
  type ThemeFonts,
  type ThemeId,
  type ThemeSidebarColors,
} from './palettes';

// 主题 Context 独立模块:供 index.tsx(ThemeProvider)与 chart.ts 等子模块共同导入,
// 避免 index ↔ 子模块循环依赖(Metro require cycle 警告)

export interface ThemeContextValue {
  /** 用户选择的主题(含 'system') */
  themeId: ThemeId;
  /** 解析后的实际调色板 id(system 已解析) */
  resolvedId: PaletteId;
  palette: Palette;
  /** 兼容字段:等价 palette.colors */
  colors: ThemeColors;
  /** 侧边栏专属色组(chrome 面板/顶栏/底栏用,特色主题与内容区拉开层次) */
  sidebar: ThemeSidebarColors;
  fonts: ThemeFonts;
  isDark: boolean;
  setThemeId: (id: ThemeId) => void;
  /** 兼容旧接口:映射为 light/dark */
  setDark: (dark: boolean) => void;
  toggleTheme: () => void;
}

export const ThemeContext = createContext<ThemeContextValue>({
  themeId: defaultThemeId,
  resolvedId: 'light',
  palette: getPalette('light'),
  colors: getPalette('light').colors,
  sidebar: getPalette('light').sidebar!,
  fonts: {},
  isDark: false,
  setThemeId: () => {},
  setDark: () => {},
  toggleTheme: () => {},
});

export function useTheme() {
  return useContext(ThemeContext);
}

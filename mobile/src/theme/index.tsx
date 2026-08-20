import AsyncStorage from '@react-native-async-storage/async-storage';
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useColorScheme } from 'react-native';
import {
  defaultThemeId,
  getPalette,
  palettes,
  type Palette,
  type PaletteId,
  type ThemeColors,
  type ThemeFonts,
  type ThemeId,
} from './palettes';

export { palettes, paletteOrder, type Palette, type PaletteId, type ThemeColors, type ThemeId } from './palettes';
export { motion, haptics } from './motion';
export { spacing, pagePadding, typography, cardShadow, sheetShadow, alpha } from './tokens';

const STORAGE_KEY = 'homibook.theme';

interface ThemeContextValue {
  /** 用户选择的主题(含 'system') */
  themeId: ThemeId;
  /** 解析后的实际调色板 id(system 已解析) */
  resolvedId: PaletteId;
  palette: Palette;
  /** 兼容字段:等价 palette.colors */
  colors: ThemeColors;
  fonts: ThemeFonts;
  isDark: boolean;
  setThemeId: (id: ThemeId) => void;
  /** 兼容旧接口:映射为 light/dark */
  setDark: (dark: boolean) => void;
  toggleTheme: () => void;
}

const ThemeContext = createContext<ThemeContextValue>({
  themeId: defaultThemeId,
  resolvedId: 'light',
  palette: getPalette('light'),
  colors: getPalette('light').colors,
  fonts: {},
  isDark: false,
  setThemeId: () => {},
  setDark: () => {},
  toggleTheme: () => {},
});

export function ThemeProvider({ children }: { children: ReactNode }) {
  const systemScheme = useColorScheme();
  const [themeId, setThemeIdState] = useState<ThemeId>(defaultThemeId);

  // 启动时读取持久化主题(登录后由 auth 流程同步 user.theme,见 M2)
  useEffect(() => {
    AsyncStorage.getItem(STORAGE_KEY).then((saved) => {
      if (saved && (saved === 'system' || saved in palettes)) setThemeIdState(saved as ThemeId);
    }).catch(() => {});
  }, []);

  const resolvedId: PaletteId =
    themeId === 'system' ? (systemScheme === 'dark' ? 'dark' : 'light') : themeId;
  const palette = getPalette(resolvedId);

  const value = useMemo<ThemeContextValue>(
    () => ({
      themeId,
      resolvedId,
      palette,
      colors: palette.colors,
      fonts: palette.fonts,
      isDark: palette.mode === 'dark',
      setThemeId: (id) => {
        setThemeIdState(id);
        AsyncStorage.setItem(STORAGE_KEY, id).catch(() => {});
      },
      setDark: (dark) => {
        const id: ThemeId = dark ? 'dark' : 'light';
        setThemeIdState(id);
        AsyncStorage.setItem(STORAGE_KEY, id).catch(() => {});
      },
      toggleTheme: () => {
        const id: ThemeId = palette.mode === 'dark' ? 'light' : 'dark';
        setThemeIdState(id);
        AsyncStorage.setItem(STORAGE_KEY, id).catch(() => {});
      },
    }),
    [themeId, resolvedId, palette],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  return useContext(ThemeContext);
}

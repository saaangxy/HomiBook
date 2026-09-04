import AsyncStorage from '@react-native-async-storage/async-storage';
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, { useSharedValue, withTiming } from 'react-native-reanimated';
import { useColorScheme } from 'react-native';
import {
  defaultThemeId,
  getPalette,
  palettes,
  type Palette,
  type PaletteId,
  type ThemeId,
} from './palettes';

export { palettes, paletteOrder, getPalette, type Palette, type PaletteId, type ThemeColors, type ThemeId, type ThemeSidebarColors, type ThemeDecor } from './palettes';
import { motion } from './motion';
export { motion, haptics } from './motion';
export { spacing, pagePadding, typography, cardShadow, sheetShadow, alpha } from './tokens';
export { ThemeBackdrop, SidebarDecor } from './decor';
export { useChartColors, semanticTypeColor } from './chart';
export { useTheme, type ThemeContextValue } from './context';
import { ThemeContext, type ThemeContextValue } from './context';

const STORAGE_KEY = 'homibook.theme';

/** 当前解析主题快照(渲染时写入):供无法使用 Context 的场景读取,如根 ErrorBoundary */
let activePaletteSnapshot: Palette = getPalette('light');
export function getActivePalette(): Palette {
  return activePaletteSnapshot;
}

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
  // 写入模块级快照(无 Context 场景兜底)
  activePaletteSnapshot = palette;

  // 切换幕布:解析主题变化时(含 setThemeId/跟随系统/登录下行)用新底色幕布盖住瞬变再快速淡出,
  // 视觉为「沉入新底色 → 浮现新界面」;useLayoutEffect 先于首帧着色,避免露出切换瞬间的闪变
  const mountedRef = useRef(false);
  const curtainOpacity = useSharedValue(0);
  useLayoutEffect(() => {
    if (!mountedRef.current) {
      mountedRef.current = true;
      return;
    }
    curtainOpacity.value = 1;
    curtainOpacity.value = withTiming(0, { duration: 280, easing: motion.easing });
  }, [resolvedId, curtainOpacity]);

  const value = useMemo<ThemeContextValue>(
    () => ({
      themeId,
      resolvedId,
      palette,
      colors: palette.colors,
      sidebar: palette.sidebar!,
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

  return (
    <ThemeContext.Provider value={value}>
      {/* flex:1 容器 + 后置幕布兄弟节点:天然覆盖在导航/侧边栏/Toast 之上(RN Modal 除外) */}
      <View style={{ flex: 1 }}>
        {children}
        <Animated.View
          pointerEvents="none"
          style={[StyleSheet.absoluteFill, { backgroundColor: palette.colors.background, opacity: curtainOpacity }]}
        />
      </View>
    </ThemeContext.Provider>
  );
}

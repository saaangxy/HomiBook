import { createContext, useContext, useMemo, useState, type ReactNode } from 'react';

// 橙色多彩账本配色(对齐移动端原型):
// slate 底 + 橙主色 + 绿收入/红支出 + 柔和阴影。活泼、精致、色彩分明。
export interface ThemeColors {
  background: string;      // 页面 slate 底
  card: string;            // 卡片面
  elevated: string;        // 浮层/输入框面
  foreground: string;      // 正文
  muted: string;           // 次要面
  mutedForeground: string; // 次要文字
  border: string;          // 发丝线
  hairline: string;        // 更细的发丝线
  primary: string;         // 橙主操作
  primaryForeground: string;
  income: string;          // 收入绿
  expense: string;         // 支出红
  transfer: string;        // 转账蓝
  white: string;
}

export const lightColors: ThemeColors = {
  background: '#f8fafc',
  card: '#ffffff',
  elevated: '#f8fafc',
  foreground: '#0f172a',
  muted: '#f1f5f9',
  mutedForeground: '#64748b',
  border: '#e2e8f0',
  hairline: '#f1f5f9',
  primary: '#f97316',
  primaryForeground: '#ffffff',
  income: '#22c55e',
  expense: '#ef4444',
  transfer: '#3b82f6',
  white: '#ffffff',
};

export const darkColors: ThemeColors = {
  background: '#0f172a',
  card: '#1e293b',
  elevated: '#1e293b',
  foreground: '#f8fafc',
  muted: '#334155',
  mutedForeground: '#94a3b8',
  border: '#334155',
  hairline: '#263550',
  primary: '#f97316',
  primaryForeground: '#ffffff',
  income: '#22c55e',
  expense: '#ef4444',
  transfer: '#3b82f6',
  white: '#ffffff',
};

interface ThemeContextValue {
  isDark: boolean;
  colors: ThemeColors;
  setDark: (dark: boolean) => void;
  toggleTheme: () => void;
}

const ThemeContext = createContext<ThemeContextValue>({
  isDark: false,
  colors: lightColors,
  setDark: () => {},
  toggleTheme: () => {},
});

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [isDark, setIsDark] = useState(false);
  const colors = isDark ? darkColors : lightColors;

  const value = useMemo(
    () => ({ isDark, colors, setDark: setIsDark, toggleTheme: () => setIsDark((d) => !d) }),
    [isDark, colors],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  return useContext(ThemeContext);
}
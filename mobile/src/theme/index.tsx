import { createContext, useContext, useMemo, useState, type ReactNode } from 'react';

// 语义色 token(与 web 主题对齐:橙色主色、圆角卡片)
export interface ThemeColors {
  background: string;
  card: string;
  cardMuted: string;
  foreground: string;
  muted: string;
  mutedForeground: string;
  border: string;
  primary: string;
  primaryForeground: string;
  destructive: string;
  income: string;
  expense: string;
  white: string;
}

export const lightColors: ThemeColors = {
  background: '#f8fafc',
  card: '#ffffff',
  cardMuted: '#f1f5f9',
  foreground: '#111827',
  muted: '#f1f5f9',
  mutedForeground: '#64748b',
  border: '#e2e8f0',
  primary: '#f97316',
  primaryForeground: '#ffffff',
  destructive: '#ef4444',
  income: '#22c55e',
  expense: '#ef4444',
  white: '#ffffff',
};

export const darkColors: ThemeColors = {
  background: '#0f172a',
  card: '#1e293b',
  cardMuted: '#0f172a',
  foreground: '#f8fafc',
  muted: '#334155',
  mutedForeground: '#94a3b8',
  border: '#334155',
  primary: '#f97316',
  primaryForeground: '#ffffff',
  destructive: '#ef4444',
  income: '#22c55e',
  expense: '#ef4444',
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
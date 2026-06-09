import { useMemo } from 'react'
import { useThemeContext } from '@/components/ThemeProvider'

export interface ChartTheme {
  primary: string; foreground: string; mutedForeground: string; border: string
  cardBg: string; cardFg: string; bg: string; COLORS: string[]; COLORS_ALL: string[]
  legendTextStyle: { color: string }; axisLabel: { color: string }
  axisLine: { lineStyle: { color: string } }; splitLine: { lineStyle: { color: string } }
  tooltipBg: string; tooltipBorder: string; tooltipText: string
  primaryRgba: (a: number) => string
}

const THEME_COLORS: Record<string, string[]> = {
  craft: [
    '#c67a4b', '#4a7c9a', '#d4a574', '#9a6b4e', '#c44e3a',
    '#5c8a7a', '#e0b878', '#8b5e4b', '#4a7c8c', '#b84a3c',
  ],
  telegram: [
    '#3a3a3a', '#c4a44a', '#6b6b6b', '#8b7355', '#d4b86a',
    '#4a4a4a', '#a08050', '#5a5a5a', '#e0c878', '#2c2c2c',
  ],
  botanical: [
    '#4a7c3f', '#8b9a6b', '#c47a8a', '#5c8a5c', '#9ab87a',
    '#6b8b4a', '#a0c080', '#d4a0a8', '#3a6a3a', '#7a9a5a',
  ],
  candy: [
    '#e891a8', '#5cc4a0', '#f0c040', '#a890d0', '#f08060',
    '#60b8d0', '#e8a0c0', '#80d0b0', '#f0d060', '#c0a0e0',
  ],
  light: [
    '#f97316', '#ef4444', '#3b82f6', '#22c55e', '#a855f7',
    '#eab308', '#ec4899', '#14b8a6', '#8b5cf6', '#f43f5e',
  ],
  dark: [
    '#fb923c', '#f87171', '#60a5fa', '#4ade80', '#c084fc',
    '#facc15', '#f472b6', '#2dd4bf', '#a78bfa', '#fb7185',
  ],
}

const DEFAULT_COLORS = [
  '#f97316', '#ef4444', '#3b82f6', '#22c55e', '#a855f7',
  '#eab308', '#ec4899', '#14b8a6', '#8b5cf6', '#f43f5e',
]

export function useChartTheme(): ChartTheme {
  const { theme } = useThemeContext()

  return useMemo(() => {
    const p = theme.vars['--primary']
    const fg = theme.vars['--foreground']
    const mf = theme.vars['--muted-foreground']
    const b = theme.vars['--border']
    const c = theme.vars['--card']
    const cf = theme.vars['--card-foreground']
    const bg = theme.vars['--background']
    const colors = THEME_COLORS[theme.id] || DEFAULT_COLORS

    return {
      primary: `hsl(${p})`,
      foreground: `hsl(${fg})`,
      mutedForeground: `hsl(${mf})`,
      border: `hsl(${b})`,
      cardBg: `hsl(${c})`,
      cardFg: `hsl(${cf})`,
      bg: `hsl(${bg})`,

      COLORS: colors,
      COLORS_ALL: colors,

      legendTextStyle: { color: `hsl(${mf})` },
      axisLabel: { color: `hsl(${mf})` },
      axisLine: { lineStyle: { color: `hsl(${b})` } },
      splitLine: { lineStyle: { color: `hsl(${b})` } },
      tooltipBg: `hsl(${c})`,
      tooltipBorder: `hsl(${b})`,
      tooltipText: `hsl(${cf})`,

      primaryRgba: (alpha: number) => `hsla(${p} / ${alpha})`,
    }
  }, [theme])
}

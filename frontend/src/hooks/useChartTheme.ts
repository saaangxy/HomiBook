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
    '#3a7a3a', '#5cb85c', '#d94a3a', '#c4a44a', '#1a8a3a',
    '#6b8b5a', '#e0c878', '#4a8a4a', '#f0d060', '#8b7355',
  ],
  botanical: [
    '#4a5a3a', '#8b5e6b', '#6b7a4a', '#b88595', '#2e3a22',
    '#9c8b6e', '#5a7a4a', '#c4b89a', '#7a6a4a', '#5a6a3a',
  ],
  candy: [
    '#e891a8', '#5cc4a0', '#f0c040', '#a890d0', '#f08060',
    '#60b8d0', '#e8a0c0', '#80d0b0', '#f0d060', '#c0a0e0',
  ],
  mondrian: [
    '#e63946', '#0077b6', '#ffd60a', '#1a1a1a', '#c1121f',
    '#023e8a', '#e6be0a', '#8d99ae', '#d90429', '#457b9d',
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

/** 将 CSS 变量中的 "H S% L%" 转为 ECharts canvas 兼容的 "hsl(H, S%, L%)" 逗号分隔格式 */
function toHsl(spaceSep: string): string {
  const parts = spaceSep.split(' ')
  return `hsl(${parts[0]}, ${parts[1]}, ${parts[2]})`
}

function toHsla(spaceSep: string, alpha: number): string {
  const parts = spaceSep.split(' ')
  return `hsla(${parts[0]}, ${parts[1]}, ${parts[2]}, ${alpha})`
}

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
      primary: toHsl(p),
      foreground: toHsl(fg),
      mutedForeground: toHsl(mf),
      border: toHsl(b),
      cardBg: toHsl(c),
      cardFg: toHsl(cf),
      bg: toHsl(bg),

      COLORS: colors,
      COLORS_ALL: colors,

      legendTextStyle: { color: toHsl(mf) },
      axisLabel: { color: toHsl(mf) },
      axisLine: { lineStyle: { color: toHsl(b) } },
      splitLine: { lineStyle: { color: toHsl(b) } },
      tooltipBg: toHsl(c),
      tooltipBorder: toHsl(b),
      tooltipText: toHsl(cf),

      primaryRgba: (alpha: number) => toHsla(p, alpha),
    }
  }, [theme])
}

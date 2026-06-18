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
    '#f4a0b8', '#7dd8c5', '#f5d060', '#c4a0e8', '#f09878',
    '#68c8e8', '#f0b0c8', '#8ad8b8', '#f8d878', '#b8a0e0',
    '#f0c090', '#78d0f0', '#e8a8d0', '#a0e0d0', '#f0c870',
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

/** 生成 N 个视觉差异最大化的 HSL 颜色，适用于分类较多的图表 */
export function generateChartColors(count: number, baseColors: string[] = DEFAULT_COLORS): string[] {
  if (count <= baseColors.length) return baseColors.slice(0, count)

  const colors = [...baseColors]
  for (let i = baseColors.length; i < count; i++) {
    // 黄金角 (137.508°) 确保相邻颜色色调差异最大
    const hue = Math.round((i * 137.508) % 360)
    // 交替饱和度和亮度产生 15 种变化组合
    const sat = 45 + ((i * 7) % 5) * 11
    const light = 40 + ((i * 11) % 5) * 9
    colors.push(`hsl(${hue}, ${sat}%, ${light}%)`)
  }
  return colors
}

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

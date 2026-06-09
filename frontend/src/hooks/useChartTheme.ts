import { useMemo } from 'react'

function cssVar(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim()
}

export interface ChartTheme {
  primary: string; foreground: string; mutedForeground: string; border: string
  cardBg: string; cardFg: string; bg: string; COLORS: string[]; COLORS_ALL: string[]
  legendTextStyle: { color: string }; axisLabel: { color: string }
  axisLine: { lineStyle: { color: string } }; splitLine: { lineStyle: { color: string } }
  tooltipBg: string; tooltipBorder: string; tooltipText: string
  primaryRgba: (a: number) => string
}

export function useChartTheme(): ChartTheme {
  return useMemo(() => {
    const primary = cssVar('--primary')
    const foreground = cssVar('--foreground')
    const mutedForeground = cssVar('--muted-foreground')
    const border = cssVar('--border')
    const card = cssVar('--card')
    const cardForeground = cssVar('--card-foreground')
    const background = cssVar('--background')

    return {
      primary: `hsl(${primary})`,
      foreground: `hsl(${foreground})`,
      mutedForeground: `hsl(${mutedForeground})`,
      border: `hsl(${border})`,
      cardBg: `hsl(${card})`,
      cardFg: `hsl(${cardForeground})`,
      bg: `hsl(${background})`,

      // COLORS 数组第一个用 primary，其余保持不变
      COLORS: [
        `hsl(${primary})`,
        '#ef4444', '#3b82f6', '#22c55e', '#a855f7',
        '#eab308', '#ec4899', '#14b8a6', '#8b5cf6', '#f43f5e',
      ],

      // COLORS 不含 expense(红) 的版本（用于 StatsTimeView 等）
      COLORS_ALL: [
        `hsl(${primary})`,
        '#ef4444', '#3b82f6', '#22c55e', '#a855f7',
        '#eab308', '#ec4899', '#14b8a6', '#8b5cf6', '#f43f5e',
      ],

      // 图表文本样式
      legendTextStyle: { color: `hsl(${mutedForeground})` },
      axisLabel: { color: `hsl(${mutedForeground})` },
      axisLine: { lineStyle: { color: `hsl(${border})` } },
      splitLine: { lineStyle: { color: `hsl(${border})` } },
      tooltipBg: `hsl(${card})`,
      tooltipBorder: `hsl(${border})`,
      tooltipText: `hsl(${cardForeground})`,

      primaryRgba: (alpha: number) => `hsla(${primary} / ${alpha})`,
    }
  }, [])
}

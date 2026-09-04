import type { ThemeColors } from './palettes';
import { useTheme } from './context';

// 图表主题色 hook(对齐 web 端 useChartTheme):
// 语义色(收入/支出/转账/主色)与分类色板随主题切换,替换页面里硬编码的十六进制色。
// 分类数超过色板长度时按黄金角(137.5°)生成色相差异最大的补充色(web 同款算法)。

/** 收入/支出/转账语义色(替代硬编码 #22c55e/#ef4444/#3b82f6);未知类型回退 fallback(缺省=支出色) */
export function semanticTypeColor(colors: ThemeColors, type?: string, fallback?: string): string {
  if (type === 'INCOME') return colors.income;
  if (type === 'TRANSFER') return colors.transfer;
  if (type === 'EXPENSE') return colors.expense;
  return fallback ?? colors.expense;
}

export interface ChartColors {
  /** 收入(语义) */
  income: string;
  /** 支出(语义) */
  expense: string;
  /** 转账(语义) */
  transfer: string;
  /** 主色 */
  primary: string;
  /** 分类色板(每主题 10 色) */
  COLORS: string[];
  /** 按索引取分类色,超出色板自动扩展 */
  chartColor: (i: number) => string;
}

export function useChartColors(): ChartColors {
  const { colors } = useTheme();
  const chart = colors.chart;
  const chartColor = (i: number): string => {
    if (i < chart.length) return chart[i];
    const hue = Math.round((i * 137.508) % 360);
    return `hsl(${hue}, 60%, 50%)`;
  };
  return {
    income: colors.income,
    expense: colors.expense,
    transfer: colors.transfer,
    primary: colors.primary,
    COLORS: chart,
    chartColor,
  };
}

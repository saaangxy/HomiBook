import type { ViewStyle } from 'react-native';
import type { Palette } from './palettes';

// 全局设计 Token(跨主题共享);主题相关值(圆角/阴影策略)走 palette

/** 4px 基数间距 */
export const spacing = { xs: 4, sm: 8, md: 12, lg: 16, xl: 20, xxl: 24, xxxl: 32 } as const;

/** 页面统一水平内边距 */
export const pagePadding = 20;

/** 颜色加透明度:支持 hsl()/hsla()/hex;淡彩底、描边等场景统一走此 */
export function alpha(color: string, a: number): string {
  const hslMatch = color.match(/^hsl\(([^)]+)\)$/);
  if (hslMatch) return `hsla(${hslMatch[1]}, ${a})`;
  const hslaMatch = color.match(/^hsla\(([^,]+,[^,]+,[^,]+),[^)]+\)$/);
  if (hslaMatch) return `hsla(${hslaMatch[1]}, ${a})`;
  if (/^#[0-9a-fA-F]{6}$/.test(color)) {
    return color + Math.round(a * 255).toString(16).padStart(2, '0');
  }
  return color;
}

export const typography = {
  display: { fontSize: 28, fontWeight: '700' as const, letterSpacing: -0.5 },
  title: { fontSize: 20, fontWeight: '700' as const, letterSpacing: -0.3 },
  cardTitle: { fontSize: 16, fontWeight: '600' as const },
  body: { fontSize: 14 },
  caption: { fontSize: 12 },
  calendarMoney: { fontSize: 8.5 },
} as const;

/** 阴影随主题策略生成(mondrian/telegram 返回空) */
export function cardShadow(palette: Palette): ViewStyle {
  if (palette.cardStyle.shadow === 'none') return {};
  if (palette.cardStyle.shadow === 'tinted') {
    return {
      shadowColor: palette.colors.primary,
      shadowOpacity: 0.18,
      shadowRadius: 14,
      shadowOffset: { width: 0, height: 6 },
      elevation: 3,
    };
  }
  // soft:浅色淡影 / 深色加大透明度
  const dark = palette.mode === 'dark';
  return {
    shadowColor: dark ? '#000000' : '#0f172a',
    shadowOpacity: dark ? 0.3 : 0.05,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 3 },
    elevation: dark ? 2 : 1,
  };
}

/** 弹窗级重阴影 */
export function sheetShadow(palette: Palette): ViewStyle {
  if (palette.cardStyle.shadow === 'none') return {};
  return {
    shadowColor: '#000000',
    shadowOpacity: palette.mode === 'dark' ? 0.5 : 0.12,
    shadowRadius: 32,
    shadowOffset: { width: 0, height: 12 },
    elevation: 8,
  };
}

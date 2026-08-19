import { Text as RNText, type TextProps, type TextStyle } from 'react-native';
import { useTheme } from '@/theme';

type Variant = 'default' | 'muted' | 'primary' | 'income' | 'expense' | 'bold' | 'title' | 'micro' | 'label' | 'amount';

interface ThemedTextProps extends TextProps {
  variant?: Variant;
}

// 主题文本:正文 + 微型标签 + 字段标签 + 大号金额
export function Text({ variant = 'default', style, children, ...rest }: ThemedTextProps) {
  const { colors } = useTheme();
  const color =
    variant === 'muted' ? colors.mutedForeground
    : variant === 'primary' ? colors.primary
    : variant === 'income' ? colors.income
    : variant === 'expense' ? colors.expense
    : colors.foreground;

  const extra: TextStyle =
    variant === 'micro' ? { fontSize: 11, letterSpacing: 2, fontWeight: '600', textTransform: 'uppercase' }
    : variant === 'label' ? { fontSize: 12, fontWeight: '500', letterSpacing: 0.3, color: colors.mutedForeground, marginBottom: 6 }
    : variant === 'title' ? { fontSize: 20, fontWeight: '700', letterSpacing: -0.3 }
    : variant === 'bold' ? { fontWeight: '600' }
    : variant === 'amount' ? { fontSize: 38, fontWeight: '700', letterSpacing: -0.5, fontVariant: ['tabular-nums'] }
    : {};

  return (
    <RNText style={[{ color }, extra, style]} {...rest}>
      {children}
    </RNText>
  );
}
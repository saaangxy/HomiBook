import { Text as RNText, type TextProps } from 'react-native';
import { useTheme } from '@/theme';

interface ThemedTextProps extends TextProps {
  variant?: 'default' | 'muted' | 'primary' | 'income' | 'expense' | 'bold' | 'title';
}

// 主题文本:默认前景色,可按语义取色
export function Text({ variant = 'default', style, children, ...rest }: ThemedTextProps) {
  const { colors } = useTheme();
  const color =
    variant === 'muted' ? colors.mutedForeground
    : variant === 'primary' ? colors.primary
    : variant === 'income' ? colors.income
    : variant === 'expense' ? colors.expense
    : variant === 'bold' || variant === 'title' ? colors.foreground
    : colors.foreground;

  return (
    <RNText
      style={[
        { color },
        variant === 'bold' && { fontWeight: '600' },
        variant === 'title' && { fontWeight: '700' },
        style,
      ]}
      {...rest}
    >
      {children}
    </RNText>
  );
}
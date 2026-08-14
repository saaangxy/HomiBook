import { type ReactNode } from 'react';
import { View, type ViewStyle } from 'react-native';
import { useTheme } from '@/theme';
import { AnimatedPressable } from '@/components/AnimatedPressable';

interface CardProps {
  children: ReactNode;
  className?: string;
  style?: ViewStyle;
  onPress?: () => void;
}

// 主题卡片:圆角 + 边框 + 卡片底色
export function Card({ children, className = '', style, onPress }: CardProps) {
  const { colors } = useTheme();
  const base = {
    backgroundColor: colors.card,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: colors.border,
  };

  if (onPress) {
    return (
      <AnimatedPressable style={[base, style]}>
        <View className={className}>{children}</View>
      </AnimatedPressable>
    );
  }
  return <View style={[base, style]} className={className}>{children}</View>;
}
import { type ReactNode } from 'react';
import { View, type ViewStyle } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useTheme } from '@/theme';
import { AnimatedPressable } from '@/components/AnimatedPressable';

interface CardProps {
  children: ReactNode;
  className?: string;
  style?: ViewStyle;
  onPress?: () => void;
  /** gradient: 橙渐变卡(浅色文字) */
  variant?: 'default' | 'gradient';
}

// 精致卡片:20px 大圆角 + 发丝边 + 极淡投影(浅色) / 抬高面(深色);variant=gradient 用橙渐变
export function Card({ children, className = '', style, onPress, variant = 'default' }: CardProps) {
  const { colors, isDark } = useTheme();

  if (variant === 'gradient') {
    const grad = (
      <LinearGradient
        colors={['#fb923c', '#f97316', '#ea580c']}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={[{ borderRadius: 20 }, style]}
      >
        <View className={className}>{children}</View>
      </LinearGradient>
    );
    if (onPress) return <AnimatedPressable>{grad}</AnimatedPressable>;
    return grad;
  }

  const base: ViewStyle = {
    backgroundColor: colors.card,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: isDark ? colors.border : '#eef1f5',
    ...(isDark
      ? {}
      : { shadowColor: '#0f172a', shadowOpacity: 0.04, shadowRadius: 10, shadowOffset: { width: 0, height: 3 }, elevation: 1 }),
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
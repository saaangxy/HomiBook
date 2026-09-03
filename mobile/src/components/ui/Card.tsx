import { type ReactNode } from 'react';
import { View, type ViewStyle } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useTheme, cardShadow } from '@/theme';
import { AnimatedPressable } from '@/components/AnimatedPressable';

interface CardProps {
  children: ReactNode;
  className?: string;
  style?: ViewStyle;
  onPress?: () => void;
  /** gradient: 品牌渐变卡(浅色文字) */
  variant?: 'default' | 'gradient';
}

// 主题化卡片:圆角/边框/阴影随主题策略(mondrian 实线无影、craft 票据粗边、telegram 发光边)
export function Card({ children, className = '', style, onPress, variant = 'default' }: CardProps) {
  const { colors, palette } = useTheme();

  if (variant === 'gradient') {
    const grad = (
      <LinearGradient
        colors={palette.colors.gradient}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={[{ borderRadius: palette.radius.card }, style]}
      >
        <View className={className}>{children}</View>
      </LinearGradient>
    );
    if (onPress) return <AnimatedPressable onPress={onPress}>{grad}</AnimatedPressable>;
    return grad;
  }

  const base: ViewStyle = {
    backgroundColor: colors.card,
    borderRadius: palette.radius.card,
    borderWidth: palette.cardStyle.borderWidth,
    borderColor: colors.border,
    ...cardShadow(palette),
  };

  if (onPress) {
    // 注意:样式与 className 必须落在内层 View(而非 AnimatedPressable)上,
    // 否则 flexDirection 等布局样式不作用于子内容,导致按压卡与普通卡布局不一致
    return (
      <AnimatedPressable onPress={onPress}>
        <View style={[base, style]} className={className}>{children}</View>
      </AnimatedPressable>
    );
  }
  return <View style={[base, style]} className={className}>{children}</View>;
}

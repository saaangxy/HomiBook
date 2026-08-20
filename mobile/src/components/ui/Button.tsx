import { type ReactNode } from 'react';
import { ActivityIndicator, StyleSheet, Text, type ViewStyle } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useTheme } from '@/theme';
import { AnimatedPressable } from '@/components/AnimatedPressable';

interface ButtonProps {
  title: string;
  onPress?: () => void;
  variant?: 'primary' | 'secondary' | 'outline' | 'ghost';
  disabled?: boolean;
  loading?: boolean;
  size?: 'md' | 'lg';
  icon?: ReactNode;
  style?: ViewStyle;
}

const SIZES = {
  md: { height: 48, padX: 20, fontSize: 15 },
  lg: { height: 54, padX: 24, fontSize: 16 },
};

// 主题化主按钮(品牌渐变,圆角随主题;mondrian 为方角色块)、次级/描边/幽灵变体
export function Button({ title, onPress, variant = 'primary', disabled, loading, size = 'md', icon, style }: ButtonProps) {
  const { colors, palette, fonts } = useTheme();
  const s = SIZES[size];
  const isPrimary = variant === 'primary';
  const radius = palette.radius.button;
  const font = { fontFamily: fonts.medium };

  const base: ViewStyle = {
    height: s.height,
    borderRadius: radius,
    paddingHorizontal: s.padX,
    borderWidth: variant === 'outline' || variant === 'secondary' ? palette.cardStyle.borderWidth : 0,
    borderColor: variant === 'outline' || variant === 'secondary' ? colors.border : 'transparent',
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: 8,
    opacity: disabled ? 0.5 : 1,
  };

  // 次级按钮:muted 底深字
  if (variant === 'secondary') {
    return (
      <AnimatedPressable disabled={disabled || loading} onPress={onPress} style={[base, { backgroundColor: colors.muted }, style]}>
        {loading ? <ActivityIndicator color={colors.foreground} /> : (
          <>
            {icon}
            <Text style={[{ color: colors.foreground, fontSize: s.fontSize, fontWeight: '500' }, font]}>{title}</Text>
          </>
        )}
      </AnimatedPressable>
    );
  }

  // 主按钮:主题品牌渐变 + 投影(overflow 裁剪渐变圆角)
  if (isPrimary) {
    return (
      <AnimatedPressable
        disabled={disabled || loading}
        onPress={onPress}
        style={[
          base,
          {
            backgroundColor: colors.primary,
            overflow: 'hidden',
            shadowColor: colors.primary,
            shadowOpacity: palette.cardStyle.shadow === 'none' ? 0 : 0.35,
            shadowRadius: 14,
            shadowOffset: { width: 0, height: 6 },
            elevation: palette.cardStyle.shadow === 'none' ? 0 : 5,
          },
          style,
        ]}
      >
        <LinearGradient
          colors={palette.colors.gradient}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={StyleSheet.absoluteFill}
        />
        {loading ? <ActivityIndicator color={colors.primaryForeground} /> : (
          <>
            {icon}
            <Text style={[{ color: colors.primaryForeground, fontSize: s.fontSize, fontWeight: '600', letterSpacing: 0.5 }, font]}>{title}</Text>
          </>
        )}
      </AnimatedPressable>
    );
  }

  // outline / ghost
  const fg = variant === 'outline' ? colors.foreground : colors.primary;
  return (
    <AnimatedPressable disabled={disabled || loading} onPress={onPress} style={[base, variant === 'outline' ? { backgroundColor: colors.card } : { backgroundColor: 'transparent' }, style]}>
      {loading ? <ActivityIndicator color={fg} /> : (
        <>
          {icon}
          <Text style={[{ color: fg, fontSize: s.fontSize, fontWeight: variant === 'ghost' ? '500' : '600' }, font]}>{title}</Text>
        </>
      )}
    </AnimatedPressable>
  );
}

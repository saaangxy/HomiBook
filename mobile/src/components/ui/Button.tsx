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

// 橙渐变主按钮(pill)、次级/描边/幽灵变体 —— 对齐移动端原型
export function Button({ title, onPress, variant = 'primary', disabled, loading, size = 'md', icon, style }: ButtonProps) {
  const { colors } = useTheme();
  const s = SIZES[size];
  const isPrimary = variant === 'primary';

  const base: ViewStyle = {
    height: s.height,
    borderRadius: 999,
    paddingHorizontal: s.padX,
    borderWidth: variant === 'outline' || variant === 'secondary' ? 1 : 0,
    borderColor: variant === 'outline' ? colors.border : variant === 'secondary' ? colors.border : 'transparent',
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: 8,
    opacity: disabled ? 0.5 : 1,
  };

  // 次级按钮:浅灰底深字(原型 btn-secondary)
  if (variant === 'secondary') {
    return (
      <AnimatedPressable disabled={disabled || loading} onPress={onPress} style={[base, { backgroundColor: colors.muted }, style]}>
        {loading ? <ActivityIndicator color={colors.foreground} /> : (
          <>
            {icon}
            <Text style={{ color: colors.foreground, fontSize: s.fontSize, fontWeight: '500' }}>{title}</Text>
          </>
        )}
      </AnimatedPressable>
    );
  }

  // 主按钮:橙渐变 + 柔和投影(渐变置于内容之后绘制为底层)
  if (isPrimary) {
    return (
      <AnimatedPressable
        disabled={disabled || loading}
        onPress={onPress}
        style={[
          base,
          { backgroundColor: '#f97316', shadowColor: '#f97316', shadowOpacity: 0.35, shadowRadius: 14, shadowOffset: { width: 0, height: 6 }, elevation: 5 },
          style,
        ]}
      >
        <LinearGradient
          colors={['#fb923c', '#f97316', '#ea580c']}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={StyleSheet.absoluteFill}
        />
        {loading ? <ActivityIndicator color="#fff" /> : (
          <>
            {icon}
            <Text style={{ color: '#fff', fontSize: s.fontSize, fontWeight: '600', letterSpacing: 0.5 }}>{title}</Text>
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
          <Text style={{ color: fg, fontSize: s.fontSize, fontWeight: variant === 'ghost' ? '500' : '600' }}>{title}</Text>
        </>
      )}
    </AnimatedPressable>
  );
}
import { type ReactNode } from 'react';
import { ActivityIndicator, Text, type ViewStyle } from 'react-native';
import { useTheme } from '@/theme';
import { AnimatedPressable } from '@/components/AnimatedPressable';

interface ButtonProps {
  title: string;
  onPress?: () => void;
  variant?: 'primary' | 'outline' | 'ghost';
  disabled?: boolean;
  loading?: boolean;
  size?: 'md' | 'lg';
  icon?: ReactNode;
  style?: ViewStyle;
}

const SIZES = {
  md: { height: 46, radius: 14, fontSize: 15 },
  lg: { height: 54, radius: 16, fontSize: 16 },
};

// 主题按钮(主色/描边/Ghost)
export function Button({ title, onPress, variant = 'primary', disabled, loading, size = 'md', icon, style }: ButtonProps) {
  const { colors } = useTheme();
  const s = SIZES[size];
  const isPrimary = variant === 'primary';

  const bg = isPrimary ? colors.primary : variant === 'outline' ? 'transparent' : 'transparent';
  const border = variant === 'outline' ? colors.border : 'transparent';
  const fg = isPrimary ? colors.primaryForeground : colors.foreground;

  return (
    <AnimatedPressable
      onPress={onPress}
      disabled={disabled || loading}
      style={[
        {
          height: s.height,
          borderRadius: s.radius,
          backgroundColor: bg,
          borderWidth: variant === 'outline' ? 1 : 0,
          borderColor: border,
          alignItems: 'center',
          justifyContent: 'center',
          flexDirection: 'row',
          gap: 8,
          opacity: disabled ? 0.5 : 1,
        },
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={fg} />
      ) : (
        <>
          {icon}
          <Text style={{ color: fg, fontSize: s.fontSize, fontWeight: '600' }}>{title}</Text>
        </>
      )}
    </AnimatedPressable>
  );
}
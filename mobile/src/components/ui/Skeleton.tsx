import { useEffect } from 'react';
import { View, type DimensionValue, type ViewStyle } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import Animated, {
  interpolate,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';
import { useTheme } from '@/theme';

interface SkeletonProps {
  width?: DimensionValue;
  height?: number;
  radius?: number;
  style?: ViewStyle;
}

const SWEEP = 160; // 扫光行程(px),覆盖常见卡片宽度

// shimmer 骨架块:muted 底 + 循环高光扫过,替代 loading 圈
export function Skeleton({ width = '100%', height = 16, radius = 8, style }: SkeletonProps) {
  const { colors, isDark } = useTheme();
  const progress = useSharedValue(0);

  useEffect(() => {
    progress.value = withRepeat(withTiming(1, { duration: 900 }), -1, false);
  }, [progress]);

  const sweepStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: interpolate(progress.value, [0, 1], [-SWEEP, SWEEP * 2]) }],
  }));

  const highlight = isDark ? 'rgba(255,255,255,0.08)' : 'rgba(255,255,255,0.65)';

  return (
    <View
      style={[
        { width, height, borderRadius: radius, backgroundColor: colors.muted, overflow: 'hidden' },
        style,
      ]}
    >
      <Animated.View style={[{ position: 'absolute', top: 0, bottom: 0, width: SWEEP / 2 }, sweepStyle]}>
        <LinearGradient
          colors={['transparent', highlight, 'transparent']}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 0 }}
          style={{ flex: 1 }}
        />
      </Animated.View>
    </View>
  );
}

/** 卡片骨架(汇总卡/列表卡占位) */
export function CardSkeleton({ lines = 3, style }: { lines?: number; style?: ViewStyle }) {
  const { palette } = useTheme();
  return (
    <View style={[{ gap: 10, padding: 20 }, style]}>
      <Skeleton width="40%" height={14} radius={palette.radius.input} />
      {Array.from({ length: lines }).map((_, i) => (
        <Skeleton key={i} width={i === lines - 1 ? '65%' : '100%'} height={12} radius={palette.radius.input} />
      ))}
    </View>
  );
}

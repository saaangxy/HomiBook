import { useEffect, type ReactNode } from 'react';
import { type ViewStyle } from 'react-native';
import Animated, { interpolate, useAnimatedStyle, useSharedValue, withDelay, withTiming } from 'react-native-reanimated';
import { motion } from '@/theme/motion';

interface FadeInViewProps {
  children: ReactNode;
  index?: number;
  from?: 'top' | 'bottom';
  className?: string;
  style?: ViewStyle;
}

// 入场 stagger 动画:每项延迟 40ms,超过上限(8 项)不再累加,避免长列表掉帧
// 注意:刻意不用 Reanimated 的 entering 布局动画,改用 useAnimatedStyle 共享值驱动——
// entering 在 freezeOnBlur 冻结/恢复后会因 settled 动画结算值丢失而把视图永久回退到
// 挂载时样式(reanimated #9965);worklet 样式在解冻后会重新注册,不受影响
export function FadeInView({ children, index = 0, from = 'bottom', className, style }: FadeInViewProps) {
  const capped = Math.min(index, motion.stagger.maxItems - 1);
  const progress = useSharedValue(0);

  useEffect(() => {
    progress.value = withDelay(
      capped * motion.stagger.delay,
      withTiming(1, { duration: motion.duration.slow, easing: motion.easing }),
    );
  }, [capped, progress]);

  const animated = useAnimatedStyle(() => ({
    opacity: progress.value,
    transform: [{
      translateY: interpolate(progress.value, [0, 1], [from === 'bottom' ? motion.stagger.offsetY : -motion.stagger.offsetY, 0]),
    }],
  }));

  return (
    <Animated.View style={[animated, style]} className={className}>
      {children}
    </Animated.View>
  );
}

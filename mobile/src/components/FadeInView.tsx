import { type ReactNode } from 'react';
import { type ViewStyle } from 'react-native';
import Animated, { Easing, FadeInDown, FadeInUp } from 'react-native-reanimated';
import { motion } from '@/theme/motion';

interface FadeInViewProps {
  children: ReactNode;
  index?: number;
  from?: 'top' | 'bottom';
  className?: string;
  style?: ViewStyle;
}

// 入场 stagger 动画:每项延迟 40ms,超过上限(8 项)不再累加,避免长列表掉帧
export function FadeInView({ children, index = 0, from = 'bottom', className, style }: FadeInViewProps) {
  const entering = from === 'bottom' ? FadeInUp : FadeInDown;
  const capped = Math.min(index, motion.stagger.maxItems - 1);
  return (
    <Animated.View
      entering={entering.delay(capped * motion.stagger.delay).duration(300).easing(Easing.out(Easing.cubic))}
      className={className}
      style={style}
    >
      {children}
    </Animated.View>
  );
}

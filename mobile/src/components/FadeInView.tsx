import { type ReactNode } from 'react';
import { type ViewStyle } from 'react-native';
import Animated, { FadeInDown, FadeInUp } from 'react-native-reanimated';

interface FadeInViewProps {
  children: ReactNode;
  index?: number;
  from?: 'top' | 'bottom';
  className?: string;
  style?: ViewStyle;
}

// 入场淡入+上移动画(列表项可传 index 错开出现)
export function FadeInView({ children, index = 0, from = 'bottom', className, style }: FadeInViewProps) {
  const entering = from === 'bottom' ? FadeInUp : FadeInDown;
  return (
    <Animated.View
      entering={entering.delay(index * 60).springify().damping(18)}
      className={className}
      style={style}
    >
      {children}
    </Animated.View>
  );
}
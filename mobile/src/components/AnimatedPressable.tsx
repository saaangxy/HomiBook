import { forwardRef } from 'react';
import { Pressable, type PressableProps } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withSpring } from 'react-native-reanimated';
import { motion, haptics } from '@/theme/motion';

const AnimatedPressableBase = Animated.createAnimatedComponent(Pressable);

export interface AnimatedPressableProps extends PressableProps {
  /** 按下缩放比例,默认 0.97 */
  scale?: number;
  /** 是否触发触感反馈,默认 true */
  haptic?: boolean;
}

// 带按压缩放 + 触感反馈的封装按钮
export const AnimatedPressable = forwardRef<typeof Pressable, AnimatedPressableProps>(function AnimatedPressable(
  { scale = 0.97, haptic = true, onPressIn, onPressOut, style, children, disabled, ...rest },
  ref,
) {
  const s = useSharedValue(1);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: s.value }],
  }));

  return (
    <AnimatedPressableBase
      ref={ref as any}
      disabled={disabled}
      onPressIn={(e) => {
        s.value = withSpring(scale, motion.spring.snappy);
        if (haptic && !disabled) haptics.tap();
        onPressIn?.(e);
      }}
      onPressOut={(e) => {
        s.value = withSpring(1, motion.spring.snappy);
        onPressOut?.(e);
      }}
      style={[animatedStyle, style]}
      {...rest}
    >
      {children}
    </AnimatedPressableBase>
  );
});
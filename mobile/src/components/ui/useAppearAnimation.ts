import { useEffect } from 'react';
import { useAnimatedStyle, useSharedValue, withDelay, withTiming, type SharedValue } from 'react-native-reanimated';
import { motion } from '@/theme';

/**
 * 入场动画的共享值版（替代 Reanimated 的 entering 布局动画）。
 *
 * 为什么不用 entering：主 window 覆盖层（FormSheet / FilterSheet / RecordModal 等，
 * 替代 RN Modal 的 absoluteFill 结构）关闭时 unmount 带 entering 的视图，会把页面上
 * **其它** worklet 动画样式（如列表 FadeInView）打回挂载时值 —— 表现为弹窗一关、
 * 整页列表 opacity 归 0 变空白，切 tab 触发 freezeOnBlur 冻结/解冻后样式重新注册才恢复
 * （reanimated #9965 同类问题，FadeInView.tsx 有同样记录）。
 * RN Modal 独立窗口内的 entering（DatePicker / TagPicker / LedgerModal）不受影响，保持不动。
 *
 * 用法：active 翻 true 时 0 → 1 播放入场；翻 false 时复位 0（视图树已卸载，不影响画面，
 * 供下次打开重播）。
 */
export function useAppearProgress({ active, delay = 0, duration = motion.duration.base }: {
  active: boolean;
  delay?: number;
  duration?: number;
}): SharedValue<number> {
  const progress = useSharedValue(0);
  useEffect(() => {
    if (active) progress.value = withDelay(delay, withTiming(1, { duration, easing: motion.easing }));
    else progress.value = 0;
  }, [active, delay, duration, progress]);
  return progress;
}

/** 便捷封装：直接产出入场样式（opacity + 轻微上滑），用于不需要与手势位移合并的场景 */
export function useAppearStyle(opts: { active: boolean; offsetY?: number; delay?: number; duration?: number }) {
  const { offsetY = 0, ...rest } = opts;
  const progress = useAppearProgress(rest);
  return useAnimatedStyle(() => ({
    opacity: progress.value,
    transform: [{ translateY: (1 - progress.value) * offsetY }],
  }));
}

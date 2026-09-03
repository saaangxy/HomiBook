import { Easing } from 'react-native-reanimated';
import * as Haptics from 'expo-haptics';

// 全局动效参数:所有动画/触觉反馈统一取自此,保证手感一致

export const motion = {
  duration: { fast: 150, base: 220, slow: 320 },
  /** iOS 弹性曲线,全局唯一缓动 */
  easing: Easing.bezier(0.16, 1, 0.3, 1),
  spring: {
    /** 侧边栏/弹窗(沿用已验证配置) */
    gentle: { damping: 26, stiffness: 210 },
    /** 按压/回弹 */
    snappy: { damping: 15, stiffness: 300, mass: 0.8 },
    /** FAB、记账成功等强调回弹 */
    bouncy: { damping: 12, stiffness: 180 },
  },
  /** 列表 stagger 参数:每项延迟与上限 */
  stagger: { delay: 40, maxItems: 8, offsetY: 12 },
  /** 侧边栏开合(纯线性 ease,已验证手感,集中管理) */
  sidebar: { duration: 280, easing: Easing.out(Easing.ease) },
} as const;

/** 触觉反馈统一封装 */
export const haptics = {
  /** tab 切换、chips 选中、展开折叠 */
  tap: () => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light),
  /** 弹窗出现、长按进入多选 */
  medium: () => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium),
  /** 记账/保存成功 */
  success: () => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success),
  /** 删除确认、超预算提示 */
  warn: () => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning),
} as const;

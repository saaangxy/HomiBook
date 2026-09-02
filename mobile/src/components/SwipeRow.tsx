import { type ReactNode } from 'react';
import { Pressable, View } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withSpring } from 'react-native-reanimated';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import type { LucideIcon } from 'lucide-react-native';
import { useTheme, motion, haptics } from '@/theme';
import { Text } from '@/components/ui/Text';

export interface SwipeAction {
  key: string;
  label: string;
  /** 操作块背景色 */
  color: string;
  fg?: string;
  icon?: LucideIcon;
  onPress: () => void;
}

const ACTION_W = 64;
const GAP = 6;
const EDGE = 6;
const V_MARGIN = 8;
/** 行最小高度 = 操作块期望高度 + 上下留白:行内容较矮(如日历页)时撑起按钮空间,按钮不溢出不裁剪 */
const ROW_MIN_H = 52 + V_MARGIN * 2;

// 左滑露出操作区(克隆/删除等):内嵌圆角方块 + 间距,弹性吸附半开/关闭两档;行底色遮盖下层操作区
export function SwipeRow({ actions, children }: { actions: SwipeAction[]; children: ReactNode }) {
  const { colors } = useTheme();
  const translateX = useSharedValue(0);
  const startX = useSharedValue(0);
  const maxOpen = actions.length * ACTION_W + (actions.length - 1) * GAP + EDGE * 2;

  const pan = Gesture.Pan()
    // 水平位移超阈值才激活,避免与垂直滚动冲突
    .activeOffsetX([-15, 15])
    .onStart(() => {
      startX.value = translateX.value;
    })
    .onUpdate((e) => {
      const next = startX.value + e.translationX;
      translateX.value = Math.max(-maxOpen, Math.min(0, next));
    })
    .onEnd((e) => {
      const open = translateX.value < -maxOpen / 2 || e.velocityX < -500;
      translateX.value = withSpring(open ? -maxOpen : 0, motion.spring.snappy);
    });

  const rowStyle = useAnimatedStyle(() => ({ transform: [{ translateX: translateX.value }] }));

  const close = () => {
    translateX.value = withSpring(0, motion.spring.snappy);
  };

  return (
    <View style={{ overflow: 'hidden' }}>
      {/* 操作区(右侧,衬于行下):圆角方块 + 间距,视觉更轻盈 */}
      <View style={{ position: 'absolute', right: 0, top: 0, bottom: 0, flexDirection: 'row', alignItems: 'stretch', gap: GAP, paddingHorizontal: EDGE }}>
        {actions.map((a) => (
          <Pressable
            key={a.key}
            onPress={() => {
              haptics.tap();
              close();
              a.onPress();
            }}
            style={{
              width: ACTION_W,
              marginVertical: V_MARGIN,
              alignItems: 'center',
              justifyContent: 'center',
              gap: 3,
              borderRadius: 14,
              backgroundColor: a.color,
            }}
          >
            {a.icon && <a.icon size={16} color={a.fg ?? '#fff'} />}
            <Text style={{ fontSize: 11, color: a.fg ?? '#fff', fontWeight: '500' }}>{a.label}</Text>
          </Pressable>
        ))}
      </View>
      <GestureDetector gesture={pan}>
        <Animated.View style={[rowStyle, { backgroundColor: colors.card, minHeight: ROW_MIN_H }]}>{children}</Animated.View>
      </GestureDetector>
    </View>
  );
}

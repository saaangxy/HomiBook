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

const ACTION_W = 72;

// 左滑露出操作区(编辑/克隆/删除):弹性吸附半开/关闭两档;行底色遮盖下层操作区
export function SwipeRow({ actions, children }: { actions: SwipeAction[]; children: ReactNode }) {
  const { colors } = useTheme();
  const translateX = useSharedValue(0);
  const startX = useSharedValue(0);
  const maxOpen = actions.length * ACTION_W;

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
      {/* 操作区(右侧,衬于行下) */}
      <View style={{ position: 'absolute', right: 0, top: 0, bottom: 0, flexDirection: 'row' }}>
        {actions.map((a) => (
          <Pressable
            key={a.key}
            onPress={() => {
              haptics.tap();
              close();
              a.onPress();
            }}
            style={{ width: ACTION_W, alignItems: 'center', justifyContent: 'center', backgroundColor: a.color, gap: 3 }}
          >
            {a.icon && <a.icon size={16} color={a.fg ?? '#fff'} />}
            <Text style={{ fontSize: 11, color: a.fg ?? '#fff', fontWeight: '500' }}>{a.label}</Text>
          </Pressable>
        ))}
      </View>
      <GestureDetector gesture={pan}>
        <Animated.View style={[rowStyle, { backgroundColor: colors.card }]}>{children}</Animated.View>
      </GestureDetector>
    </View>
  );
}

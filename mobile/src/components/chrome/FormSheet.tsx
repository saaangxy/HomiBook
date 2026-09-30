import { useEffect, type ReactNode } from 'react';
import { KeyboardAvoidingView, Modal, Pressable, ScrollView, StyleSheet, useWindowDimensions, View } from 'react-native';
import Animated, {
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from 'react-native-reanimated';
import { Gesture, GestureDetector, GestureHandlerRootView } from 'react-native-gesture-handler';
import { useTheme, motion, haptics, sheetShadow } from '@/theme';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Text } from '@/components/ui/Text';
import { Button } from '@/components/ui/Button';
import { useAppearProgress } from '@/components/ui/useAppearAnimation';

interface FormSheetProps {
  visible: boolean;
  title: string;
  onClose: () => void;
  onSave?: () => void;
  saveLabel?: string;
  saveLoading?: boolean;
  /**
   * 内容可能超过一屏时开启:给内容区加高度上限并内部滚动。
   * 底部弹窗高度跟着内容长,内容过高会一路顶到状态栏/通知栏;长内容(详情、多字段表单)务必开启。
   * 默认关闭 —— 短表单不需要多包一层 ScrollView。
   */
  scrollBody?: boolean;
  children: ReactNode;
}

// 底部表单弹窗 v2:主题化圆角/阴影 + 把手区下滑关闭手势(阈值 80px 或速度 800)
export function FormSheet({ visible, title, onClose, onSave, saveLabel = '保存', saveLoading, scrollBody = false, children }: FormSheetProps) {
  const { colors, palette } = useTheme();
  const insets = useSafeAreaInsets();
  const { height: windowHeight } = useWindowDimensions();
  const translateY = useSharedValue(0);
  // 内容区高度上限:整屏 − 顶部安全区 − 底部安全区 − (把手/标题/保存按钮/内边距 ≈ 240)
  const maxBodyHeight = Math.max(180, windowHeight - insets.top - insets.bottom - 240);

  // 入场动画(共享值驱动,替代 entering —— 见 useAppearAnimation.ts 顶部说明)
  const appear = useAppearProgress({ active: visible });
  // 背景淡入;弹窗淡入上滑,并与下拉关闭手势的位移合并进同一个 worklet
  const backdropAnim = useAnimatedStyle(() => ({ opacity: appear.value }));
  const sheetAnim = useAnimatedStyle(() => ({
    opacity: appear.value,
    transform: [{ translateY: translateY.value + (1 - appear.value) * 24 }],
  }));

  // 打开时复位位移 + 出现触感
  useEffect(() => {
    if (visible) {
      translateY.value = 0;
      haptics.medium();
    }
  }, [visible, translateY]);

  const pan = Gesture.Pan()
    .onUpdate((e) => {
      if (e.translationY > 0) translateY.value = e.translationY;
    })
    .onEnd((e) => {
      if (e.translationY > 80 || e.velocityY > 800) {
        runOnJS(onClose)();
      } else {
        translateY.value = withSpring(0, motion.spring.gentle);
      }
    });

  // 全屏 Modal(透明):弹窗必须盖住整个屏幕。早期用 `StyleSheet.absoluteFill` 覆盖层,
  // 它只能盖住「所在父容器」—— 被嵌在页面/聊天面板里时,弹窗被裁在容器内(底部按钮被 tab bar
  // 压住、面板外还露出页面内容)。Android edge-to-edge 下必须带 statusBarTranslucent +
  // navigationBarTranslucent,否则独立 Dialog 窗口的高度会被截断(底部留缝)。
  // 返回键由 Modal 的 onRequestClose 处理,不再需要 BackHandler。
  if (!visible) return null;

  return (
    <Modal visible transparent animationType="none" statusBarTranslucent navigationBarTranslucent onRequestClose={onClose}>
      {/* Modal 是独立原生层级,不在根 GestureHandlerRootView 子树内 —— 少了它,把手区下拉关闭手势不生效 */}
      <GestureHandlerRootView style={{ flex: 1 }}>
      <KeyboardAvoidingView
        style={{ flex: 1, justifyContent: 'flex-end' }}
        behavior="padding"
      >
        <Animated.View style={[StyleSheet.absoluteFill, backdropAnim]}>
          <Pressable style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.5)' }} onPress={onClose} />
        </Animated.View>
        <Animated.View
          style={[
            sheetShadow(palette),
            {
              backgroundColor: colors.card,
              borderTopLeftRadius: palette.radius.sheet,
              borderTopRightRadius: palette.radius.sheet,
              paddingHorizontal: 20,
              paddingBottom: Math.max(insets.bottom + 12, 24),
              // 兜底:即便内容区未开滚动,整张弹窗也不越过状态栏
              maxHeight: windowHeight - insets.top - 8,
            },
            // 入场(淡入上滑)与下拉关闭手势共用这一个 worklet 样式
            sheetAnim,
          ]}
        >
          {/* 把手 + 标题行整体可拖动关闭 */}
          <GestureDetector gesture={pan}>
            <View style={{ paddingTop: 10 }}>
              <View style={{ width: 36, height: 4, borderRadius: 2, backgroundColor: colors.muted, alignSelf: 'center', marginBottom: 10 }} />
              <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
                <Text style={{ fontSize: 17, fontWeight: '700' }}>{title}</Text>
                <Pressable onPress={onClose} style={{ width: 30, height: 30, borderRadius: 15, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.muted }}>
                  <Text style={{ color: colors.mutedForeground, fontSize: 14 }}>✕</Text>
                </Pressable>
              </View>
            </View>
          </GestureDetector>
          {scrollBody ? (
            <ScrollView
              style={{ maxHeight: maxBodyHeight }}
              keyboardShouldPersistTaps="handled"
              nestedScrollEnabled
              showsVerticalScrollIndicator={false}
            >
              {children}
            </ScrollView>
          ) : children}
          {onSave && (
            <View style={{ marginTop: 16 }}>
              <Button title={saveLabel} onPress={onSave} loading={saveLoading} />
            </View>
          )}
        </Animated.View>
      </KeyboardAvoidingView>
      </GestureHandlerRootView>
    </Modal>
  );
}

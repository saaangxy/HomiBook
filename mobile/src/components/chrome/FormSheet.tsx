import { useEffect, type ReactNode } from 'react';
import { KeyboardAvoidingView, Modal, Pressable, StyleSheet, View } from 'react-native';
import Animated, {
  FadeIn,
  FadeInDown,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from 'react-native-reanimated';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { useTheme, motion, haptics, sheetShadow } from '@/theme';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Text } from '@/components/ui/Text';
import { Button } from '@/components/ui/Button';

interface FormSheetProps {
  visible: boolean;
  title: string;
  onClose: () => void;
  onSave?: () => void;
  saveLabel?: string;
  saveLoading?: boolean;
  children: ReactNode;
}

// 底部表单弹窗 v2:主题化圆角/阴影 + 把手区下滑关闭手势(阈值 80px 或速度 800)
export function FormSheet({ visible, title, onClose, onSave, saveLabel = '保存', saveLoading, children }: FormSheetProps) {
  const { colors, palette } = useTheme();
  const insets = useSafeAreaInsets();
  const translateY = useSharedValue(0);

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

  const sheetAnim = useAnimatedStyle(() => ({ transform: [{ translateY: translateY.value }] }));

  return (
    <Modal visible={visible} transparent animationType="none" onRequestClose={onClose}>
      <KeyboardAvoidingView
        style={{ flex: 1, justifyContent: 'flex-end' }}
        behavior="padding"
      >
        <Animated.View entering={FadeIn.duration(180)} style={StyleSheet.absoluteFill}>
          <Pressable style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.5)' }} onPress={onClose} />
        </Animated.View>
        <Animated.View
          entering={FadeInDown.duration(motion.duration.base).easing(motion.easing)}
          style={[
            sheetShadow(palette),
            {
              backgroundColor: colors.card,
              borderTopLeftRadius: palette.radius.sheet,
              borderTopRightRadius: palette.radius.sheet,
              paddingHorizontal: 20,
              paddingBottom: Math.max(insets.bottom + 12, 24),
            },
          ]}
        >
          {/* 手势 transform 单独包一层,避免与 entering 布局动画的 transform 冲突 */}
          <Animated.View style={[sheetAnim]}>
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
          {children}
          {onSave && (
            <View style={{ marginTop: 16 }}>
              <Button title={saveLabel} onPress={onSave} loading={saveLoading} />
            </View>
          )}
          </Animated.View>
        </Animated.View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

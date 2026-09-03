import { useEffect, useRef, useState } from 'react';
import { Dimensions, Keyboard, KeyboardAvoidingView, Modal, Platform, Pressable, View } from 'react-native';
import Animated, { FadeIn, SlideInDown } from 'react-native-reanimated';
import { useTheme, motion } from '@/theme';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { AIAssistant } from '@/components/chat/AIAssistant';
import { useUIShell } from './chrome';

// AI 财务助手全局弹窗:固定高度底部 sheet(键盘弹出时整体压缩到键盘上方),内嵌完整聊天组件
export function AIAssistantModal() {
  const { colors } = useTheme();
  const { aiOpen, closeAI } = useUIShell();
  const insets = useSafeAreaInsets();
  // 缓存初始窗口高度:Android 键盘弹出时窗口会 resize,用固定快照保持高度稳定
  const screenH = useRef(Dimensions.get('window').height).current;

  // 键盘高度:键盘弹出时压缩 sheet
  const [kbH, setKbH] = useState(0);
  useEffect(() => {
    const show = Keyboard.addListener('keyboardDidShow', (e) => setKbH(e.endCoordinates.height));
    const hide = Keyboard.addListener('keyboardDidHide', () => setKbH(0));
    return () => {
      show.remove();
      hide.remove();
    };
  }, []);
  const sheetH = Math.round(kbH > 0 ? Math.min(screenH * 0.92, screenH - kbH - 12) : screenH * 0.92);

  return (
    <Modal visible={aiOpen} transparent animationType="none" onRequestClose={closeAI}>
      <KeyboardAvoidingView style={{ flex: 1, justifyContent: 'flex-end' }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        <Animated.View entering={FadeIn.duration(160)} style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.45)' }}>
          <Pressable style={{ flex: 1 }} onPress={closeAI} />
        </Animated.View>

        <Animated.View
          entering={SlideInDown.duration(motion.duration.base).easing(motion.easing)}
          style={{ backgroundColor: colors.card, borderTopLeftRadius: 24, borderTopRightRadius: 24, height: sheetH, overflow: 'hidden' }}
        >
          {/* 把手 */}
          <View style={{ alignItems: 'center', paddingTop: 10 }}>
            <View style={{ width: 36, height: 4, borderRadius: 2, backgroundColor: colors.muted }} />
          </View>
          {/* 聊天主体(仅弹窗打开时挂载,避免与记一笔 AI 模式双实例常驻;标题/关闭由内嵌组件工具行提供) */}
          {aiOpen && (
            <View style={{ flex: 1, paddingTop: 6 }}>
              <AIAssistant onClose={closeAI} />
            </View>
          )}
        </Animated.View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

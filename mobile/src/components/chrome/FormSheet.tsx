import { type ReactNode } from 'react';
import { Modal, Pressable, StyleSheet, View } from 'react-native';
import Animated, { FadeIn, FadeInDown } from 'react-native-reanimated';
import { useTheme } from '@/theme';
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

// 底部表单弹窗(新建/编辑通用):标题 + 内容 + 保存/取消;样式对齐登录卡
export function FormSheet({ visible, title, onClose, onSave, saveLabel = '保存', saveLoading, children }: FormSheetProps) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();

  return (
    <Modal visible={visible} transparent animationType="none" onRequestClose={onClose}>
      <View style={{ flex: 1, justifyContent: 'flex-end' }}>
        <Animated.View entering={FadeIn.duration(180)} style={StyleSheet.absoluteFill}>
          <Pressable style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.5)' }} onPress={onClose} />
        </Animated.View>
        <Animated.View
          entering={FadeInDown.springify().damping(20)}
          style={{
            backgroundColor: colors.card,
            borderTopLeftRadius: 24,
            borderTopRightRadius: 24,
            paddingHorizontal: 20,
            paddingTop: 10,
            paddingBottom: Math.max(insets.bottom + 12, 24),
          }}
        >
          <View style={{ width: 36, height: 4, borderRadius: 2, backgroundColor: colors.muted, alignSelf: 'center', marginBottom: 10 }} />
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
            <Text style={{ fontSize: 17, fontWeight: '700' }}>{title}</Text>
            <Pressable onPress={onClose} style={{ width: 30, height: 30, borderRadius: 15, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.muted }}>
              <Text style={{ color: colors.mutedForeground, fontSize: 14 }}>✕</Text>
            </Pressable>
          </View>
          {children}
          {onSave && (
            <View style={{ marginTop: 16 }}>
              <Button title={saveLabel} onPress={onSave} loading={saveLoading} />
            </View>
          )}
        </Animated.View>
      </View>
    </Modal>
  );
}
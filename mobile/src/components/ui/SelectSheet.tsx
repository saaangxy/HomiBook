import { useState, type ReactNode } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import Animated, { Easing, FadeIn, FadeInDown } from 'react-native-reanimated';
import { Check, ChevronDown } from 'lucide-react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme, sheetShadow, haptics } from '@/theme';
import { Text } from '@/components/ui/Text';

export interface SelectOption {
  value: string;
  label: string;
  /** 左侧图标/emoji */
  icon?: ReactNode;
}

interface SelectSheetProps {
  value: string;
  options: SelectOption[];
  onChange: (value: string) => void;
  placeholder?: string;
}

// 下拉选择(移动端形态):触发器为输入框样式(值 + ⌄),点开底部弹窗单选列表
// 对齐网页端 DictCombobox 的交互语义
export function SelectSheet({ value, options, onChange, placeholder = '请选择' }: SelectSheetProps) {
  const { colors, palette } = useTheme();
  const insets = useSafeAreaInsets();
  const [open, setOpen] = useState(false);

  const selected = options.find((o) => o.value === value);

  return (
    <>
      {/* 触发器 */}
      <Pressable
        onPress={() => {
          setOpen(true);
          haptics.tap();
        }}
        style={{
          height: 46,
          borderRadius: palette.radius.input,
          borderWidth: 1,
          borderColor: colors.border,
          backgroundColor: colors.elevated,
          paddingHorizontal: 14,
          flexDirection: 'row',
          alignItems: 'center',
        }}
      >
        {selected?.icon ? <View style={{ marginRight: 8 }}>{selected.icon}</View> : null}
        <Text style={{ flex: 1, fontSize: 15, color: selected ? colors.foreground : colors.mutedForeground }}>
          {selected?.label ?? placeholder}
        </Text>
        <ChevronDown size={16} color={colors.mutedForeground} />
      </Pressable>

      {/* 底部弹窗选项列表 */}
      <Modal visible={open} transparent animationType="none" onRequestClose={() => setOpen(false)}>
        <View style={{ flex: 1, justifyContent: 'flex-end' }}>
          <Animated.View entering={FadeIn.duration(180)} style={StyleSheet.absoluteFill}>
            <Pressable style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.5)' }} onPress={() => setOpen(false)} />
          </Animated.View>
          <Animated.View
            entering={FadeInDown.duration(260).easing(Easing.out(Easing.cubic))}
            style={[
              sheetShadow(palette),
              {
                backgroundColor: colors.card,
                borderTopLeftRadius: palette.radius.sheet,
                borderTopRightRadius: palette.radius.sheet,
                paddingHorizontal: 20,
                paddingTop: 10,
                paddingBottom: Math.max(insets.bottom + 12, 24),
                maxHeight: '65%',
              },
            ]}
          >
            <View style={{ width: 36, height: 4, borderRadius: 2, backgroundColor: colors.muted, alignSelf: 'center', marginBottom: 10 }} />
            <ScrollView showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
              {options.map((o) => {
                const active = o.value === value;
                return (
                  <Pressable
                    key={o.value}
                    onPress={() => {
                      onChange(o.value);
                      haptics.tap();
                      setOpen(false);
                    }}
                    style={{
                      flexDirection: 'row',
                      alignItems: 'center',
                      gap: 12,
                      paddingVertical: 13,
                      paddingHorizontal: 12,
                      borderRadius: 12,
                      backgroundColor: active ? colors.muted : 'transparent',
                    }}
                  >
                    {o.icon}
                    <Text style={{ flex: 1, fontSize: 15, color: colors.foreground, fontWeight: active ? '600' : '400' }}>{o.label}</Text>
                    {active && <Check size={17} color={colors.primary} strokeWidth={2.5} />}
                  </Pressable>
                );
              })}
            </ScrollView>
          </Animated.View>
        </View>
      </Modal>
    </>
  );
}

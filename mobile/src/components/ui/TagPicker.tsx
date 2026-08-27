import { useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import Animated, { Easing, FadeIn, FadeInDown } from 'react-native-reanimated';
import { Plus, X } from 'lucide-react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme, sheetShadow, haptics, alpha } from '@/theme';
import { Text } from '@/components/ui/Text';

interface TagPickerProps {
  value: string[];
  onChange: (tags: string[]) => void;
  /** 预算标签 + 流水标签(去重后传入) */
  suggestions: string[];
  placeholder?: string;
}

// 标签多选(对齐网页端 TagCombobox):已选标签可移除,点开底部弹窗从已有标签选择或新建
export function TagPicker({ value, onChange, suggestions, placeholder = '选择或输入标签' }: TagPickerProps) {
  const { colors, palette } = useTheme();
  const insets = useSafeAreaInsets();
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState('');

  const add = (tag: string) => {
    const t = tag.trim();
    if (t && !value.includes(t)) onChange([...value, t]);
  };
  const remove = (tag: string) => onChange(value.filter((v) => v !== tag));

  const filtered = input.trim() ? suggestions.filter((t) => t.toLowerCase().includes(input.trim().toLowerCase())) : suggestions;
  const unused = filtered.filter((t) => !value.includes(t));
  const canCreate = !!(input.trim() && !value.includes(input.trim()) && !suggestions.includes(input.trim()));

  return (
    <>
      {/* 已选标签 + 添加触发器 */}
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 14 }}>
        {value.map((tag) => (
          <Pressable
            key={tag}
            onPress={() => { remove(tag); haptics.tap(); }}
            style={{ flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 8, paddingVertical: 4, borderRadius: 999, backgroundColor: alpha(colors.primary, 0.12) }}
          >
            <Text style={{ fontSize: 12, color: colors.primary }}>{tag}</Text>
            <X size={12} color={colors.primary} />
          </Pressable>
        ))}
        <Pressable
          onPress={() => { setOpen(true); haptics.tap(); }}
          style={{
            flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 10, paddingVertical: 6,
            borderRadius: 999, borderWidth: 1, borderColor: colors.border, borderStyle: 'dashed',
          }}
        >
          <Plus size={14} color={colors.mutedForeground} />
          <Text style={{ fontSize: 12, color: colors.mutedForeground }}>{value.length ? '添加标签' : placeholder}</Text>
        </Pressable>
      </View>

      {/* 底部弹窗 */}
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
            <TextInput
              value={input}
              onChangeText={setInput}
              placeholder="搜索或输入新标签..."
              placeholderTextColor={colors.mutedForeground}
              autoCapitalize="none"
              style={{
                borderWidth: 1, borderColor: colors.border, borderRadius: 10, padding: 10,
                fontSize: 14, color: colors.foreground, marginBottom: 8,
              }}
            />
            <ScrollView showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
              {canCreate && (
                <Pressable
                  onPress={() => { add(input); setInput(''); haptics.tap(); }}
                  style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 13, paddingHorizontal: 12, borderRadius: 12 }}
                >
                  <Plus size={16} color={colors.primary} />
                  <Text style={{ fontSize: 15, color: colors.primary }}>创建 "{input.trim()}"</Text>
                </Pressable>
              )}
              {unused.length === 0 && !canCreate && (
                <Text variant="muted" style={{ paddingVertical: 16, textAlign: 'center', fontSize: 13 }}>无匹配标签</Text>
              )}
              {unused.map((tag) => (
                <Pressable
                  key={tag}
                  onPress={() => { add(tag); haptics.tap(); }}
                  style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 13, paddingHorizontal: 12, borderRadius: 12 }}
                >
                  <Text style={{ flex: 1, fontSize: 15, color: colors.foreground }}>{tag}</Text>
                  <Plus size={15} color={colors.mutedForeground} />
                </Pressable>
              ))}
            </ScrollView>
          </Animated.View>
        </View>
      </Modal>
    </>
  );
}

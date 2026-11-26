import { useEffect, useState } from 'react';
import { BackHandler, KeyboardAvoidingView, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import Animated, { useAnimatedStyle } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme, alpha, haptics, sheetShadow } from '@/theme';
import { Text } from '@/components/ui/Text';
import { Button } from '@/components/ui/Button';
import { useAppearProgress } from '@/components/ui/useAppearAnimation';
import type { BudgetType } from '@/types';
import { BUDGET_DIMENSION_LABELS, BUDGET_TYPE_LABELS } from '@homibook/core';

/**
 * 预算筛选条件(与流水管理的 RecordFilters 同构:类型多选 + 维度单选 + 关键词)
 * 空值统一表示「不限」;月度/项目类型为空时展示全部类型。
 */
export interface BudgetFilters {
  types: BudgetType[];
  categoryCode: string;
  tag: string;
  ownerId: string;
  keyword: string;
}

export const emptyBudgetFilters: BudgetFilters = {
  types: [],
  categoryCode: '',
  tag: '',
  ownerId: '',
  keyword: '',
};

/** 活跃条件计数(每个维度各计 1,与流水筛选口径一致) */
export function countActiveBudgetFilters(f: BudgetFilters): number {
  return (
    f.types.length +
    (f.categoryCode ? 1 : 0) +
    (f.tag ? 1 : 0) +
    (f.ownerId ? 1 : 0) +
    (f.keyword.trim() ? 1 : 0)
  );
}

interface BudgetFilterSheetProps {
  visible: boolean;
  initial: BudgetFilters;
  categoryOptions: { value: string; label: string }[];
  tagOptions: string[];
  memberOptions: { value: string; label: string }[];
  onApply: (f: BudgetFilters) => void;
  onClose: () => void;
}

const TYPE_OPTIONS: { value: BudgetType; label: string }[] = [
  { value: 'FIXED', label: BUDGET_TYPE_LABELS.FIXED },
  { value: 'FREE', label: BUDGET_TYPE_LABELS.FREE },
];

// 预算筛选抽屉(对齐流水管理 FilterSheet 的交互):类型多选 + 分类/标签/成员单选 + 关键词
export function BudgetFilterSheet({
  visible,
  initial,
  categoryOptions,
  tagOptions,
  memberOptions,
  onApply,
  onClose,
}: BudgetFilterSheetProps) {
  const { colors, palette } = useTheme();
  const insets = useSafeAreaInsets();
  const [draft, setDraft] = useState<BudgetFilters>(initial);

  // 打开时同步外部条件为草稿
  useEffect(() => {
    if (visible) setDraft(initial);
  }, [visible, initial]);

  const toggle = <T,>(list: T[], v: T): T[] => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);

  /** 单选维度:再次点击已选项视为取消(回到「全部」) */
  const pick = (cur: string, v: string) => (cur === v ? '' : v);

  const chip = (active: boolean) => ({
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: active ? colors.primary : colors.border,
    backgroundColor: active ? alpha(colors.primary, 0.12) : colors.elevated,
  });

  const chipText = (active: boolean) => ({
    fontSize: 13,
    color: active ? colors.primary : colors.foreground,
    fontWeight: active ? ('600' as const) : ('400' as const),
  });

  const inputStyle = {
    backgroundColor: colors.elevated,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 11,
    color: colors.foreground,
    fontSize: 14,
  };

  const appliedCount = countActiveBudgetFilters(draft);

  // Android 返回键关闭
  useEffect(() => {
    if (!visible) return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      onClose();
      return true;
    });
    return () => sub.remove();
  }, [visible, onClose]);

  const appear = useAppearProgress({ active: visible });
  const backdropAnim = useAnimatedStyle(() => ({ opacity: appear.value }));
  const sheetAnim = useAnimatedStyle(() => ({
    opacity: appear.value,
    transform: [{ translateY: (1 - appear.value) * 24 }],
  }));

  if (!visible) return null;

  return (
    <View style={StyleSheet.absoluteFill}>
      <KeyboardAvoidingView style={{ flex: 1, justifyContent: 'flex-end' }} behavior="padding">
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
              paddingTop: 10,
              paddingBottom: Math.max(insets.bottom + 12, 24),
              maxHeight: '85%',
            },
            sheetAnim,
          ]}
        >
          <View style={{ width: 36, height: 4, borderRadius: 2, backgroundColor: colors.muted, alignSelf: 'center', marginBottom: 10 }} />
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
            <Text style={{ fontSize: 17, fontWeight: '700' }}>筛选预算</Text>
            <Pressable onPress={onClose} style={{ width: 30, height: 30, borderRadius: 15, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.muted }}>
              <Text style={{ color: colors.mutedForeground, fontSize: 14 }}>✕</Text>
            </Pressable>
          </View>

          <ScrollView showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
            {/* 类型 */}
            <Text variant="label">类型(可多选)</Text>
            <View style={{ flexDirection: 'row', gap: 8, marginBottom: 16 }}>
              {TYPE_OPTIONS.map((t) => {
                const active = draft.types.includes(t.value);
                return (
                  <Pressable
                    key={t.value}
                    onPress={() => { setDraft((d) => ({ ...d, types: toggle(d.types, t.value) })); haptics.tap(); }}
                    style={chip(active)}
                  >
                    <Text style={chipText(active)}>{t.label}</Text>
                  </Pressable>
                );
              })}
            </View>

            {/* 分类 */}
            <Text variant="label">{BUDGET_DIMENSION_LABELS.category}</Text>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 16 }}>
              {[{ value: '', label: '全部' }, ...categoryOptions].map((c) => {
                const active = draft.categoryCode === c.value;
                return (
                  <Pressable
                    key={c.value || 'all'}
                    onPress={() => { setDraft((d) => ({ ...d, categoryCode: pick(d.categoryCode, c.value) })); haptics.tap(); }}
                    style={chip(active)}
                  >
                    <Text style={chipText(active)}>{c.label}</Text>
                  </Pressable>
                );
              })}
            </View>

            {/* 标签 */}
            <Text variant="label">{BUDGET_DIMENSION_LABELS.project}</Text>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 16 }}>
              {[{ value: '', label: '全部' }, ...tagOptions.map((t) => ({ value: t, label: t }))].map((t) => {
                const active = draft.tag === t.value;
                return (
                  <Pressable
                    key={t.value || 'all'}
                    onPress={() => { setDraft((d) => ({ ...d, tag: pick(d.tag, t.value) })); haptics.tap(); }}
                    style={chip(active)}
                  >
                    <Text style={chipText(active)}>{t.label}</Text>
                  </Pressable>
                );
              })}
            </View>

            {/* 成员 */}
            <Text variant="label">{BUDGET_DIMENSION_LABELS.member}</Text>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 16 }}>
              {[{ value: '', label: '全部' }, ...memberOptions].map((m) => {
                const active = draft.ownerId === m.value;
                return (
                  <Pressable
                    key={m.value || 'all'}
                    onPress={() => { setDraft((d) => ({ ...d, ownerId: pick(d.ownerId, m.value) })); haptics.tap(); }}
                    style={chip(active)}
                  >
                    <Text style={chipText(active)}>{m.label}</Text>
                  </Pressable>
                );
              })}
            </View>

            {/* 关键词 */}
            <Text variant="label">关键词(预算名称)</Text>
            <TextInput
              value={draft.keyword}
              onChangeText={(v) => setDraft((d) => ({ ...d, keyword: v }))}
              placeholder="模糊搜索"
              placeholderTextColor={colors.mutedForeground}
              style={[inputStyle, { marginBottom: 8 }]}
            />
          </ScrollView>

          <View style={{ flexDirection: 'row', gap: 10, marginTop: 12 }}>
            <Button title="重置" variant="secondary" onPress={() => setDraft(emptyBudgetFilters)} style={{ flex: 1 }} />
            <Button
              title={appliedCount ? `应用筛选 (${appliedCount})` : '应用筛选'}
              onPress={() => {
                onApply(draft);
                haptics.tap();
                onClose();
              }}
              style={{ flex: 2 }}
            />
          </View>
        </Animated.View>
      </KeyboardAvoidingView>
    </View>
  );
}

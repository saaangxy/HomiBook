import { useEffect, useState } from 'react';
import { BackHandler, KeyboardAvoidingView, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import Animated, { useAnimatedStyle } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme, alpha, haptics, sheetShadow } from '@/theme';
import { Text } from '@/components/ui/Text';
import { Button } from '@/components/ui/Button';
import { DatePicker } from '@/components/ui/DatePicker';
import { useAppearProgress } from '@/components/ui/useAppearAnimation';
import { useRecords } from '@/stores/records';
import type { RecordType } from '@/types';
import { accountLabel, isMultiOwnerAccounts } from '@/lib/account';

export interface RecordFilters {
  types: RecordType[];
  accountIds: string[];
  /** 转账的转入账户(转账记录的 accountId 存的是源账户,两者分开筛) */
  toAccountIds: string[];
  categoryCodes: string[];
  dateFrom: string; // '' = 不限
  dateTo: string;
  minAmount: string;
  maxAmount: string;
  keyword: string; // 交易方/备注模糊
  /** 平账状态:'' = 全部,'pending' = 未平账,'offset' = 已平账 */
  offsetState: '' | 'pending' | 'offset';
}

export const emptyFilters: RecordFilters = {
  types: [],
  accountIds: [],
  toAccountIds: [],
  categoryCodes: [],
  dateFrom: '',
  dateTo: '',
  minAmount: '',
  maxAmount: '',
  keyword: '',
  offsetState: '',
};

/** 活跃条件计数(日期/金额各计 1) */
export function countActiveFilters(f: RecordFilters): number {
  return (
    f.types.length +
    f.accountIds.length +
    f.toAccountIds.length +
    f.categoryCodes.length +
    (f.dateFrom || f.dateTo ? 1 : 0) +
    (f.minAmount || f.maxAmount ? 1 : 0) +
    (f.keyword.trim() ? 1 : 0) +
    (f.offsetState ? 1 : 0)
  );
}

interface FilterSheetProps {
  visible: boolean;
  initial: RecordFilters;
  onApply: (f: RecordFilters) => void;
  onClose: () => void;
}

const TYPE_OPTIONS: { value: RecordType; label: string }[] = [
  { value: 'EXPENSE', label: '支出' },
  { value: 'INCOME', label: '收入' },
  { value: 'TRANSFER', label: '转账' },
];

// 流水高级筛选抽屉(对齐网页端筛选能力):类型/账户/分类多选 + 日期范围 + 金额区间 + 关键词
export function FilterSheet({ visible, initial, onApply, onClose }: FilterSheetProps) {
  const { colors, palette } = useTheme();
  const insets = useSafeAreaInsets();
  const { accounts, categories } = useRecords();
  const multiOwnerAccounts = isMultiOwnerAccounts(accounts);
  const [draft, setDraft] = useState<RecordFilters>(initial);

  // 打开时同步外部条件为草稿
  useEffect(() => {
    if (visible) setDraft(initial);
  }, [visible, initial]);

  const toggle = <T,>(list: T[], v: T): T[] => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);

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

  const appliedCount = countActiveFilters(draft);

  // Android 返回键关闭(Modal 替换为主 window 覆盖层后,需自行拦截返回键)
  useEffect(() => {
    if (!visible) return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      onClose();
      return true;
    });
    return () => sub.remove();
  }, [visible, onClose]);

  // 入场动画(共享值驱动,替代 entering —— 见 useAppearAnimation.ts 顶部说明)
  const appear = useAppearProgress({ active: visible });
  const backdropAnim = useAnimatedStyle(() => ({ opacity: appear.value }));
  const sheetAnim = useAnimatedStyle(() => ({
    opacity: appear.value,
    transform: [{ translateY: (1 - appear.value) * 24 }],
  }));

  // 主 window 覆盖层(替代 RN Modal):Android 上 Modal 的独立 Dialog 窗口在
  // edge-to-edge 全屏设备上高度会被截断(底部缝隙),改用绝对定位覆盖层
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
            <Text style={{ fontSize: 17, fontWeight: '700' }}>筛选流水</Text>
            <Pressable onPress={onClose} style={{ width: 30, height: 30, borderRadius: 15, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.muted }}>
              <Text style={{ color: colors.mutedForeground, fontSize: 14 }}>✕</Text>
            </Pressable>
          </View>

          <ScrollView showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
            {/* 类型 */}
            <Text variant="label">类型(可多选)</Text>
            <View style={{ flexDirection: 'row', gap: 8, marginBottom: 16 }}>
              {TYPE_OPTIONS.map((t) => (
                <Pressable
                  key={t.value}
                  onPress={() => {
                    setDraft((d) => {
                      const types = toggle(d.types, t.value);
                      // 类型里不再含转账时,「转入账户」无从命中,顺手清掉避免留下空结果
                      const toAccountIds = types.length > 0 && !types.includes('TRANSFER') ? [] : d.toAccountIds;
                      return { ...d, types, toAccountIds };
                    });
                    haptics.tap();
                  }}
                  style={chip(draft.types.includes(t.value))}
                >
                  <Text style={chipText(draft.types.includes(t.value))}>{t.label}</Text>
                </Pressable>
              ))}
            </View>

            {/* 平账状态:单选,与 Web 端口径一致(空 = 全部) */}
            <Text variant="label">平账状态</Text>
            <View style={{ flexDirection: 'row', gap: 8, marginBottom: 16 }}>
              {([
                { value: '', label: '全部' },
                { value: 'pending', label: '未平账' },
                { value: 'offset', label: '已平账' },
              ] as const).map((o) => (
                <Pressable
                  key={o.value || 'all'}
                  onPress={() => { setDraft((d) => ({ ...d, offsetState: o.value })); haptics.tap(); }}
                  style={chip(draft.offsetState === o.value)}
                >
                  <Text style={chipText(draft.offsetState === o.value)}>{o.label}</Text>
                </Pressable>
              ))}
            </View>

            {/* 账户 */}
            <Text variant="label">账户(可多选)</Text>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 16 }}>
              {accounts.map((a) => (
                <Pressable key={a.id} onPress={() => { setDraft((d) => ({ ...d, accountIds: toggle(d.accountIds, a.id) })); haptics.tap(); }} style={chip(draft.accountIds.includes(a.id))}>
                  <Text style={chipText(draft.accountIds.includes(a.id))}>{accountLabel(a, multiOwnerAccounts)}</Text>
                </Pressable>
              ))}
            </View>

            {/* 转账转入账户:转账记录的「账户」列存的是源账户,转入账户要单独筛 */}
            {(draft.types.length === 0 || draft.types.includes('TRANSFER')) && (
              <>
                <Text variant="label">目标账户(转账转入,可多选)</Text>
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 16 }}>
                  {accounts.map((a) => (
                    <Pressable key={a.id} onPress={() => { setDraft((d) => ({ ...d, toAccountIds: toggle(d.toAccountIds, a.id) })); haptics.tap(); }} style={chip(draft.toAccountIds.includes(a.id))}>
                      <Text style={chipText(draft.toAccountIds.includes(a.id))}>{accountLabel(a, multiOwnerAccounts)}</Text>
                    </Pressable>
                  ))}
                </View>
              </>
            )}

            {/* 分类 */}
            <Text variant="label">分类(可多选)</Text>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 16 }}>
              {categories.map((c) => (
                <Pressable key={c.code} onPress={() => { setDraft((d) => ({ ...d, categoryCodes: toggle(d.categoryCodes, c.code) })); haptics.tap(); }} style={chip(draft.categoryCodes.includes(c.code))}>
                  <Text style={chipText(draft.categoryCodes.includes(c.code))}>{c.label}</Text>
                </Pressable>
              ))}
            </View>

            {/* 日期范围 */}
            <Text variant="label">日期范围</Text>
            <View style={{ flexDirection: 'row', gap: 10, marginBottom: 16 }}>
              <View style={{ flex: 1 }}>
                <DatePicker value={draft.dateFrom} onChange={(v) => setDraft((d) => ({ ...d, dateFrom: v }))} />
              </View>
              <View style={{ flex: 1 }}>
                <DatePicker value={draft.dateTo} onChange={(v) => setDraft((d) => ({ ...d, dateTo: v }))} />
              </View>
            </View>

            {/* 金额区间 */}
            <Text variant="label">金额区间</Text>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 16 }}>
              <TextInput value={draft.minAmount} onChangeText={(v) => setDraft((d) => ({ ...d, minAmount: v }))} placeholder="最低" placeholderTextColor={colors.mutedForeground} keyboardType="decimal-pad" style={[inputStyle, { flex: 1 }]} />
              <Text variant="muted">—</Text>
              <TextInput value={draft.maxAmount} onChangeText={(v) => setDraft((d) => ({ ...d, maxAmount: v }))} placeholder="最高" placeholderTextColor={colors.mutedForeground} keyboardType="decimal-pad" style={[inputStyle, { flex: 1 }]} />
            </View>

            {/* 关键词 */}
            <Text variant="label">关键词(交易方 / 备注)</Text>
            <TextInput value={draft.keyword} onChangeText={(v) => setDraft((d) => ({ ...d, keyword: v }))} placeholder="模糊搜索" placeholderTextColor={colors.mutedForeground} style={[inputStyle, { marginBottom: 8 }]} />
          </ScrollView>

          <View style={{ flexDirection: 'row', gap: 10, marginTop: 12 }}>
            <Button title="重置" variant="secondary" onPress={() => setDraft(emptyFilters)} style={{ flex: 1 }} />
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

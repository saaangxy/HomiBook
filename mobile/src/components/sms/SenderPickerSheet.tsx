import { useMemo, useState } from 'react';
import { Pressable, ScrollView, TextInput, View } from 'react-native';
import { Check, Plus, Search, X } from 'lucide-react-native';
import { useTheme, alpha, haptics } from '@/theme';
import { Text } from '@/components/ui/Text';
import { FormSheet } from '@/components/chrome/FormSheet';
import { Btn, useInputStyle } from '@/components/settings/shared';
import type { SmsSenderEntry } from '@/services/sms-senders';

// 发件人白名单选择器:可搜索的多选下拉。
// 候选来自「扫描后缓存的本机来源」(services/sms-senders);搜索无匹配时可手动添加,
// 便于「先定规则再扫描」的场景。选择结果只决定采集范围,不改动任何已有流水。
//
// 由调用方在打开时才挂载(用 initialSelected 初始化),避免用 effect 同步 props 到 state。

export function SenderPickerSheet({ visible, initialSelected, senders, onClose, onConfirm, onClearCache }: {
  visible: boolean;
  /** 打开时的已选项(只在挂载时读取一次) */
  initialSelected: string[];
  /** 本机缓存的候选来源(按命中次数降序) */
  senders: SmsSenderEntry[];
  onClose: () => void;
  onConfirm: (next: string[]) => void;
  /** 清空候选缓存(下次扫描重新累积);不传则不显示该按钮 */
  onClearCache?: () => void;
}) {
  const { colors } = useTheme();
  const inputStyle = useInputStyle();
  const [query, setQuery] = useState('');
  const [picked, setPicked] = useState<string[]>(initialSelected);

  const q = query.trim().toLowerCase();
  const filtered = useMemo(() => {
    if (!q) return senders;
    return senders.filter(
      (s) => s.sender.toLowerCase().includes(q) || (s.detail ?? '').toLowerCase().includes(q),
    );
  }, [senders, q]);

  // 搜索词不在候选里且未被选中 → 允许手动加(比如刚从别处抄来的服务号)
  const canAddManual = q.length > 0 && !picked.some((p) => p.toLowerCase() === q);
  // 已选但不在候选里的(手动添加或本次未扫到):单独展示,可取消
  const pickedOnly = picked.filter((p) => !senders.some((s) => s.sender === p));

  const toggle = (sender: string) => {
    haptics.tap();
    setPicked((prev) => (prev.includes(sender) ? prev.filter((p) => p !== sender) : [...prev, sender]));
  };

  return (
    <FormSheet
      visible={visible}
      title="发件人白名单"
      onClose={onClose}
      onSave={() => onConfirm(picked)}
      saveLabel={picked.length > 0 ? `保存(${picked.length})` : '保存(不限来源)'}
    >
      <View style={{ gap: 10 }}>
        <Text variant="muted" style={{ fontSize: 11.5, lineHeight: 16 }}>
          留空 = 不限来源;候选在每次扫描后更新。
        </Text>

        {/* 搜索:候选多时按号码 / 机构名过滤 */}
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: 6, ...inputStyle, paddingVertical: 8 }}>
            <Search size={14} color={colors.mutedForeground} />
            <TextInput
              value={query}
              onChangeText={setQuery}
              placeholder="搜索号码或机构名"
              placeholderTextColor={colors.mutedForeground}
              autoCapitalize="none"
              autoCorrect={false}
              style={{ flex: 1, color: colors.foreground, fontSize: 13.5, padding: 0 }}
            />
            {query ? (
              <Pressable onPress={() => setQuery('')} hitSlop={6}>
                <X size={14} color={colors.mutedForeground} />
              </Pressable>
            ) : null}
          </View>
          {picked.length > 0 ? (
            <Pressable onPress={() => { haptics.tap(); setPicked([]); }} hitSlop={6}>
              <Text style={{ fontSize: 12, color: colors.mutedForeground }}>清空</Text>
            </Pressable>
          ) : null}
        </View>

        {/* 已选但不在候选里的(手动添加的):给一个显式移除入口 */}
        {pickedOnly.length > 0 ? (
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
            {pickedOnly.map((p) => (
              <Pressable
                key={p}
                onPress={() => toggle(p)}
                style={{
                  flexDirection: 'row', alignItems: 'center', gap: 4,
                  paddingHorizontal: 8, paddingVertical: 4, borderRadius: 999,
                  backgroundColor: alpha(colors.primary, 0.12),
                }}
              >
                <Text style={{ fontSize: 11.5, color: colors.primary }}>{p}</Text>
                <X size={11} color={colors.primary} />
              </Pressable>
            ))}
          </View>
        ) : null}

        <ScrollView style={{ maxHeight: 300 }} keyboardShouldPersistTaps="handled" nestedScrollEnabled>
          {canAddManual ? (
            <Pressable
              onPress={() => {
                haptics.tap();
                setPicked((prev) => [...prev, query.trim()]);
                setQuery('');
              }}
              style={{
                flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 10,
                borderBottomWidth: 1, borderBottomColor: colors.hairline,
              }}
            >
              <Plus size={14} color={colors.primary} />
              <Text style={{ fontSize: 13, color: colors.primary, flex: 1 }} numberOfLines={1}>
                添加「{query.trim()}」
              </Text>
            </Pressable>
          ) : null}

          {filtered.length === 0 && !canAddManual ? (
            <Text variant="muted" style={{ fontSize: 12, textAlign: 'center', paddingVertical: 20 }}>
              {senders.length === 0 ? '还没有候选来源\n先扫描一次,这里会出现本机见到的发件人' : '没有匹配的来源'}
            </Text>
          ) : null}

          {filtered.map((s) => {
            const on = picked.includes(s.sender);
            return (
              <Pressable
                key={`${s.channel}|${s.sender}`}
                onPress={() => toggle(s.sender)}
                style={{
                  flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 10,
                  borderBottomWidth: 1, borderBottomColor: colors.hairline,
                }}
              >
                <View
                  style={{
                    width: 20, height: 20, borderRadius: 6, borderWidth: 1,
                    borderColor: on ? colors.primary : colors.border,
                    backgroundColor: on ? colors.primary : 'transparent',
                    alignItems: 'center', justifyContent: 'center',
                  }}
                >
                  {on ? <Check size={13} color={colors.primaryForeground} /> : null}
                </View>
                <View style={{ flex: 1, gap: 2 }}>
                  <Text style={{ fontSize: 13.5, fontWeight: '500' }} numberOfLines={1}>
                    {s.detail || s.sender}
                  </Text>
                  <Text variant="muted" style={{ fontSize: 11 }} numberOfLines={1}>
                    {s.detail ? `${s.sender} · ` : ''}共 {s.count} 条 · 交易 {s.transactions} 条
                  </Text>
                </View>
                <View style={{ paddingHorizontal: 5, borderRadius: 4, backgroundColor: colors.muted }}>
                  <Text style={{ fontSize: 9.5, color: colors.mutedForeground }}>
                    {s.channel === 'notification' ? '通知' : '短信'}
                  </Text>
                </View>
              </Pressable>
            );
          })}
        </ScrollView>

        {/* 缓存清理:候选列表只增不减时给用户一个出口(下次扫描重新累积) */}
        {onClearCache && senders.length > 0 ? (
          <Btn
            title="清空候选缓存"
            variant="secondary"
            onPress={() => {
              haptics.tap();
              onClearCache();
            }}
          />
        ) : null}
      </View>
    </FormSheet>
  );
}

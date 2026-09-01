import { useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, View } from 'react-native';
import { Check, CopyMinus } from 'lucide-react-native';
import { useTheme, alpha, haptics } from '@/theme';
import { Text } from '@/components/ui/Text';
import { FormSheet } from '@/components/chrome/FormSheet';
import { ChipSelect } from '@/components/ui/ChipSelect';
import { notifyPageRefresh } from '@/components/chrome/chrome';
import { useRecords } from '@/stores/records';
import { accountLabel, isMultiOwnerAccounts } from '@/lib/account';
import {
  detectDuplicatesApi,
  batchDeleteRecordsApi,
  type DedupMatchFields,
  type DuplicateGroup,
} from '@/services/records';
import type { RecordItem, RecordType } from '@/types';

const TYPE_LABEL: Record<RecordType, string> = { EXPENSE: '支出', INCOME: '收入', TRANSFER: '转账' };
const TYPE_COLOR: Record<RecordType, string> = { EXPENSE: '#ef4444', INCOME: '#22c55e', TRANSFER: '#3b82f6' };

const TOGGLE_FIELDS: { key: 'type' | 'accountId' | 'payer' | 'amount' | 'ownerId'; label: string }[] = [
  { key: 'type', label: '类型' },
  { key: 'accountId', label: '账户' },
  { key: 'payer', label: '交易方' },
  { key: 'amount', label: '金额' },
  { key: 'ownerId', label: '归属人' },
];

const DEFAULT_FIELDS: DedupMatchFields = { date: 'date', type: true, accountId: true, payer: true, amount: true, ownerId: false };

/** 解析分组 key 为可读标签(账户段显示"账户名 · 归属人"、归属人段显示名称,均非 id) */
function parseGroupKey(key: string, fields: DedupMatchFields, accountDisplay: Map<string, string>, ownerNames: Map<string, string>): string[] {
  const parts = key.split('||');
  const labels: string[] = [];
  let idx = 0;

  if (fields.date) {
    const val = parts[idx++];
    labels.push(`日期: ${fields.date === 'date' ? val : val.replace('T', ' ').slice(0, 19)}`);
  }
  if (fields.type) labels.push(`类型: ${TYPE_LABEL[parts[idx++] as RecordType] ?? parts[idx - 1]}`);
  if (fields.accountId) labels.push(`账户: ${accountDisplay.get(parts[idx++]) ?? parts[idx - 1]}`);
  if (fields.payer) labels.push(`交易方: ${parts[idx++] === '__empty__' ? '(空)' : parts[idx - 1]}`);
  if (fields.amount) labels.push(`金额: ${parts[idx++]}`);
  if (fields.ownerId) labels.push(`归属人: ${ownerNames.get(parts[idx++]) ?? parts[idx - 1]}`);

  return labels;
}

/** 格式化 ISO 日期为 YYYY-MM-DD HH:mm:ss */
function fmtDate(iso: string): string {
  return (iso || '').replace('T', ' ').slice(0, 19);
}

interface DedupSheetProps {
  visible: boolean;
  onClose: () => void;
  bookId: string;
}

// 流水去重抽屉(对齐 web 端 DedupDialog):选匹配条件 → 检测重复 → 按组勾选删除,默认每组保留最早一条
export function DedupSheet({ visible, onClose, bookId }: DedupSheetProps) {
  const { colors, palette } = useTheme();
  const { accounts } = useRecords();

  const [matchFields, setMatchFields] = useState<DedupMatchFields>(DEFAULT_FIELDS);
  const [groups, setGroups] = useState<DuplicateGroup[]>([]);
  const [totalDuplicates, setTotalDuplicates] = useState(0);
  const [detected, setDetected] = useState(false);
  const [detecting, setDetecting] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState('');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  // 账户 id → "账户名 · 归属人" 显示映射(多归属人账本才带归属人)
  const multiOwnerAccounts = isMultiOwnerAccounts(accounts);
  const accountDisplay = new Map(accounts.map((a) => [a.id, accountLabel(a, multiOwnerAccounts)]));
  // 归属人 id → 名称映射(从检测结果记录收集,避免额外拉取成员列表)
  const ownerNames = new Map<string, string>();
  for (const g of groups) {
    for (const r of g.records) {
      if (r.ownerId && r.ownerName) ownerNames.set(r.ownerId, r.ownerName);
    }
  }

  const reset = () => {
    setGroups([]);
    setTotalDuplicates(0);
    setDetected(false);
    setDetecting(false);
    setDeleting(false);
    setError('');
    setSelectedIds(new Set());
    setMatchFields(DEFAULT_FIELDS);
  };

  const handleClose = () => {
    reset();
    onClose();
  };

  const handleDetect = async () => {
    setDetecting(true);
    setError('');
    setDetected(false);
    setGroups([]);
    setSelectedIds(new Set());
    try {
      const result = await detectDuplicatesApi(bookId, matchFields);
      setGroups(result.groups);
      setTotalDuplicates(result.totalDuplicates);
      setDetected(true);
      // 默认勾选:每组保留最早的(第一条),勾选其余
      const toDelete = new Set<string>();
      for (const g of result.groups) {
        for (let i = 1; i < g.records.length; i++) toDelete.add(g.records[i].id);
      }
      setSelectedIds(toDelete);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setDetecting(false);
    }
  };

  const toggleRecord = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleGroup = (group: DuplicateGroup) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      const groupIds = group.records.map((r) => r.id);
      const allSelected = groupIds.every((id) => next.has(id));
      for (const id of groupIds) {
        if (allSelected) next.delete(id);
        else next.add(id);
      }
      return next;
    });
  };

  const handleDelete = () => {
    if (selectedIds.size === 0 || deleting) return;
    Alert.alert('删除选中记录', `将永久删除 ${selectedIds.size} 条流水,不可恢复。`, [
      { text: '取消', style: 'cancel' },
      {
        text: '删除',
        style: 'destructive',
        onPress: async () => {
          setDeleting(true);
          setError('');
          try {
            await batchDeleteRecordsApi(Array.from(selectedIds));
            haptics.success();
            notifyPageRefresh();
            handleClose();
          } catch (e: any) {
            setError(e.message);
          } finally {
            setDeleting(false);
          }
        },
      },
    ]);
  };

  const activeFieldCount = TOGGLE_FIELDS.filter((f) => matchFields[f.key]).length + (matchFields.date ? 1 : 0);

  const toggleBtnStyle = (on: boolean) => ({
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 4,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: on ? colors.primary : colors.border,
    backgroundColor: on ? alpha(colors.primary, 0.12) : colors.card,
  });

  return (
    <FormSheet visible={visible} title="去重检测" onClose={handleClose}>
      <ScrollView style={{ maxHeight: 460 }} contentContainerStyle={{ paddingBottom: 8 }} showsVerticalScrollIndicator={false}>
        {error ? (
          <View style={{ padding: 10, borderRadius: 10, backgroundColor: alpha(colors.expense, 0.1), marginBottom: 12 }}>
            <Text style={{ fontSize: 12, color: colors.expense }}>{error}</Text>
          </View>
        ) : null}

        {/* 匹配条件 */}
        <Text variant="muted" style={{ fontSize: 12, marginBottom: 8 }}>匹配条件(至少一项)</Text>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 10 }}>
          <ChipSelect
            value={matchFields.date ?? 'ignore'}
            onChange={(v) => setMatchFields((p) => ({ ...p, date: v === 'ignore' ? null : (v as 'date' | 'exact') }))}
            options={[
              { value: 'date', label: '时间:同日' },
              { value: 'exact', label: '时间:精确' },
              { value: 'ignore', label: '时间:忽略' },
            ]}
          />
        </View>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 12 }}>
          {TOGGLE_FIELDS.map((f) => {
            const on = matchFields[f.key];
            return (
              <Pressable
                key={f.key}
                onPress={() => {
                  setMatchFields((p) => ({ ...p, [f.key]: !p[f.key] }));
                  haptics.tap();
                }}
                style={toggleBtnStyle(on)}
              >
                <Text style={{ fontSize: 12, color: on ? colors.primary : colors.mutedForeground, fontWeight: on ? '600' : '400' }}>{f.label}</Text>
                {on ? <Check size={12} color={colors.primary} /> : null}
              </Pressable>
            );
          })}
        </View>
        <Pressable
          onPress={handleDetect}
          disabled={activeFieldCount < 1 || detecting}
          style={{
            height: 42,
            borderRadius: palette.radius.button,
            backgroundColor: colors.primary,
            alignItems: 'center',
            justifyContent: 'center',
            flexDirection: 'row',
            gap: 8,
            opacity: activeFieldCount < 1 || detecting ? 0.5 : 1,
            marginBottom: 14,
          }}
        >
          {detecting ? (
            <ActivityIndicator color={colors.primaryForeground} />
          ) : (
            <Text style={{ fontSize: 14, fontWeight: '600', color: colors.primaryForeground }}>检测重复</Text>
          )}
        </Pressable>

        {/* 结果 */}
        {detected && groups.length === 0 ? (
          <View style={{ alignItems: 'center', paddingVertical: 36 }}>
            <CopyMinus size={36} color={colors.mutedForeground} style={{ opacity: 0.4, marginBottom: 10 }} />
            <Text variant="muted" style={{ fontSize: 13 }}>未发现重复记录</Text>
          </View>
        ) : null}

        {detected && groups.length > 0 ? (
          <>
            {/* 摘要 */}
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 12 }}>
              {[
                `共 ${groups.length} 组重复`,
                `${totalDuplicates} 条可删除`,
                `已选 ${selectedIds.size} 条`,
              ].map((t) => (
                <View key={t} style={{ paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999, backgroundColor: colors.muted }}>
                  <Text style={{ fontSize: 11, color: colors.mutedForeground }}>{t}</Text>
                </View>
              ))}
            </View>

            {/* 重复分组 */}
            {groups.map((group, gi) => {
              const groupIds = group.records.map((r) => r.id);
              const allSelected = groupIds.every((id) => selectedIds.has(id));
              const keyLabels = parseGroupKey(group.key, matchFields, accountDisplay, ownerNames);
              return (
                <View key={gi} style={{ borderWidth: 1, borderColor: colors.border, borderRadius: 14, overflow: 'hidden', marginBottom: 14 }}>
                  {/* 组头 */}
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 12, paddingVertical: 8, backgroundColor: colors.muted, flexWrap: 'wrap' }}>
                    <Pressable onPress={() => toggleGroup(group)}>
                      <Text style={{ fontSize: 12, color: colors.primary, fontWeight: '600' }}>{allSelected ? '取消全选' : '全选'}</Text>
                    </Pressable>
                    <Text style={{ fontSize: 12, color: colors.mutedForeground }}>{group.count} 条重复</Text>
                  </View>
                  <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 4, paddingHorizontal: 12, paddingBottom: 8, backgroundColor: colors.muted }}>
                    {keyLabels.map((label, i) => (
                      <View key={i} style={{ paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6, borderWidth: 1, borderColor: colors.border }}>
                        <Text style={{ fontSize: 10, color: colors.mutedForeground }}>{label}</Text>
                      </View>
                    ))}
                  </View>

                  {/* 组内记录 */}
                  {group.records.map((r: RecordItem, ri) => {
                    const checked = selectedIds.has(r.id);
                    const keep = ri === 0;
                    return (
                      <Pressable
                        key={r.id}
                        onPress={() => toggleRecord(r.id)}
                        style={{
                          flexDirection: 'row',
                          alignItems: 'center',
                          gap: 10,
                          paddingHorizontal: 12,
                          paddingVertical: 10,
                          borderTopWidth: 1,
                          borderTopColor: colors.hairline,
                          backgroundColor: keep ? alpha(colors.income, 0.06) : colors.card,
                        }}
                      >
                        {/* 勾选框 */}
                        <View
                          style={{
                            width: 20,
                            height: 20,
                            borderRadius: 6,
                            borderWidth: 1.5,
                            borderColor: checked ? colors.primary : colors.border,
                            backgroundColor: checked ? colors.primary : 'transparent',
                            alignItems: 'center',
                            justifyContent: 'center',
                          }}
                        >
                          {checked ? <Check size={13} color={colors.primaryForeground} /> : null}
                        </View>

                        {/* 信息列 */}
                        <View style={{ flex: 1 }}>
                          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                            {keep ? (
                              <View style={{ paddingHorizontal: 5, paddingVertical: 1, borderRadius: 5, backgroundColor: alpha(colors.income, 0.15) }}>
                                <Text style={{ fontSize: 9, color: colors.income, fontWeight: '700' }}>保留</Text>
                              </View>
                            ) : null}
                            <Text style={{ fontSize: 13, fontWeight: '700', color: TYPE_COLOR[r.type] }}>{TYPE_LABEL[r.type]}</Text>
                            <Text style={{ fontSize: 14, fontWeight: '700', fontVariant: ['tabular-nums'], color: TYPE_COLOR[r.type] }}>
                              {r.type === 'EXPENSE' ? '-' : r.type === 'INCOME' ? '+' : ''}{r.amount.toFixed(2)}
                            </Text>
                            <Text variant="muted" style={{ fontSize: 10, marginLeft: 'auto' }}>{fmtDate(r.date)}</Text>
                          </View>
                          <Text variant="muted" style={{ fontSize: 11, marginTop: 3 }} numberOfLines={1}>
                            {r.type === 'TRANSFER' && r.toAccountName
                              ? `${r.accountName ?? '-'} → ${r.toAccountName}`
                              : r.accountName ?? '-'}
                            {r.counterparty ? ` · ${r.counterparty}` : ''}
                            {r.categoryCode ? ` · ${r.categoryCode}` : ''}
                            {r.ownerName ? ` · ${r.ownerName}` : ''}
                            {r.remark ? ` · ${r.remark}` : ''}
                          </Text>
                        </View>
                      </Pressable>
                    );
                  })}
                </View>
              );
            })}
          </>
        ) : null}
      </ScrollView>

      {/* 删除选中 */}
      {detected && groups.length > 0 ? (
        <Pressable
          onPress={handleDelete}
          disabled={selectedIds.size === 0 || deleting}
          style={{
            marginTop: 12,
            height: 48,
            borderRadius: palette.radius.button,
            backgroundColor: colors.expense,
            alignItems: 'center',
            justifyContent: 'center',
            flexDirection: 'row',
            gap: 8,
            opacity: selectedIds.size === 0 || deleting ? 0.5 : 1,
          }}
        >
          {deleting ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={{ fontSize: 15, fontWeight: '600', color: '#fff' }}>删除选中 ({selectedIds.size})</Text>
          )}
        </Pressable>
      ) : null}
    </FormSheet>
  );
}

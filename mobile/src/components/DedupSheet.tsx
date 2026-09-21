import { useMemo, useState, type ReactNode } from 'react';
import { ActivityIndicator, Pressable, ScrollView, Switch, TextInput, View } from 'react-native';
import { Check, CopyMinus } from 'lucide-react-native';
import { useTheme, alpha, haptics, semanticTypeColor } from '@/theme';
import { Text } from '@/components/ui/Text';
import { FormSheet } from '@/components/chrome/FormSheet';
import { ConfirmSheet } from '@/components/chrome/ConfirmSheet';
import { ChipSelect } from '@/components/ui/ChipSelect';
import { showToast } from '@/components/chrome/Toast';
import { notifyPageRefresh } from '@/components/chrome/chrome';
import { useRecords } from '@/stores/records';
import { accountLabel, isMultiOwnerAccounts } from '@/lib/account';
import {
  DEDUP_EMPTY_LABEL,
  DEFAULT_DEDUP_MATCH_FIELDS,
  DEDUP_TOGGLE_FIELDS,
  DEDUP_TYPE_LABELS,
  parseDuplicateGroupKey,
  planDuplicateMerge,
  type DedupMatchFields,
  type DuplicateMergeChoice,
  type DuplicateMergeConflict,
  type DuplicateMergeConflictField,
  type DuplicateMergePlan,
  type DuplicateMergeRecord,
} from '@homibook/core';
import {
  detectDuplicatesApi,
  batchDeleteRecordsApi,
  mergeDuplicatesApi,
  type DuplicateGroup,
} from '@/services/records';
import type { RecordItem } from '@/types';

const TYPE_LABEL = DEDUP_TYPE_LABELS;

/** 格式化 ISO 日期为 YYYY-MM-DD HH:mm:ss */
function fmtDate(iso: string): string {
  return (iso || '').replace('T', ' ').slice(0, 19);
}

/** 冲突选择里「不填」的哨兵值(chip 的 value 必须是字符串) */
const EMPTY_CHIP = '__empty__';

/**
 * 流水 → core 的合并入参。
 * 后端返回的流水对象带 payer / fromAccountId(本地 RecordItem 类型未声明),按鸭子类型取,取不到再退回 counterparty。
 */
function toMergeRecord(r: RecordItem): DuplicateMergeRecord {
  const raw = r as RecordItem & { payer?: string | null; fromAccountId?: string | null };
  return {
    id: r.id,
    accountId: r.accountId,
    fromAccountId: raw.fromAccountId ?? null,
    toAccountId: r.toAccountId ?? null,
    categoryCode: r.categoryCode ?? null,
    payer: raw.payer ?? r.counterparty ?? null,
    remark: r.remark ?? null,
    tags: r.tags ?? [],
    attachments: r.attachments ?? [],
    type: r.type,
  };
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

  const [matchFields, setMatchFields] = useState<DedupMatchFields>(DEFAULT_DEDUP_MATCH_FIELDS);
  const [groups, setGroups] = useState<DuplicateGroup[]>([]);
  const [totalDuplicates, setTotalDuplicates] = useState(0);
  const [detected, setDetected] = useState(false);
  const [detecting, setDetecting] = useState(false);
  const [error, setError] = useState('');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  // 处理方式(合并 / 删除):勾选语义两种模式一致 —— 勾选 = 该记录会被处理,切模式不动勾选
  const [mode, setMode] = useState<'merge' | 'delete'>('merge');
  // 每组合并结果的编辑(keepId → 冲突选择 / 文本覆盖)
  const [choices, setChoices] = useState<Record<string, DuplicateMergeChoice>>({});
  // 合并与删除共用的「执行中」标记
  const [running, setRunning] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);

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
    setRunning(false);
    setError('');
    setSelectedIds(new Set());
    setMatchFields(DEFAULT_DEDUP_MATCH_FIELDS);
    setMode('merge');
    setChoices({});
    setGroupFilter('all');
    setConfirmOpen(false);
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

  /** 底部按钮:按当前模式弹确认(删除 / 合并) */
  const handleRun = () => {
    if (running) return;
    if (mode === 'delete' ? selectedIds.size === 0 : pendingMergeCount === 0) return;
    setConfirmOpen(true);
  };

  const doDelete = async () => {
    setConfirmOpen(false);
    setRunning(true);
    setError('');
    try {
      await batchDeleteRecordsApi(Array.from(selectedIds));
      haptics.success();
      notifyPageRefresh();
      handleClose();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setRunning(false);
    }
  };

  const activeFieldCount = DEDUP_TOGGLE_FIELDS.filter((f) => matchFields[f.key]).length + (matchFields.date ? 1 : 0);

  // ── 合并预演 ──
  // 处理单位:每组「第 1 条 + 该组被勾选的其余记录」(第 1 条永远是保留记录,不参与被并入)。
  // 结果面板与提交走后端的是同一个 core 函数 → 所见即所做。
  const mergePlans = useMemo(() => {
    const out: { group: DuplicateGroup; plan: DuplicateMergePlan }[] = [];
    for (const g of groups) {
      const keep = g.records[0];
      const picked = g.records.slice(1).filter((r) => selectedIds.has(r.id));
      if (picked.length === 0) continue;
      out.push({
        group: g,
        plan: planDuplicateMerge([toMergeRecord(keep), ...picked.map(toMergeRecord)], choices[keep.id]),
      });
    }
    return out;
  }, [groups, selectedIds, choices]);

  const planOf = (group: DuplicateGroup) => mergePlans.find((p) => p.group === group)?.plan;
  const pendingMergeCount = mergePlans.reduce((sum, p) => sum + (p.plan.blocked ? 0 : p.plan.mergeIds.length), 0);
  const blockedCount = mergePlans.filter((p) => p.plan.blocked).length;

  // 分组筛选(全部 / 无冲突 / 有冲突):**按整组判定,与勾选无关** ——
  // 勾选决定「处理哪些」,筛选决定「先看哪些」,所以要用全组记录算一次,而不是用当前勾选算。
  // 「有冲突」= 账户/分类组内不一致(要选一个)或方向不一致(根本不能合),即"需要人工处理的组"。
  const [groupFilter, setGroupFilter] = useState<'all' | 'clean' | 'conflict'>('all');
  const groupInfo = useMemo(() => {
    const map = new Map<DuplicateGroup, { dirty: boolean }>();
    for (const g of groups) {
      const plan = planDuplicateMerge(g.records.map(toMergeRecord));
      map.set(g, { dirty: plan.conflicts.length > 0 || !!plan.blocked });
    }
    return map;
  }, [groups]);
  const cleanCount = groups.filter((g) => !groupInfo.get(g)?.dirty).length;
  const conflictCount = groups.length - cleanCount;
  const visibleGroups = groupFilter === 'all'
    ? groups
    : groups.filter((g) => (groupFilter === 'clean' ? !groupInfo.get(g)?.dirty : !!groupInfo.get(g)?.dirty));

  const chipValue = (v: string | null | undefined) => (v == null ? EMPTY_CHIP : v);
  // 取该字段的当前选择:**显式选过(含选「不填」= null)一律以选择为准** ——
  // 不能用 `?? c.default` 兜底:null 会被判为「没选」而回退到默认值,导致「不填」选不上
  const mergeValueOf = (plan: DuplicateMergePlan, c: DuplicateMergeConflict) => {
    const chosen = choices[plan.keepId];
    if (chosen && c.field in chosen) return chosen[c.field] ?? null;
    return c.default;
  };
  const setMergeChoice = (keepId: string, field: DuplicateMergeConflictField, v: string) => {
    setChoices((prev) => ({ ...prev, [keepId]: { ...prev[keepId], [field]: v === EMPTY_CHIP ? null : v } }));
  };
  const setMergeText = (keepId: string, field: 'remarkText' | 'payerText', v: string) => {
    setChoices((prev) => ({ ...prev, [keepId]: { ...prev[keepId], [field]: v } }));
  };
  const mergeOptionLabel = (v: string | null, field: DuplicateMergeConflictField) =>
    v === null ? DEDUP_EMPTY_LABEL : field === 'accountId' ? (accountDisplay.get(v) ?? v) : v;
  const mergeOptionsOf = (c: DuplicateMergeConflict) => {
    const options = c.options.map((o) => ({
      value: chipValue(o.value),
      label: `${mergeOptionLabel(o.value, c.field)} ×${o.count}`,
    }));
    // 分类可空:组内没人留空时也要能选「不填」
    if (c.field === 'categoryCode' && !c.options.some((o) => o.value === null)) {
      options.push({ value: EMPTY_CHIP, label: '不填' });
    }
    return options;
  };
  const conflictOf = (plan: DuplicateMergePlan, field: DuplicateMergeConflictField) =>
    plan.conflicts.find((c) => c.field === field);

  /** 合并结果面板的一行:淡绿 = 自动收敛(含并集/拼接),淡红 = 冲突需用户确认 */
  const resultRow = (label: string, conflict: boolean, children: ReactNode) => (
    <View
      style={{
        backgroundColor: conflict ? alpha(colors.expense, 0.12) : alpha(colors.income, 0.12),
        borderRadius: 8,
        paddingHorizontal: 8,
        paddingVertical: 6,
        marginBottom: 6,
      }}
    >
      <Text style={{ fontSize: 10.5, color: colors.mutedForeground, marginBottom: 4 }}>
        {label}
        {conflict ? ' · 组内不一致,请选择' : ''}
      </Text>
      {children}
    </View>
  );

  const doMerge = async () => {
    setConfirmOpen(false);
    setRunning(true);
    setError('');
    try {
      const targets = mergePlans.filter((p) => !p.plan.blocked);
      const res = await mergeDuplicatesApi(
        bookId,
        matchFields,
        targets.map(({ group, plan }) => ({
          keepId: plan.keepId,
          mergeIds: plan.mergeIds,
          choices: choices[group.records[0].id],
        })),
      );
      haptics.success();
      notifyPageRefresh();
      showToast(`已合并 ${res.mergedGroups} 组 / ${res.mergedRecords} 条`);
      setChoices({});
      // 重新检测:合并后组会消失,列表与真实状态保持一致
      await handleDetect();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setRunning(false);
    }
  };

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
    <>
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
            onChange={(v) => setMatchFields((p) => ({ ...p, date: v === 'ignore' ? null : (v as 'exact' | 'minute' | 'date') }))}
            options={[
              { value: 'exact', label: '时间:精确' },
              { value: 'minute', label: '时间:同分钟' },
              { value: 'date', label: '时间:同日' },
              { value: 'ignore', label: '时间:忽略' },
            ]}
          />
        </View>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 12 }}>
          {DEDUP_TOGGLE_FIELDS.map((f) => {
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
            {/* 处理方式二选一(switch):勾选语义两模式一致(勾选 = 该记录会被处理),切模式不动勾选 */}
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8 }}>
              <Text style={{ fontSize: 13, fontWeight: '600', color: mode === 'merge' ? colors.primary : colors.mutedForeground }}>
                合并重复
              </Text>
              <Switch
                value={mode === 'merge'}
                onValueChange={(v) => {
                  setMode(v ? 'merge' : 'delete');
                  haptics.tap();
                }}
                trackColor={{ false: alpha(colors.expense, 0.45), true: alpha(colors.primary, 0.45) }}
                thumbColor={mode === 'merge' ? colors.primary : colors.expense}
              />
              <Text style={{ fontSize: 13, fontWeight: '600', color: mode === 'delete' ? colors.expense : colors.mutedForeground }}>
                删除重复
              </Text>
            </View>
            <Text variant="muted" style={{ fontSize: 11, lineHeight: 15, marginBottom: 10 }}>
              {mode === 'merge'
                ? '勾选要并入的记录(默认每组除第 1 条外全选),每组保留最早一条;下方结果面板淡绿 = 自动收敛、淡红 = 需你确认。'
                : '勾选要删除的记录(默认每组除第 1 条外全选),每组保留最早一条。'}
            </Text>

            {/* 摘要 */}
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 12 }}>
              {[
                `共 ${groups.length} 组重复`,
                `${totalDuplicates} 条重复`,
                mode === 'merge' ? `将合并 ${pendingMergeCount} 条` : `已选 ${selectedIds.size} 条`,
                ...(mode === 'merge' && blockedCount > 0 ? [`${blockedCount} 组方向不一致,不参与合并`] : []),
              ].map((t) => (
                <View key={t} style={{ paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999, backgroundColor: colors.muted }}>
                  <Text style={{ fontSize: 11, color: colors.mutedForeground }}>{t}</Text>
                </View>
              ))}
            </View>

            {/* 分组筛选:先看需要拍板的组(计数按整组算,与勾选无关) */}
            <View style={{ flexDirection: 'row', gap: 8, marginBottom: 10 }}>
              {([
                ['all', '全部', groups.length],
                ['clean', '无冲突', cleanCount],
                ['conflict', '有冲突', conflictCount],
              ] as const).map(([key, label, count]) => {
                const on = groupFilter === key;
                return (
                  <Pressable
                    key={key}
                    onPress={() => {
                      setGroupFilter(key);
                      haptics.tap();
                    }}
                    style={{
                      paddingHorizontal: 10,
                      paddingVertical: 5,
                      borderRadius: 999,
                      borderWidth: 1,
                      borderColor: on ? colors.primary : colors.border,
                      backgroundColor: on ? alpha(colors.primary, 0.12) : colors.card,
                    }}
                  >
                    <Text style={{ fontSize: 11.5, fontWeight: on ? '600' : '400', color: on ? colors.primary : colors.mutedForeground }}>
                      {label} {count}
                    </Text>
                  </Pressable>
                );
              })}
            </View>

            {visibleGroups.length === 0 ? (
              <View style={{ paddingVertical: 20, alignItems: 'center' }}>
                <Text variant="muted" style={{ fontSize: 12 }}>当前筛选下没有分组</Text>
              </View>
            ) : null}

            {/* 重复分组 */}
            {visibleGroups.map((group) => {
              const groupIds = group.records.map((r) => r.id);
              const allSelected = groupIds.every((id) => selectedIds.has(id));
              const keyLabels = parseDuplicateGroupKey(group.key, matchFields, { accountDisplay, ownerNames });
              const groupPlan = planOf(group);
              const keepRec = group.records[0];
              const accountConflict = groupPlan ? conflictOf(groupPlan, 'accountId') : undefined;
              const categoryConflict = groupPlan ? conflictOf(groupPlan, 'categoryCode') : undefined;
              const accountValue = groupPlan?.patch.accountId ?? keepRec.accountId;
              const categoryValue = groupPlan?.patch.categoryCode ?? keepRec.categoryCode ?? null;
              const payerValue = choices[keepRec.id]?.payerText ?? groupPlan?.patch.payer ?? keepRec.counterparty ?? '';
              const remarkValue = choices[keepRec.id]?.remarkText ?? groupPlan?.remark ?? '';
              const tagsValue = groupPlan?.patch.tags ?? keepRec.tags ?? [];
              const attachCount =
                (keepRec.attachments?.length ?? 0) +
                group.records.slice(1).filter((r) => selectedIds.has(r.id)).reduce((n, r) => n + (r.attachments?.length ?? 0), 0);
              return (
                <View key={group.key} style={{ borderWidth: 1, borderColor: colors.border, borderRadius: 14, overflow: 'hidden', marginBottom: 14 }}>
                  {/* 组头 */}
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 12, paddingVertical: 8, backgroundColor: colors.muted, flexWrap: 'wrap' }}>
                    <Pressable onPress={() => toggleGroup(group)}>
                      <Text style={{ fontSize: 12, color: colors.primary, fontWeight: '600' }}>{allSelected ? '取消全选' : '全选'}</Text>
                    </Pressable>
                    <Text style={{ fontSize: 12, color: colors.mutedForeground }}>{group.count} 条重复</Text>
                    {mode === 'merge' && groupPlan ? (
                      <Text variant="muted" style={{ fontSize: 11, marginLeft: 'auto' }}>
                        {groupPlan.blocked ? '方向不一致,不合并' : `将并入 ${groupPlan.mergeIds.length} 条`}
                      </Text>
                    ) : null}
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
                            <Text style={{ fontSize: 13, fontWeight: '700', color: semanticTypeColor(colors, r.type) }}>{TYPE_LABEL[r.type]}</Text>
                            <Text style={{ fontSize: 14, fontWeight: '700', fontVariant: ['tabular-nums'], color: semanticTypeColor(colors, r.type) }}>
                              {r.type === 'EXPENSE' ? '-' : r.type === 'INCOME' ? '+' : ''}{r.amount.toFixed(2)}
                            </Text>
                            <Text variant="muted" style={{ fontSize: 10, marginLeft: 'auto' }}>{fmtDate(r.date)}</Text>
                          </View>
                          <Text variant="muted" style={{ fontSize: 11, marginTop: 3 }} numberOfLines={1}>
                            {r.type === 'TRANSFER' && r.toAccountName
                              ? `${r.accountName ?? '-'} → ${r.toAccountName}`
                              : r.accountName ?? '-'}
                            {r.counterparty ? ` · ${r.counterparty}` : ''}
                            {r.categoryCode ? ` · ${r.categoryCode}` : ' · 未分类'}
                            {r.ownerName ? ` · ${r.ownerName}` : ''}
                          </Text>
                          {/* 其余字段另起一行,保证「全部流水字段」都能看到 */}
                          <Text variant="muted" style={{ fontSize: 10.5, marginTop: 2 }} numberOfLines={1}>
                            备注 {r.remark || '—'} · 标签 {r.tags?.length ? r.tags.join(' / ') : '—'} · 附件 {r.attachments?.length ?? 0} 个
                          </Text>
                        </View>
                      </Pressable>
                    );
                  })}

                  {/* 合并结果(内联可编辑,不再另弹窗):淡绿 = 自动收敛,淡红 = 组内不一致需确认 */}
                  {mode === 'merge' ? (
                    <View style={{ borderTopWidth: 1, borderTopColor: colors.hairline, backgroundColor: colors.muted, paddingHorizontal: 10, paddingVertical: 10 }}>
                      {!groupPlan ? (
                        <Text variant="muted" style={{ fontSize: 11 }}>未勾选要并入的记录 — 本组不处理</Text>
                      ) : groupPlan.blocked ? (
                        <Text style={{ fontSize: 11, color: colors.expense }}>本组不参与合并:{groupPlan.blocked}</Text>
                      ) : (
                        <>
                          <Text style={{ fontSize: 11.5, fontWeight: '600', marginBottom: 8 }}>合并结果(可编辑)</Text>

                          {/* 锚点:分组依据,合并不动 */}
                          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 8 }}>
                            {[
                              `类型 ${TYPE_LABEL[keepRec.type]}`,
                              `金额 ${keepRec.amount.toFixed(2)}`,
                              `日期 ${fmtDate(keepRec.date)}`,
                            ].map((t) => (
                              <View key={t} style={{ paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6, backgroundColor: colors.card }}>
                                <Text variant="muted" style={{ fontSize: 10.5 }}>{t}</Text>
                              </View>
                            ))}
                          </View>

                          {resultRow('账户', !!accountConflict, accountConflict ? (
                            <ChipSelect
                              value={chipValue(mergeValueOf(groupPlan, accountConflict))}
                              onChange={(v) => setMergeChoice(groupPlan.keepId, 'accountId', v)}
                              options={mergeOptionsOf(accountConflict)}
                            />
                          ) : (
                            <Text style={{ fontSize: 12 }}>{mergeOptionLabel(accountValue, 'accountId')}</Text>
                          ))}

                          {resultRow('分类', !!categoryConflict, categoryConflict ? (
                            <ChipSelect
                              value={chipValue(mergeValueOf(groupPlan, categoryConflict))}
                              onChange={(v) => setMergeChoice(groupPlan.keepId, 'categoryCode', v)}
                              options={mergeOptionsOf(categoryConflict)}
                            />
                          ) : (
                            <Text style={{ fontSize: 12 }}>{categoryValue ?? DEDUP_EMPTY_LABEL}</Text>
                          ))}

                          {resultRow('交易方', false, (
                            <TextInput
                              value={payerValue}
                              onChangeText={(v) => setMergeText(groupPlan.keepId, 'payerText', v)}
                              placeholder="可不填"
                              placeholderTextColor={colors.mutedForeground}
                              style={{ fontSize: 12.5, color: colors.foreground, backgroundColor: colors.card, borderRadius: 6, paddingHorizontal: 8, paddingVertical: 4 }}
                            />
                          ))}

                          {resultRow('备注', false, (
                            <TextInput
                              value={remarkValue}
                              onChangeText={(v) => setMergeText(groupPlan.keepId, 'remarkText', v)}
                              placeholder="可不填(默认拼接各条备注)"
                              placeholderTextColor={colors.mutedForeground}
                              multiline
                              style={{ fontSize: 12.5, color: colors.foreground, backgroundColor: colors.card, borderRadius: 6, paddingHorizontal: 8, paddingVertical: 4, minHeight: 30 }}
                            />
                          ))}

                          {resultRow('标签 / 附件', false, (
                            <Text style={{ fontSize: 12 }}>
                              标签 {tagsValue.length > 0 ? tagsValue.join(' / ') : '无'} · 附件 {attachCount} 个
                            </Text>
                          ))}

                          {groupPlan.autoFilled.length > 0 ? (
                            <Text variant="muted" style={{ fontSize: 10, lineHeight: 14 }}>
                              自动:{groupPlan.autoFilled.map((f) => f.detail).join(';')}
                            </Text>
                          ) : null}
                        </>
                      )}
                    </View>
                  ) : null}
                </View>
              );
            })}
          </>
        ) : null}
      </ScrollView>

      {/* 底部动作:随模式切换 —— 删除 / 合并(勾选在两模式之间保留) */}
      {detected && groups.length > 0 ? (
        <Pressable
          onPress={handleRun}
          disabled={running || (mode === 'delete' ? selectedIds.size === 0 : pendingMergeCount === 0)}
          style={{
            marginTop: 12,
            height: 48,
            borderRadius: palette.radius.button,
            backgroundColor: mode === 'delete' ? colors.expense : colors.primary,
            alignItems: 'center',
            justifyContent: 'center',
            flexDirection: 'row',
            gap: 8,
            opacity: running || (mode === 'delete' ? selectedIds.size === 0 : pendingMergeCount === 0) ? 0.5 : 1,
          }}
        >
          {running ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={{ fontSize: 15, fontWeight: '600', color: '#fff' }}>
              {mode === 'delete' ? `删除 (${selectedIds.size})` : `合并 (${pendingMergeCount})`}
            </Text>
          )}
        </Pressable>
      ) : null}

      {/* 二次确认(两个模式共用) */}
      <ConfirmSheet
        visible={confirmOpen}
        title={mode === 'delete' ? '删除选中记录' : '合并选中记录'}
        message={
          mode === 'delete'
            ? `将永久删除 ${selectedIds.size} 条流水,不可恢复。`
            : `将合并 ${mergePlans.filter((p) => !p.plan.blocked).length} 组、删除 ${pendingMergeCount} 条重复记录;备注拼接、附件并入各组第 1 条,不可撤销。`
        }
        onConfirm={mode === 'delete' ? doDelete : doMerge}
        onClose={() => setConfirmOpen(false)}
      />
      </FormSheet>
    </>
  );
}

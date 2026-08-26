import { useEffect, useMemo, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, View } from 'react-native';
import { ArrowUpRight, ArrowDownRight, ArrowLeftRight, SlidersHorizontal, X, Copy, Trash2, Pencil } from 'lucide-react-native';
import { useTheme, alpha, haptics } from '@/theme';
import { useUIShell } from '@/components/chrome/chrome';
import { useRecords } from '@/stores/records';
import { fetchRecords } from '@/services/records';
import { Screen } from '@/components/Screen';
import { Card } from '@/components/ui/Card';
import { Text } from '@/components/ui/Text';
import { RecordRow } from '@/components/RecordRow';
import { SwipeRow } from '@/components/SwipeRow';
import { EmptyState } from '@/components/ui/EmptyState';
import { FadeInView } from '@/components/FadeInView';
import { FilterSheet, countActiveFilters, emptyFilters, type RecordFilters } from '@/components/FilterSheet';
import { formatMoney } from '@/lib/format';
import type { RecordItem, RecordType } from '@/types';

const TYPE_LABEL: Record<RecordType, string> = { EXPENSE: '支出', INCOME: '收入', TRANSFER: '转账' };

// 流水管理:4 汇总卡 + 高级筛选抽屉(FilterSheet) + 活跃条件胶囊 + 左滑编辑/克隆/删除 + 下拉刷新
// 数据全部消费 useRecords() 唯一数据源 —— 记一笔/编辑/删除后全局即时一致
export default function RecordsScreen() {
  const { colors } = useTheme();
  const { openRecord } = useUIShell();
  const { currentLedger } = useUIShell();
  const bookId = currentLedger.id;
  const { records, summary, accounts, categories, refresh, cloneRecord, deleteRecord } = useRecords();
  const [filters, setFilters] = useState<RecordFilters>(emptyFilters);
  const [filterOpen, setFilterOpen] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  // 后端筛选结果(独立请求,不受 store 前 100 条限制)
  const [list, setList] = useState<RecordItem[]>([]);

  const catLabelMap = useMemo(() => Object.fromEntries(categories.map((x) => [x.code, x.label])), [categories]);

  // 有筛选时按后端条件请求;无筛选时用 store 全量(下拉刷新更新)
  const hasActiveFilter = countActiveFilters(filters) > 0;
  useEffect(() => {
    if (!bookId) return;
    if (!hasActiveFilter) {
      setList([]);
      return;
    }
    let cancel = false;
    const singleAccount = filters.accountIds.length === 1 ? filters.accountIds[0] : undefined;
    const singleCategory = filters.categoryCodes.length === 1 ? filters.categoryCodes[0] : undefined;
    fetchRecords(bookId, {
      pageSize: 100,
      types: filters.types,
      dateFrom: filters.dateFrom || undefined,
      dateTo: filters.dateTo || undefined,
      amountFrom: filters.minAmount ? Number(filters.minAmount) : undefined,
      amountTo: filters.maxAmount ? Number(filters.maxAmount) : undefined,
      remark: filters.keyword.trim() || undefined,
      accountId: singleAccount,
      categoryCode: singleCategory,
    }).then((r) => { if (!cancel) setList(r); });
    return () => { cancel = true; };
  }, [bookId, hasActiveFilter, filters.types, filters.accountIds, filters.categoryCodes, filters.dateFrom, filters.dateTo, filters.minAmount, filters.maxAmount, filters.keyword]);

  const onRefresh = async () => {
    setRefreshing(true);
    try {
      await refresh();
      // 有筛选时同步重拉后端筛选结果
      if (bookId && hasActiveFilter) {
        const singleAccount = filters.accountIds.length === 1 ? filters.accountIds[0] : undefined;
        const singleCategory = filters.categoryCodes.length === 1 ? filters.categoryCodes[0] : undefined;
        await fetchRecords(bookId, {
          pageSize: 100,
          types: filters.types,
          dateFrom: filters.dateFrom || undefined,
          dateTo: filters.dateTo || undefined,
          amountFrom: filters.minAmount ? Number(filters.minAmount) : undefined,
          amountTo: filters.maxAmount ? Number(filters.maxAmount) : undefined,
          remark: filters.keyword.trim() || undefined,
          accountId: singleAccount,
          categoryCode: singleCategory,
        }).then(setList);
      }
    } finally {
      setRefreshing(false);
    }
  };

  // 数据源:有筛选 → 后端结果;无筛选 → store 全量
  const source = hasActiveFilter ? list : records;
  // 多选账户/分类(后端仅支持单值)在客户端补过滤
  const filtered = source.filter((r) => {
    if (filters.accountIds.length > 1 && !filters.accountIds.includes(r.accountId)) return false;
    if (filters.categoryCodes.length > 1 && !filters.categoryCodes.includes(r.categoryCode ?? '')) return false;
    return true;
  });
  const activeCount = countActiveFilters(filters);

  // 按日分组(由近及远)
  const groups = filtered.reduce<Record<string, RecordItem[]>>((acc, r) => {
    const day = r.date.slice(0, 10);
    (acc[day] ??= []).push(r);
    return acc;
  }, {});
  const dates = Object.keys(groups).sort((a, b) => (a < b ? 1 : -1));

  const onClone = (r: RecordItem) => {
    cloneRecord(r);
    haptics.success();
  };
  const onDelete = (r: RecordItem) => {
    deleteRecord(r.id);
    haptics.warn();
  };

  // 活跃条件胶囊(点 × 单个移除)
  const activeChips: { key: string; label: string; onClear: () => void }[] = [
    ...filters.types.map((t) => ({
      key: `t-${t}`,
      label: TYPE_LABEL[t],
      onClear: () => setFilters((f) => ({ ...f, types: f.types.filter((x) => x !== t) })),
    })),
    ...filters.accountIds.map((id) => ({
      key: `a-${id}`,
      label: accounts.find((a) => a.id === id)?.name ?? id,
      onClear: () => setFilters((f) => ({ ...f, accountIds: f.accountIds.filter((x) => x !== id) })),
    })),
    ...filters.categoryCodes.map((code) => ({
      key: `c-${code}`,
      label: catLabelMap[code] ?? code,
      onClear: () => setFilters((f) => ({ ...f, categoryCodes: f.categoryCodes.filter((x) => x !== code) })),
    })),
    ...(filters.dateFrom || filters.dateTo
      ? [{ key: 'date', label: `${filters.dateFrom || '…'} ~ ${filters.dateTo || '…'}`, onClear: () => setFilters((f) => ({ ...f, dateFrom: '', dateTo: '' })) }]
      : []),
    ...(filters.minAmount || filters.maxAmount
      ? [{ key: 'amt', label: `¥${filters.minAmount || '0'} ~ ¥${filters.maxAmount || '∞'}`, onClear: () => setFilters((f) => ({ ...f, minAmount: '', maxAmount: '' })) }]
      : []),
    ...(filters.keyword.trim()
      ? [{ key: 'kw', label: `「${filters.keyword.trim()}」`, onClear: () => setFilters((f) => ({ ...f, keyword: '' })) }]
      : []),
  ];

  const summaryCards = [
    { label: '总收入', value: summary.income, icon: ArrowUpRight, color: colors.income },
    { label: '总支出', value: summary.expense, icon: ArrowDownRight, color: colors.expense },
    { label: '转账总额', value: summary.transfer, icon: ArrowLeftRight, color: colors.transfer },
    { label: '净收入', value: summary.netIncome, icon: ArrowUpRight, color: summary.netIncome >= 0 ? colors.income : colors.expense },
  ] as const;

  return (
    <Screen>
      <View style={{ flex: 1, paddingHorizontal: 20, paddingTop: 8 }}>
        {/* 标题栏 */}
        <Text style={{ fontSize: 20, fontWeight: '700', marginBottom: 14 }}>流水管理</Text>

        {/* 汇总卡片 2x2 */}
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', rowGap: 10, marginBottom: 16 }}>
          {summaryCards.map(({ label, value, icon: Icon, color }, i) => (
            <FadeInView key={label} index={i} style={{ width: '48%' }}>
              <View style={{ padding: 14, borderRadius: 18, flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border }}>
                <View style={{ width: 36, height: 36, borderRadius: 11, alignItems: 'center', justifyContent: 'center', backgroundColor: alpha(color, 0.12) }}>
                  <Icon size={17} color={color} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text variant="muted" style={{ fontSize: 11 }}>{label}</Text>
                  <Text style={{ fontSize: 16, fontWeight: '700', color, fontVariant: ['tabular-nums'], marginTop: 1 }} numberOfLines={1}>{formatMoney(value)}</Text>
                </View>
              </View>
            </FadeInView>
          ))}
        </View>

        {/* 筛选入口 + 活跃条件胶囊 */}
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, paddingBottom: 12, alignItems: 'center' }}>
          <Pressable
            onPress={() => {
              setFilterOpen(true);
              haptics.tap();
            }}
            style={{ flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 14, paddingVertical: 7, borderRadius: 999, backgroundColor: colors.muted, borderWidth: 1, borderColor: colors.border }}
          >
            <SlidersHorizontal size={13} color={colors.foreground} />
            <Text style={{ fontSize: 13, color: colors.foreground, fontWeight: '500' }}>筛选</Text>
            {activeCount > 0 && (
              <View style={{ minWidth: 16, height: 16, borderRadius: 8, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 4 }}>
                <Text style={{ fontSize: 10, color: colors.primaryForeground, fontWeight: '700' }}>{activeCount}</Text>
              </View>
            )}
          </Pressable>

          {activeChips.map((c) => (
            <View key={c.key} style={{ flexDirection: 'row', alignItems: 'center', gap: 4, paddingLeft: 12, paddingRight: 8, paddingVertical: 6, borderRadius: 999, backgroundColor: alpha(colors.primary, 0.1), borderWidth: 1, borderColor: alpha(colors.primary, 0.3) }}>
              <Text style={{ fontSize: 12, color: colors.primary }}>{c.label}</Text>
              <Pressable onPress={c.onClear} hitSlop={6}>
                <X size={12} color={colors.primary} />
              </Pressable>
            </View>
          ))}
        </View>

        <ScrollView
          contentContainerStyle={{ paddingBottom: 40, flexGrow: 1 }}
          showsVerticalScrollIndicator={false}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} colors={[colors.primary]} />}
        >
          {dates.length === 0 ? (
            <EmptyState
              icon="🧾"
              title={activeCount ? '没有符合条件的流水' : '暂无流水'}
              description={activeCount ? '试试调整筛选条件' : '记下第一笔,开始管理家庭财务'}
              actionLabel={activeCount ? undefined : '记一笔'}
              onAction={activeCount ? undefined : () => openRecord()}
            />
          ) : (
            dates.map((d, gi) => (
              <FadeInView key={d} index={gi}>
                <Card className="px-5 py-4 mb-4">
                  <Text variant="muted" style={{ fontSize: 11, letterSpacing: 1, marginBottom: 12 }}>{d}</Text>
                  {groups[d].map((r, i) => (
                    <View key={r.id}>
                      <SwipeRow
                        actions={[
                          { key: 'edit', label: '编辑', color: colors.transfer, icon: Pencil, onPress: () => openRecord(r) },
                          { key: 'clone', label: '克隆', color: colors.mutedForeground, icon: Copy, onPress: () => onClone(r) },
                          { key: 'del', label: '删除', color: colors.expense, icon: Trash2, onPress: () => onDelete(r) },
                        ]}
                      >
                        <Pressable onPress={() => { haptics.tap(); openRecord(r); }}>
                          <RecordRow record={r} />
                        </Pressable>
                      </SwipeRow>
                      {i < groups[d].length - 1 && <View style={{ height: 14 }} />}
                    </View>
                  ))}
                </Card>
              </FadeInView>
            ))
          )}
        </ScrollView>
      </View>

      <FilterSheet visible={filterOpen} initial={filters} onApply={setFilters} onClose={() => setFilterOpen(false)} />
    </Screen>
  );
}

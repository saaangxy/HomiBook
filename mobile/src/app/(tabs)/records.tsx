import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Alert, FlatList, Platform, Pressable, RefreshControl, View } from 'react-native';
import { useIsFocused } from 'expo-router';
import { ArrowUpRight, ArrowDownRight, ArrowLeftRight, SlidersHorizontal, X, Copy, Trash2, CopyMinus, FileUp, Download, Save, Share2 } from 'lucide-react-native';
import { useTheme, alpha, haptics } from '@/theme';
import { useUIShell, usePageRefresh } from '@/components/chrome/chrome';
import { useRecords } from '@/stores/records';
import { fetchRecordsPaged } from '@/services/records';
import { Screen } from '@/components/Screen';
import { Card } from '@/components/ui/Card';
import { Text } from '@/components/ui/Text';
import { RecordRow } from '@/components/RecordRow';
import { SwipeRow } from '@/components/SwipeRow';
import { EmptyState } from '@/components/ui/EmptyState';
import { FadeInView } from '@/components/FadeInView';
import { FilterSheet, countActiveFilters, emptyFilters, type RecordFilters } from '@/components/FilterSheet';
import { DedupSheet } from '@/components/DedupSheet';
import { ImportSheet } from '@/components/import/ImportSheet';
import { ConfirmSheet } from '@/components/chrome/ConfirmSheet';
import { FormSheet } from '@/components/chrome/FormSheet';
import { exportRecordsCsv, type ExportMode } from '@/services/import';
import { formatMoneyShort } from '@/lib/format';
import type { RecordItem, RecordType } from '@/types';

const TYPE_LABEL: Record<RecordType, string> = { EXPENSE: '支出', INCOME: '收入', TRANSFER: '转账' };
/** 列表分页大小:一次只加载 20 条,滚动到底自动加载下一页 */
const PAGE_SIZE = 20;

/** 判断第一页内容是否变化(静默刷新时避免无谓替换打断滚动位置) */
function samePage(a: RecordItem[], b: RecordItem[]): boolean {
  return a.length === b.length && a.every((x, i) => x.id === b[i].id);
}

// 流水管理:单行汇总条 + 高级筛选抽屉(FilterSheet) + 活跃条件胶囊 + 左滑克隆/删除 + 下拉刷新
// 列表走后端分页(20 条/页);记一笔/编辑保存后由 RecordModal 触发静默重拉第一页
export default function RecordsScreen() {
  const { colors } = useTheme();
  const { openRecord, currentLedger } = useUIShell();
  const bookId = currentLedger.id;
  const { summary, accounts, categories, refresh, cloneRecord, deleteRecord } = useRecords();
  // 刷新时机:切到本页时(isFocused)检查筛选签名 —— 条件变化才重新加载,同条件回切走静默刷新(无感知延迟)
  const isFocused = useIsFocused();
  const [filters, setFilters] = useState<RecordFilters>(emptyFilters);
  const [filterOpen, setFilterOpen] = useState(false);
  const [dedupOpen, setDedupOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [exportSheetOpen, setExportSheetOpen] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  // ---- 后端分页列表 ----
  const [items, setItems] = useState<RecordItem[]>([]);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [loading, setLoading] = useState(true);           // 首屏/筛选切换(阻塞列表)
  const [loadingMore, setLoadingMore] = useState(false);  // 触底加载下一页(列表底部转圈)

  // 后端查询条件(多选账户/分类后端仅支持单值,取唯一值传后端,其余客户端补过滤)
  const query = useMemo(() => {
    const singleAccount = filters.accountIds.length === 1 ? filters.accountIds[0] : undefined;
    const singleCategory = filters.categoryCodes.length === 1 ? filters.categoryCodes[0] : undefined;
    return {
      types: filters.types,
      dateFrom: filters.dateFrom || undefined,
      dateTo: filters.dateTo || undefined,
      amountFrom: filters.minAmount ? Number(filters.minAmount) : undefined,
      amountTo: filters.maxAmount ? Number(filters.maxAmount) : undefined,
      remark: filters.keyword.trim() || undefined,
      accountId: singleAccount,
      categoryCode: singleCategory,
    };
  }, [filters]);

  const filterKey = useMemo(() => JSON.stringify([bookId, query]), [bookId, query]);
  const loadedKeyRef = useRef('');

  const load = useCallback(async (opts?: { silent?: boolean }) => {
    if (!bookId) return;
    if (!opts?.silent) setLoading(true);
    try {
      const r = await fetchRecordsPaged(bookId, { page: 1, pageSize: PAGE_SIZE, ...query });
      // 静默刷新时内容未变则不动列表,保住滚动位置
      setItems((prev) => (opts?.silent && samePage(prev, r.records) ? prev : r.records));
      setPage(1);
      setTotalPages(Math.max(1, Math.ceil(r.total / PAGE_SIZE)));
      loadedKeyRef.current = filterKey;
    } finally {
      if (!opts?.silent) setLoading(false);
    }
  }, [bookId, query, filterKey]);

  useEffect(() => {
    if (!isFocused || !bookId) return;
    // 筛选/账本变化 → 带全屏 loading 重新加载;同条件回切页面 → 静默刷新第一页(导入/跨页变更也能及时同步)
    if (loadedKeyRef.current !== filterKey) load();
    else load({ silent: true });
  }, [isFocused, bookId, filterKey, load]);

  const loadMore = useCallback(() => {
    if (!bookId || loading || loadingMore || page >= totalPages) return;
    setLoadingMore(true);
    fetchRecordsPaged(bookId, { page: page + 1, pageSize: PAGE_SIZE, ...query })
      .then((r) => {
        setItems((prev) => [...prev, ...r.records]);
        setPage((p) => p + 1);
        setTotalPages(Math.max(1, Math.ceil(r.total / PAGE_SIZE)));
      })
      .finally(() => setLoadingMore(false));
  }, [bookId, loading, loadingMore, page, totalPages, query]);

  // 记一笔/编辑保存后由 RecordModal 直接触发:静默重拉第一页
  const reloadPage = useCallback(() => {
    load({ silent: true });
  }, [load]);
  usePageRefresh(reloadPage);

  const onRefresh = async () => {
    setRefreshing(true);
    try {
      await refresh();
      if (bookId) await load({ silent: true });
    } finally {
      setRefreshing(false);
    }
  };

  // 多选账户/分类(超过一个时后端不支持)在客户端补过滤 + 按日分组(useMemo 避免每次渲染重算)
  // 注:多选条件下触底加载的页也可能被客户端过滤,极端情况页内条数会偏少,属既有取舍
  const { groups, dates } = useMemo(() => {
    const f = items.filter((r) => {
      if (filters.accountIds.length > 1 && !filters.accountIds.includes(r.accountId)) return false;
      if (filters.categoryCodes.length > 1 && !filters.categoryCodes.includes(r.categoryCode ?? '')) return false;
      return true;
    });
    const g = f.reduce<Record<string, RecordItem[]>>((acc, r) => {
      const day = r.date.slice(0, 10);
      (acc[day] ??= []).push(r);
      return acc;
    }, {});
    return { groups: g, dates: Object.keys(g).sort((a, b) => (a < b ? 1 : -1)) };
  }, [items, filters]);
  const activeCount = countActiveFilters(filters);
  const hasActiveFilter = activeCount > 0;

  const catLabelMap = useMemo(() => Object.fromEntries(categories.map((x) => [x.code, x.label])), [categories]);

  const onClone = (r: RecordItem) => {
    cloneRecord(r).then(() => load({ silent: true }));
    haptics.success();
  };
  // 删除需二次确认(自定义弹窗),确认后真正删除
  const [confirmRecord, setConfirmRecord] = useState<RecordItem | null>(null);
  const onDelete = (r: RecordItem) => setConfirmRecord(r);
  const onConfirmDelete = () => {
    if (!confirmRecord) return;
    deleteRecord(confirmRecord.id);
    // 本地即时移除(store 刷新由 deleteRecord 内部完成),无需整页重拉
    setItems((prev) => prev.filter((x) => x.id !== confirmRecord.id));
    haptics.warn();
    setConfirmRecord(null);
  };

  // 按当前筛选条件导出 CSV(与 web 一致:筛选即导出范围);方式由导出弹层选择
  const onExport = async (mode: ExportMode) => {
    if (!bookId || exporting) return;
    setExportSheetOpen(false);
    setExporting(true);
    haptics.tap();
    try {
      await exportRecordsCsv(
        {
          bookId,
          types: filters.types,
          accountIds: filters.accountIds,
          categoryCodes: filters.categoryCodes,
          dateFrom: filters.dateFrom || undefined,
          dateTo: filters.dateTo || undefined,
        },
        mode,
      );
      haptics.success();
    } catch (e: any) {
      Alert.alert('导出失败', e.message?.slice(0, 200) || '未知错误');
    } finally {
      setExporting(false);
    }
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

        {/* 汇总条:四项整合为一行,减少纵向空间占用 */}
        <FadeInView>
          <View style={{ flexDirection: 'row', backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border, borderRadius: 16, marginBottom: 16, overflow: 'hidden' }}>
            {summaryCards.map(({ label, value, icon: Icon, color }, i) => (
              <View
                key={label}
                style={{ flex: 1, alignItems: 'center', paddingVertical: 12, paddingHorizontal: 4, gap: 5, borderLeftWidth: i > 0 ? 1 : 0, borderLeftColor: colors.hairline }}
              >
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                  <Icon size={12} color={color} />
                  <Text variant="muted" style={{ fontSize: 10.5 }}>{label}</Text>
                </View>
                <Text style={{ fontSize: 14, fontWeight: '700', color, fontVariant: ['tabular-nums'] }} numberOfLines={1} adjustsFontSizeToFit>
                  {formatMoneyShort(value)}
                </Text>
              </View>
            ))}
          </View>
        </FadeInView>

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

          {/* 去重入口 */}
          <Pressable
            onPress={() => {
              setDedupOpen(true);
              haptics.tap();
            }}
            style={{ flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 14, paddingVertical: 7, borderRadius: 999, backgroundColor: colors.muted, borderWidth: 1, borderColor: colors.border }}
          >
            <CopyMinus size={13} color={colors.foreground} />
            <Text style={{ fontSize: 13, color: colors.foreground, fontWeight: '500' }}>去重</Text>
          </Pressable>

          {/* 导入入口 */}
          <Pressable
            onPress={() => {
              setImportOpen(true);
              haptics.tap();
            }}
            style={{ flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 14, paddingVertical: 7, borderRadius: 999, backgroundColor: colors.muted, borderWidth: 1, borderColor: colors.border }}
          >
            <FileUp size={13} color={colors.foreground} />
            <Text style={{ fontSize: 13, color: colors.foreground, fontWeight: '500' }}>导入</Text>
          </Pressable>

          {/* 导出入口 */}
          <Pressable
            onPress={() => {
              setExportSheetOpen(true);
              haptics.tap();
            }}
            disabled={exporting}
            style={{ flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 14, paddingVertical: 7, borderRadius: 999, backgroundColor: colors.muted, borderWidth: 1, borderColor: colors.border, opacity: exporting ? 0.5 : 1 }}
          >
            <Download size={13} color={colors.foreground} />
            <Text style={{ fontSize: 13, color: colors.foreground, fontWeight: '500' }}>{exporting ? '导出中...' : '导出'}</Text>
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

        {/* 列表虚拟化:按日期组分项,只渲染可视区,页面切换/长列表不再全量挂载拖慢首帧 */}
        {loading ? (
          <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
            <ActivityIndicator size="large" color={colors.primary} />
          </View>
        ) : (
          <FlatList
            data={dates}
            keyExtractor={(d) => d}
            renderItem={({ item: d, index }) => (
              <FadeInView index={index}>
                <Card className="px-5 py-4 mb-4">
                  <Text variant="muted" style={{ fontSize: 11, letterSpacing: 1, marginBottom: 12 }}>{d}</Text>
                  {groups[d].map((r, i) => (
                    <View key={r.id}>
                      <SwipeRow
                        actions={[
                          { key: 'clone', label: '克隆', color: colors.transfer, icon: Copy, onPress: () => onClone(r) },
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
            )}
            ListEmptyComponent={
              <EmptyState
                icon="🧾"
                title={hasActiveFilter ? '没有符合条件的流水' : '暂无流水'}
                description={hasActiveFilter ? '试试调整筛选条件' : '记下第一笔,开始管理家庭财务'}
                actionLabel={hasActiveFilter ? undefined : '记一笔'}
                onAction={hasActiveFilter ? undefined : () => openRecord()}
              />
            }
            ListFooterComponent={
              loadingMore ? (
                <View style={{ paddingVertical: 16, alignItems: 'center' }}>
                  <ActivityIndicator size="small" color={colors.primary} />
                </View>
              ) : items.length > 0 && page >= totalPages ? (
                <Text variant="muted" style={{ fontSize: 11, textAlign: 'center', paddingVertical: 14 }}>已加载全部</Text>
              ) : null
            }
            onEndReached={loadMore}
            onEndReachedThreshold={0.4}
            contentContainerStyle={{ paddingBottom: 40, flexGrow: 1 }}
            showsVerticalScrollIndicator={false}
            initialNumToRender={6}
            maxToRenderPerBatch={6}
            windowSize={7}
            refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} colors={[colors.primary]} />}
          />
        )}
      </View>

      {/* 删除二次确认(自定义弹窗,替代系统 Alert) */}
      <ConfirmSheet
        visible={!!confirmRecord}
        title="删除流水"
        message="确定删除这笔流水吗?删除后不可恢复。"
        onConfirm={onConfirmDelete}
        onClose={() => setConfirmRecord(null)}
      />

      <FilterSheet visible={filterOpen} initial={filters} onApply={setFilters} onClose={() => setFilterOpen(false)} />
      {/* 导出方式选择:保存到设备(SAF,仅 Android)/系统分享 */}
      <FormSheet visible={exportSheetOpen} title="导出 CSV" onClose={() => setExportSheetOpen(false)}>
        {Platform.OS === 'android' ? (
          <Pressable
            onPress={() => onExport('save')}
            disabled={exporting}
            style={{ flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14, borderRadius: 14, borderWidth: 1.5, borderColor: colors.border, marginBottom: 10, opacity: exporting ? 0.5 : 1 }}
          >
            <Save size={20} color={colors.primary} />
            <View style={{ flex: 1 }}>
              <Text style={{ fontSize: 15, fontWeight: '600' }}>保存到设备</Text>
              <Text variant="muted" style={{ fontSize: 11, marginTop: 2 }}>选择文件夹后直接写入,再次导出免选择</Text>
            </View>
          </Pressable>
        ) : null}
        <Pressable
          onPress={() => onExport('share')}
          disabled={exporting}
          style={{ flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14, borderRadius: 14, borderWidth: 1.5, borderColor: colors.border, opacity: exporting ? 0.5 : 1 }}
        >
          <Share2 size={20} color={colors.primary} />
          <View style={{ flex: 1 }}>
            <Text style={{ fontSize: 15, fontWeight: '600' }}>系统分享</Text>
            <Text variant="muted" style={{ fontSize: 11, marginTop: 2 }}>调起分享面板,发送或保存到任意位置</Text>
          </View>
        </Pressable>
      </FormSheet>
      {bookId ? <DedupSheet visible={dedupOpen} onClose={() => setDedupOpen(false)} bookId={bookId} /> : null}
      {bookId ? (
        <ImportSheet
          visible={importOpen}
          onClose={() => setImportOpen(false)}
          bookId={bookId}
          dictCodes={categories.map((c) => ({ code: c.code, label: c.label, group: c.type === 'EXPENSE' ? 'transaction_category_expense' : c.type === 'INCOME' ? 'transaction_category_income' : 'transaction_category_transfer' }))}
        />
      ) : null}
    </Screen>
  );
}

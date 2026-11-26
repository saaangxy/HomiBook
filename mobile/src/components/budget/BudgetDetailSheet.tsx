import { useCallback, useEffect, useMemo, useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { useTheme, alpha } from '@/theme';
import { Text } from '@/components/ui/Text';
import { FormSheet } from '@/components/chrome/FormSheet';
import { LoadingState } from '@/components/ui/LoadingState';
import {
  fetchRecordsPaged,
  fetchGroupSummary,
  fetchCategoryTrend,
  type GroupSummaryItem,
} from '@/services/records';
import { useRecords } from '@/stores/records';
import type { BudgetItem, RecordItem } from '@/types';
import { BUDGET_TYPE_LABELS } from '@homibook/core';

interface Props {
  budget: BudgetItem | null;
  bookId: string;
  onClose: () => void;
}

const PAGE_SIZE = 20;

function pad2(n: number) {
  return String(n).padStart(2, '0');
}

// 预算明细弹窗:记录明细 + 分类分布 + 支出趋势(与 Web 端预算详情口径一致)
export function BudgetDetailSheet({ budget, bookId, onClose }: Props) {
  const { colors } = useTheme();
  const { categories } = useRecords();
  const visible = budget !== null;

  const [tab, setTab] = useState<'records' | 'stats'>('records');
  const [records, setRecords] = useState<RecordItem[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [recordsLoading, setRecordsLoading] = useState(false);
  const [group, setGroup] = useState<GroupSummaryItem[]>([]);
  const [trend, setTrend] = useState<{ periods: string[]; categories: { name: string; data: number[] }[] }>({ periods: [], categories: [] });
  const [statsLoading, setStatsLoading] = useState(false);

  // 预算 → 流水筛选条件（周期/分类/项目/成员，与统计口径一致）
  const filters = useMemo(() => {
    if (!budget) return null;
    const category = budget.categoryCode
      ? categories.find((c) => c.code === budget.categoryCode)
      : undefined;
    const type = category?.type === 'INCOME' ? 'INCOME' : 'EXPENSE';

    let dateFrom: string | undefined;
    let dateTo: string | undefined;
    if (budget.type === 'FIXED' && budget.month) {
      const lastDay = new Date(budget.year, budget.month, 0).getDate();
      dateFrom = `${budget.year}-${pad2(budget.month)}-01`;
      dateTo = `${budget.year}-${pad2(budget.month)}-${pad2(lastDay)}`;
    } else {
      dateFrom = budget.startDate ? budget.startDate.slice(0, 10) : undefined;
      dateTo = budget.endDate ? budget.endDate.slice(0, 10) : undefined;
    }

    return {
      type,
      categoryCode: budget.categoryCode ?? undefined,
      tags: budget.tags?.length ? budget.tags.join(',') : undefined,
      ownerId: budget.ownerId ?? undefined,
      dateFrom,
      dateTo,
    };
  }, [budget, categories]);

  const loadRecords = useCallback(async (targetPage: number) => {
    if (!budget || !filters) return;
    setRecordsLoading(true);
    try {
      const res = await fetchRecordsPaged(bookId, { ...filters, types: [filters.type], page: targetPage, pageSize: PAGE_SIZE });
      setRecords(res.records);
      setTotal(res.total);
      setPage(targetPage);
    } finally {
      setRecordsLoading(false);
    }
  }, [budget, filters, bookId]);

  const loadStats = useCallback(async () => {
    if (!budget || !filters) return;
    setStatsLoading(true);
    try {
      const days = filters.dateFrom && filters.dateTo
        ? (new Date(filters.dateTo).getTime() - new Date(filters.dateFrom).getTime()) / 86400000
        : 0;
      const granularity = days > 62 ? 'monthly' as const : 'daily' as const;
      const [groups, trendData] = await Promise.all([
        fetchGroupSummary(bookId, {
          type: filters.type,
          groupBy: 'category',
          dateFrom: filters.dateFrom,
          dateTo: filters.dateTo,
          categoryCode: filters.categoryCode,
          tags: filters.tags,
          ownerId: filters.ownerId,
        }),
        fetchCategoryTrend(bookId, {
          type: filters.type,
          granularity,
          dateFrom: filters.dateFrom,
          dateTo: filters.dateTo,
          categoryCode: filters.categoryCode,
          tags: filters.tags,
          ownerId: filters.ownerId,
        }),
      ]);
      setGroup(groups);
      setTrend(trendData);
    } finally {
      setStatsLoading(false);
    }
  }, [budget, filters, bookId]);

  useEffect(() => {
    if (!budget) return;
    setTab('records');
    setRecords([]);
    setTotal(0);
    setGroup([]);
    setTrend({ periods: [], categories: [] });
    loadRecords(1);
    loadStats();
  }, [budget, loadRecords, loadStats]);

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const amount = budget?.amount ?? 0;
  const actual = budget?.actualAmount ?? 0;
  const remaining = amount - actual;
  const percent = amount > 0 ? (actual / amount) * 100 : 0;

  const trendTotals = trend.periods.map((_, i) => trend.categories.reduce((s, c) => s + (c.data[i] ?? 0), 0));
  const trendMax = Math.max(...trendTotals, 1);
  const labelStep = Math.max(1, Math.ceil(trend.periods.length / 6));

  return (
    <FormSheet visible={visible} title={budget?.name ?? '预算明细'} onClose={onClose} scrollBody>
      {budget && filters && (
        <View style={{ gap: 12 }}>
          {/* 概要 */}
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <View style={{
              paddingHorizontal: 8, paddingVertical: 2, borderRadius: 6,
              backgroundColor: alpha(colors.primary, 0.12),
            }}>
              <Text style={{ fontSize: 11, fontWeight: '600', color: colors.primary }}>{BUDGET_TYPE_LABELS[budget.type]}</Text>
            </View>
            <Text style={{ flex: 1, fontSize: 12, color: colors.mutedForeground }} numberOfLines={1}>
              预算 ¥{amount.toLocaleString()} · 实际 ¥{actual.toLocaleString()}
            </Text>
            <Text style={{ fontSize: 12, fontWeight: '600', color: remaining < 0 ? colors.destructive : colors.income }}>
              {remaining < 0 ? `超支 ¥${Math.abs(remaining).toLocaleString()}` : `剩余 ¥${remaining.toLocaleString()}`}
            </Text>
          </View>

          <View style={{ height: 6, borderRadius: 3, backgroundColor: colors.muted, overflow: 'hidden' }}>
            <View style={{
              height: '100%', width: `${Math.min(percent, 100)}%`, borderRadius: 3,
              backgroundColor: percent > 100 ? colors.destructive : colors.primary,
            }} />
          </View>

          {/* Tabs */}
          <View style={{ flexDirection: 'row', backgroundColor: colors.muted, borderRadius: 10, padding: 3 }}>
            {([
              { key: 'records', label: '记录明细' },
              { key: 'stats', label: '统计图表' },
            ] as const).map((t) => (
              <Pressable
                key={t.key}
                onPress={() => setTab(t.key)}
                style={{
                  flex: 1, paddingVertical: 8, borderRadius: 8, alignItems: 'center',
                  backgroundColor: tab === t.key ? colors.card : 'transparent',
                }}
              >
                <Text style={{ fontSize: 13, fontWeight: tab === t.key ? '600' : '400', color: tab === t.key ? colors.foreground : colors.mutedForeground }}>
                  {t.label}
                </Text>
              </Pressable>
            ))}
          </View>

          {tab === 'records' ? (
            <View style={{ gap: 8 }}>
              {recordsLoading ? (
                <LoadingState />
              ) : records.length === 0 ? (
                <Text variant="muted" style={{ fontSize: 12.5, textAlign: 'center', paddingVertical: 24 }}>暂无匹配记录</Text>
              ) : (
                <>
                  {records.map((r) => (
                    <View key={r.id} style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: colors.hairline }}>
                      <View style={{ flex: 1, gap: 2 }}>
                        <Text style={{ fontSize: 13 }} numberOfLines={1}>
                          {r.categoryName || r.categoryCode || '未分类'}
                          {r.remark ? <Text variant="muted" style={{ fontSize: 12 }}>{` · ${r.remark}`}</Text> : null}
                        </Text>
                        <Text variant="muted" style={{ fontSize: 11 }}>
                          {r.date.slice(0, 10)}{r.ownerName ? ` · ${r.ownerName}` : ''}
                        </Text>
                      </View>
                      <Text style={{
                        fontSize: 13, fontWeight: '600', fontVariant: ['tabular-nums'],
                        color: r.type === 'INCOME' ? colors.income : colors.expense,
                      }}>
                        {r.type === 'INCOME' ? '+' : '-'}¥{r.amount.toLocaleString()}
                      </Text>
                    </View>
                  ))}

                  {totalPages > 1 && (
                    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 4 }}>
                      <Pressable disabled={page <= 1} onPress={() => loadRecords(page - 1)} style={{ opacity: page <= 1 ? 0.4 : 1, paddingVertical: 6, paddingHorizontal: 10 }}>
                        <Text style={{ fontSize: 12, color: colors.primary }}>‹ 上一页</Text>
                      </Pressable>
                      <Text variant="muted" style={{ fontSize: 11 }}>{page} / {totalPages}</Text>
                      <Pressable disabled={page >= totalPages} onPress={() => loadRecords(page + 1)} style={{ opacity: page >= totalPages ? 0.4 : 1, paddingVertical: 6, paddingHorizontal: 10 }}>
                        <Text style={{ fontSize: 12, color: colors.primary }}>下一页 ›</Text>
                      </Pressable>
                    </View>
                  )}
                </>
              )}
            </View>
          ) : (
            <View style={{ gap: 14 }}>
              {statsLoading ? (
                <LoadingState />
              ) : (
                <>
                  {/* 分类分布 */}
                  <View style={{ gap: 8 }}>
                    <Text style={{ fontSize: 13, fontWeight: '600' }}>分类分布</Text>
                    {group.length === 0 ? (
                      <Text variant="muted" style={{ fontSize: 12, textAlign: 'center', paddingVertical: 12 }}>暂无分类数据</Text>
                    ) : group.map((g) => {
                      const pct = actual > 0 ? (g.amount / actual) * 100 : 0;
                      return (
                        <View key={g.key} style={{ gap: 4 }}>
                          <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 8 }}>
                            <Text style={{ flex: 1, fontSize: 12 }} numberOfLines={1}>{g.label}</Text>
                            <Text variant="muted" style={{ fontSize: 11, fontVariant: ['tabular-nums'] }}>
                              ¥{g.amount.toLocaleString()} · {pct.toFixed(0)}%
                            </Text>
                          </View>
                          <View style={{ height: 6, borderRadius: 3, backgroundColor: colors.muted, overflow: 'hidden' }}>
                            <View style={{ height: '100%', width: `${Math.min(pct, 100)}%`, borderRadius: 3, backgroundColor: colors.primary }} />
                          </View>
                        </View>
                      );
                    })}
                  </View>

                  {/* 支出趋势 */}
                  <View style={{ gap: 8 }}>
                    <Text style={{ fontSize: 13, fontWeight: '600' }}>支出趋势</Text>
                    {trend.periods.length === 0 ? (
                      <Text variant="muted" style={{ fontSize: 12, textAlign: 'center', paddingVertical: 12 }}>暂无趋势数据</Text>
                    ) : (
                      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6, paddingVertical: 4 }}>
                        {trend.periods.map((period, i) => {
                          const value = trendTotals[i] ?? 0;
                          const h = Math.max(2, Math.round((value / trendMax) * 72));
                          return (
                            <View key={period} style={{ width: 26, alignItems: 'center', gap: 4 }}>
                              <Text variant="muted" style={{ fontSize: 9 }} numberOfLines={1}>{value > 0 ? Math.round(value) : ''}</Text>
                              <View style={{ height: 72, justifyContent: 'flex-end' }}>
                                <View style={{ width: 16, height: h, borderRadius: 3, backgroundColor: colors.primary }} />
                              </View>
                              <Text variant="muted" style={{ fontSize: 9 }} numberOfLines={1}>
                                {i % labelStep === 0 || i === trend.periods.length - 1 ? period.slice(5) : ''}
                              </Text>
                            </View>
                          );
                        })}
                      </ScrollView>
                    )}
                  </View>
                </>
              )}
            </View>
          )}
        </View>
      )}
    </FormSheet>
  );
}

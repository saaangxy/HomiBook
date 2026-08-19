import { useEffect, useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { ArrowUpRight, ArrowDownRight, ArrowLeftRight, Plus } from 'lucide-react-native';
import { useTheme } from '@/theme';
import { useUIShell } from '@/components/chrome/chrome';
import { Screen } from '@/components/Screen';
import { Card } from '@/components/ui/Card';
import { Text } from '@/components/ui/Text';
import { RecordRow } from '@/components/RecordRow';
import { AnimatedPressable } from '@/components/AnimatedPressable';
import { FadeInView } from '@/components/FadeInView';
import { fetchRecords, fetchCategories, fetchSummary } from '@/services/records';
import { formatMoney } from '@/lib/format';
import type { RecordItem, RecordSummary } from '@/types';

type Filter = '全部' | '收入' | '支出' | '转账';
const FILTERS: Filter[] = ['全部', '收入', '支出', '转账'];

const TYPE_OF: Record<Filter, string | null> = {
  全部: null,
  收入: 'INCOME',
  支出: 'EXPENSE',
  转账: 'TRANSFER',
};

// 流水管理:4 汇总卡(参考网页端) + 筛选胶囊 + 按日分组精致列表 + 记一笔 FAB
export default function RecordsScreen() {
  const { colors } = useTheme();
  const { openRecord } = useUIShell();
  const [records, setRecords] = useState<RecordItem[]>([]);
  const [summary, setSummary] = useState<RecordSummary | null>(null);
  const [catMap, setCatMap] = useState<Record<string, string>>({});
  const [filter, setFilter] = useState<Filter>('全部');

  useEffect(() => {
    fetchRecords().then(setRecords);
    fetchSummary().then(setSummary);
    fetchCategories().then((c) => setCatMap(Object.fromEntries(c.map((x) => [x.code, x.icon]))));
  }, []);

  const type = TYPE_OF[filter];
  const filtered = records.filter((r) => (type ? r.type === type : true));

  // 按日分组(由近及远)
  const groups = filtered.reduce<Record<string, RecordItem[]>>((acc, r) => {
    (acc[r.date] ??= []).push(r);
    return acc;
  }, {});
  const dates = Object.keys(groups).sort((a, b) => (a < b ? 1 : -1));

  const summaryCards = [
    { label: '总收入', value: summary?.income ?? 0, icon: ArrowUpRight, color: colors.income },
    { label: '总支出', value: summary?.expense ?? 0, icon: ArrowDownRight, color: colors.expense },
    { label: '转账总额', value: summary?.transfer ?? 0, icon: ArrowLeftRight, color: colors.transfer },
    { label: '净收入', value: summary?.netIncome ?? 0, icon: ArrowUpRight, color: (summary?.netIncome ?? 0) >= 0 ? colors.income : colors.expense },
  ] as const;

  return (
    <Screen>
      <View style={{ flex: 1, paddingHorizontal: 20, paddingTop: 8 }}>
        {/* 标题栏 */}
        <Text style={{ fontSize: 20, fontWeight: '700', marginBottom: 14 }}>流水管理</Text>

        {/* 汇总卡片 2x2 */}
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', rowGap: 10, marginBottom: 16 }}>
          {summaryCards.map(({ label, value, icon: Icon, color }) => (
            <FadeInView key={label} index={0} style={{ width: '48%' }}>
              <View style={{ padding: 14, borderRadius: 18, flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border }}>
                <View style={{ width: 36, height: 36, borderRadius: 11, alignItems: 'center', justifyContent: 'center', backgroundColor: `${color}1f` }}>
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

        {/* 筛选胶囊 + 记一笔 */}
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={{ gap: 8, paddingBottom: 12, alignItems: 'center' }}
        >
          {FILTERS.map((f) => {
            const active = filter === f;
            return (
              <Pressable
                key={f}
                onPress={() => setFilter(f)}
                style={{
                  paddingHorizontal: 16,
                  paddingVertical: 7,
                  borderRadius: 999,
                  backgroundColor: active ? colors.primary : colors.muted,
                  borderWidth: 1,
                  borderColor: active ? colors.primary : colors.border,
                }}
              >
                <Text style={{ fontSize: 13, color: active ? '#fff' : colors.foreground, fontWeight: active ? '600' : '400' }}>{f}</Text>
              </Pressable>
            );
          })}
          <Pressable
            onPress={openRecord}
            style={{ flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 16, paddingVertical: 7, borderRadius: 999, backgroundColor: 'rgba(249,115,22,0.12)', borderWidth: 1, borderColor: 'rgba(249,115,22,0.3)' }}
          >
            <Plus size={14} color={colors.primary} />
            <Text style={{ fontSize: 13, color: colors.primary, fontWeight: '600' }}>记一笔</Text>
          </Pressable>
        </ScrollView>

        <ScrollView contentContainerStyle={{ paddingBottom: 40 }} showsVerticalScrollIndicator={false}>
          {dates.length === 0 ? (
            <Card className="items-center py-12"><Text variant="muted">暂无流水</Text></Card>
          ) : (
            dates.map((d, gi) => (
              <FadeInView key={d} index={gi}>
                <Card className="px-5 py-4 mb-4">
                  <Text variant="muted" style={{ fontSize: 11, letterSpacing: 1, marginBottom: 12 }}>{d}</Text>
                  {groups[d].map((r, i) => (
                    <View key={r.id}>
                      <RecordRow record={r} icon={catMap[r.categoryCode ?? '']} showDivider={i < groups[d].length - 1} />
                      {i < groups[d].length - 1 && <View style={{ height: 14 }} />}
                    </View>
                  ))}
                </Card>
              </FadeInView>
            ))
          )}
        </ScrollView>
      </View>

      {/* 记一笔 FAB */}
      <AnimatedPressable
        onPress={openRecord}
        style={{ position: 'absolute', right: 20, bottom: 28, width: 58, height: 58, borderRadius: 29, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.primary, shadowColor: '#f97316', shadowOpacity: 0.4, shadowRadius: 12, shadowOffset: { width: 0, height: 6 }, elevation: 8 }}
      >
        <Plus size={26} color="#fff" />
      </AnimatedPressable>
    </Screen>
  );
}
import { useEffect, useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { useRouter } from 'expo-router';
import { Plus, ChevronDown, SlidersHorizontal } from 'lucide-react-native';
import { useTheme } from '@/theme';
import { Screen } from '@/components/Screen';
import { Card } from '@/components/ui/Card';
import { Text } from '@/components/ui/Text';
import { RecordRow } from '@/components/RecordRow';
import { FadeInView } from '@/components/FadeInView';
import { AnimatedPressable } from '@/components/AnimatedPressable';
import { fetchRecords, fetchCategories } from '@/services/records';
import { formatMoney } from '@/lib/format';
import type { RecordItem } from '@/types';

type Filter = '全部' | '支出' | '收入';

export default function RecordsScreen() {
  const { colors } = useTheme();
  const router = useRouter();
  const [records, setRecords] = useState<RecordItem[]>([]);
  const [catMap, setCatMap] = useState<Record<string, string>>({});
  const [filter, setFilter] = useState<Filter>('全部');

  useEffect(() => {
    fetchRecords().then(setRecords);
    fetchCategories().then((c) => setCatMap(Object.fromEntries(c.map((x) => [x.code, x.icon]))));
  }, []);

  const filtered = records.filter((r) => (filter === '全部' ? true : filter === '收入' ? r.type === 'INCOME' : r.type === 'EXPENSE'));
  const monthExpense = records.filter((r) => r.type === 'EXPENSE').reduce((s, r) => s + r.amount, 0);

  const FILTERS: Filter[] = ['全部', '支出', '收入'];

  return (
    <Screen>
      <View className="flex-1">
        {/* 头部 */}
        <View className="px-5 pt-3 pb-2">
          <View className="flex-row items-center justify-between mb-3">
            <Text variant="title" style={{ fontSize: 22 }}>流水</Text>
            <Pressable onPress={() => router.push('/add-record')} className="flex-row items-center gap-1 rounded-full px-3 py-1.5" style={{ backgroundColor: colors.primary }}>
              <Plus size={16} color={colors.primaryForeground} />
              <Text style={{ color: colors.primaryForeground, fontSize: 13, fontWeight: '600' }}>记一笔</Text>
            </Pressable>
          </View>

          {/* 月份 + 筛选 */}
          <View className="flex-row items-center gap-2 mb-3">
            <Pressable className="flex-row items-center gap-1 rounded-full px-3 py-1.5" style={{ backgroundColor: colors.muted }}>
              <Text variant="muted" style={{ fontSize: 13 }}>2026年8月</Text>
              <ChevronDown size={14} color={colors.mutedForeground} />
            </Pressable>
            <View className="flex-1" />
            <Pressable className="w-9 h-9 rounded-full items-center justify-center" style={{ backgroundColor: colors.muted }}>
              <SlidersHorizontal size={16} color={colors.mutedForeground} />
            </Pressable>
          </View>

          {/* 类型筛选 */}
          <View className="flex-row gap-2">
            {FILTERS.map((f) => {
              const active = filter === f;
              return (
                <Pressable
                  key={f}
                  className="px-4 py-1.5 rounded-full"
                  style={{ backgroundColor: active ? colors.primary : colors.muted }}
                  onPress={() => setFilter(f)}
                >
                  <Text style={{ color: active ? colors.primaryForeground : colors.mutedForeground, fontSize: 13, fontWeight: active ? '600' : '400' }}>
                    {f}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </View>

        {/* 列表 */}
        <ScrollView contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 90 }} showsVerticalScrollIndicator={false}>
          <Card className="p-4 mb-4" style={{ backgroundColor: colors.cardMuted, borderColor: 'transparent' }}>
            <View className="flex-row justify-between">
              <Text variant="muted" style={{ fontSize: 13 }}>本月支出合计</Text>
              <Text variant="expense" style={{ fontSize: 15, fontWeight: '700', fontVariant: ['tabular-nums'] }}>{formatMoney(monthExpense)}</Text>
            </View>
          </Card>

          {filtered.map((r, i) => (
            <FadeInView key={r.id} index={Math.min(i, 8)}>
              <Card className="p-4 mb-3">
                <RecordRow record={r} icon={catMap[r.categoryCode ?? '']} />
              </Card>
            </FadeInView>
          ))}
          {filtered.length === 0 && (
            <View className="items-center py-12"><Text variant="muted">暂无流水</Text></View>
          )}
        </ScrollView>
      </View>

      {/* FAB */}
      <AnimatedPressable
        onPress={() => router.push('/add-record')}
        className="absolute bottom-6 right-5 w-14 h-14 rounded-full items-center justify-center shadow-lg"
        style={{ backgroundColor: colors.primary, shadowColor: colors.primary, shadowOpacity: 0.4, shadowRadius: 10, shadowOffset: { width: 0, height: 4 }, elevation: 6 }}
      >
        <Plus size={26} color={colors.primaryForeground} />
      </AnimatedPressable>
    </Screen>
  );
}
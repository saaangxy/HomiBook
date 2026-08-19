import { useEffect, useMemo, useState } from 'react';
import { Pressable, View } from 'react-native';
import Svg, { Polyline, Line, Text as SvgText } from 'react-native-svg';
import { LinearGradient } from 'expo-linear-gradient';
import { useTheme } from '@/theme';
import { Screen } from '@/components/Screen';
import { Card } from '@/components/ui/Card';
import { Text } from '@/components/ui/Text';
import { RadarChart } from '@/components/RadarChart';
import { FadeInView } from '@/components/FadeInView';
import { fetchRadar, fetchMonthlyTrend, fetchSummary, fetchRecords } from '@/services/records';
import { formatMoney, formatMoneyShort } from '@/lib/format';
import type { RadarMetric, RecordItem, RecordSummary } from '@/types';

type Range = '月' | '年';

// 统计:2x2 汇总卡(参考网页端) + 收支总览渐变 + 月度收支趋势 + 分类支出占比 + 财务健康雷达
export default function StatsScreen() {
  const { colors } = useTheme();
  const [range, setRange] = useState<Range>('月');
  const [radar, setRadar] = useState<RadarMetric[]>([]);
  const [summary, setSummary] = useState<RecordSummary | null>(null);
  const [records, setRecords] = useState<RecordItem[]>([]);
  const [trend, setTrend] = useState<{ months: string[]; income: number[]; expense: number[] } | null>(null);

  useEffect(() => {
    fetchRadar().then(setRadar);
    fetchSummary().then(setSummary);
    fetchRecords().then(setRecords);
    fetchMonthlyTrend().then(setTrend);
  }, []);

  // 分类支出占比(支出全部按分类聚合)
  const catExpense = useMemo(() => {
    const map = new Map<string, number>();
    for (const r of records) if (r.type === 'EXPENSE') map.set(r.categoryName ?? '未分类', (map.get(r.categoryName ?? '未分类') ?? 0) + r.amount);
    return Array.from(map.entries()).sort((a, b) => b[1] - a[1]);
  }, [records]);
  const catTotal = catExpense.reduce((s, [, v]) => s + v, 0);

  const summaryCards = [
    { label: '总收入', value: summary?.income ?? 0, color: colors.income },
    { label: '总支出', value: summary?.expense ?? 0, color: colors.expense },
    { label: '净收入', value: summary?.netIncome ?? 0, color: (summary?.netIncome ?? 0) >= 0 ? colors.income : colors.expense },
    { label: '转账总额', value: summary?.transfer ?? 0, color: colors.transfer },
  ];

  const W = 300;
  const H = 150;
  const PAD = 22;
  const max = trend ? Math.max(...trend.income, ...trend.expense, 1) : 1;
  const pts = (data: number[]) =>
    data.map((v, i) => [PAD + (i * (W - PAD * 2)) / (data.length - 1), H - PAD - (v / max) * (H - PAD * 2)] as const);

  return (
    <Screen scroll>
      <View className="px-5 pt-4">
        {/* 标题 + 月/年切换 */}
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
          <Text style={{ fontSize: 20, fontWeight: '700' }}>统计</Text>
          <View style={{ flexDirection: 'row', backgroundColor: colors.muted, borderRadius: 999, padding: 3 }}>
            {(['月', '年'] as Range[]).map((r) => {
              const active = range === r;
              return (
                <Pressable
                  key={r}
                  onPress={() => setRange(r)}
                  style={{ paddingHorizontal: 18, paddingVertical: 5, borderRadius: 999, backgroundColor: active ? colors.primary : 'transparent' }}
                >
                  <Text style={{ fontSize: 13, fontWeight: active ? '700' : '400', color: active ? '#fff' : colors.mutedForeground }}>{r}</Text>
                </Pressable>
              );
            })}
          </View>
        </View>

        {/* 2x2 汇总卡 */}
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', rowGap: 10, marginBottom: 16 }}>
          {summaryCards.map(({ label, value, color }, gi) => (
            <FadeInView key={label} index={gi} style={{ width: '48%', padding: 16, borderRadius: 18, alignItems: 'center', backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border }}>
              <Text variant="muted" style={{ fontSize: 11, marginBottom: 4 }}>{label}</Text>
              <Text style={{ fontSize: 18, fontWeight: '700', color, fontVariant: ['tabular-nums'] }}>{formatMoney(value)}</Text>
            </FadeInView>
          ))}
        </View>

        {/* 结余(橙渐变) */}
        <FadeInView index={4}>
          <LinearGradient
            colors={['#fb923c', '#f97316', '#ea580c']}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={{ borderRadius: 20, padding: 20, marginBottom: 16, shadowColor: '#f97316', shadowOpacity: 0.3, shadowRadius: 16, shadowOffset: { width: 0, height: 8 }, elevation: 6 }}
          >
            <Text style={{ color: 'rgba(255,255,255,0.85)', fontSize: 12 }}>{range === '月' ? '本月结余' : '本年度结余'}</Text>
            <Text style={{ color: '#fff', fontSize: 30, fontWeight: '700', letterSpacing: -0.5, fontVariant: ['tabular-nums'], marginTop: 4 }}>
              {formatMoneyShort(summary?.netIncome ?? 0)}
            </Text>
            <Text style={{ color: 'rgba(255,255,255,0.6)', fontSize: 12, marginTop: 8, fontVariant: ['tabular-nums'] }}>
              收入 {formatMoneyShort(summary?.income ?? 0)} · 支出 {formatMoneyShort(summary?.expense ?? 0)}
            </Text>
          </LinearGradient>
        </FadeInView>

        {/* 月度收支趋势 */}
        <FadeInView index={5}>
          <Card className="px-5 py-5 mb-4">
            <Text variant="label">月度收支趋势</Text>
            {trend && (
              <Svg width={W} height={H} style={{ marginTop: 8 }}>
                {[0.25, 0.5, 0.75, 1].map((t) => (
                  <Line key={t} x1={PAD} x2={W - PAD} y1={H - PAD - t * (H - PAD * 2)} y2={H - PAD - t * (H - PAD * 2)} stroke={colors.hairline} strokeWidth={1} />
                ))}
                <Polyline points={pts(trend.income).map((p) => p.join(',')).join(' ')} fill="none" stroke={colors.income} strokeWidth={2} />
                <Polyline points={pts(trend.expense).map((p) => p.join(',')).join(' ')} fill="none" stroke={colors.expense} strokeWidth={2} />
                {trend.months.map((m, i) => (
                  <SvgText key={m} x={PAD + (i * (W - PAD * 2)) / (trend.months.length - 1)} y={H - 4} fontSize={8} fill={colors.mutedForeground} textAnchor="middle">
                    {m}
                  </SvgText>
                ))}
              </Svg>
            )}
            <View style={{ flexDirection: 'row', gap: 16, marginTop: 6 }}>
              <LegendDot color={colors.income} label="收入" />
              <LegendDot color={colors.expense} label="支出" />
            </View>
          </Card>
        </FadeInView>

        {/* 分类支出占比 */}
        <FadeInView index={6}>
          <Card className="px-5 py-5 mb-4">
            <Text variant="label">分类支出占比</Text>
            {catExpense.map(([name, v], i) => {
              const pct = catTotal ? Math.round((v / catTotal) * 100) : 0;
              return (
                <View key={name} style={{ marginTop: i === 0 ? 8 : 14 }}>
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 5 }}>
                    <Text style={{ fontSize: 13 }}>{name}</Text>
                    <Text variant="muted" style={{ fontSize: 12, fontVariant: ['tabular-nums'] }}>{pct}% · {formatMoneyShort(v)}</Text>
                  </View>
                  <View style={{ height: 6, borderRadius: 3, backgroundColor: colors.muted, overflow: 'hidden' }}>
                    <View style={{ width: `${pct}%`, height: '100%', backgroundColor: colors.primary, borderRadius: 3 }} />
                  </View>
                </View>
              );
            })}
          </Card>
        </FadeInView>

        {/* 财务健康雷达 */}
        <FadeInView index={7}>
          <Card className="px-5 py-5 mb-8">
            <Text variant="label">财务健康</Text>
            <RadarChart metrics={radar} />
          </Card>
        </FadeInView>
      </View>
    </Screen>
  );
}

function LegendDot({ color, label }: { color: string; label: string }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
      <View style={{ width: 10, height: 4, borderRadius: 2, backgroundColor: color }} />
      <Text variant="muted" style={{ fontSize: 11 }}>{label}</Text>
    </View>
  );
}
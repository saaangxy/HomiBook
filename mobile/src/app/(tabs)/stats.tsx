import { useEffect, useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { TrendingUp, Wallet, Target } from 'lucide-react-native';
import Svg, { Polyline, Line, Text as SvgText } from 'react-native-svg';
import { useTheme } from '@/theme';
import { Screen } from '@/components/Screen';
import { Card } from '@/components/ui/Card';
import { Text } from '@/components/ui/Text';
import { RadarChart } from '@/components/RadarChart';
import { FadeInView } from '@/components/FadeInView';
import { fetchRadar, fetchMonthlyTrend, fetchSummary } from '@/services/records';
import { formatMoneyShort } from '@/lib/format';
import type { RadarMetric, RecordSummary } from '@/types';

type Range = '月' | '年';

export default function StatsScreen() {
  const { colors } = useTheme();
  const [range, setRange] = useState<Range>('月');
  const [radar, setRadar] = useState<RadarMetric[]>([]);
  const [summary, setSummary] = useState<RecordSummary | null>(null);
  const [trend, setTrend] = useState<{ months: string[]; income: number[]; expense: number[] } | null>(null);

  useEffect(() => {
    fetchRadar().then(setRadar);
    fetchSummary().then(setSummary);
    fetchMonthlyTrend().then(setTrend);
  }, []);

  // 折线图坐标
  const W = 300;
  const H = 140;
  const PAD = 20;
  const max = trend ? Math.max(...trend.income, ...trend.expense) : 1;
  const pts = (data: number[]) =>
    data.map((v, i) => [PAD + (i * (W - PAD * 2)) / (data.length - 1), H - PAD - (v / max) * (H - PAD * 2)] as const);

  return (
    <Screen scroll>
      <View className="px-5 pt-3 flex-1">
        <View className="flex-row items-center justify-between mb-4">
          <Text variant="title" style={{ fontSize: 22 }}>统计</Text>
          <View className="flex-row rounded-full p-1" style={{ backgroundColor: colors.muted }}>
            {(['月', '年'] as Range[]).map((r) => (
              <Pressable key={r} className="px-4 py-1.5 rounded-full" style={{ backgroundColor: range === r ? colors.primary : 'transparent' }} onPress={() => setRange(r)}>
                <Text style={{ color: range === r ? colors.primaryForeground : colors.mutedForeground, fontSize: 13, fontWeight: '600' }}>{r}</Text>
              </Pressable>
            ))}
          </View>
        </View>

        {/* 汇总卡 */}
        <FadeInView>
          <View className="flex-row gap-3 mb-5">
            {[
              { label: '收入', value: summary?.income ?? 0, color: colors.income, icon: Wallet },
              { label: '支出', value: summary?.expense ?? 0, color: colors.expense, icon: TrendingUp },
              { label: '结余', value: summary?.netIncome ?? 0, color: colors.primary, icon: Target },
            ].map((c) => (
              <Card key={c.label} className="flex-1 p-4">
                <View className="flex-row items-center gap-1.5 mb-2">
                  <c.icon size={14} color={c.color} />
                  <Text variant="muted" style={{ fontSize: 12 }}>{c.label}</Text>
                </View>
                <Text style={{ color: c.color, fontSize: 16, fontWeight: '700', fontVariant: ['tabular-nums'] }}>
                  {formatMoneyShort(c.value)}
                </Text>
              </Card>
            ))}
          </View>
        </FadeInView>

        {/* 收支趋势 */}
        <FadeInView index={1}>
          <Card className="p-4 mb-5">
            <Text variant="bold" style={{ fontSize: 15, marginBottom: 12 }}>收支趋势</Text>
            {trend && (
              <Svg width={W} height={H}>
                {[0.25, 0.5, 0.75, 1].map((t) => (
                  <Line key={t} x1={PAD} x2={W - PAD} y1={H - PAD - t * (H - PAD * 2)} y2={H - PAD - t * (H - PAD * 2)} stroke={colors.border} strokeWidth={1} />
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
          </Card>
        </FadeInView>

        {/* 财务健康雷达 */}
        <FadeInView index={2}>
          <Card className="p-4 mb-6">
            <Text variant="bold" style={{ fontSize: 15, marginBottom: 8 }}>财务健康评估</Text>
            <RadarChart metrics={radar} />
          </Card>
        </FadeInView>
      </View>
    </Screen>
  );
}
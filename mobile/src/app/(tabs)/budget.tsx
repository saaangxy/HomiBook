import { useEffect, useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { ChevronLeft, ChevronRight } from 'lucide-react-native';
import { useTheme } from '@/theme';
import { Screen } from '@/components/Screen';
import { Card } from '@/components/ui/Card';
import { Text } from '@/components/ui/Text';
import { FadeInView } from '@/components/FadeInView';
import { fetchBudgets } from '@/services/records';
import { formatMoney } from '@/lib/format';
import type { BudgetItem } from '@/types';

// 使用率进度条:按阈值着色(参考网页端 >100 红 / >80 橙 / >60 黄 / 其余绿)
function usageColor(percent: number, colors: ReturnType<typeof useTheme>['colors']) {
  if (percent > 100) return colors.expense;
  if (percent > 80) return colors.primary;
  if (percent > 60) return '#eab308';
  return colors.income;
}

// 预算管理:汇总 4 卡(参考网页端) + 月份切换 + 逐分类预算卡(使用进度条/剩余/超支)
export default function BudgetScreen() {
  const { colors } = useTheme();
  const [budgets, setBudgets] = useState<BudgetItem[]>([]);
  const [year, setYear] = useState(2026);
  const [month, setMonth] = useState(8);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    fetchBudgets().then(setBudgets);
  }, []);

  // 按月筛选
  const visible = budgets.filter((b) => b.year === year && (b.month === month || b.month === null));
  const totalBudget = visible.reduce((s, b) => s + b.amount, 0);
  const totalUsed = visible.reduce((s, b) => s + b.actualAmount, 0);
  const remaining = totalBudget - totalUsed;
  const usage = totalBudget ? (totalUsed / totalBudget) * 100 : 0;

  const monthNav = (d: number) => {
    const next = new Date(year, month - 1 + d, 1);
    setYear(next.getFullYear());
    setMonth(next.getMonth() + 1);
  };

  const cards = [
    { label: `${month}月总预算`, value: formatMoney(totalBudget) },
    { label: '实际支出', value: formatMoney(totalUsed) },
    { label: '剩余预算', value: formatMoney(remaining), color: remaining < 0 ? colors.expense : colors.income },
    { label: '使用率', value: `${usage.toFixed(1)}%`, color: usage > 100 ? colors.expense : usage > 80 ? colors.primary : colors.income },
  ];

  return (
    <Screen>
      <View style={{ flex: 1, paddingHorizontal: 20, paddingTop: 8 }}>
        {/* 标题栏 */}
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
          <Text style={{ fontSize: 20, fontWeight: '700' }}>预算管理</Text>
          {/* 月份切换 */}
          <View style={{ flexDirection: 'row', gap: 4, alignItems: 'center' }}>
            <Pressable onPress={() => monthNav(-1)} style={{ width: 30, height: 30, borderRadius: 15, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.muted }}>
              <ChevronLeft size={15} color={colors.foreground} />
            </Pressable>
            <Text style={{ fontSize: 13, fontWeight: '600', minWidth: 46, textAlign: 'center' }}>{year}年{month}月</Text>
            <Pressable onPress={() => monthNav(1)} style={{ width: 30, height: 30, borderRadius: 15, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.muted }}>
              <ChevronRight size={15} color={colors.foreground} />
            </Pressable>
          </View>
        </View>

        {/* 汇总 2x2 */}
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', rowGap: 10, marginBottom: 16 }}>
          {cards.map((c, gi) => (
            <FadeInView key={c.label} index={gi} style={{ width: '48%', padding: 16, borderRadius: 18, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border }}>
              <Text variant="muted" style={{ fontSize: 11, marginBottom: 4 }}>{c.label}</Text>
              <Text style={{ fontSize: 20, fontWeight: '700', fontVariant: ['tabular-nums'], color: c.color ?? colors.foreground }} numberOfLines={1}>{c.value}</Text>
            </FadeInView>
          ))}
        </View>

        {/* 预算列表 */}
        <ScrollView contentContainerStyle={{ paddingBottom: 40 }} showsVerticalScrollIndicator={false}>
          <Text variant="muted" style={{ fontSize: 12, letterSpacing: 1, marginBottom: 10 }}>固定预算</Text>
          {visible.length === 0 ? (
            <Card className="items-center py-12">
              <Text style={{ fontSize: 30, marginBottom: 6 }}>🗓️</Text>
              <Text variant="muted">该月暂无预算</Text>
            </Card>
          ) : (
            visible.map((b, i) => {
              const pct = b.amount ? (b.actualAmount / b.amount) * 100 : 0;
              const rem = b.amount - b.actualAmount;
              const color = usageColor(pct, colors);
              return (
                <FadeInView key={b.id} index={i}>
                  <Card className="px-5 py-4 mb-3" onPress={() => setExpanded((v) => !v)}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                        <Text style={{ fontSize: 15, fontWeight: '600' }}>{b.name}</Text>
                        {b.categoryCode && (
                          <View style={{ paddingHorizontal: 8, paddingVertical: 2, borderRadius: 6, backgroundColor: `${colors.transfer}1f` }}>
                            <Text style={{ fontSize: 10, color: colors.transfer, fontWeight: '600' }}>{b.categoryCode}</Text>
                          </View>
                        )}
                      </View>
                      <Text style={{ fontSize: 15, fontWeight: '700', fontVariant: ['tabular-nums'] }}>¥{formatMoney(b.amount)}</Text>
                    </View>

                    {/* 使用进度条 */}
                    <View style={{ height: 8, borderRadius: 4, backgroundColor: colors.muted, marginTop: 12, overflow: 'hidden' }}>
                      <View style={{ width: `${Math.min(pct, 100)}%`, height: '100%', backgroundColor: color, borderRadius: 4 }} />
                    </View>
                    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 8 }}>
                      <Text style={{ fontSize: 12, color, fontWeight: '600', fontVariant: ['tabular-nums'] }}>
                        {rem < 0 ? `超支 ¥${formatMoney(Math.abs(rem))}` : `剩余 ¥${formatMoney(rem)}`}
                      </Text>
                      <Text variant="muted" style={{ fontSize: 12, fontVariant: ['tabular-nums'] }}>已用 {formatMoney(b.actualAmount)} · {pct.toFixed(1)}%</Text>
                    </View>
                  </Card>
                </FadeInView>
              );
            })
          )}

          <Text variant="muted" style={{ fontSize: 12, letterSpacing: 1, marginTop: 18, marginBottom: 10 }}>自由预算</Text>
          <Card className="items-center py-10">
            <Text style={{ fontSize: 30, marginBottom: 6 }}>🎯</Text>
            <Text variant="muted">暂无自由预算(设计示例)</Text>
          </Card>
        </ScrollView>
      </View>
    </Screen>
  );
}
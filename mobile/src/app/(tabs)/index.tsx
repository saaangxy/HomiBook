import { useCallback, useEffect, useMemo, useState } from 'react';
import { router } from 'expo-router';
import { Pressable, ScrollView, View, useWindowDimensions } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { ChevronRight } from 'lucide-react-native';
import { useTheme, alpha } from '@/theme';
import { useAuth } from '@/stores/auth';
import { Screen } from '@/components/Screen';
import { Card } from '@/components/ui/Card';
import { Text } from '@/components/ui/Text';
import { RecordRow } from '@/components/RecordRow';
import { FadeInView } from '@/components/FadeInView';
import { fetchBudgets, fetchMonthlyTrend } from '@/services/records';
import { useRecords } from '@/stores/records';
import { useUIShell } from '@/components/chrome/chrome';
import { formatMoney, formatMoneyShort } from '@/lib/format';
import type { BudgetItem } from '@/types';

type Period = '本月' | '当年';

// 首页:收支总览(品牌渐变) + 预算 + AI 助手 + 最近流水;数据消费 useRecords() 唯一数据源
export default function HomeScreen() {
  const { colors, palette } = useTheme();
  const { nickname } = useAuth();
  const { width } = useWindowDimensions();
  const [period, setPeriod] = useState<Period>('本月');
  const [activeIdx, setActiveIdx] = useState(0); // 收支总览当前页索引(圆点高亮,实时跟随滑动)
  const [budgets, setBudgets] = useState<BudgetItem[]>([]);
  const [budgetExp, setBudgetExp] = useState(false);
  const [yearIncome, setYearIncome] = useState(0);
  const [yearExpense, setYearExpense] = useState(0);
  const { records, summary, refresh } = useRecords();
  const { currentLedger, openAI } = useUIShell();
  const [refreshing, setRefreshing] = useState(false);

  // 下拉刷新:重拉 store(流水/账户/分类) + 预算 + 当年收支
  const onRefresh = useCallback(async () => {
    const bookId = currentLedger.id;
    setRefreshing(true);
    try {
      if (bookId) {
        await Promise.all([
          refresh(),
          fetchBudgets(bookId).then(setBudgets),
          fetchMonthlyTrend(bookId).then((t) => {
            setYearIncome(t.income.reduce((s, x) => s + x, 0));
            setYearExpense(t.expense.reduce((s, x) => s + x, 0));
          }),
        ]);
      } else {
        await refresh();
      }
    } finally {
      setRefreshing(false);
    }
  }, [refresh, currentLedger.id]);

  useEffect(() => {
    const bookId = currentLedger.id;
    if (!bookId) return;
    fetchBudgets(bookId).then(setBudgets);
    // 当年收支:由月度趋势累计
    fetchMonthlyTrend(bookId).then((t) => {
      setYearIncome(t.income.reduce((s, x) => s + x, 0));
      setYearExpense(t.expense.reduce((s, x) => s + x, 0));
    });
  }, [currentLedger.id]);
  const recent = records.slice(0, 4);

  // 本月预算项:当年当月 + 年度预算(month:null,与预算管理页当月视图口径一致)
  const now = new Date();
  const monthlyBudgets = useMemo(
    () => budgets.filter((b) => b.year === now.getFullYear() && (b.month === now.getMonth() + 1 || b.month === null)),
    [budgets], // eslint-disable-line react-hooks/exhaustive-deps
  );
  const totalBudget = monthlyBudgets.reduce((s, b) => s + b.amount, 0);
  const totalUsed = monthlyBudgets.reduce((s, b) => s + b.actualAmount, 0);
  const pct = totalBudget ? Math.min(100, Math.round((totalUsed / totalBudget) * 100)) : 0;

  const income = summary.income;
  const expense = summary.expense;

  // AI 助手卡片洞察:基于本月真实数据生成(预算进度优先,否则最高支出分类)
  const insight = useMemo(() => {
    if (totalBudget > 0) {
      if (totalUsed <= 0) return '本月预算尚无消耗，记一笔开始吧';
      return pct >= 100
        ? `本月预算已超支，已使用 ${formatMoney(totalUsed)}`
        : `本月预算已使用 ${pct}%（${formatMoney(totalUsed)}/${formatMoney(totalBudget)}）`;
    }
    const ym = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    const byCat = new Map<string, number>();
    for (const r of records) {
      if (r.type !== 'EXPENSE' || r.date.slice(0, 7) !== ym) continue;
      const key = r.categoryName ?? '未分类';
      byCat.set(key, (byCat.get(key) ?? 0) + r.amount);
    }
    const top = [...byCat.entries()].sort((a, b) => b[1] - a[1])[0];
    return top ? `本月「${top[0]}」支出最高，共 ${formatMoney(top[1])}` : '本月暂无支出记录，记一笔开始吧';
  }, [totalBudget, totalUsed, pct, records, now]);

  return (
    <Screen scroll refreshing={refreshing} onRefresh={onRefresh}>
      <View className="px-5 pt-4">
        {/* 问候 */}
        <FadeInView>
          <View className="flex-row items-center justify-between mb-5">
            <View>
              <Text variant="muted" style={{ fontSize: 13 }}>{period === '本月' ? '下午好' : '近况概览'}</Text>
              <Text style={{ fontSize: 22, fontWeight: '700' }}>{nickname || '朋友'} 👋</Text>
            </View>
          </View>
        </FadeInView>

        {/* 收支总览(品牌渐变,左右滑动切换月度/年度) */}
        <FadeInView index={1}>
          <ScrollView
            horizontal
            pagingEnabled
            showsHorizontalScrollIndicator={false}
            style={{ marginHorizontal: -20, backgroundColor: 'transparent' }}
            onScroll={(e) => {
              const idx = Math.round(e.nativeEvent.contentOffset.x / width);
              setActiveIdx(Math.max(0, Math.min(idx, 1)));
            }}
            scrollEventThrottle={16}
            onMomentumScrollEnd={(e) => {
              const idx = Math.round(e.nativeEvent.contentOffset.x / width);
              setActiveIdx(idx);
              setPeriod(idx >= 1 ? '当年' : '本月');
            }}
          >
            {([
              {
                key: '本月' as Period,
                label: '月度',
                income, expense,
                net: summary.netIncome,
              },
              {
                key: '当年' as Period,
                label: '年度',
                income: yearIncome,
                expense: yearExpense,
                net: yearIncome - yearExpense,
              },
            ]).map((d) => (
              <View key={d.key} style={{ width, paddingHorizontal: 20 }}>
                <LinearGradient
                  colors={palette.colors.gradient}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 1 }}
                  style={{ borderRadius: palette.radius.card, padding: 20, marginBottom: 16, shadowColor: colors.primary, shadowOpacity: 0.3, shadowRadius: 16, shadowOffset: { width: 0, height: 8 }, elevation: 6 }}
                >
                  {/* 标题 + 月度/年度 标签 */}
                  <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                    <Text style={{ color: '#fff', fontSize: 13, fontWeight: '600' }}>收支总览</Text>
                    <View style={{ paddingHorizontal: 10, paddingVertical: 3, borderRadius: 999, backgroundColor: 'rgba(255,255,255,0.2)' }}>
                      <Text style={{ color: '#fff', fontSize: 11, fontWeight: '600' }}>{d.label}</Text>
                    </View>
                  </View>

                  {/* 收入 / 支出 / 结余 */}
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: 18 }}>
                    {[
                      { label: '收入', value: formatMoneyShort(d.income), color: '#d1fae5' },
                      { label: '支出', value: formatMoneyShort(d.expense), color: '#fee2e2' },
                      { label: '结余', value: formatMoneyShort(d.net), color: '#ffffff' },
                    ].map((c) => (
                      <View key={c.label} style={{ flex: 1, alignItems: 'center' }}>
                        <Text style={{ color: 'rgba(255,255,255,0.8)', fontSize: 12, marginBottom: 4 }}>{c.label}</Text>
                        <Text style={{ color: c.color, fontSize: 18, fontWeight: '700', fontVariant: ['tabular-nums'] }}>{c.value}</Text>
                      </View>
                    ))}
                  </View>

                  {/* 指示点:卡片内底部居中,实时跟随当前页 */}
                  <View style={{ flexDirection: 'row', justifyContent: 'center', gap: 6, marginTop: 14 }}>
                    {[0, 1].map((i) => (
                      <View key={i} style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: activeIdx === i ? '#fff' : 'rgba(255,255,255,0.4)' }} />
                    ))}
                  </View>
                </LinearGradient>
              </View>
            ))}
          </ScrollView>
        </FadeInView>

        {/* 预算(当月无预算数据时不展示) */}
        {monthlyBudgets.length > 0 && (
          <FadeInView index={2}>
            <Card className="px-5 py-4 mb-4">
              {/* 点击头部展开/收起本月明细 */}
              <Pressable onPress={() => setBudgetExp((v) => !v)} style={{ gap: 2 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                  <View>
                    <Text variant="muted" style={{ fontSize: 12 }}>本月总预算</Text>
                    <Text style={{ fontSize: 22, fontWeight: '700', fontVariant: ['tabular-nums'], marginTop: 2 }}>{formatMoney(totalBudget)}</Text>
                  </View>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                    <Text style={{ color: colors.primary, fontSize: 13, fontWeight: '600' }}>{pct}%</Text>
                  </View>
                </View>
                <View style={{ height: 8, borderRadius: 4, backgroundColor: colors.muted, marginTop: 12, overflow: 'hidden' }}>
                  <View style={{ width: `${pct}%`, height: '100%', backgroundColor: colors.primary, borderRadius: 4 }} />
                </View>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: 8 }}>
                  <Text variant="muted" style={{ fontSize: 11 }}>已用 {formatMoney(totalUsed)}</Text>
                  <Text variant="muted" style={{ fontSize: 11 }}>剩余 {formatMoney(totalBudget - totalUsed)}</Text>
                </View>
              </Pressable>

              {budgetExp && (
                <View style={{ borderTopWidth: 1, borderTopColor: colors.hairline, marginTop: 14, paddingTop: 10 }}>
                  {monthlyBudgets.map((b) => {
                    const bp = b.amount ? Math.min(100, Math.round((b.actualAmount / b.amount) * 100)) : 0;
                    return (
                      <View key={b.id} style={{ marginBottom: 12 }}>
                        <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 5 }}>
                          <Text style={{ fontSize: 13 }}>{b.name}</Text>
                          <Text variant="muted" style={{ fontSize: 12, fontVariant: ['tabular-nums'] }}>{formatMoney(b.actualAmount)} / {formatMoney(b.amount)}</Text>
                        </View>
                        <View style={{ height: 6, borderRadius: 3, backgroundColor: colors.muted, overflow: 'hidden' }}>
                          <View style={{ width: `${bp}%`, height: '100%', backgroundColor: bp >= 100 ? colors.expense : colors.primary, borderRadius: 3 }} />
                        </View>
                      </View>
                    );
                  })}
                </View>
              )}
            </Card>
          </FadeInView>
        )}

        {/* AI 财务助手(点击直接弹出 AI 弹窗) */}
        <FadeInView index={3}>
          <Pressable onPress={openAI} style={{ flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: alpha(colors.primary, 0.06), borderRadius: 20, padding: 16, marginBottom: 16, borderWidth: 1, borderColor: alpha(colors.primary, 0.2) }}>
            <View style={{ width: 42, height: 42, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: alpha(colors.primary, 0.12) }}>
              <Text style={{ fontSize: 22 }}>🤖</Text>
            </View>
            <View style={{ flex: 1 }}>
              <Text style={{ fontSize: 15, fontWeight: '600' }}>AI 财务助手</Text>
              <Text variant="muted" style={{ fontSize: 12, marginTop: 2 }} numberOfLines={1}>{insight}</Text>
            </View>
            <ChevronRight size={16} color={colors.primary} />
          </Pressable>
        </FadeInView>

        {/* 最近流水 */}
        <FadeInView index={4}>
          <Text variant="muted" style={{ fontSize: 12, letterSpacing: 1, marginBottom: 10 }}>最近流水</Text>
          <Card className="px-5 py-4 mb-4">
            {recent.map((r, i) => (
              <View key={r.id}>
                <RecordRow record={r} showDivider={i < recent.length - 1} />
                {i < recent.length - 1 && <View style={{ height: 12 }} />}
              </View>
            ))}
          </Card>
        </FadeInView>
      </View>
    </Screen>
  );
}
import { useEffect, useState } from 'react';
import { Pressable, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { ChevronRight } from 'lucide-react-native';
import { useTheme } from '@/theme';
import { useAuth } from '@/stores/auth';
import { Screen } from '@/components/Screen';
import { Card } from '@/components/ui/Card';
import { Text } from '@/components/ui/Text';
import { RecordRow } from '@/components/RecordRow';
import { FadeInView } from '@/components/FadeInView';
import { fetchSummary, fetchBudgets, fetchCategories } from '@/services/records';
import { useRecords } from '@/stores/records';
import { useCountUp } from '@/lib/useCountUp';
import { formatMoney, formatMoneyShort } from '@/lib/format';
import type { RecordSummary, BudgetItem } from '@/types';

type Period = '本月' | '当年';

// 首页:收支总览(橙渐变) + 预算 + AI 助手 + 最近流水
export default function HomeScreen() {
  const { colors } = useTheme();
  const { nickname } = useAuth();
  const [period, setPeriod] = useState<Period>('本月');
  const [summary, setSummary] = useState<RecordSummary | null>(null);
  const [budgets, setBudgets] = useState<BudgetItem[]>([]);
  const [budgetExp, setBudgetExp] = useState(false);
  const [catMap, setCatMap] = useState<Record<string, string>>({});
  const { records } = useRecords();

  useEffect(() => {
    fetchSummary().then(setSummary);
    fetchBudgets().then(setBudgets);
    fetchCategories().then((c) => setCatMap(Object.fromEntries(c.map((x) => [x.code, x.icon]))));
  }, []);
  const recent = records.slice(0, 4);

  const balance = useCountUp(summary?.netIncome ?? 0);
  const totalBudget = budgets.reduce((s, b) => s + b.amount, 0);
  const totalUsed = budgets.reduce((s, b) => s + b.actualAmount, 0);
  const pct = totalBudget ? Math.min(100, Math.round((totalUsed / totalBudget) * 100)) : 0;

  const income = summary?.income ?? 0;
  const expense = summary?.expense ?? 0;

  return (
    <Screen scroll>
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

        {/* 收支总览(橙渐变) */}
        <FadeInView index={1}>
          <LinearGradient
            colors={['#fb923c', '#f97316', '#ea580c']}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={{ borderRadius: 20, padding: 20, marginBottom: 16, shadowColor: '#f97316', shadowOpacity: 0.3, shadowRadius: 16, shadowOffset: { width: 0, height: 8 }, elevation: 6 }}
          >
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
              <Text style={{ color: 'rgba(255,255,255,0.9)', fontSize: 13, fontWeight: '600' }}>收支总览</Text>
              <View style={{ flexDirection: 'row', gap: 6 }}>
                {(['本月', '当年'] as Period[]).map((p) => {
                  const active = period === p;
                  return (
                    <Pressable
                      key={p}
                      onPress={() => setPeriod(p)}
                      style={{ paddingHorizontal: 12, paddingVertical: 5, borderRadius: 999, backgroundColor: active ? 'rgba(255,255,255,0.25)' : 'transparent' }}
                    >
                      <Text style={{ color: '#fff', fontSize: 12, fontWeight: active ? '700' : '400' }}>{p}</Text>
                    </Pressable>
                  );
                })}
              </View>
            </View>

            <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: 18 }}>
              {[
                { label: '收入', value: formatMoneyShort(income), color: '#d1fae5' },
                { label: '支出', value: formatMoneyShort(expense), color: '#fee2e2' },
                { label: '结余', value: formatMoneyShort(balance), color: '#ffffff' },
              ].map((c) => (
                <View key={c.label} style={{ flex: 1, alignItems: 'center' }}>
                  <Text style={{ color: 'rgba(255,255,255,0.8)', fontSize: 12, marginBottom: 4 }}>{c.label}</Text>
                  <Text style={{ color: c.color, fontSize: 18, fontWeight: '700', fontVariant: ['tabular-nums'] }}>{c.value}</Text>
                </View>
              ))}
            </View>
          </LinearGradient>
        </FadeInView>

        {/* 预算 */}
        <FadeInView index={2}>
          <Card className="px-5 py-4 mb-4" onPress={() => setBudgetExp((v) => !v)}>
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
              <View>
                <Text variant="muted" style={{ fontSize: 12 }}>本月总预算</Text>
                <Text style={{ fontSize: 22, fontWeight: '700', fontVariant: ['tabular-nums'], marginTop: 2 }}>¥{formatMoney(totalBudget)}</Text>
              </View>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                <Text variant="muted" style={{ fontSize: 20 }}>{budgetExp ? '⌃' : '⌄'}</Text>
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

            {budgetExp && (
              <View style={{ borderTopWidth: 1, borderTopColor: colors.hairline, marginTop: 14, paddingTop: 10 }}>
                {budgets.map((b) => {
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

        {/* AI 助手(点击进入记一笔的 AI 识别) */}
        <FadeInView index={3}>
          <Pressable style={{ flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: 'rgba(249,115,22,0.06)', borderRadius: 20, padding: 16, marginBottom: 16, borderWidth: 1, borderColor: 'rgba(249,115,22,0.2)' }}>
            <View style={{ width: 42, height: 42, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(249,115,22,0.12)' }}>
              <Text style={{ fontSize: 22 }}>🤖</Text>
            </View>
            <View style={{ flex: 1 }}>
              <Text style={{ fontSize: 15, fontWeight: '600' }}>AI 财务助手</Text>
              <Text variant="muted" style={{ fontSize: 12, marginTop: 2 }}>本月餐饮支出偏高，建议控制晚餐消费</Text>
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
                <RecordRow record={r} icon={catMap[r.categoryCode ?? '']} showDivider={i < recent.length - 1} />
                {i < recent.length - 1 && <View style={{ height: 12 }} />}
              </View>
            ))}
          </Card>
        </FadeInView>
      </View>
    </Screen>
  );
}
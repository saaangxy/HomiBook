import { useEffect, useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { useRouter } from 'expo-router';
import { LinearGradient } from 'expo-linear-gradient';
import { Plus, Bot, AlertTriangle, ChevronRight, BookOpen } from 'lucide-react-native';
import { useTheme } from '@/theme';
import { useAuth } from '@/stores/auth';
import { Screen } from '@/components/Screen';
import { Card } from '@/components/ui/Card';
import { Text } from '@/components/ui/Text';
import { RecordRow } from '@/components/RecordRow';
import { FadeInView } from '@/components/FadeInView';
import { AnimatedPressable } from '@/components/AnimatedPressable';
import { fetchRecords, fetchSummary, fetchBudgets, fetchCategories } from '@/services/records';
import { formatMoney, formatMoneyShort } from '@/lib/format';
import type { RecordItem, RecordSummary, BudgetItem } from '@/types';

export default function HomeScreen() {
  const { colors } = useTheme();
  const { nickname, currentServer } = useAuth();
  const router = useRouter();

  const [summary, setSummary] = useState<RecordSummary | null>(null);
  const [recent, setRecent] = useState<RecordItem[]>([]);
  const [budgets, setBudgets] = useState<BudgetItem[]>([]);
  const [catMap, setCatMap] = useState<Record<string, string>>({});

  // 模拟数据加载
  useEffect(() => {
    fetchSummary().then(setSummary);
    fetchRecords().then((r) => setRecent(r.slice(0, 3)));
    fetchBudgets().then(setBudgets);
    fetchCategories().then((c) => setCatMap(Object.fromEntries(c.map((x) => [x.code, x.icon]))));
  }, []);

  const dangerBudget = budgets.find((b) => b.actualAmount >= b.amount);
  const alarmBudget = budgets.find((b) => b.actualAmount > 0 && b.actualAmount / b.amount > 0.85 && b.actualAmount < b.amount);

  return (
    <Screen scroll>
      <View className="px-5 pt-3">
        {/* 问候 + 当前服务器 */}
        <FadeInView>
          <View className="flex-row items-center justify-between mb-4 px-1">
            <View>
              <Text variant="title" style={{ fontSize: 22 }}>你好,{nickname || '朋友'}</Text>
              <Text variant="muted" style={{ fontSize: 13 }}>{currentServer?.name ?? '未连接服务器'}</Text>
            </View>
            <Pressable onPress={() => router.push('/server')} className="flex-row items-center gap-1 rounded-full px-3 py-1.5" style={{ backgroundColor: colors.muted }}>
              <Text variant="muted" style={{ fontSize: 12 }}>服务器</Text>
              <ChevronRight size={14} color={colors.mutedForeground} />
            </Pressable>
          </View>
        </FadeInView>

        {/* 本月摘要渐变卡 */}
        <FadeInView index={1}>
          <LinearGradient
            colors={[colors.primary, '#fb923c']}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            className="rounded-3xl p-5 mb-4"
          >
            <View className="flex-row items-center gap-2 mb-1">
              <BookOpen size={16} color={colors.primaryForeground} />
              <Text style={{ color: colors.primaryForeground, fontSize: 13 }}>8月账单</Text>
            </View>
            <View className="flex-row items-end gap-1 mb-4">
              <Text style={{ color: colors.primaryForeground, fontSize: 30, fontWeight: '800' , fontVariant:['tabular-nums']}}>
                {summary ? formatMoney(summary.netIncome) : '...'}
              </Text>
              <Text style={{ color: colors.primaryForeground, opacity: 0.8, fontSize: 13, marginBottom: 6 }}>本月结余</Text>
            </View>
            <View className="flex-row gap-6">
              <View className="flex-1">
                <Text style={{ color: colors.primaryForeground, opacity: 0.85, fontSize: 12 }}>收入</Text>
                <Text style={{ color: colors.primaryForeground, fontSize: 16, fontWeight: '700', fontVariant:['tabular-nums'] }}>
                  {summary ? formatMoneyShort(summary.income) : '...'}
                </Text>
              </View>
              <View className="flex-1">
                <Text style={{ color: colors.primaryForeground, opacity: 0.85, fontSize: 12 }}>支出</Text>
                <Text style={{ color: colors.primaryForeground, fontSize: 16, fontWeight: '700', fontVariant:['tabular-nums'] }}>
                  {summary ? formatMoneyShort(summary.expense) : '...'}
                </Text>
              </View>
              <View className="flex-1 items-end">
                <Text style={{ color: colors.primaryForeground, opacity: 0.85, fontSize: 12 }}>本月记账</Text>
                <Text style={{ color: colors.primaryForeground, fontSize: 16, fontWeight: '700' }}>{recent.length + 5} 笔</Text>
              </View>
            </View>
          </LinearGradient>
        </FadeInView>

        {/* 预算预警 */}
        {(dangerBudget || alarmBudget) && (
          <FadeInView index={2}>
            <Card className="p-3.5 mb-4 flex-row items-center gap-3" style={{ borderColor: colors.expense }}>
              <AlertTriangle size={18} color={colors.expense} />
              <View className="flex-1">
                <Text variant="expense" style={{ fontSize: 13, fontWeight: '600' }}>
                  {dangerBudget ? `${dangerBudget.name} 已超预算` : `${alarmBudget!.name} 即将超预算`}
                </Text>
                <Text variant="muted" style={{ fontSize: 12 }}>
                  {dangerBudget
                    ? `已花 ${formatMoney(dangerBudget.actualAmount)} / ${formatMoney(dangerBudget.amount)}`
                    : `已花 ${formatMoney(alarmBudget!.actualAmount)} / ${formatMoney(alarmBudget!.amount)}`}
                </Text>
              </View>
            </Card>
          </FadeInView>
        )}

        {/* 最近流水 */}
        <View className="mb-4">
          <View className="flex-row items-center justify-between mb-2 px-1">
            <Text variant="bold" style={{ fontSize: 16 }}>最近记账</Text>
            <Pressable onPress={() => router.push('/records')}>
              <Text variant="primary" style={{ fontSize: 13 }}>查看全部</Text>
            </Pressable>
          </View>
          <Card className="p-4 gap-4">
            {recent.map((r, i) => (
              <FadeInView key={r.id} index={i}>
                <RecordRow record={r} icon={catMap[r.categoryCode ?? '']} />
                {i < recent.length - 1 && <View className="h-px my-4" style={{ backgroundColor: colors.border }} />}
              </FadeInView>
            ))}
          </Card>
        </View>

        {/* AI 助手 */}
        <FadeInView>
          <AnimatedPressable onPress={() => {/* AI 入口 */}}>
            <Card className="p-4 flex-row items-center gap-3">
              <View className="w-11 h-11 rounded-2xl items-center justify-center" style={{ backgroundColor: colors.primary }}>
                <Bot size={22} color={colors.primaryForeground} />
              </View>
              <View className="flex-1">
                <Text variant="bold" style={{ fontSize: 15 }}>AI 记账助手</Text>
                <Text variant="muted" style={{ fontSize: 12 }}>"这个月花超了吗?" 问我</Text>
              </View>
              <ChevronRight size={18} color={colors.mutedForeground} />
            </Card>
          </AnimatedPressable>
        </FadeInView>
      </View>

      {/* 记一笔 FAB */}
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
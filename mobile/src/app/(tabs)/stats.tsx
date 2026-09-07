import { useState, useEffect, useMemo, useCallback, useRef, type ReactNode } from 'react';
import { useIsFocused } from 'expo-router';
import {
  RefreshControl, ScrollView, View, Pressable, Dimensions, Platform, ActivityIndicator, FlatList,
  Animated as RNAnimated, Easing as RNEasing,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { GestureDetector, Gesture } from 'react-native-gesture-handler';
import Animated, { Easing, FadeInDown, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import {
  TrendingUp, TrendingDown, Wallet, PieChart as PieIcon,
  Activity, Search, ChevronLeft, ChevronRight, Users, X,
} from 'lucide-react-native';
import Svg, {
  Line as SvgLine, Polyline, Rect, Circle, Text as SvgText, G, Path, Polygon,
} from 'react-native-svg';
import type { SharedValue } from 'react-native-reanimated';
import { useTheme, alpha, haptics, useChartColors } from '@/theme';
import { Text } from '@/components/ui/Text';
import { FormSheet } from '@/components/chrome/FormSheet';
import { DatePicker } from '@/components/ui/DatePicker';
import { RecordRow } from '@/components/RecordRow';
import { useRecords } from '@/stores/records';
import { useUIShell, usePageRefresh } from '@/components/chrome/chrome';
import {
  fetchMonthlyTrend, fetchBalanceHistory, fetchAccounts, fetchGroupSummary, fetchCategoryTrend, fetchSummary,
  fetchRecordsPaged, fetchBookMembers, fetchBudgets, type GroupSummaryItem, type CategoryTrendResult,
} from '@/services/records';
import { fetchRecurring } from '@/services/recurring';
import { computeRadarMetrics, computeTimeRadar } from '@/lib/financial-health';
import { accountLabel, isMultiOwnerAccounts } from '@/lib/account';
import type { BudgetItem, LedgerMember, RadarMetric, RecordItem, RecordSummary } from '@/types';

// ── Tab 定义:对齐网页端 4 视图 ──
type StatsTab = 'overview' | 'yearly' | 'monthly' | 'free';
const TABS: { key: StatsTab; label: string }[] = [
  { key: 'overview', label: '首页' },
  { key: 'yearly', label: '年度' },
  { key: 'monthly', label: '月度' },
  { key: 'free', label: '自由' },
];

import { ChartInteraction, TipRow, TripleLineChart, AreaLineChart, MultiLineChart, DualBarChart, StackedBarChart, DonutChart, TimeRadar, CW, fmtMoney } from '@/components/charts';

// ════════════════════════════════════════
function SummaryCard({ icon: Icon, label, value, color }: {
  icon: typeof TrendingUp; label: string; value: number; color: string;
}) {
  const { colors } = useTheme();
  return (
    <View style={{ flex: 1, padding: 12, borderRadius: 12, gap: 6, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
        <View style={{ width: 28, height: 28, borderRadius: 8, backgroundColor: alpha(color, 0.12), alignItems: 'center', justifyContent: 'center' }}>
          <Icon size={15} color={color} />
        </View>
        <Text style={{ fontSize: 12, color: colors.mutedForeground }}>{label}</Text>
      </View>
      <Text style={{ fontSize: 17, fontWeight: '700', color: colors.foreground }}>¥{value.toLocaleString()}</Text>
    </View>
  );
}

function ChartCard({ title, children }: { title: string; children: React.ReactNode }) {
  const { colors } = useTheme();
  return (
    <View style={{ backgroundColor: colors.card, borderRadius: 14, padding: 14, borderWidth: 1, borderColor: colors.border, gap: 10, overflow: 'hidden' }}>
      <Text style={{ fontSize: 15, fontWeight: '600', color: colors.foreground }}>{title}</Text>
      {children}
    </View>
  );
}

// 图表点击后的选中信息块(名称+金额+取消+查看流水)
function SelectionBlock({ label, amount, color, onCancel, onDetail }: {
  label: string; amount: number; color: string; onCancel: () => void; onDetail: () => void;
}) {
  const { colors } = useTheme();
  return (
    <Animated.View entering={FadeInDown.duration(200)} style={{ marginTop: 8, borderRadius: 10, borderWidth: 1, borderColor: alpha(color, 0.4), backgroundColor: alpha(color, 0.08), padding: 10, gap: 8 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: color }} />
        <Text style={{ fontSize: 13, fontWeight: '600', color: colors.foreground, flex: 1 }} numberOfLines={1}>{label}</Text>
        <Text style={{ fontSize: 14, fontWeight: '700', color }}>{amount.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</Text>
        <Pressable hitSlop={8} onPress={onCancel}>
          <X size={15} color={colors.mutedForeground} />
        </Pressable>
      </View>
      <Pressable onPress={onDetail} style={{ paddingVertical: 8, borderRadius: 8, alignItems: 'center', backgroundColor: colors.primary }}>
        <Text style={{ fontSize: 12.5, fontWeight: '600', color: colors.primaryForeground }}>查看流水</Text>
      </Pressable>
    </Animated.View>
  );
}

// ════════════════════════════════════════
// 主页面
// ════════════════════════════════════════
export default function StatsPage() {
  const { colors } = useTheme();
  const cc = useChartColors();
  const { summary, refresh, accounts } = useRecords();
  // 刷新时机:切到本页时(isFocused)重拉各视图数据
  const isFocused = useIsFocused();
  const { currentLedger } = useUIShell();
  const bookId = currentLedger.id;
  const [tab, setTab] = useState<StatsTab>('overview');
  // 账本成员(归属筛选选项)
  const [members, setMembers] = useState<LedgerMember[]>([]);
  // 成员列表(归属筛选选项)
  useEffect(() => {
    if (!bookId) { setMembers([]); return; }
    fetchBookMembers(bookId).then(setMembers).catch(() => setMembers([]));
  }, [bookId]);
  const activeAccounts = useMemo(() => accounts.filter((a) => a.status === 'ACTIVE'), [accounts]);
  const multiOwnerAccounts = isMultiOwnerAccounts(accounts);
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [analysisType, setAnalysisType] = useState<'EXPENSE' | 'INCOME' | 'TRANSFER'>('EXPENSE');
  // 自由筛选
  const [freeDateFrom, setFreeDateFrom] = useState('');
  const [freeDateTo, setFreeDateTo] = useState('');
  const [freeAccountIds, setFreeAccountIds] = useState<string[]>([]);
  const [freeOwnerIds, setFreeOwnerIds] = useState<string[]>([]);
  const [freeSearched, setFreeSearched] = useState(false);
  // 搜索时固化的筛选参数(对齐 web searchParams:修改条件需重新点击搜索)
  const [freeParams, setFreeParams] = useState<{ dateFrom?: string; dateTo?: string; accountId?: string; ownerId?: string }>({});

  // 真实数据:月度趋势 / 资产净值 / 财务健康雷达
  const [trend, setTrend] = useState<{ months: string[]; income: number[]; expense: number[] }>({ months: [], income: [], expense: [] });
  const [netWorth, setNetWorth] = useState<{ dates: string[]; values: number[] }>({ dates: [], values: [] });
  const [balance, setBalance] = useState<{ dates: string[]; series: { name: string; data: number[] }[] }>({ dates: [], series: [] });
  const [radar, setRadar] = useState<RadarMetric[]>([]);

  // 概览数据(近12个月口径,对齐 web StatsOverview.load)
  const loadOverview = useCallback(async () => {
    if (!bookId) return;
    const nowD = new Date();
    const p2 = (n: number) => String(n).padStart(2, '0');
    const dateTo = `${nowD.getFullYear()}-${p2(nowD.getMonth() + 1)}-${p2(nowD.getDate())}`;
    const startD = new Date(nowD.getFullYear(), nowD.getMonth() - 11, 1);
    const dateFrom = `${startD.getFullYear()}-${p2(startD.getMonth() + 1)}-01`;
    const dailyD = new Date(nowD.getFullYear(), nowD.getMonth(), nowD.getDate() - 59);
    const dailyFrom = `${dailyD.getFullYear()}-${p2(dailyD.getMonth() + 1)}-${p2(dailyD.getDate())}`;
    const [trendRes, accountsRes, loans, passive, insurance] = await Promise.all([
      fetchMonthlyTrend(bookId, dateFrom, dateTo),
      fetchAccounts(bookId).catch(() => []),
      fetchRecurring(bookId).catch(() => []),
      // 被动收入(投资收益,分红) 与 保费支出(保险) 用于 7 维评分
      fetchSummary(bookId, { type: 'INCOME', categoryCode: '投资收益,分红', dateFrom, dateTo }),
      fetchSummary(bookId, { type: 'EXPENSE', categoryCode: '保险', dateFrom, dateTo }),
    ]);
    setTrend(trendRes);
    // 资产净值趋势 + 账户余额变化(近60天):ACTIVE 账户余额历史(对齐 web)
    const active = accountsRes.filter((a) => a.status === 'ACTIVE');
    if (active.length > 0) {
      const hist = await fetchBalanceHistory(bookId, { accountIds: active.map((a) => a.id).join(','), granularity: 'monthly', dateFrom, dateTo });
      if (hist.length > 0) {
        const dates = hist[0].balances.map((b) => b.date);
        setNetWorth({ dates, values: dates.map((_, i) => hist.reduce((s, a) => s + (a.balances[i]?.balance ?? 0), 0)) });
      } else {
        setNetWorth({ dates: [], values: [] });
      }
      const dailyHist = await fetchBalanceHistory(bookId, { accountIds: active.slice(0, 5).map((a) => a.id).join(','), granularity: 'daily', dateFrom: dailyFrom, dateTo });
      if (dailyHist.length > 0) {
        const multiOwner = isMultiOwnerAccounts(accountsRes);
        setBalance({
          dates: dailyHist[0].balances.map((b) => b.date),
          series: dailyHist.map((a) => {
            const acct = accountsRes.find((x) => x.id === a.accountId);
            return { name: acct ? accountLabel(acct, multiOwner) : a.accountName, data: a.balances.map((b) => b.balance) };
          }),
        });
      } else {
        setBalance({ dates: [], series: [] });
      }
    } else {
      setNetWorth({ dates: [], values: [] });
      setBalance({ dates: [], series: [] });
    }
    // 财务健康评估(7维)
    setRadar(computeRadarMetrics({
      accounts: accountsRes,
      loans: loans.filter((l) => l.recurringType === 'LOAN' && l.active),
      summary,
      passiveIncome: passive.income,
      insuranceExpense: insurance.expense,
    }));
  }, [bookId, summary]);

  useEffect(() => {
    if (!isFocused) return;
    loadOverview();
  }, [isFocused, loadOverview]);

  // ── 时间视图数据(对齐 web StatsTimeView/AnalysisPanel):时间段 + 分组汇总 + 分类趋势 ──
  const pad2 = (n: number) => String(n).padStart(2, '0');
  const range = useMemo(() => {
    if (tab === 'yearly') return { dateFrom: `${year}-01-01`, dateTo: `${year}-12-31` };
    if (tab === 'monthly') {
      const last = new Date(year, month, 0).getDate();
      return { dateFrom: `${year}-${pad2(month)}-01`, dateTo: `${year}-${pad2(month)}-${last}` };
    }
    return { dateFrom: freeParams.dateFrom, dateTo: freeParams.dateTo };
  }, [tab, year, month, freeParams]);

  const [analysis, setAnalysis] = useState<{ category: GroupSummaryItem[]; owner: GroupSummaryItem[]; account: GroupSummaryItem[] }>({ category: [], owner: [], account: [] });
  const [stacked, setStacked] = useState<CategoryTrendResult>({ periods: [], categories: [] });
  const [rangeSummary, setRangeSummary] = useState<RecordSummary | null>(null);
  const [timeLoading, setTimeLoading] = useState(false);
  const [analysisLoading, setAnalysisLoading] = useState(false);
  const [pieSelected, setPieSelected] = useState<{ groupBy: 'category' | 'ownerId' | 'accountId'; item: GroupSummaryItem } | null>(null);
  const [barSelected, setBarSelected] = useState<{ periodIdx: number; catIdx: number } | null>(null);

  const isTimeTab = tab === 'yearly' || tab === 'monthly' || (tab === 'free' && freeSearched);
  // 自由筛选的账户/归属(搜索时固化,仅自由 tab 生效)
  const freeAccountId = tab === 'free' ? freeParams.accountId : undefined;
  const freeOwnerId = tab === 'free' ? freeParams.ownerId : undefined;
  // 时间段财务健康 5 维(真实计算,对齐 web StatsTimeView)
  const [timeRadar, setTimeRadar] = useState<RadarMetric[]>([]);

  // 时间视图主体:分类趋势 + 汇总 + 5维雷达(不随分析面板类型变化)
  const loadTimeView = useCallback(() => {
    if (!bookId || !isTimeTab) return;
    if (tab !== 'free' && (!range.dateFrom || !range.dateTo)) return;
    let cancel = false;
    setTimeLoading(true);
    setBarSelected(null);
    const granularity: 'monthly' | 'daily' = tab === 'yearly' ? 'monthly' : 'daily';
    const trendParams = tab === 'yearly'
      ? { granularity: 'monthly' as const, year, dateFrom: range.dateFrom, dateTo: range.dateTo }
      : tab === 'monthly'
        ? { granularity: 'daily' as const, year, month, dateFrom: range.dateFrom, dateTo: range.dateTo }
        : { granularity: 'daily' as const, dateFrom: range.dateFrom, dateTo: range.dateTo };
    Promise.all([
      fetchCategoryTrend(bookId, { type: 'EXPENSE', ...trendParams, accountId: freeAccountId, ownerId: freeOwnerId }),
      fetchSummary(bookId, { dateFrom: range.dateFrom, dateTo: range.dateTo, accountId: freeAccountId, ownerId: freeOwnerId }),
      // 5维雷达数据源:固定预算 / 活跃贷款 / 被动收入(投资收益,分红)
      fetchBudgets(bookId).catch(() => []),
      fetchRecurring(bookId).catch(() => []),
      fetchSummary(bookId, { type: 'INCOME', categoryCode: '投资收益,分红', dateFrom: range.dateFrom, dateTo: range.dateTo, accountId: freeAccountId, ownerId: freeOwnerId }),
    ]).then(([trendRes, sum, budgets, loans, passive]) => {
      if (cancel) return;
      // 过滤全零分类(对齐 web)
      setStacked({ periods: trendRes.periods, categories: trendRes.categories.filter((c) => c.data.some((v) => v > 0)) });
      setRangeSummary(sum);
      // ── 5维雷达(对齐 web fetchBudgetHealth + computeRadar) ──
      const fixed = (budgets as BudgetItem[]).filter((b) => b.type === 'FIXED' && b.month != null);
      const inScope = fixed.filter((b) => {
        if (tab === 'yearly') return b.year === year;
        if (tab === 'monthly') return b.year === year && b.month === month;
        // free:预算所在月与所选范围相交
        if (!range.dateFrom || !range.dateTo) return false;
        const bFrom = `${b.year}-${pad2(b.month!)}-01`;
        const bTo = `${b.year}-${pad2(b.month!)}-${new Date(b.year, b.month!, 0).getDate()}`;
        return bFrom <= range.dateTo && bTo >= range.dateFrom;
      });
      const totalBudgeted = inScope.reduce((s, b) => s + b.amount, 0);
      const totalActual = inScope.reduce((s, b) => s + b.actualAmount, 0);
      const budgetHealth = totalBudgeted === 0 ? 100 : Math.max(0, Math.round((1 - Math.max(0, totalActual - totalBudgeted) / totalBudgeted) * 100));
      const monthlyPayment = loans.filter((l) => l.recurringType === 'LOAN' && l.active).reduce((s, l) => s + (l.amount ?? 0), 0);
      const monthsInPeriod = range.dateFrom && range.dateTo
        ? Math.max(1, (new Date(range.dateTo).getFullYear() - new Date(range.dateFrom).getFullYear()) * 12 + (new Date(range.dateTo).getMonth() - new Date(range.dateFrom).getMonth()) + 1)
        : 1;
      setTimeRadar(computeTimeRadar({ summary: sum, budgetHealth, monthlyPayment, monthsInPeriod, passiveIncome: passive.income }));
    }).finally(() => { if (!cancel) setTimeLoading(false); });
    return () => { cancel = true; };
  }, [bookId, isTimeTab, range.dateFrom, range.dateTo, tab, year, month, freeAccountId, freeOwnerId]);

  useEffect(() => {
    if (!isFocused) return;
    const cleanup = loadTimeView();
    return typeof cleanup === 'function' ? cleanup : undefined;
  }, [isFocused, loadTimeView]); // 切到本页时即时重拉

  // 分析面板:分组汇总随类型/时间段独立刷新(对齐 web AnalysisPanel,不触发整页 loading)
  const loadAnalysis = useCallback(() => {
    if (!bookId || !isTimeTab) return;
    if (tab !== 'free' && (!range.dateFrom || !range.dateTo)) return;
    let cancel = false;
    setPieSelected(null);
    setAnalysisLoading(true);
    Promise.all([
      fetchGroupSummary(bookId, { type: analysisType, groupBy: 'category', dateFrom: range.dateFrom, dateTo: range.dateTo, accountId: freeAccountId, ownerId: freeOwnerId }),
      fetchGroupSummary(bookId, { type: analysisType, groupBy: 'ownerId', dateFrom: range.dateFrom, dateTo: range.dateTo, accountId: freeAccountId, ownerId: freeOwnerId }),
      fetchGroupSummary(bookId, { type: analysisType, groupBy: 'accountId', dateFrom: range.dateFrom, dateTo: range.dateTo, accountId: freeAccountId, ownerId: freeOwnerId }),
    ]).then(([category, owner, account]) => {
      if (cancel) return;
      setAnalysis({ category, owner, account });
    }).finally(() => { if (!cancel) setAnalysisLoading(false); });
    return () => { cancel = true; };
  }, [bookId, isTimeTab, range.dateFrom, range.dateTo, analysisType, freeAccountId, freeOwnerId]);

  useEffect(() => {
    if (!isFocused) return;
    const cleanup = loadAnalysis();
    return typeof cleanup === 'function' ? cleanup : undefined;
  }, [isFocused, loadAnalysis]);

  // 记一笔/编辑保存后由 RecordModal 直接调用:按当前视图重拉数据
  const reloadPage = useCallback(() => {
    loadOverview();
    loadTimeView();
    loadAnalysis();
  }, [loadOverview, loadTimeView, loadAnalysis]);
  usePageRefresh(reloadPage);

  // ── 图表详情弹层:点击「查看流水」后上滑分页加载流水(对齐 web Dialog) ──
  const [detail, setDetail] = useState<{ title: string; params: Record<string, unknown> } | null>(null);
  const [detailRecords, setDetailRecords] = useState<RecordItem[]>([]);
  const [detailTotal, setDetailTotal] = useState(0);
  const [detailPage, setDetailPage] = useState(1);
  const [detailLoading, setDetailLoading] = useState(false);
  const PAGE_SIZE = 20;

  // append=false 重置列表(第1页);append=true 追加(上滑加载更多)
  const loadDetailPage = useCallback(async (page: number, params: Record<string, unknown>, append = false) => {
    setDetailLoading(true);
    try {
      const res = await fetchRecordsPaged(bookId, { page, pageSize: PAGE_SIZE, ...params } as any);
      setDetailRecords((prev) => (append ? [...prev, ...res.records] : res.records));
      setDetailTotal(res.total);
      setDetailPage(page);
    } finally {
      setDetailLoading(false);
    }
  }, [bookId]);

  const openPieDetail = (sel: { groupBy: 'category' | 'ownerId' | 'accountId'; item: GroupSummaryItem }) => {
    const params: Record<string, unknown> = {
      type: analysisType,
      dateFrom: range.dateFrom,
      dateTo: range.dateTo,
      // 自由筛选下继承账户/归属(对应 groupBy 时被选中项覆盖,对齐 web)
      ...(tab === 'free' ? { accountId: freeParams.accountId, ownerId: freeParams.ownerId } : {}),
      ...(sel.groupBy === 'category' ? { categoryCode: sel.item.key } : {}),
      ...(sel.groupBy === 'accountId' ? { accountId: sel.item.key } : {}),
      ...(sel.groupBy === 'ownerId' ? { ownerId: sel.item.key } : {}),
    };
    setDetail({ title: `${sel.item.label}`, params });
    loadDetailPage(1, params);
  };

  const openBarDetail = (sel: { periodIdx: number; catIdx: number }) => {
    const period = stacked.periods[sel.periodIdx];
    const cat = stacked.categories[sel.catIdx];
    if (!period || !cat) return;
    // period 长度7 → 整月;长度10 → 单日(web 同规则)
    const isMonth = period.length === 7;
    const y = Number(period.slice(0, 4));
    const m = Number(period.slice(5, 7));
    const last = new Date(y, m, 0).getDate();
    const params: Record<string, unknown> = {
      type: 'EXPENSE',
      dateFrom: isMonth ? `${period}-01` : period,
      dateTo: isMonth ? `${period}-${last}` : period,
      ...(cat.code ? { categoryCode: cat.code } : {}),
    };
    setDetail({ title: `${period} · ${cat.name}`, params });
    loadDetailPage(1, params);
  };

  const [refreshing, setRefreshing] = useState(false);
  // 下拉刷新:重拉 store + 概览数据(趋势/净值/雷达)
  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await Promise.all([refresh(), loadOverview()]);
    } finally {
      setRefreshing(false);
    }
  }, [refresh, loadOverview]);

  const monthlyLabels = useMemo(
    () => trend.months.map((m) => `${Number(m.slice(5, 7))}月`),
    [trend.months],
  );
  const netWorthLabels = useMemo(
    () => netWorth.dates.map((d) => (d.length > 7 ? d.slice(5) : d)),
    [netWorth.dates],
  );
  const balanceLabels = useMemo(
    () => balance.dates.map((d) => (d.length > 7 ? d.slice(5) : d)),
    [balance.dates],
  );

  // ── 首页(Overview):对齐网页 StatsOverview ──
  const renderOverview = () => (
    <View style={{ gap: 16 }}>
      <View style={{ flexDirection: 'row', gap: 8 }}>
        <SummaryCard icon={TrendingUp} label="总收入" value={summary.income} color={cc.income} />
        <SummaryCard icon={TrendingDown} label="总支出" value={summary.expense} color={cc.expense} />
      </View>
      <View style={{ flexDirection: 'row', gap: 8 }}>
        <SummaryCard icon={Activity} label="净收入" value={summary.netIncome} color={summary.netIncome >= 0 ? cc.income : cc.expense} />
        <SummaryCard icon={Wallet} label="转账总额" value={summary.transfer} color={cc.transfer} />
      </View>

      <ChartCard title="月度收支趋势">
        <TripleLineChart income={trend.income} expense={trend.expense} labels={monthlyLabels} />
      </ChartCard>

      <ChartCard title="资产净值趋势">
        {/* 加高画布:倾斜 x 轴标签需要更大的底部留白 */}
        <AreaLineChart data={netWorth.values} labels={netWorthLabels} color={colors.primary} height={224} />
      </ChartCard>

      <ChartCard title="账户余额变化(近60天)">
        <MultiLineChart series={balance.series} labels={balanceLabels} />
      </ChartCard>

      <ChartCard title="财务健康评估(7维)">
        <View style={{ alignItems: 'center' }}>
          <TimeRadar metrics={radar} size={Math.min(CW, 300)} />
        </View>
        <View style={{ gap: 6, marginTop: 8 }}>
          {radar.map(m => (
            <View key={m.name} style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: m.value >= 80 ? '#22c55e' : m.value >= 50 ? '#f59e0b' : '#ef4444' }} />
              <Text style={{ fontSize: 12, color: colors.mutedForeground, flex: 1 }}>{m.name}</Text>
              <Text style={{ fontSize: 12, fontWeight: '600', color: colors.foreground }}>{m.value}分</Text>
              <Text style={{ fontSize: 11, color: colors.mutedForeground, flex: 1.2, textAlign: 'right' }}>{m.detail}</Text>
            </View>
          ))}
        </View>
      </ChartCard>
    </View>
  );

  // ── 年度/月度/自由:对齐网页 StatsTimeView ──
  const renderTimeView = (mode: 'yearly' | 'monthly' | 'free') => (
    <View style={{ gap: 16 }}>
      {/* 时间选择器 */}
      {mode === 'yearly' && (
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 12 }}>
          <Pressable onPress={() => setYear(y => y - 1)} style={{ width: 36, height: 36, alignItems: 'center', justifyContent: 'center', borderRadius: 8, backgroundColor: colors.muted }}>
            <ChevronLeft size={18} color={colors.foreground} />
          </Pressable>
          <Text style={{ fontSize: 16, fontWeight: '600', color: colors.foreground, minWidth: 80, textAlign: 'center' }}>{year} 年</Text>
          <Pressable onPress={() => setYear(y => y + 1)} style={{ width: 36, height: 36, alignItems: 'center', justifyContent: 'center', borderRadius: 8, backgroundColor: colors.muted }}>
            <ChevronRight size={18} color={colors.foreground} />
          </Pressable>
        </View>
      )}
      {mode === 'monthly' && (
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
          <Pressable onPress={() => setMonth(m => m > 1 ? m - 1 : 12)} style={{ width: 36, height: 36, alignItems: 'center', justifyContent: 'center', borderRadius: 8, backgroundColor: colors.muted }}>
            <ChevronLeft size={18} color={colors.foreground} />
          </Pressable>
          <Pressable onPress={() => setYear(y => y - 1)} style={{ paddingHorizontal: 8, height: 36, alignItems: 'center', justifyContent: 'center', borderRadius: 8, backgroundColor: colors.muted }}>
            <Text style={{ fontSize: 13, color: colors.foreground }}>‹ {year}</Text>
          </Pressable>
          <Text style={{ fontSize: 16, fontWeight: '600', color: colors.foreground, minWidth: 60, textAlign: 'center' }}>{month} 月</Text>
          <Pressable onPress={() => setYear(y => y + 1)} style={{ paddingHorizontal: 8, height: 36, alignItems: 'center', justifyContent: 'center', borderRadius: 8, backgroundColor: colors.muted }}>
            <Text style={{ fontSize: 13, color: colors.foreground }}>{year} ›</Text>
          </Pressable>
          <Pressable onPress={() => setMonth(m => m < 12 ? m + 1 : 1)} style={{ width: 36, height: 36, alignItems: 'center', justifyContent: 'center', borderRadius: 8, backgroundColor: colors.muted }}>
            <ChevronRight size={18} color={colors.foreground} />
          </Pressable>
        </View>
      )}
      {/* 自由筛选(对齐 web:日期范围 + 账户/成员多选,点搜索后固化查询) */}
      {mode === 'free' && (
        <View style={{ gap: 12 }}>
          <View style={{ flexDirection: 'row', gap: 8 }}>
            <View style={{ flex: 1 }}>
              <Text style={{ fontSize: 11, color: colors.mutedForeground, marginBottom: 4 }}>开始日期</Text>
              <DatePicker value={freeDateFrom} onChange={(v) => setFreeDateFrom(v.slice(0, 10))} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={{ fontSize: 11, color: colors.mutedForeground, marginBottom: 4 }}>结束日期</Text>
              <DatePicker value={freeDateTo} onChange={(v) => setFreeDateTo(v.slice(0, 10))} />
            </View>
          </View>
          {/* 账户(可多选,不选=全部) */}
          {activeAccounts.length > 0 && (
            <View>
              <Text style={{ fontSize: 11, color: colors.mutedForeground, marginBottom: 6 }}>账户(可多选,不选=全部)</Text>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                {activeAccounts.map((a) => {
                  const active = freeAccountIds.includes(a.id);
                  return (
                    <Pressable
                      key={a.id}
                      onPress={() => setFreeAccountIds((list) => (list.includes(a.id) ? list.filter((x) => x !== a.id) : [...list, a.id]))}
                      style={{
                        paddingHorizontal: 12, paddingVertical: 7, borderRadius: 999, borderWidth: 1,
                        borderColor: active ? colors.primary : colors.border,
                        backgroundColor: active ? alpha(colors.primary, 0.12) : colors.card,
                      }}
                    >
                      <Text style={{ fontSize: 12, color: active ? colors.primary : colors.foreground, fontWeight: active ? '600' : '400' }}>{accountLabel(a, multiOwnerAccounts)}</Text>
                    </Pressable>
                  );
                })}
              </View>
            </View>
          )}
          {/* 成员(可多选,不选=全部) */}
          {members.length > 0 && (
            <View>
              <Text style={{ fontSize: 11, color: colors.mutedForeground, marginBottom: 6 }}>成员(可多选,不选=全部)</Text>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                {members.map((m) => {
                  const uid = m.userId || m.id;
                  const active = freeOwnerIds.includes(uid);
                  return (
                    <Pressable
                      key={m.id}
                      onPress={() => setFreeOwnerIds((list) => (list.includes(uid) ? list.filter((x) => x !== uid) : [...list, uid]))}
                      style={{
                        paddingHorizontal: 12, paddingVertical: 7, borderRadius: 999, borderWidth: 1,
                        borderColor: active ? colors.primary : colors.border,
                        backgroundColor: active ? alpha(colors.primary, 0.12) : colors.card,
                      }}
                    >
                      <Text style={{ fontSize: 12, color: active ? colors.primary : colors.foreground, fontWeight: active ? '600' : '400' }}>{m.nickname}</Text>
                    </Pressable>
                  );
                })}
              </View>
            </View>
          )}
          <Pressable
            onPress={() => {
              setFreeParams({
                dateFrom: freeDateFrom || undefined,
                dateTo: freeDateTo || undefined,
                accountId: freeAccountIds.length ? freeAccountIds.join(',') : undefined,
                ownerId: freeOwnerIds.length ? freeOwnerIds.join(',') : undefined,
              });
              setFreeSearched(true);
            }}
            style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 10, borderRadius: 10, backgroundColor: colors.primary }}
          >
            <Search size={16} color={colors.primaryForeground} />
            <Text style={{ color: colors.primaryForeground, fontWeight: '600', fontSize: 14 }}>搜索</Text>
          </Pressable>
        </View>
      )}

      {/* 自由筛选未搜索提示 */}
      {mode === 'free' && !freeSearched ? (
        <ChartCard title="提示">
          <View style={{ alignItems: 'center', paddingVertical: 20 }}>
            <Search size={32} color={colors.mutedForeground} />
            <Text style={{ fontSize: 14, color: colors.mutedForeground, marginTop: 8 }}>设置筛选条件后点击搜索</Text>
          </View>
        </ChartCard>
      ) : (
        <>
          {/* 汇总卡片(时间段) */}
          <View style={{ flexDirection: 'row', gap: 8 }}>
            <SummaryCard icon={TrendingUp} label="总收入" value={(rangeSummary ?? summary).income} color={cc.income} />
            <SummaryCard icon={TrendingDown} label="总支出" value={(rangeSummary ?? summary).expense} color={cc.expense} />
          </View>
          <View style={{ flexDirection: 'row', gap: 8 }}>
            <SummaryCard icon={Activity} label="净收入" value={(rangeSummary ?? summary).netIncome} color={(rangeSummary ?? summary).netIncome >= 0 ? cc.income : cc.expense} />
            <SummaryCard icon={Wallet} label="转账总额" value={(rangeSummary ?? summary).transfer} color={cc.transfer} />
          </View>

          {timeLoading ? (
            <View style={{ paddingVertical: 40, alignItems: 'center' }}>
              <ActivityIndicator size="large" color={colors.primary} />
            </View>
          ) : (
            <>
          {/* 5维雷达(时间段真实计算) */}
          <ChartCard title="财务健康评估(5维)">
            <View style={{ alignItems: 'center' }}>
              <TimeRadar metrics={timeRadar} size={Math.min(CW, 260)} />
            </View>
            <View style={{ gap: 6, marginTop: 8 }}>
              {timeRadar.map(m => (
                <View key={m.name} style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                  <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: m.value >= 80 ? '#22c55e' : m.value >= 50 ? '#f59e0b' : '#ef4444' }} />
                  <Text style={{ fontSize: 12, color: colors.mutedForeground, flex: 1 }}>{m.name}</Text>
                  <Text style={{ fontSize: 12, fontWeight: '600', color: colors.foreground }}>{m.value}分</Text>
                  <Text style={{ fontSize: 11, color: colors.mutedForeground, flex: 1.2, textAlign: 'right' }}>{m.detail}</Text>
                </View>
              ))}
            </View>
          </ChartCard>

          {/* 分析面板:支出/收入/转账 × 分类/成员/账户 饼图(点击查看流水) */}
          <ChartCard title="分析面板">
            {/* 类型切换 */}
            <View style={{ flexDirection: 'row', gap: 6, marginBottom: 8 }}>
              {([
                { key: 'EXPENSE', label: '支出', color: cc.expense },
                { key: 'INCOME', label: '收入', color: cc.income },
                { key: 'TRANSFER', label: '转账', color: cc.transfer },
              ] as const).map(t => (
                <Pressable key={t.key} onPress={() => { setAnalysisType(t.key); setPieSelected(null); }} style={{
                  flex: 1, paddingVertical: 7, alignItems: 'center', borderRadius: 8,
                  backgroundColor: analysisType === t.key ? alpha(t.color, 0.12) : colors.muted,
                  borderWidth: 1, borderColor: analysisType === t.key ? t.color : 'transparent',
                }}>
                  <Text style={{ fontSize: 12, fontWeight: '600', color: analysisType === t.key ? t.color : colors.mutedForeground }}>{t.label}</Text>
                </Pressable>
              ))}
            </View>
            {analysisLoading ? (
              <View style={{ paddingVertical: 40, alignItems: 'center' }}>
                <ActivityIndicator size="large" color={colors.primary} />
              </View>
            ) : (
            [
              { groupBy: 'category' as const, title: '分类占比', icon: PieIcon, data: analysis.category },
              { groupBy: 'ownerId' as const, title: '归属占比', icon: Users, data: analysis.owner },
              { groupBy: 'accountId' as const, title: '支付账户占比', icon: Wallet, data: analysis.account },
            ].map(({ groupBy, title, icon: Icon, data }) => {
              const selIdx = pieSelected?.groupBy === groupBy ? data.findIndex((d) => d.key === pieSelected.item.key) : -1;
              const sel = pieSelected?.groupBy === groupBy ? pieSelected.item : null;
              return (
                <View key={groupBy} style={{ marginBottom: 16 }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, marginBottom: 6, justifyContent: 'center' }}>
                    <Icon size={12} color={colors.mutedForeground} />
                    <Text style={{ fontSize: 12, color: colors.mutedForeground }}>{title}</Text>
                  </View>
                  {data.length === 0 ? (
                    <Text style={{ fontSize: 12, color: colors.mutedForeground, textAlign: 'center', paddingVertical: 20 }}>暂无数据</Text>
                  ) : (
                    <DonutChart
                      data={data.map((d) => ({ name: d.label, value: d.amount }))}
                      size={Math.min(CW, 180)}
                      selectedIndex={selIdx >= 0 ? selIdx : null}
                      onSelect={(i) => setPieSelected({ groupBy, item: data[i] })}
                    />
                  )}
                  {sel && (
                    <SelectionBlock
                      label={sel.label}
                      amount={sel.amount}
                      color={cc.COLORS[(selIdx >= 0 ? selIdx : 0) % cc.COLORS.length]}
                      onCancel={() => setPieSelected(null)}
                      onDetail={() => openPieDetail({ groupBy, item: sel })}
                    />
                  )}
                </View>
              );
            })
            )}
          </ChartCard>

          {/* 堆叠柱状图 */}
          <ChartCard title={mode === 'yearly' ? '各月分类支出构成' : '每日分类支出构成'}>
            {stacked.periods.length === 0 ? (
              <Text style={{ fontSize: 12, color: colors.mutedForeground, textAlign: 'center', paddingVertical: 20 }}>暂无数据</Text>
            ) : (
              <StackedBarChart
                periods={stacked.periods}
                categories={stacked.categories.map((c) => ({ name: c.name, data: c.data }))}
                selectedIndex={barSelected}
                onSelect={(periodIdx, catIdx) => setBarSelected({ periodIdx, catIdx })}
              />
            )}
            {barSelected && stacked.categories[barSelected.catIdx] && (
              <SelectionBlock
                label={`${stacked.periods[barSelected.periodIdx]} · ${stacked.categories[barSelected.catIdx].name}`}
                amount={stacked.categories[barSelected.catIdx].data[barSelected.periodIdx] ?? 0}
                color={cc.COLORS[barSelected.catIdx % cc.COLORS.length]}
                onCancel={() => setBarSelected(null)}
                onDetail={() => openBarDetail(barSelected)}
              />
            )}
          </ChartCard>
            </>
          )}
        </>
      )}
    </View>
  );

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }} edges={['bottom']}>
      {/* Tab 栏:4视图对齐网页端 */}
      <View style={{
        paddingHorizontal: 16, paddingTop: 8, paddingBottom: 4,
        backgroundColor: colors.background, zIndex: 10,
      }}>
        <View style={{ flexDirection: 'row', backgroundColor: colors.muted, borderRadius: 12, padding: 3, gap: 2 }}>
          {TABS.map(t => {
            const active = tab === t.key;
            return (
              <Pressable key={t.key} onPress={() => setTab(t.key)} style={{
                flex: 1, paddingVertical: 8, alignItems: 'center', borderRadius: 10,
                backgroundColor: active ? colors.card : 'transparent',
              }}>
                <Text style={{ fontSize: 13, fontWeight: '600', color: active ? colors.primary : colors.mutedForeground }}>{t.label}</Text>
              </Pressable>
            );
          })}
        </View>
      </View>

      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 16, paddingBottom: 40 }} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} colors={[colors.primary]} />}>
        {tab === 'overview' && renderOverview()}
        {tab === 'yearly' && renderTimeView('yearly')}
        {tab === 'monthly' && renderTimeView('monthly')}
        {tab === 'free' && renderTimeView('free')}
      </ScrollView>

      {/* 图表选中项的流水详情弹层(对齐 web Dialog:标题 + 流水列表,上滑分页) */}
      <FormSheet visible={!!detail} title={detail?.title ?? '流水详情'} onClose={() => setDetail(null)}>
        {detailLoading && detailRecords.length === 0 ? (
          <View style={{ paddingVertical: 40, alignItems: 'center' }}>
            <ActivityIndicator size="large" color={colors.primary} />
          </View>
        ) : detailRecords.length === 0 ? (
          <Text style={{ fontSize: 13, color: colors.mutedForeground, textAlign: 'center', paddingVertical: 32 }}>该范围内暂无流水</Text>
        ) : (
          <FlatList
            style={{ maxHeight: 480 }}
            data={detailRecords}
            keyExtractor={(r) => r.id}
            renderItem={({ item }) => <RecordRow record={item} />}
            ItemSeparatorComponent={() => <View style={{ height: 10 }} />}
            onEndReached={() => {
              if (detail && !detailLoading && detailPage * PAGE_SIZE < detailTotal) {
                loadDetailPage(detailPage + 1, detail.params, true);
              }
            }}
            onEndReachedThreshold={0.25}
            showsVerticalScrollIndicator={false}
            ListFooterComponent={
              <View style={{ paddingVertical: 12, alignItems: 'center' }}>
                {detailLoading ? (
                  <ActivityIndicator size="small" color={colors.primary} />
                ) : (
                  <Text style={{ fontSize: 11, color: colors.mutedForeground }}>
                    {detailPage * PAGE_SIZE >= detailTotal ? `已加载全部 ${detailTotal} 条` : '上滑加载更多'}
                  </Text>
                )}
              </View>
            }
          />
        )}
      </FormSheet>
    </SafeAreaView>
  );
}

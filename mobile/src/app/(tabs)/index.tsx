import { useCallback, useEffect, useMemo, useState } from 'react';
import { router, useIsFocused } from 'expo-router';
import { Pressable, ScrollView, View } from 'react-native';
import { AlertTriangle, ArrowDownRight, ArrowUpRight, CalendarClock, Camera, ChevronRight, FileUp, MessageSquareText, Plus } from 'lucide-react-native';
import { useTheme, alpha } from '@/theme';
import { useAuth } from '@/stores/auth';
import { useAIAvailability } from '@/hooks/useAIAvailability';
import { Screen } from '@/components/Screen';
import { FormSheet } from '@/components/chrome/FormSheet';
import { Card } from '@/components/ui/Card';
import { Text } from '@/components/ui/Text';
import { FadeInView } from '@/components/FadeInView';
import { LoadingState } from '@/components/ui/LoadingState';
import { fetchBudgets, fetchGroupSummary, fetchMonthlyTrend, fetchSummary, type GroupSummaryItem } from '@/services/records';
import { fetchRecurring } from '@/services/recurring';
import { uploadImage } from '@/services/chat';
import { showToast } from '@/components/chrome/Toast';
import { useRecords } from '@/stores/records';
import { useUIShell, usePageRefresh } from '@/components/chrome/chrome';
import { formatMoney, formatMoneyShort } from '@/lib/format';
import type { BudgetItem, RecordSummary, RecurringTransaction } from '@/types';

type Period = '本月' | '当年';

/** 本月日期范围(YYYY-MM-DD),与 web 首页「本月收入/支出/结余」同口径 */
function currentMonthRange() {
  const d = new Date();
  const y = d.getFullYear();
  const m = d.getMonth() + 1;
  const p = (n: number) => String(n).padStart(2, '0');
  return { dateFrom: `${y}-${p(m)}-01`, dateTo: `${y}-${p(m)}-${new Date(y, m, 0).getDate()}` };
}

// 首页:收支总览(品牌渐变) + 预算 + AI 助手 + 最近流水;数据消费 useRecords() 唯一数据源
export default function HomeScreen() {
  const { colors, palette } = useTheme();
  const { nickname } = useAuth();
  const [period, setPeriod] = useState<Period>('本月');
  const [activeIdx, setActiveIdx] = useState(0); // 收支总览当前页索引(圆点高亮,实时跟随滑动)
  const [budgets, setBudgets] = useState<BudgetItem[]>([]);
  const [budgetExp, setBudgetExp] = useState(false);
  const [yearIncome, setYearIncome] = useState(0);
  const [yearExpense, setYearExpense] = useState(0);
  /** 本月收支(后端聚合):store 的 summary 是全量口径,「本月收入/支出/结余」必须单独按当月取 */
  const [monthSummary, setMonthSummary] = useState<RecordSummary>({ income: 0, expense: 0, transfer: 0, netIncome: 0 });
  /** 本月支出 Top3 / 固定收支待办（仪表盘数据源） */
  const [topCategories, setTopCategories] = useState<GroupSummaryItem[]>([]);
  const [recurrings, setRecurrings] = useState<RecurringTransaction[]>([]);
  /** 图片记账:拍照/相册选择弹层 */
  const [imagePickerOpen, setImagePickerOpen] = useState(false);
  const { records, refresh, loading: recordsLoading } = useRecords();
  /** 预算/年度收支的首屏加载态(与 store 的流水加载态一起决定是否显示占位) */
  const [extraLoading, setExtraLoading] = useState(true);
  // 刷新时机:切到本页时(isFocused)重拉预算与年度收支
  const isFocused = useIsFocused();
  const { currentLedger, openAI, openRecord, pushPendingShare, openImportSheet } = useUIShell();
  // AI 助手可用性:未启用则整块隐藏;开着但没配模型则提示去配置(与 web 首页同语义)。
  // 传 isFocused:从设置里配好返回到本页时会重读,不必杀进程才生效。
  const ai = useAIAvailability(isFocused);
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
          fetchSummary(bookId, currentMonthRange()).then(setMonthSummary),
          fetchGroupSummary(bookId, { type: 'EXPENSE', groupBy: 'category', dateFrom: currentMonthRange().dateFrom, dateTo: currentMonthRange().dateTo }).then(setTopCategories).catch(() => {}),
          fetchRecurring(bookId).then(setRecurrings).catch(() => {}),
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
    if (!isFocused || !bookId) return;
    // 预算 + 年度收支都到齐再撤首屏占位(之后切页回来都是静默刷新,不闪 loading)
    Promise.all([
      fetchBudgets(bookId).then(setBudgets),
      // 当年收支:由月度趋势累计
      fetchMonthlyTrend(bookId).then((t) => {
        setYearIncome(t.income.reduce((s, x) => s + x, 0));
        setYearExpense(t.expense.reduce((s, x) => s + x, 0));
      }),
      // 本月收支:与 web 首页「本月收入/支出/结余」同口径(带当月 dateFrom/dateTo)
      fetchSummary(bookId, currentMonthRange()).then(setMonthSummary),
      // 仪表盘:本月支出 Top3 / 固定收支待办(单个失败不拖垮首屏)
      fetchGroupSummary(bookId, { type: 'EXPENSE', groupBy: 'category', dateFrom: currentMonthRange().dateFrom, dateTo: currentMonthRange().dateTo }).then(setTopCategories).catch(() => {}),
      fetchRecurring(bookId).then(setRecurrings).catch(() => {}),
    ]).catch(() => {}).finally(() => setExtraLoading(false));
  }, [isFocused, currentLedger.id]); // 切到本页时,预算进度与年度收支即时重算

  // 记一笔/编辑保存后由 RecordModal 直接调用:重拉预算与年度收支
  const reloadPage = useCallback(() => {
    const bookId = currentLedger.id;
    if (!bookId) return;
    fetchBudgets(bookId).then(setBudgets);
    fetchMonthlyTrend(bookId).then((t) => {
      setYearIncome(t.income.reduce((s, x) => s + x, 0));
      setYearExpense(t.expense.reduce((s, x) => s + x, 0));
    });
    fetchSummary(bookId, currentMonthRange()).then(setMonthSummary);
    fetchGroupSummary(bookId, { type: 'EXPENSE', groupBy: 'category', dateFrom: currentMonthRange().dateFrom, dateTo: currentMonthRange().dateTo }).then(setTopCategories).catch(() => {});
    fetchRecurring(bookId).then(setRecurrings).catch(() => {});
  }, [currentLedger.id]);
  usePageRefresh(reloadPage);

  /** 图片记账:选图/拍照 → 上传 → 预填到 AI 聊天(与系统分享链路同构) */
  const pickReceipt = async (camera: boolean) => {
    try {
      const ImagePicker = await import('expo-image-picker');
      const perm = camera
        ? await ImagePicker.requestCameraPermissionsAsync()
        : await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!perm.granted) { showToast('需要相机/相册权限'); return; }
      const result = camera
        ? await ImagePicker.launchCameraAsync({ quality: 0.8 })
        : await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.8 });
      if (result.canceled || !result.assets?.length) return;
      const asset = result.assets[0];
      showToast('正在上传图片...');
      const up = await uploadImage(asset.uri, asset.fileName || `receipt-${Date.now()}.jpg`, asset.mimeType || 'image/jpeg');
      // 预填到 AI 聊天:与系统分享进入聊天的链路完全一致
      pushPendingShare({
        attachments: [{ id: up.id, uri: up.fullUrl || up.url, fullUrl: up.fullUrl || up.url, originalFilename: asset.fileName || '图片' }],
      });
      openAI();
    } catch (e: any) {
      showToast(`上传失败: ${e?.message || '未知错误'}`);
    }
  };

  // 本月预算项:当年当月 + 年度预算(month:null,与预算管理页当月视图口径一致)
  const now = new Date();
  const monthlyBudgets = useMemo(
    () => budgets.filter((b) => b.year === now.getFullYear() && (b.month === now.getMonth() + 1 || b.month === null)),
    [budgets], // eslint-disable-line react-hooks/exhaustive-deps
  );
  const totalBudget = monthlyBudgets.reduce((s, b) => s + b.amount, 0);
  const totalUsed = monthlyBudgets.reduce((s, b) => s + b.actualAmount, 0);
  const pct = totalBudget ? Math.min(100, Math.round((totalUsed / totalBudget) * 100)) : 0;

  /** 收支总览两页数据(月度/年度) */
  const overviewPages = [
    {
      key: '本月' as Period,
      // 期间写清楚,「月度」两个字看不出是哪个月
      periodLabel: `${now.getFullYear()}年${now.getMonth() + 1}月`,
      income: monthSummary.income,
      expense: monthSummary.expense,
      net: monthSummary.netIncome,
    },
    {
      key: '当年' as Period,
      periodLabel: `${now.getFullYear()}年`,
      income: yearIncome,
      expense: yearExpense,
      net: yearIncome - yearExpense,
    },
  ];
  /** 卡内滑动页宽:不手算(padding 链路容易漏),用 onLayout 实测 ScrollView 视口宽 */
  const [innerW, setInnerW] = useState(0);

  // ── 本月支出 Top3(横条相对宽度用第一名归一) ──
  const topExpense = useMemo(() => topCategories.slice(0, 3), [topCategories]);
  const topExpenseMax = topExpense[0]?.amount ?? 0;

  // ── 超预算预警(对齐 web 首页:≥85% 提醒,≥100% 危险) ──
  const budgetAlerts = useMemo(
    () => monthlyBudgets
      .filter((b) => b.amount > 0 && b.actualAmount / b.amount >= 0.85)
      .sort((a, b) => b.actualAmount / b.amount - a.actualAmount / a.amount),
    [monthlyBudgets],
  );

  // ── 固定收支待办:下次生成时间在未来 7 天内,按日期升序取前 5 ──
  // 不用 useMemo:内部要取当前时间,放 hook 里会触发 react-hooks/purity(数据量小,重算无妨)
  const recurringDue = (() => {
    const now = new Date().getTime();
    const week = 7 * 24 * 3600 * 1000;
    return recurrings
      .filter((r) => r.active !== false && r.nextGenerateAt)
      .map((r) => ({ ...r, ts: new Date(r.nextGenerateAt as string).getTime() }))
      .filter((r) => r.ts >= now && r.ts - now <= week)
      .sort((a, b) => a.ts - b.ts)
      .slice(0, 5);
  })();



  /** 首屏占位:流水 store 与预算/年度收支全部到齐前,不渲染数据块(避免 ¥0 → 真实值的整体重排) */
  const bootLoading = recordsLoading || extraLoading;

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
        {/* 问候 + AI 助手融合:问候为主视觉,右上角 AI 入口、下方一行洞察。
            未启用 AI ⇒ 只剩问候;已启用未配置 ⇒ 洞察位提示去设置 */}
        <FadeInView>
          <Pressable
            disabled={!ai.enabled}
            onPress={() => { if (!ai.configured) { router.push('/settings'); return; } openAI(); }}
            className="mb-4"
          >
            {/* 头像在最左,问候/洞察靠右成列 —— 消息列表项的经典布局,视线从头像自然落到文字 */}
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
              {ai.enabled && (
                <View style={{ width: 46, height: 46, borderRadius: 14, alignItems: 'center', justifyContent: 'center', backgroundColor: alpha(colors.primary, 0.12) }}>
                  <Text style={{ fontSize: 24 }}>🤖</Text>
                </View>
              )}
              <View style={{ flex: 1 }}>
                <Text variant="muted" style={{ fontSize: 13 }}>{period === '本月' ? '下午好' : '近况概览'}</Text>
                <Text style={{ fontSize: 22, fontWeight: '700', marginTop: 1 }}>{nickname || '朋友'} 👋</Text>
                {ai.enabled && !bootLoading && (
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 6 }}>
                    <Text variant="muted" style={{ fontSize: 12, flex: 1 }} numberOfLines={1}>
                      {ai.configured ? `💡 ${insight}` : 'AI 助手尚未配置模型，点击前往设置'}
                    </Text>
                    <ChevronRight size={12} color={colors.mutedForeground} />
                  </View>
                )}
              </View>
            </View>
          </Pressable>
        </FadeInView>

        {/* 数据未就绪时统一占位,避免先渲染 ¥0 总览 / 空预算 / 空流水再整体重排 */}
        {bootLoading && <LoadingState paddingVertical={90} text="正在加载账本数据..." />}
        {!bootLoading && (
        <>
        <FadeInView index={1}>
          {/* 卡壳固定,内部横向滑动切换月度/年度 —— 整卡滑动时背景跟着位移,观感很跳 */}
          <View
            style={{ backgroundColor: colors.card, borderRadius: palette.radius.card, borderWidth: 1, borderColor: colors.border, padding: 12, marginBottom: 12 }}
          >
            {/* 头部:期间左上、指示点右上 —— 视觉重心上移,底部留给资产行 */}
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
              <Text style={{ color: colors.mutedForeground, fontSize: 11.5, fontWeight: '600' }}>
                {overviewPages[activeIdx].periodLabel}
              </Text>
              <View style={{ flexDirection: 'row', gap: 5 }}>
                {[0, 1].map((i) => (
                  <View key={i} style={{ width: 5, height: 5, borderRadius: 2.5, backgroundColor: activeIdx === i ? colors.primary : colors.border }} />
                ))}
              </View>
            </View>

            {/* 数字区:卡内滑动,只有结余/收支跟着翻页 */}
            <ScrollView
              horizontal
              pagingEnabled
              showsHorizontalScrollIndicator={false}
              onLayout={(e) => setInnerW(e.nativeEvent.layout.width)}
              onScroll={(e) => {
                const idx = Math.round(e.nativeEvent.contentOffset.x / (innerW || 1));
                setActiveIdx(Math.max(0, Math.min(idx, 1)));
              }}
              scrollEventThrottle={16}
              onMomentumScrollEnd={(e) => {
                const idx = Math.round(e.nativeEvent.contentOffset.x / (innerW || 1));
                setActiveIdx(idx);
                setPeriod(idx >= 1 ? '当年' : '本月');
              }}
              style={{ marginTop: 10 }}
            >
              {overviewPages.map((d) => (
                <View key={d.key} style={{ width: innerW || undefined }}>
                  <Text style={{ color: colors.mutedForeground, fontSize: 11, marginTop: 8 }}>
                    {d.key === '本月' ? '本月结余' : '本年结余'}
                  </Text>
                  <Text
                    style={{ color: d.net >= 0 ? colors.foreground : colors.expense, fontSize: 24, fontWeight: '800', fontVariant: ['tabular-nums'], marginTop: 1 }}
                    numberOfLines={1}
                    adjustsFontSizeToFit
                  >
                    {formatMoneyShort(d.net)}
                  </Text>

                  {/* 收支两个块:语义色标识,底色与卡片同系 */}
                  <View style={{ flexDirection: 'row', gap: 8, marginTop: 10 }}>
                    <View style={{ flex: 1, borderRadius: 12, backgroundColor: colors.muted, paddingVertical: 8, paddingHorizontal: 10 }}>
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                        <ArrowUpRight size={11} color={colors.income} />
                        <Text style={{ color: colors.mutedForeground, fontSize: 10.5 }}>收入</Text>
                      </View>
                      <Text style={{ color: colors.income, fontSize: 14, fontWeight: '700', fontVariant: ['tabular-nums'], marginTop: 2 }}>
                        {formatMoneyShort(d.income)}
                      </Text>
                    </View>
                    <View style={{ flex: 1, borderRadius: 12, backgroundColor: colors.muted, paddingVertical: 8, paddingHorizontal: 10 }}>
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                        <ArrowDownRight size={11} color={colors.expense} />
                        <Text style={{ color: colors.mutedForeground, fontSize: 10.5 }}>支出</Text>
                      </View>
                      <Text style={{ color: colors.expense, fontSize: 14, fontWeight: '700', fontVariant: ['tabular-nums'], marginTop: 2 }}>
                        {formatMoneyShort(d.expense)}
                      </Text>
                    </View>
                  </View>
                </View>
              ))}
            </ScrollView>


          </View>
        </FadeInView>

        {/* 快捷操作:无边框圆形图标,视觉更轻。「导入」切到流水页并弹出其导入面板 */}
        <View style={{ flexDirection: 'row', marginBottom: 10 }}>
          {[
            { icon: Plus, label: '记一笔', onPress: () => openRecord() },
            { icon: FileUp, label: '导入', onPress: () => { openImportSheet(); router.push('/(tabs)/records'); } },
            { icon: MessageSquareText, label: '短信/通知', onPress: () => router.push('/sms-import') },
            { icon: Camera, label: '图片记账', onPress: () => setImagePickerOpen(true) },
          ].map((a) => (
            <Pressable
              key={a.label}
              onPress={a.onPress}
              style={{ flex: 1, alignItems: 'center', gap: 6, paddingVertical: 6 }}
            >
              <View
                style={{
                  width: 42, height: 42, borderRadius: 21, alignItems: 'center', justifyContent: 'center',
                  backgroundColor: alpha(colors.primary, 0.1), borderWidth: 1, borderColor: alpha(colors.primary, 0.18),
                }}
              >
                <a.icon size={18} color={colors.primary} />
              </View>
              <Text style={{ fontSize: 11, color: colors.mutedForeground }}>{a.label}</Text>
            </Pressable>
          ))}
        </View>

        {/* 预算(当月无预算数据时不展示) */}
        {monthlyBudgets.length > 0 && (
          <FadeInView index={2}>
            <Card className="px-5 py-4 mb-3">
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

        {/* 超预算预警(≥85% 提醒 / ≥100% 危险,仅在有预警项时展示) */}
        {budgetAlerts.length > 0 && (
          <FadeInView index={5}>
            <View style={{ marginBottom: 12, borderRadius: 14, borderWidth: 1, borderColor: alpha(colors.expense, 0.4), backgroundColor: alpha(colors.expense, 0.06), padding: 12, gap: 8 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                <AlertTriangle size={14} color={colors.expense} />
                <Text style={{ fontSize: 13, fontWeight: '600', color: colors.expense }}>预算预警</Text>
              </View>
              {budgetAlerts.slice(0, 3).map((b) => {
                const bp = Math.round((b.actualAmount / b.amount) * 100);
                return (
                  <View key={b.id} style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
                    <Text style={{ fontSize: 12.5 }} numberOfLines={1}>{b.name}</Text>
                    <Text style={{ fontSize: 12, fontWeight: '600', color: bp >= 100 ? colors.expense : colors.mutedForeground }}>
                      {bp}% · 已用 {formatMoneyShort(b.actualAmount)}
                    </Text>
                  </View>
                );
              })}
            </View>
          </FadeInView>
        )}

        {/* 本月支出 Top3(点击右上角跳统计页) */}
        {topExpense.length > 0 && (
          <FadeInView index={6}>
            <Card className="px-5 py-4 mb-3">
              <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
                <Text style={{ fontSize: 14, fontWeight: '600' }}>本月支出 Top{topExpense.length}</Text>
                <Pressable onPress={() => router.push('/(tabs)/stats')} style={{ flexDirection: 'row', alignItems: 'center', gap: 2 }}>
                  <Text variant="muted" style={{ fontSize: 11 }}>查看统计</Text>
                  <ChevronRight size={12} color={colors.mutedForeground} />
                </Pressable>
              </View>
              {topExpense.map((c, i) => (
                <View key={c.key} style={{ marginBottom: i === topExpense.length - 1 ? 0 : 10 }}>
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 4 }}>
                    <Text style={{ fontSize: 12.5, flex: 1, marginRight: 8 }} numberOfLines={1}>{i + 1}. {c.label}</Text>
                    <Text style={{ fontSize: 12.5, fontWeight: '600', fontVariant: ['tabular-nums'] }}>{formatMoneyShort(c.amount)}</Text>
                  </View>
                  <View style={{ height: 6, borderRadius: 3, backgroundColor: colors.muted, overflow: 'hidden' }}>
                    <View
                      style={{ width: `${topExpenseMax ? Math.max(6, Math.round((c.amount / topExpenseMax) * 100)) : 0}%`, height: '100%', backgroundColor: colors.primary, borderRadius: 3 }}
                    />
                  </View>
                </View>
              ))}
            </Card>
          </FadeInView>
        )}

        {/* 固定收支待办:未来 7 天内将生成,仅在有项时展示 */}
        {recurringDue.length > 0 && (
          <FadeInView index={7}>
            <Card className="px-5 py-4 mb-3">
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 8 }}>
                <CalendarClock size={14} color={colors.primary} />
                <Text style={{ fontSize: 14, fontWeight: '600' }}>近 7 天固定收支</Text>
              </View>
              {recurringDue.map((r, i) => (
                <View
                  key={r.id}
                  style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 8, borderTopWidth: i > 0 ? 1 : 0, borderTopColor: colors.hairline }}
                >
                  <Text style={{ fontSize: 12.5, flex: 1, marginRight: 8 }} numberOfLines={1}>
                    {r.categoryCode || '未分类'}{r.accountName ? ` · ${r.accountName}` : ''}
                  </Text>
                  <Text variant="muted" style={{ fontSize: 12, fontVariant: ['tabular-nums'] }}>
                    {(r.nextGenerateAt as string).slice(5, 10)} · {formatMoneyShort(r.amount)}
                  </Text>
                </View>
              ))}
            </Card>
          </FadeInView>
        )}



        </>
        )}

        {/* 图片记账:拍照/相册选择(风格与 app 内其它弹层一致) */}
        <FormSheet visible={imagePickerOpen} title="图片记账" onClose={() => setImagePickerOpen(false)}>
          <View style={{ gap: 10, paddingBottom: 8 }}>
            <Pressable
              onPress={() => { setImagePickerOpen(false); void pickReceipt(true); }}
              style={{ flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14, borderRadius: 12, backgroundColor: colors.muted }}
            >
              <View style={{ width: 38, height: 38, borderRadius: 10, alignItems: 'center', justifyContent: 'center', backgroundColor: alpha(colors.primary, 0.12) }}>
                <Camera size={18} color={colors.primary} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={{ fontSize: 14, fontWeight: '600' }}>拍照</Text>
                <Text variant="muted" style={{ fontSize: 11.5, marginTop: 1 }}>拍摄小票/收据,自动识别金额与日期</Text>
              </View>
            </Pressable>
            <Pressable
              onPress={() => { setImagePickerOpen(false); void pickReceipt(false); }}
              style={{ flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14, borderRadius: 12, backgroundColor: colors.muted }}
            >
              <View style={{ width: 38, height: 38, borderRadius: 10, alignItems: 'center', justifyContent: 'center', backgroundColor: alpha(colors.primary, 0.12) }}>
                <FileUp size={18} color={colors.primary} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={{ fontSize: 14, fontWeight: '600' }}>从相册选择</Text>
                <Text variant="muted" style={{ fontSize: 11.5, marginTop: 1 }}>选择已保存的小票或账单截图</Text>
              </View>
            </Pressable>
          </View>
        </FormSheet>
      </View>
    </Screen>
  );
}

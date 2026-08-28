import { useCallback, useEffect, useMemo, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, View, useWindowDimensions } from 'react-native';
import { ChevronLeft, ChevronRight, CalendarCheck } from 'lucide-react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, { runOnJS, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { useTheme, haptics, alpha } from '@/theme';
import { Screen } from '@/components/Screen';
import { Card } from '@/components/ui/Card';
import { Text } from '@/components/ui/Text';
import { RecordRow } from '@/components/RecordRow';
import { FormSheet } from '@/components/chrome/FormSheet';
import { useUIShell } from '@/components/chrome/chrome';
import { fetchCalendar, fetchRecords, type CalendarDay } from '@/services/records';
import { holidayApi, type HolidayItem } from '@/services/settings';
import { useRecords } from '@/stores/records';
import type { RecordItem } from '@/types';
import { formatMoney, formatMoneyShort } from '@/lib/format';

const WEEKDAYS = ['一', '二', '三', '四', '五', '六', '日'];
const ROW_FULL = 64; // 日历行高(始终不变,压缩的是可视高度)
const CALM_ROWS = 3; // 压缩态可见行数(其余上下滚动展示)

// 真实"今天"的 yyyy-mm-dd(独立于日历正在浏览的年月,每次渲染重取以处理跨天)
const todayDateKey = () => {
  const t = new Date();
  return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}-${String(t.getDate()).padStart(2, '0')}`;
};

// 流水日历:月历网格(日期下常显当日收支) + 选中压缩日历可视高度(整月仍可滚动)+ 放大当日流水(点击记录可编辑)+ 年月快速导航
export default function CalendarScreen() {
  const { colors } = useTheme();
  const { width } = useWindowDimensions();
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1); // 1-12
  const [selected, setSelected] = useState(now.getDate());
  // 分类图标(图标来源复用 records store 的分类)
  const { categories, refresh } = useRecords();
  const { currentLedger, openRecord } = useUIShell();
  const bookId = currentLedger.id;
  const [ymOpen, setYmOpen] = useState(false);
  const [pickY, setPickY] = useState(year);
  const [expanded, setExpanded] = useState(true); // 日历展开态(选中日压缩后为 false)

  // 月视图每日汇总(独立请求,按年月拉取)与选中日流水
  const [monthlyDays, setMonthlyDays] = useState<CalendarDay[]>([]);
  const [dayList, setDayList] = useState<RecordItem[]>([]);
  useEffect(() => {
    if (!bookId) return;
    let cancel = false;
    fetchCalendar(bookId, year, month).then((d) => { if (!cancel) setMonthlyDays(d); });
    return () => { cancel = true; };
  }, [bookId, year, month]);
  useEffect(() => {
    if (!bookId) return;
    let cancel = false;
    const date = key(selected);
    fetchRecords(bookId, { page: 1, pageSize: 100, dateFrom: date, dateTo: date }).then((list) => { if (!cancel) setDayList(list); });
    return () => { cancel = true; };
  }, [bookId, year, month, selected]);

  // 节假日/调休数据(按年拉取,同 web 端 /api/holidays)
  const [holidays, setHolidays] = useState<HolidayItem[]>([]);
  useEffect(() => {
    let cancel = false;
    holidayApi.getByYear(year).then((d) => { if (!cancel) setHolidays(d); }).catch(() => {});
    return () => { cancel = true; };
  }, [year]);

  const [refreshing, setRefreshing] = useState(false);
  // 下拉刷新:重拉 store(分类) + 月汇总 + 当日流水
  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      if (!bookId) return;
      const date = key(selected);
      await Promise.all([
        refresh(),
        fetchCalendar(bookId, year, month).then(setMonthlyDays),
        fetchRecords(bookId, { page: 1, pageSize: 100, dateFrom: date, dateTo: date }).then(setDayList),
      ]);
    } finally {
      setRefreshing(false);
    }
  }, [refresh, bookId, year, month, selected]);

  const days = useMemo(() => {
    const first = new Date(year, month - 1, 1);
    const offset = (first.getDay() + 6) % 7; // 周一为首
    const total = new Date(year, month, 0).getDate();
    return [...Array(offset).fill(0), ...Array.from({ length: total }, (_, i) => i + 1)];
  }, [year, month]);

  // 日历总行数 -> 展开态高度;压缩态只显示 3 行,内部滚动查看整月
  const gridRows = Math.ceil(days.length / 7);
  const fullH = gridRows * ROW_FULL;
  const calmH = CALM_ROWS * ROW_FULL;

  // 选中日期时压缩日历可视高度(行高不变,网格可上下滚动)
  const compress = useSharedValue(0);
  const gridBoxStyle = useAnimatedStyle(() => ({
    height: fullH + (calmH - fullH) * compress.value,
    overflow: 'hidden' as const,
  }));

  const key = (d: number) => `${year}-${String(month).padStart(2, '0')}-${String(d).padStart(2, '0')}`;

  // 每日收支汇总(来自后端 /api/records/calendar 月视图)
  const daySum = useMemo(() => {
    const m: Record<string, { income: number; expense: number; transfer: number }> = {};
    for (const d of monthlyDays) {
      m[d.date] = { income: d.income, expense: d.expense, transfer: d.transfer };
    }
    return m;
  }, [monthlyDays]);

  // 节假日索引(yyyy-mm-dd → 节假日信息)
  const holidayMap = useMemo(() => {
    const m: Record<string, HolidayItem> = {};
    for (const h of holidays) m[h.date.slice(0, 10)] = h;
    return m;
  }, [holidays]);

  const dayRecords = dayList;
  const dayTotals = useMemo(() => {
    let income = 0, expense = 0, transfer = 0;
    for (const r of dayRecords) {
      if (r.type === 'INCOME') income += r.amount;
      else if (r.type === 'EXPENSE') expense += r.amount;
      else transfer += r.amount;
    }
    return { income, expense, transfer };
  }, [dayRecords]);

  const nav = (delta: number) => {
    const next = new Date(year, month - 1 + delta, 1);
    setYear(next.getFullYear());
    setMonth(next.getMonth() + 1);
    setSelected(1);
  };

  // 快速返回当日
  const goToday = () => {
    const t = new Date();
    setYear(t.getFullYear());
    setMonth(t.getMonth() + 1);
    setSelected(t.getDate());
    setExpanded(false);
    compress.value = withTiming(1, { duration: 220 });
  };

  // 重新展开日历
  const expand = () => {
    setExpanded(true);
    compress.value = withTiming(0, { duration: 220 });
  };

  const onPressDay = (d: number) => {
    // 点击已选中的日期 -> 重新展开
    if (!expanded && d === selected) {
      expand();
      return;
    }
    setSelected(d);
    setExpanded(false);
    compress.value = withTiming(1, { duration: 220 });
  };

  // 向下滑动当日流水区域 -> 重新展开日历
  // 降低触发阈值,让轻微下滑即可展开
  const panExpand = Gesture.Pan()
    .enabled(!expanded)
    .activeOffsetY(8)
    .onEnd((e) => {
      if (e.translationY > 20) runOnJS(expand)();
    });

  // 年月快速导航:选择某年某月后跳转
  const onPick = (y: number, m: number) => {
    setYear(y);
    setMonth(m);
    setSelected(1);
    setExpanded(false);
    compress.value = withTiming(1, { duration: 220 });
    setYmOpen(false);
  };

  const todayKey = todayDateKey();
  const cellW = `${100 / 7}%`;

  return (
    <Screen>
      <View style={{ flex: 1, paddingHorizontal: 20, paddingTop: 8 }}>
        <Text style={{ fontSize: 20, fontWeight: '700', marginBottom: 12 }}>流水日历</Text>

        {/* 月份切换 */}
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
          {/* 点击年月 → 快速导航 */}
          <Pressable onPress={() => { setPickY(year); setYmOpen(true); }} style={{ flexDirection: 'row', alignItems: 'center' }}>
            <Text style={{ fontSize: 15, fontWeight: '700', color: colors.primary }}>{year}年{month}月</Text>
          </Pressable>
          <View style={{ flexDirection: 'row', gap: 8 }}>
            <Pressable onPress={() => nav(-1)} style={{ width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.muted }}>
              <ChevronLeft size={16} color={colors.foreground} />
            </Pressable>
            <Pressable onPress={() => nav(1)} style={{ width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.muted }}>
              <ChevronRight size={16} color={colors.foreground} />
            </Pressable>
            {/* 返回今日 */}
            <Pressable onPress={goToday} style={{ height: 34, paddingHorizontal: 10, borderRadius: 17, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 4, backgroundColor: alpha(colors.primary, 0.12) }}>
              <CalendarCheck size={15} color={colors.primary} />
              <Text style={{ fontSize: 12, fontWeight: '600', color: colors.primary }}>今日</Text>
            </Pressable>
          </View>
        </View>

        {/* 星期表头 */}
        <View style={{ flexDirection: 'row', marginBottom: 6 }}>
          {WEEKDAYS.map((w) => (
            <View key={w} style={{ width: cellW, alignItems: 'center' }}>
              <Text variant="muted" style={{ fontSize: 12, fontWeight: '600' }}>{w}</Text>
            </View>
          ))}
        </View>

        {/* 日历网格:选中后压缩可视高度,整月上下滚动展示;日期下收支金额常显 */}
        <Animated.View style={gridBoxStyle}>
          <ScrollView showsVerticalScrollIndicator={false} nestedScrollEnabled refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} colors={[colors.primary]} />}>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
              {days.map((d, i) => {
                if (d === 0) return <View key={`b${i}`} style={{ width: cellW, alignItems: 'center', justifyContent: 'center', height: ROW_FULL }} />;
                const isToday = key(d) === todayKey;
                const isSel = d === selected;
                const sum = daySum[key(d)];
                const hasSum = !!sum && (sum.income > 0 || sum.expense > 0 || sum.transfer > 0);
                const holiday = holidayMap[key(d)];
                return (
                  <Pressable key={d} onPress={() => onPressDay(d)} style={{ width: cellW, height: ROW_FULL, alignItems: 'center', justifyContent: 'flex-start', paddingTop: 3 }}>
                    <View style={{ width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center', backgroundColor: isSel || isToday ? colors.primary : 'transparent' }}>
                      {/* 节假日数字标红(同 web 端法定休日 rose 色),选中/今天保持主色 */}
                      <Text style={{ fontSize: 13, fontWeight: isToday || isSel ? '700' : '400', color: isSel || isToday ? colors.primaryForeground : holiday && !holiday.isWorkday ? colors.expense : colors.foreground }}>
                        {d}
                      </Text>
                    </View>
                    {/* 节假日名称/调休班标记(同 web 端:休日显示名称,调休日显示"班") */}
                    {holiday && (
                      <Text numberOfLines={1} style={{ fontSize: 8.5, lineHeight: 11, marginTop: 1, maxWidth: '100%', color: holiday.isWorkday ? colors.mutedForeground : colors.expense, fontWeight: holiday.isWorkday ? '400' : '500' }}>
                        {holiday.isWorkday ? '班' : holiday.name}
                      </Text>
                    )}
                    {hasSum && (
                      <View style={{ alignItems: 'center', marginTop: 2 }}>
                        {sum!.transfer > 0 && (
                          <Text style={{ fontSize: 8.5, color: colors.transfer, fontVariant: ['tabular-nums'], lineHeight: 12 }} numberOfLines={1}>↻{formatMoneyShort(sum!.transfer)}</Text>
                        )}
                        {sum!.expense > 0 && (
                          <Text style={{ fontSize: 8.5, color: colors.expense, fontVariant: ['tabular-nums'], lineHeight: 12 }} numberOfLines={1}>-{formatMoneyShort(sum!.expense)}</Text>
                        )}
                        {sum!.income > 0 && (
                          <Text style={{ fontSize: 8.5, color: colors.income, fontVariant: ['tabular-nums'], lineHeight: 12 }} numberOfLines={1}>+{formatMoneyShort(sum!.income)}</Text>
                        )}
                      </View>
                    )}
                  </Pressable>
                );
              })}
            </View>
          </ScrollView>
        </Animated.View>

        {/* 当日流水:压缩日历后占满剩余高度,内部可滚动;向下滑动可重新展开日历;点击记录可编辑 */}
        <View style={{ flex: 1, marginTop: 12 }} pointerEvents="box-none">
          {/* 下滑展开:把手 + 标题行 整个区域都可触发,非仅小把手 */}
          {!expanded && (
            <GestureDetector gesture={panExpand}>
              <View style={{ paddingBottom: 10 }}>
                {/* 把手(视觉提示) */}
                <View style={{ alignItems: 'center', paddingTop: 8, paddingBottom: 6 }}>
                  <View style={{ width: 48, height: 5, borderRadius: 3, backgroundColor: colors.muted }} />
                </View>
                {/* 标题行也纳入手势区域 */}
                <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
                  <Text style={{ fontSize: 15, fontWeight: '600' }}>当日流水</Text>
                  {/* 支出/收入/转账同步展示 */}
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                    {dayTotals.expense > 0 && (
                      <Text style={{ fontSize: 12, color: colors.expense, fontVariant: ['tabular-nums'] }}>支 {formatMoneyShort(dayTotals.expense)}</Text>
                    )}
                    {dayTotals.income > 0 && (
                      <Text style={{ fontSize: 12, color: colors.income, fontVariant: ['tabular-nums'] }}>收 {formatMoneyShort(dayTotals.income)}</Text>
                    )}
                    {dayTotals.transfer > 0 && (
                      <Text style={{ fontSize: 12, color: colors.transfer, fontVariant: ['tabular-nums'] }}>转 {formatMoneyShort(dayTotals.transfer)}</Text>
                    )}
                    {dayTotals.expense === 0 && dayTotals.income === 0 && dayTotals.transfer === 0 && (
                      <Text variant="muted" style={{ fontSize: 12 }}>{month}月{selected}日</Text>
                    )}
                  </View>
                </View>
              </View>
            </GestureDetector>
          )}
          {expanded && (
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
              <Text style={{ fontSize: 15, fontWeight: '600' }}>当日流水</Text>
            </View>
          )}
          <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingBottom: 24 }} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
            <Card className="px-5 py-4">
              {dayRecords.length === 0 ? (
                <View className="items-center py-10"><Text variant="muted">当天暂无流水</Text></View>
              ) : (
                dayRecords.map((r, i) => (
                  <View key={r.id}>
                    <Pressable
                      onPress={() => {
                        haptics.tap();
                        openRecord(r);
                      }}
                    >
                      <RecordRow record={r} showDivider={i < dayRecords.length - 1} />
                    </Pressable>
                    {i < dayRecords.length - 1 && <View style={{ height: 14 }} />}
                  </View>
                ))
              )}
            </Card>
          </ScrollView>
        </View>
      </View>

      {/* 年月快速导航弹窗 */}
      <FormSheet visible={ymOpen} title="选择年月" onClose={() => setYmOpen(false)}>
        <View style={{ marginBottom: 8 }}>
          {/* 年份切换 */}
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
            <Pressable onPress={() => setPickY((v) => v - 1)} style={{ width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.muted }}>
              <ChevronLeft size={16} color={colors.foreground} />
            </Pressable>
            <Text style={{ fontSize: 16, fontWeight: '700' }}>{pickY} 年</Text>
            <Pressable onPress={() => setPickY((v) => v + 1)} style={{ width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.muted }}>
              <ChevronRight size={16} color={colors.foreground} />
            </Pressable>
          </View>
          {/* 月网格 */}
          <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
            {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => {
              const active = m === month && pickY === year;
              return (
                <Pressable
                  key={m}
                  onPress={() => onPick(pickY, m)}
                  style={{ width: '25%', aspectRatio: 1.3, justifyContent: 'center', alignItems: 'center', padding: 4 }}
                >
                  <View
                    style={{
                      flex: 1, alignSelf: 'stretch', borderRadius: 12, alignItems: 'center', justifyContent: 'center',
                      backgroundColor: active ? colors.primary : colors.muted,
                    }}
                  >
                    <Text style={{ fontSize: 14, fontWeight: active ? '700' : '500', color: active ? colors.primaryForeground : colors.foreground }}>{m}月</Text>
                  </View>
                </Pressable>
              );
            })}
          </View>
        </View>
      </FormSheet>
    </Screen>
  );
}

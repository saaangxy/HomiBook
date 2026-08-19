import { useEffect, useMemo, useState } from 'react';
import { Pressable, ScrollView, View, useWindowDimensions } from 'react-native';
import { ChevronLeft, ChevronRight } from 'lucide-react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, { runOnJS, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { useTheme } from '@/theme';
import { Screen } from '@/components/Screen';
import { Card } from '@/components/ui/Card';
import { Text } from '@/components/ui/Text';
import { RecordRow } from '@/components/RecordRow';
import { FormSheet } from '@/components/chrome/FormSheet';
import { fetchRecords, fetchCategories } from '@/services/records';
import { formatMoney, formatMoneyShort } from '@/lib/format';
import type { RecordItem } from '@/types';

const WEEKDAYS = ['一', '二', '三', '四', '五', '六', '日'];
const ROW_FULL = 64; // 日历格 全高
const ROW_CALM = 48; // 选中压缩后高度

// 流水日历:月历网格(流水高亮/今日橙底/当日收支) + 选中日流水(选中后压缩日历、放大当日流水)+ 点击年月快速导航
export default function CalendarScreen() {
  const { colors } = useTheme();
  const { width } = useWindowDimensions();
  const [year, setYear] = useState(2026);
  const [month, setMonth] = useState(8); // 1-12
  const [selected, setSelected] = useState(17);
  const [records, setRecords] = useState<RecordItem[]>([]);
  const [catMap, setCatMap] = useState<Record<string, string>>({});
  const [ymOpen, setYmOpen] = useState(false);
  const [pickY, setPickY] = useState(year);
  const [expanded, setExpanded] = useState(true); // 日历展开态(选中日压缩后为 false)

  // 选中日期时压缩日历行高(Reanimated)
  const compress = useSharedValue(0);
  const rowStyle = useAnimatedStyle(() => ({ height: ROW_FULL + (ROW_CALM - ROW_FULL) * compress.value }));
  // 压缩后隐藏日期下的当日收支金额
  const moneyStyle = useAnimatedStyle(() => ({ opacity: 1 - compress.value }));

  useEffect(() => {
    fetchRecords().then(setRecords);
    fetchCategories().then((c) => setCatMap(Object.fromEntries(c.map((x) => [x.code, x.icon]))));
  }, []);

  const days = useMemo(() => {
    const first = new Date(year, month - 1, 1);
    const offset = (first.getDay() + 6) % 7; // 周一为首
    const total = new Date(year, month, 0).getDate();
    return [...Array(offset).fill(0), ...Array.from({ length: total }, (_, i) => i + 1)];
  }, [year, month]);

  const key = (d: number) => `${year}-${String(month).padStart(2, '0')}-${String(d).padStart(2, '0')}`;

  // 每日收支汇总
  const daySum = useMemo(() => {
    const m: Record<string, { income: number; expense: number }> = {};
    for (const r of records) {
      const e = (m[r.date] ??= { income: 0, expense: 0 });
      if (r.type === 'INCOME') e.income += r.amount;
      else if (r.type === 'EXPENSE') e.expense += r.amount;
    }
    return m;
  }, [records]);

  const dayRecords = records.filter((r) => r.date === key(selected));
  const dayExpense = dayRecords.filter((r) => r.type === 'EXPENSE').reduce((s, r) => s + r.amount, 0);

  const nav = (delta: number) => {
    const next = new Date(year, month - 1 + delta, 1);
    setYear(next.getFullYear());
    setMonth(next.getMonth() + 1);
    setSelected(1);
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
  const panExpand = Gesture.Pan()
    .enabled(!expanded)
    .activeOffsetY(18)
    .onEnd((e) => {
      if (e.translationY > 40) runOnJS(expand)();
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

  const todayKey = key(new Date().getDate());
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
            <Text style={{ fontSize: 13, color: colors.primary, marginLeft: 4, transform: [{ translateY: -1 }] }}>⌄</Text>
          </Pressable>
          <View style={{ flexDirection: 'row', gap: 8 }}>
            <Pressable onPress={() => nav(-1)} style={{ width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.muted }}>
              <ChevronLeft size={16} color={colors.foreground} />
            </Pressable>
            <Pressable onPress={() => nav(1)} style={{ width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.muted }}>
              <ChevronRight size={16} color={colors.foreground} />
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

        {/* 日历网格(选中日期后压缩行高) */}
        <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
          {days.map((d, i) => {
            if (d === 0) return <View key={`b${i}`} style={{ width: cellW, alignItems: 'center', justifyContent: 'center', overflow: 'hidden', height: ROW_FULL }} />;
            const isToday = key(d) === todayKey;
            const isSel = d === selected;
            const sum = daySum[key(d)];
            const hasSum = !!sum && (sum.income > 0 || sum.expense > 0);
            return (
              <Pressable key={d} onPress={() => onPressDay(d)} style={{ width: cellW, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}>
                <Animated.View style={[rowStyle, { alignItems: 'center', justifyContent: 'flex-start', paddingTop: 3 }]}>
                  <View style={{ width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center', backgroundColor: isSel || isToday ? colors.primary : 'transparent' }}>
                    <Text style={{ fontSize: 13, fontWeight: isToday || isSel ? '700' : '400', color: isSel || isToday ? '#fff' : colors.foreground }}>
                      {d}
                    </Text>
                  </View>
                  {hasSum && (
                    <Animated.View style={[{ alignItems: 'center', marginTop: 2 }, moneyStyle]}>
                      {sum!.expense > 0 && (
                        <Text style={{ fontSize: 8.5, color: colors.expense, fontVariant: ['tabular-nums'], lineHeight: 12 }} numberOfLines={1}>-{formatMoneyShort(sum!.expense)}</Text>
                      )}
                      {sum!.income > 0 && (
                        <Text style={{ fontSize: 8.5, color: colors.income, fontVariant: ['tabular-nums'], lineHeight: 12 }} numberOfLines={1}>+{formatMoneyShort(sum!.income)}</Text>
                      )}
                    </Animated.View>
                  )}
                </Animated.View>
              </Pressable>
            );
          })}
        </View>

        {/* 当日流水:选中后放大占满剩余高度,内部可滚动;向下滑动可重新展开日历 */}
        <View style={{ flex: 1, marginTop: 16 }} pointerEvents="box-none">
          {/* 下滑展开把手(仅压缩态显示) */}
          {!expanded && (
            <GestureDetector gesture={panExpand}>
              <View style={{ alignItems: 'center', paddingVertical: 8 }}>
                <View style={{ width: 40, height: 4, borderRadius: 2, backgroundColor: colors.muted }} />
              </View>
            </GestureDetector>
          )}
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
            <Text style={{ fontSize: 15, fontWeight: '600' }}>当日流水</Text>
            <Text variant="muted" style={{ fontSize: 12 }}>{month}月{selected}日 · 支出{formatMoney(dayExpense)}</Text>
          </View>
          <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingBottom: 24 }} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
            <Card className="px-5 py-4">
              {dayRecords.length === 0 ? (
                <View className="items-center py-10"><Text variant="muted">当天暂无流水</Text></View>
              ) : (
                dayRecords.map((r, i) => (
                  <View key={r.id}>
                    <RecordRow record={r} icon={catMap[r.categoryCode ?? '']} showDivider={i < dayRecords.length - 1} />
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
                    <Text style={{ fontSize: 14, fontWeight: active ? '700' : '500', color: active ? '#fff' : colors.foreground }}>{m}月</Text>
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
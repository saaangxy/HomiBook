import { useEffect, useRef, useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import dayjs from 'dayjs';
import { LinearGradient } from 'expo-linear-gradient';
import Animated, { FadeIn, FadeInDown } from 'react-native-reanimated';
import { Calendar as CalendarIcon, ChevronLeft, ChevronRight } from 'lucide-react-native';
import { useTheme, alpha, motion } from '@/theme';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Text } from '@/components/ui/Text';

interface DatePickerProps {
  value: string; // 'YYYY-MM-DDTHH:mm:ss'(与 web 端 datetime-picker 一致)
  onChange: (value: string) => void;
}

const WEEKDAYS = ['日', '一', '二', '三', '四', '五', '六'];

/** 滚轮:单项高度 / 可见高度(4 项多一点,与 web datetime-picker 的观感一致) */
const ITEM_H = 36;
const WHEEL_H = 150;
const HOURS = Array.from({ length: 24 }, (_, i) => i);
const MINUTES = Array.from({ length: 60 }, (_, i) => i);
const SECONDS = Array.from({ length: 60 }, (_, i) => i);

/**
 * 自绘滚动选择列(替代原生 Picker)。
 *
 * 为什么不用 `@react-native-picker/picker`:Android 上 `mode="dropdown"` 渲染成
 * 「数字 + 下拉箭头」、`dialog` 又弹系统对话框,两种形态与日历部分都不搭,iOS/Android
 * 观感也割裂。web 端 `datetime-picker` 一直是自绘滚轮(36px 行高 + 上下渐隐 + 主色选择框),
 * 这里按同一形态实现:
 *   - `snapToInterval` 让松手后吸附到整项;
 *   - 上下 `LinearGradient` 遮住溢出内容,聚焦中间一行;
 *   - 居中的主色圆角框标出当前选中项;
 *   - 点某一项直接选中并滚到位。
 *
 * 数学与 web 一致:`contentContainer` 上下各留 `(WHEEL_H - ITEM_H) / 2`,于是
 * `contentOffset.y = value * ITEM_H` 恰好让第 value 项居中。
 */
function WheelColumn({
  items,
  value,
  label,
  onChange,
}: {
  items: number[];
  value: number;
  label: string;
  onChange: (v: number) => void;
}) {
  const { colors } = useTheme();
  const ref = useRef<ScrollView>(null);
  const pad = (WHEEL_H - ITEM_H) / 2;

  // 外部值变化(如「回到今天」)时把滚轮同步过去;此时不回报 onChange,避免回环。
  // 延后一帧再滚:首次挂载时 ScrollView 还没完成布局,立即 scrollTo 会被忽略。
  const syncingRef = useRef(false);
  useEffect(() => {
    syncingRef.current = true;
    const t = setTimeout(() => {
      ref.current?.scrollTo({ y: value * ITEM_H, animated: false });
      syncingRef.current = false;
    }, 30);
    return () => clearTimeout(t);
  }, [value]);

  const settle = (y: number) => {
    if (syncingRef.current) return;
    const idx = Math.min(items.length - 1, Math.max(0, Math.round(y / ITEM_H)));
    if (idx !== value) onChange(idx);
  };

  return (
    <View style={{ alignItems: 'center', flex: 1 }}>
      <Text variant="muted" style={{ fontSize: 11, marginBottom: 4 }}>{label}</Text>
      <View style={{ height: WHEEL_H, width: '100%', borderRadius: 12, backgroundColor: colors.muted, overflow: 'hidden' }}>
        {/* 居中选择框(对齐 web:主色圆角边框) */}
        <View
          pointerEvents="none"
          style={{ position: 'absolute', left: 6, right: 6, top: pad, height: ITEM_H, borderRadius: 8, borderWidth: 1.5, borderColor: colors.primary, zIndex: 2 }}
        />
        {/* 上下渐隐:遮住溢出的项,让中间一行成为焦点 */}
        <LinearGradient pointerEvents="none" colors={[colors.muted, 'transparent']} style={{ position: 'absolute', top: 0, left: 0, right: 0, height: pad, zIndex: 1 }} />
        <LinearGradient pointerEvents="none" colors={['transparent', colors.muted]} style={{ position: 'absolute', bottom: 0, left: 0, right: 0, height: pad, zIndex: 1 }} />
        <ScrollView
          ref={ref}
          showsVerticalScrollIndicator={false}
          snapToInterval={ITEM_H}
          decelerationRate="fast"
          contentContainerStyle={{ paddingVertical: pad }}
          onMomentumScrollEnd={(e) => settle(e.nativeEvent.contentOffset.y)}
          onScrollEndDrag={(e) => settle(e.nativeEvent.contentOffset.y)}
        >
          {items.map((v) => {
            const active = v === value;
            return (
              <Pressable
                key={v}
                onPress={() => {
                  ref.current?.scrollTo({ y: v * ITEM_H, animated: true });
                  onChange(v);
                }}
                style={{ height: ITEM_H, alignItems: 'center', justifyContent: 'center' }}
              >
                <Text style={{ fontSize: 16, fontWeight: active ? '700' : '400', color: active ? colors.primary : colors.foreground }}>
                  {String(v).padStart(2, '0')}
                </Text>
              </Pressable>
            );
          })}
        </ScrollView>
      </View>
    </View>
  );
}

function parseValue(value?: string): dayjs.Dayjs {
  if (!value) return dayjs();
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return dayjs(value + 'T00:00:00');
  return dayjs(value);
}

export function DatePicker({ value, onChange }: DatePickerProps) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const [open, setOpen] = useState(false);

  const init = parseValue(value);
  const [view, setView] = useState(init.startOf('month'));
  const [time, setTime] = useState({ h: init.hour(), mi: init.minute(), s: init.second() });
  /** 面板态:day=日历(标题里的年/月可点开表格);month=月表格;year=年表格 */
  const [panel, setPanel] = useState<'day' | 'month' | 'year'>('day');
  /** 年表格起始年(一屏 12 个,上下按整屏翻) */
  const [yearBase, setYearBase] = useState(init.year());

  const openSheet = () => {
    const v = parseValue(value);
    setView(v.startOf('month'));
    setTime({ h: v.hour(), mi: v.minute(), s: v.second() });
    setYearBase(v.year());
    setPanel('day'); // 每次打开都从日历开始,不残留上次的表格
    setOpen(true);
  };

  const emitTime = (h: number, mi: number, s: number) => {
    onChange(parseValue(value).hour(h).minute(mi).second(s).format('YYYY-MM-DDTHH:mm:ss'));
  };
  const emitDay = (d: number) => {
    onChange(view.date(d).hour(time.h).minute(time.mi).second(time.s).format('YYYY-MM-DDTHH:mm:ss'));
    setOpen(false);
  };

  /**
   * 回到今天:日期与时分秒一起设为「现在」并关闭弹窗(与选日期一致)。
   * 此前只调了 emitTime —— 它基于当前 value 只改时间、日期原地不动,点下去看着「没反应」。
   */
  const goToday = () => {
    const now = dayjs();
    setView(now.startOf('month'));
    setTime({ h: now.hour(), mi: now.minute(), s: now.second() });
    onChange(now.format('YYYY-MM-DDTHH:mm:ss'));
    setOpen(false);
  };

  const firstDay = view.startOf('month').day();
  const total = view.daysInMonth();
  const cells = [...Array(firstDay).fill(0), ...Array.from({ length: total }, (_, i) => i + 1)];
  const todayKey = dayjs().format('YYYY-MM-DD');
  // 按 7 天切行、每格 flex:1 均分。不能用「宽度 100/7 %」—— 那是无限小数(14.2857…%),
  // 7 格之和略超容器宽,像素圆整后不同分辨率下最后一格被挤到下一行(表现为「每行只有 6 个」)。
  // 末尾补 0 占位,保证每行恰好 7 格(否则末行 flex:1 会把不足的格子拉宽)。
  const weeks = (() => {
    const padded = [...cells];
    while (padded.length % 7 !== 0) padded.push(0);
    const out: number[][] = [];
    for (let i = 0; i < padded.length; i += 7) out.push(padded.slice(i, i + 7));
    return out;
  })();
  const display = value ? dayjs(value).format('YYYY年M月D日 HH:mm:ss') : '选择日期';

  /** 时/分/秒变更:统一改本地 time 并回传完整时间 */
  const setTimeField = (field: 'h' | 'mi' | 's', v: number) => {
    const next = { ...time, [field]: v };
    setTime(next);
    emitTime(next.h, next.mi, next.s);
  };

  return (
    <>
      <Pressable
        onPress={openSheet}
        style={{ height: 44, borderRadius: 14, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.elevated, paddingHorizontal: 14, flexDirection: 'row', alignItems: 'center' }}
      >
        <CalendarIcon size={15} color={colors.primary} />
        <Text style={{ marginLeft: 8, fontSize: 14, color: value ? colors.foreground : colors.mutedForeground, flex: 1 }}>{display}</Text>
      </Pressable>

      <Modal visible={open} transparent animationType="none" onRequestClose={() => setOpen(false)}>
        <View style={{ flex: 1, justifyContent: 'flex-end' }}>
          <Animated.View entering={FadeIn.duration(160)} style={StyleSheet.absoluteFill}>
            <Pressable style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.5)' }} onPress={() => setOpen(false)} />
          </Animated.View>
          <Animated.View
            entering={FadeInDown.duration(motion.duration.base).easing(motion.easing)}
            style={{ backgroundColor: colors.card, borderTopLeftRadius: 24, borderTopRightRadius: 24, paddingHorizontal: 20, paddingTop: 10, paddingBottom: Math.max(insets.bottom + 14, 24) }}
          >
            <View style={{ width: 36, height: 4, borderRadius: 2, backgroundColor: colors.muted, alignSelf: 'center', marginBottom: 12 }} />

            {/* 年月导航 + 快速选择:点「YYYY年」打开年表格,点「M月」打开月表格,选中即回填并回到日历 */}
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
              <Pressable onPress={() => setView(view.subtract(1, 'month'))} style={{ width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.muted }}>
                <ChevronLeft size={16} color={colors.foreground} />
              </Pressable>
              {panel === 'day' ? (
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                  <Pressable
                    onPress={() => { setYearBase(view.year()); setPanel('year'); }}
                    hitSlop={6}
                    style={{ paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8, backgroundColor: alpha(colors.primary, 0.1) }}
                  >
                    <Text style={{ fontSize: 15, fontWeight: '700', color: colors.primary }}>{view.format('YYYY')}年</Text>
                  </Pressable>
                  <Pressable
                    onPress={() => setPanel('month')}
                    hitSlop={6}
                    style={{ paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8, backgroundColor: alpha(colors.primary, 0.1) }}
                  >
                    <Text style={{ fontSize: 15, fontWeight: '700', color: colors.primary }}>{view.format('M')}月</Text>
                  </Pressable>
                </View>
              ) : (
                <Pressable onPress={() => setPanel('day')} hitSlop={6} style={{ paddingHorizontal: 10, paddingVertical: 3, borderRadius: 8 }}>
                  <Text style={{ fontSize: 15, fontWeight: '700' }}>
                    {panel === 'year' ? '选择年份' : `${view.format('YYYY')}年 · 选择月份`}
                  </Text>
                </Pressable>
              )}
              <Pressable onPress={() => setView(view.add(1, 'month'))} style={{ width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.muted }}>
                <ChevronRight size={16} color={colors.foreground} />
              </Pressable>
            </View>

            {panel === 'day' && (
              <>
                {/* 星期表头(与网格同为 7 等分) */}
                <View style={{ flexDirection: 'row', marginBottom: 6 }}>
                  {WEEKDAYS.map((w) => (
                    <View key={w} style={{ flex: 1, alignItems: 'center' }}>
                      <Text variant="muted" style={{ fontSize: 11, fontWeight: '600' }}>{w}</Text>
                    </View>
                  ))}
                </View>

                {/* 日期网格 */}
                <ScrollView showsVerticalScrollIndicator={false} style={{ maxHeight: 260 }} keyboardShouldPersistTaps="handled">
                  <View>
                    {weeks.map((row, ri) => (
                      <View key={ri} style={{ flexDirection: 'row' }}>
                        {row.map((d, ci) => {
                          if (d === 0) return <View key={`b${ri}-${ci}`} style={{ flex: 1, height: 40 }} />;
                          const k = view.year() + '-' + String(view.month() + 1).padStart(2, '0') + '-' + String(d).padStart(2, '0');
                          const isToday = k === todayKey;
                          const isSel = k === value?.slice(0, 10);
                          return (
                            <Pressable key={k} onPress={() => emitDay(d)} style={{ flex: 1, height: 40, alignItems: 'center', justifyContent: 'center' }}>
                              <View
                                style={{
                                  width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center',
                                  backgroundColor: isSel ? colors.primary : isToday ? alpha(colors.primary, 0.12) : 'transparent',
                                  borderWidth: isToday && !isSel ? 1 : 0,
                                  borderColor: colors.primary,
                                }}
                              >
                                <Text style={{ fontSize: 14, fontWeight: isSel || isToday ? '700' : '400', color: isSel ? '#fff' : colors.foreground }}>{d}</Text>
                              </View>
                            </Pressable>
                          );
                        })}
                      </View>
                    ))}
                  </View>
                </ScrollView>
              </>
            )}

            {panel === 'month' && (
              /* 月表格:4 列 × 3 行;与日期网格同一套「按行 + flex:1」均分,不依赖百分比取整 */
              <View style={{ minHeight: 264 }}>
                {[0, 1, 2].map((r) => (
                  <View key={r} style={{ flexDirection: 'row' }}>
                    {[1, 2, 3, 4].map((c) => {
                      const m = r * 4 + c;
                      const isSel = m === view.month() + 1;
                      return (
                        <Pressable
                          key={m}
                          onPress={() => { setView(view.month(m - 1).startOf('month')); setPanel('day'); }}
                          style={{ flex: 1, height: 64, alignItems: 'center', justifyContent: 'center' }}
                        >
                          <View style={{ width: 54, height: 40, borderRadius: 10, alignItems: 'center', justifyContent: 'center', backgroundColor: isSel ? colors.primary : colors.muted }}>
                            <Text style={{ fontSize: 14, fontWeight: isSel ? '700' : '500', color: isSel ? '#fff' : colors.foreground }}>{m}月</Text>
                          </View>
                        </Pressable>
                      );
                    })}
                  </View>
                ))}
              </View>
            )}

            {panel === 'year' && (
              /* 年表格:4 列 × 3 行 = 一屏 12 年,上下按整屏翻;点年份后接着选月份 */
              <View style={{ minHeight: 264 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                  <Pressable onPress={() => setYearBase(yearBase - 12)} style={{ paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999, backgroundColor: colors.muted, flexDirection: 'row', alignItems: 'center', gap: 3 }}>
                    <ChevronLeft size={13} color={colors.foreground} />
                    <Text style={{ fontSize: 12 }}>前 12 年</Text>
                  </Pressable>
                  <Text variant="muted" style={{ fontSize: 12 }}>{yearBase} - {yearBase + 11}</Text>
                  <Pressable onPress={() => setYearBase(yearBase + 12)} style={{ paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999, backgroundColor: colors.muted, flexDirection: 'row', alignItems: 'center', gap: 3 }}>
                    <Text style={{ fontSize: 12 }}>后 12 年</Text>
                    <ChevronRight size={13} color={colors.foreground} />
                  </Pressable>
                </View>
                {[0, 1, 2].map((r) => (
                  <View key={r} style={{ flexDirection: 'row' }}>
                    {[0, 1, 2, 3].map((c) => {
                      const y = yearBase + r * 4 + c;
                      const isSel = y === view.year();
                      return (
                        <Pressable
                          key={y}
                          onPress={() => { setView(view.year(y).startOf('month')); setPanel('month'); }}
                          style={{ flex: 1, height: 64, alignItems: 'center', justifyContent: 'center' }}
                        >
                          <View style={{ width: 64, height: 40, borderRadius: 10, alignItems: 'center', justifyContent: 'center', backgroundColor: isSel ? colors.primary : colors.muted }}>
                            <Text style={{ fontSize: 14, fontWeight: isSel ? '700' : '500', color: isSel ? '#fff' : colors.foreground }}>{y}</Text>
                          </View>
                        </Pressable>
                      );
                    })}
                  </View>
                ))}
              </View>
            )}

            {/* 时分秒:自绘滚动选择(与 web datetime-picker 同形态) */}
            <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 8, marginTop: 12 }}>
              <WheelColumn items={HOURS} value={time.h} label="时" onChange={(v) => setTimeField('h', v)} />
              <WheelColumn items={MINUTES} value={time.mi} label="分" onChange={(v) => setTimeField('mi', v)} />
              <WheelColumn items={SECONDS} value={time.s} label="秒" onChange={(v) => setTimeField('s', v)} />
            </View>

            {/* 今天 */}
            <View style={{ alignItems: 'center', marginTop: 12 }}>
              <Pressable
                onPress={goToday}
                style={{ paddingHorizontal: 16, paddingVertical: 7, borderRadius: 999, backgroundColor: alpha(colors.primary, 0.12) }}
              >
                <Text style={{ fontSize: 12, color: colors.primary, fontWeight: '600' }}>回到今天</Text>
              </Pressable>
            </View>
          </Animated.View>
        </View>
      </Modal>
    </>
  );
}

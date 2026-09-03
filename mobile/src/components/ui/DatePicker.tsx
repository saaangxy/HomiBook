import { useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import dayjs from 'dayjs';
import { Picker } from '@react-native-picker/picker';
import Animated, { Easing, FadeIn, FadeInDown } from 'react-native-reanimated';
import { Calendar as CalendarIcon, ChevronLeft, ChevronRight } from 'lucide-react-native';
import { useTheme, alpha, motion } from '@/theme';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Text } from '@/components/ui/Text';

interface DatePickerProps {
  value: string; // 'YYYY-MM-DDTHH:mm:ss'(与 web 端 datetime-picker 一致)
  onChange: (value: string) => void;
}

const WEEKDAYS = ['日', '一', '二', '三', '四', '五', '六'];

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

  const openSheet = () => {
    const v = parseValue(value);
    setView(v.startOf('month'));
    setTime({ h: v.hour(), mi: v.minute(), s: v.second() });
    setOpen(true);
  };

  const emitTime = (h: number, mi: number, s: number) => {
    onChange(parseValue(value).hour(h).minute(mi).second(s).format('YYYY-MM-DDTHH:mm:ss'));
  };
  const emitDay = (d: number) => {
    onChange(view.date(d).hour(time.h).minute(time.mi).second(time.s).format('YYYY-MM-DDTHH:mm:ss'));
    setOpen(false);
  };

  const firstDay = view.startOf('month').day();
  const total = view.daysInMonth();
  const cells = [...Array(firstDay).fill(0), ...Array.from({ length: total }, (_, i) => i + 1)];
  const todayKey = dayjs().format('YYYY-MM-DD');
  const cellW = `${100 / 7}%`;
  const display = value ? dayjs(value).format('YYYY年M月D日 HH:mm:ss') : '选择日期';

  // 时/分/秒滚轮:ScrollView 上下滑动 + 点击项选中 + onScroll 防抖提交(兼容 Web 无 momentum 事件)
  // 时/分/秒:使用 @react-native-picker/picker(iOS 原生滚轮 / Android 滚轮 / Web select)
  // 通过 selectedValue 可靠回显,onValueChange 可靠选择(无需手写 ScrollView 滚轮)
  const TimePicker = ({ field, range, label }: { field: 'h' | 'mi' | 's'; range: number; label: string }) => {
    const items = Array.from({ length: range }, (_, i) => i);
    const cur = time[field];
    const set = (val: number) => {
      const next = { ...time, [field]: val };
      setTime(next);
      emitTime(next.h, next.mi, next.s);
    };
    return (
      <View style={{ alignItems: 'center', flex: 1 }}>
        <Text variant="muted" style={{ fontSize: 11, marginBottom: 6 }}>{label}</Text>
        <Picker
          selectedValue={cur}
          onValueChange={set}
          style={{ height: 130, width: '100%' }}
          itemStyle={{ fontSize: 16, color: colors.foreground, height: 32 }}
        >
          {items.map((i) => (
            <Picker.Item key={i} label={String(i).padStart(2, '0')} value={i} />
          ))}
        </Picker>
      </View>
    );
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

            {/* 年月切换 */}
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
              <Pressable onPress={() => setView(view.subtract(1, 'month'))} style={{ width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.muted }}>
                <ChevronLeft size={16} color={colors.foreground} />
              </Pressable>
              <Text style={{ fontSize: 16, fontWeight: '700' }}>{view.format('YYYY年M月')}</Text>
              <Pressable onPress={() => setView(view.add(1, 'month'))} style={{ width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.muted }}>
                <ChevronRight size={16} color={colors.foreground} />
              </Pressable>
            </View>

            {/* 星期表头 */}
            <View style={{ flexDirection: 'row', marginBottom: 6 }}>
              {WEEKDAYS.map((w) => (
                <View key={w} style={{ width: cellW, alignItems: 'center' }}>
                  <Text variant="muted" style={{ fontSize: 11, fontWeight: '600' }}>{w}</Text>
                </View>
              ))}
            </View>

            {/* 日期网格 */}
            <ScrollView showsVerticalScrollIndicator={false} style={{ maxHeight: 260 }} keyboardShouldPersistTaps="handled">
              <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
                {cells.map((d, i) => {
                  if (d === 0) return <View key={`b${i}`} style={{ width: cellW, height: 40 }} />;
                  const k = view.year() + '-' + String(view.month() + 1).padStart(2, '0') + '-' + String(d).padStart(2, '0');
                  const isToday = k === todayKey;
                  const isSel = k === value?.slice(0, 10);
                  return (
                    <Pressable key={k} onPress={() => emitDay(d)} style={{ width: cellW, height: 40, alignItems: 'center', justifyContent: 'center' }}>
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
            </ScrollView>

            {/* 时分秒选择(@react-native-picker/picker) */}
            <View style={{ flexDirection: 'row', alignItems: 'flex-start', marginTop: 8, paddingVertical: 4, borderTopWidth: 1, borderTopColor: colors.hairline }}>
              <TimePicker field="h" range={24} label="时" />
              <TimePicker field="mi" range={60} label="分" />
              <TimePicker field="s" range={60} label="秒" />
            </View>

            {/* 今天 */}
            <View style={{ alignItems: 'center', marginTop: 8 }}>
              <Pressable
                onPress={() => { const now = dayjs(); setTime({ h: now.hour(), mi: now.minute(), s: now.second() }); emitTime(now.hour(), now.minute(), now.second()); }}
                style={{ paddingHorizontal: 16, paddingVertical: 7, borderRadius: 999, backgroundColor: colors.muted }}
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

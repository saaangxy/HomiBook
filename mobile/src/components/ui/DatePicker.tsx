import { useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import Animated, { FadeIn, FadeInDown } from 'react-native-reanimated';
import { Calendar as CalendarIcon, ChevronLeft, ChevronRight } from 'lucide-react-native';
import { useTheme } from '@/theme';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Text } from '@/components/ui/Text';

interface DatePickerProps {
  value: string; // 'YYYY-MM-DD'
  onChange: (value: string) => void;
}

const WEEKDAYS = ['日', '一', '二', '三', '四', '五', '六'];

// 底部弹窗日历(仿网页 date-picker):年月切换 + 周表头 + 日期网格,点选即回调 'YYYY-MM-DD'
export function DatePicker({ value, onChange }: DatePickerProps) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const [open, setOpen] = useState(false);

  const today = value
    ? { y: new Date(value + 'T00:00:00').getFullYear(), m: new Date(value + 'T00:00:00').getMonth() + 1, d: new Date(value + 'T00:00:00').getDate() }
    : { y: new Date().getFullYear(), m: new Date().getMonth() + 1, d: new Date().getDate() };
  const [vm, setVm] = useState({ y: today.y, m: today.m });

  const openSheet = () => {
    setVm({ y: today.y, m: today.m });
    setOpen(true);
  };

  const nav = (delta: number) => {
    const next = new Date(vm.y, vm.m - 1 + delta, 1);
    setVm({ y: next.getFullYear(), m: next.getMonth() + 1 });
  };

  const firstDay = new Date(vm.y, vm.m - 1, 1).getDay(); // 周日=0
  const total = new Date(vm.y, vm.m, 0).getDate();
  const cells = [...Array(firstDay).fill(0), ...Array.from({ length: total }, (_, i) => i + 1)];

  const nowKey = new Date();
  const todayKey = `${nowKey.getFullYear()}-${String(nowKey.getMonth() + 1).padStart(2, '0')}-${String(nowKey.getDate()).padStart(2, '0')}`;

  const cellW = `${100 / 7}%`;

  const select = (d: number) => {
    const k = `${vm.y}-${String(vm.m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    onChange(k);
    setOpen(false);
  };

  const display = value
    ? `${today.y}年${today.m}月${today.d}日 ${WEEKDAYS[new Date(value + 'T00:00:00').getDay()]}`
    : '选择日期';

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
            entering={FadeInDown.springify().damping(20)}
            style={{ backgroundColor: colors.card, borderTopLeftRadius: 24, borderTopRightRadius: 24, paddingHorizontal: 20, paddingTop: 10, paddingBottom: Math.max(insets.bottom + 14, 24) }}
          >
            <View style={{ width: 36, height: 4, borderRadius: 2, backgroundColor: colors.muted, alignSelf: 'center', marginBottom: 12 }} />

            {/* 年月切换 */}
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
              <Pressable onPress={() => nav(-1)} style={{ width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.muted }}>
                <ChevronLeft size={16} color={colors.foreground} />
              </Pressable>
              <Text style={{ fontSize: 16, fontWeight: '700' }}>{vm.y}年{vm.m}月</Text>
              <Pressable onPress={() => nav(1)} style={{ width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.muted }}>
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
            <ScrollView showsVerticalScrollIndicator={false} style={{ maxHeight: 320 }} keyboardShouldPersistTaps="handled">
              <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
                {cells.map((d, i) => {
                  if (d === 0) return <View key={`b${i}`} style={{ width: cellW, height: 40 }} />;
                  const k = `${vm.y}-${String(vm.m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
                  const isToday = k === todayKey;
                  const isSel = k === value;
                  return (
                    <Pressable key={k} onPress={() => select(d)} style={{ width: cellW, height: 40, alignItems: 'center', justifyContent: 'center' }}>
                      <View
                        style={{
                          width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center',
                          backgroundColor: isSel ? colors.primary : isToday ? 'rgba(249,115,22,0.12)' : 'transparent',
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

            {/* 今天 */}
            <View style={{ alignItems: 'center', marginTop: 8 }}>
              <Pressable
                onPress={() => select(parseInt(todayKey.slice(-2), 10))}
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
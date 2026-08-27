import { useEffect, useMemo, useState } from 'react';
import { Pressable, ScrollView, TextInput, View } from 'react-native';
import { useTheme } from '@/theme';
import { Text } from './Text';

interface CronBuilderProps {
  value?: string;
  onChange: (cron: string) => void;
}

const SCHEDULE_TYPES = [
  { value: 'hour', label: '每小时' },
  { value: 'day', label: '每天' },
  { value: 'week', label: '每周' },
  { value: 'month', label: '每月' },
  { value: 'year', label: '每年' },
  { value: 'custom', label: '自定义' },
] as const;

type ScheduleType = (typeof SCHEDULE_TYPES)[number]['value'];

const MINUTES_ALL = Array.from({ length: 60 }, (_, i) => i);
const COMMON_MINUTES = [0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55];
const HOURS = Array.from({ length: 24 }, (_, i) => i);
const DAYS_OF_MONTH = Array.from({ length: 31 }, (_, i) => i + 1);
const MONTH_LABELS = ['1月', '2月', '3月', '4月', '5月', '6月', '7月', '8月', '9月', '10月', '11月', '12月'];
const DAY_LABELS = ['日', '一', '二', '三', '四', '五', '六'];

interface ParsedCron {
  type: ScheduleType;
  minutes: number[];
  hours: number[];
  daysOfMonth: number[];
  months: number[];
  daysOfWeek: number[];
  custom: string;
}

// 解析规则对齐网页端 CronBuilder(* 与 ? 均视为通配,兼容标准 5 段与 Quartz 风格)
function parseCron(expr: string): ParsedCron {
  const empty: ParsedCron = { type: 'day', minutes: [0], hours: [0], daysOfMonth: [1], months: [1], daysOfWeek: [0], custom: '' };
  if (!expr) return empty;
  const parts = expr.trim().split(/\s+/);
  if (parts.length !== 5) return { ...empty, type: 'custom', custom: expr };
  const [min, hour, dom, month, dow] = parts;
  const star = (p: string) => p === '*' || p === '?';
  const parseNums = (p: string) => (star(p) ? [] : p.split(',').map(Number).filter((n) => !isNaN(n)));
  const mins = parseNums(min);
  const hrs = parseNums(hour);
  const doms = parseNums(dom);
  const months = parseNums(month);
  const dows = parseNums(dow);
  if (mins.length > 0 && hour === '*' && star(dom) && star(month) && star(dow)) {
    return { ...empty, type: 'hour', minutes: mins };
  }
  if (mins.length > 0 && hrs.length > 0 && star(dom) && star(month) && star(dow)) {
    return { ...empty, type: 'day', minutes: mins, hours: hrs };
  }
  if (mins.length > 0 && hrs.length > 0 && star(dom) && star(month) && dows.length > 0) {
    return { ...empty, type: 'week', minutes: mins, hours: hrs, daysOfWeek: dows };
  }
  if (mins.length > 0 && hrs.length > 0 && doms.length > 0 && star(month) && star(dow)) {
    return { ...empty, type: 'month', minutes: mins, hours: hrs, daysOfMonth: doms };
  }
  if (mins.length > 0 && hrs.length > 0 && doms.length > 0 && !star(month) && star(dow)) {
    return { ...empty, type: 'year', minutes: mins, hours: hrs, daysOfMonth: doms, months };
  }
  return { ...empty, type: 'custom', custom: expr };
}

function buildCron(p: ParsedCron): string {
  const m = (arr: number[], total: number) => (arr.length === 0 || arr.length === total ? '*' : arr.join(','));
  switch (p.type) {
    case 'hour': return `${m(p.minutes, 60)} * * * ?`;
    case 'day': return `${m(p.minutes, 60)} ${m(p.hours, 24)} * * ?`;
    case 'week': return `${m(p.minutes, 60)} ${m(p.hours, 24)} ? * ${m(p.daysOfWeek, 7)}`;
    case 'month': return `${m(p.minutes, 60)} ${m(p.hours, 24)} ${m(p.daysOfMonth, 31)} * ?`;
    case 'year': return `${m(p.minutes, 60)} ${m(p.hours, 24)} ${m(p.daysOfMonth, 31)} ${m(p.months, 12)} ?`;
    case 'custom': return p.custom || '';
    default: return '';
  }
}

// 触发时间构建器(移动端形态,产出与网页端一致的标准 cron 表达式):
// 调度类型切换 + 分钟/小时/星期/日期/月份多选宫格 + 自定义表达式输入
export function CronBuilder({ value, onChange }: CronBuilderProps) {
  const { colors } = useTheme();
  const initial = useMemo(() => parseCron(value || ''), []); // 仅初始化一次,后续以内部状态为准
  const [scheduleType, setScheduleType] = useState<ScheduleType>(initial.type);
  const [minutes, setMinutes] = useState<number[]>(initial.minutes);
  const [hours, setHours] = useState<number[]>(initial.hours);
  const [daysOfMonth, setDaysOfMonth] = useState<number[]>(initial.daysOfMonth);
  const [months, setMonths] = useState<number[]>(initial.months);
  const [daysOfWeek, setDaysOfWeek] = useState<number[]>(initial.daysOfWeek);
  const [custom, setCustom] = useState(initial.custom);
  const [allMinutes, setAllMinutes] = useState(false);

  const parsed: ParsedCron = { type: scheduleType, minutes, hours, daysOfMonth, months, daysOfWeek, custom };
  const cron = useMemo(() => buildCron(parsed), [scheduleType, minutes, hours, daysOfMonth, months, daysOfWeek, custom]);

  useEffect(() => {
    onChange(cron);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cron]);

  const switchType = (t: ScheduleType) => {
    setScheduleType(t);
    // 切换类型重置默认值(对齐网页端 resetToDefaults)
    setMinutes([0]); setHours([0]); setDaysOfMonth([1]); setMonths([1]); setDaysOfWeek([0]);
  };

  const toggleIn = (arr: number[], val: number, set: (v: number[]) => void) =>
    set(arr.includes(val) ? arr.filter((v) => v !== val) : [...arr, val].sort((a, b) => a - b));

  const chipStyle = (active: boolean) => ({
    paddingHorizontal: 8,
    paddingVertical: 5,
    minWidth: 40,
    borderRadius: 8,
    alignItems: 'center' as const,
    borderWidth: 1,
    backgroundColor: active ? colors.primary : colors.muted,
    borderColor: active ? colors.primary : colors.border,
  });
  const chipText = (active: boolean) => ({ fontSize: 11.5, color: active ? colors.primaryForeground : colors.foreground });
  const sectionLabel = (t: string) => (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 10, marginBottom: 6 }}>
      <Text style={{ fontSize: 12, fontWeight: '600', color: colors.mutedForeground }}>{t}</Text>
      {t === '分钟' && (
        <Pressable onPress={() => setAllMinutes(!allMinutes)} style={{ paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6, backgroundColor: colors.muted }}>
          <Text style={{ fontSize: 10, color: colors.mutedForeground }}>{allMinutes ? '常用' : '全部'}</Text>
        </Pressable>
      )}
    </View>
  );

  const minuteList = allMinutes ? MINUTES_ALL : COMMON_MINUTES;

  return (
    <View>
      {/* 调度类型 */}
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
        {SCHEDULE_TYPES.map((t) => {
          const active = scheduleType === t.value;
          return (
            <Pressable key={t.value} onPress={() => switchType(t.value)} style={chipStyle(active)}>
              <Text style={[chipText(active), { fontSize: 12, fontWeight: active ? '600' : '400' }]}>{t.label}</Text>
            </Pressable>
          );
        })}
      </View>

      {scheduleType === 'custom' ? (
        <TextInput
          value={custom}
          onChangeText={setCustom}
          placeholder="如 0 0 9 * *"
          placeholderTextColor={colors.mutedForeground}
          autoCapitalize="none"
          style={{ marginTop: 10, borderWidth: 1, borderColor: colors.border, borderRadius: 12, paddingVertical: 10, paddingHorizontal: 12, color: colors.foreground, fontSize: 14 }}
        />
      ) : (
        <>
          {/* 分钟 */}
          {sectionLabel('分钟')}
          <ScrollView showsVerticalScrollIndicator={false} style={{ maxHeight: allMinutes ? 120 : undefined }} nestedScrollEnabled>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 4 }}>
              {minuteList.map((mi) => (
                <Pressable key={mi} onPress={() => toggleIn(minutes, mi, setMinutes)} style={chipStyle(minutes.includes(mi))}>
                  <Text style={chipText(minutes.includes(mi))}>{String(mi).padStart(2, '0')}</Text>
                </Pressable>
              ))}
            </View>
          </ScrollView>

          {/* 小时(每小时类型无需选择) */}
          {scheduleType !== 'hour' && (
            <>
              {sectionLabel('小时')}
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 4 }}>
                {HOURS.map((h) => (
                  <Pressable key={h} onPress={() => toggleIn(hours, h, setHours)} style={chipStyle(hours.includes(h))}>
                    <Text style={chipText(hours.includes(h))}>{String(h).padStart(2, '0')}</Text>
                  </Pressable>
                ))}
              </View>
            </>
          )}

          {/* 星期 */}
          {scheduleType === 'week' && (
            <>
              {sectionLabel('星期')}
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 4 }}>
                {DAY_LABELS.map((d, i) => (
                  <Pressable key={i} onPress={() => toggleIn(daysOfWeek, i, setDaysOfWeek)} style={[chipStyle(daysOfWeek.includes(i)), { flex: 1 }]}>
                    <Text style={chipText(daysOfWeek.includes(i))}>{d}</Text>
                  </Pressable>
                ))}
              </View>
            </>
          )}

          {/* 月份 */}
          {scheduleType === 'year' && (
            <>
              {sectionLabel('月份')}
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 4 }}>
                {MONTH_LABELS.map((ml, i) => (
                  <Pressable key={i} onPress={() => toggleIn(months, i + 1, setMonths)} style={chipStyle(months.includes(i + 1))}>
                    <Text style={chipText(months.includes(i + 1))}>{ml}</Text>
                  </Pressable>
                ))}
              </View>
            </>
          )}

          {/* 日期 */}
          {(scheduleType === 'month' || scheduleType === 'year') && (
            <>
              {sectionLabel('日期')}
              <ScrollView showsVerticalScrollIndicator={false} style={{ maxHeight: 108 }} nestedScrollEnabled>
                <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
                  {DAYS_OF_MONTH.map((d) => {
                    const active = daysOfMonth.includes(d);
                    return (
                      <Pressable key={d} onPress={() => toggleIn(daysOfMonth, d, setDaysOfMonth)} style={{ width: `${100 / 7}%`, padding: 3 }}>
                        <View style={{ height: 30, borderRadius: 8, alignItems: 'center', justifyContent: 'center', borderWidth: 1, backgroundColor: active ? colors.primary : colors.muted, borderColor: active ? colors.primary : colors.border }}>
                          <Text style={[chipText(active), { fontSize: 11.5 }]}>{d}</Text>
                        </View>
                      </Pressable>
                    );
                  })}
                </View>
              </ScrollView>
            </>
          )}
        </>
      )}

      {/* 结果表达式 */}
      <View style={{ marginTop: 10, padding: 10, borderRadius: 10, backgroundColor: colors.muted }}>
        <Text style={{ fontSize: 12, color: colors.mutedForeground }}>触发表达式</Text>
        <Text style={{ fontSize: 13, fontFamily: 'monospace', color: colors.foreground, marginTop: 2 }}>{cron || '(未配置)'}</Text>
      </View>
    </View>
  );
}

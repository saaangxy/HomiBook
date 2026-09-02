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
import { useTheme, alpha, haptics } from '@/theme';
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

const SCREEN_W = Dimensions.get('window').width;
// 外层 ScrollView padding 16×2 = 32; 卡片 padding 14×2 = 28; 总扣减 60
const CW = SCREEN_W - 60;
const CHART_H = 200;
const CHART_COLORS = ['#6366f1', '#f97316', '#ec4899', '#14b8a6', '#ef4444', '#8b5cf6', '#22c55e', '#06b6d4', '#f59e0b', '#3b82f6'];

// ── 金额格式化 ──
const fmtMoney = (v: number) => v >= 10000 ? `${(v / 10000).toFixed(1)}万` : `${Math.round(v)}`;

// ── 图表点按交互:点按/拖动选择最近数据点,参考线 + 具体值浮层 ──
function ChartInteraction({ n, xFromIdx, idxFromX, renderTip, height, children }: {
  n: number;
  /** 数据索引 → x 坐标(参考线/浮层定位) */
  xFromIdx: (i: number) => number;
  /** 触摸 x → 最近数据索引 */
  idxFromX: (x: number) => number;
  renderTip: (idx: number) => ReactNode;
  height: number;
  children: ReactNode;
}) {
  const { colors } = useTheme();
  const [selected, setSelected] = useState<number | null>(null);
  const clampIdx = (x: number) => Math.max(0, Math.min(n - 1, idxFromX(x)));
  // 回调标记 runOnJS:内部调用 haptics/setState(RN 侧函数),在 UI worklet 线程同步调用会崩溃;
  // 拖动选择仅更新 state,无需 worklet 高频驱动
  const pan = Gesture.Pan()
    .activeOffsetX([-10, 10])
    .runOnJS(true)
    .onUpdate((e) => setSelected(clampIdx(e.x)));
  const tap = Gesture.Tap()
    .runOnJS(true)
    .onStart((e) => {
      haptics.tap();
      setSelected((prev) => {
        const idx = clampIdx(e.x);
        return prev === idx ? null : idx;
      });
    });
  const px = selected !== null ? xFromIdx(selected) : 0;
  return (
    <View style={{ alignItems: 'center' }}>
      <GestureDetector gesture={Gesture.Simultaneous(pan, tap)}>
        <View style={{ width: CW, height }}>
          {children}
          {selected !== null ? (
            <>
              {/* 参考竖线 */}
              <View
                pointerEvents="none"
                style={{ position: 'absolute', left: px - 0.5, top: 4, bottom: 20, width: 1, borderLeftWidth: 1, borderColor: alpha(colors.foreground, 0.35), borderStyle: 'dashed' }}
              />
              {/* 数值浮层(左右 clamp 防溢出) */}
              <View
                pointerEvents="none"
                style={{
                  position: 'absolute', top: 2, left: Math.max(4, Math.min(px - 66, CW - 136)), width: 132,
                  borderRadius: 8, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border,
                  paddingHorizontal: 8, paddingVertical: 5, gap: 2,
                }}
              >
                {renderTip(selected)}
              </View>
            </>
          ) : null}
        </View>
      </GestureDetector>
    </View>
  );
}

/** 浮层数值行:色点 + 名称 + 值 */
function TipRow({ color, label, value }: { color: string; label: string; value: string }) {
  const { colors } = useTheme();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
      <View style={{ width: 5, height: 5, borderRadius: 3, backgroundColor: color }} />
      <Text style={{ fontSize: 9, color: colors.mutedForeground, flex: 1 }}>{label}</Text>
      <Text style={{ fontSize: 10, fontWeight: '600', color, fontVariant: ['tabular-nums'] }}>{value}</Text>
    </View>
  );
}

// ════════════════════════════════════════
// 自绘图表组件
// ════════════════════════════════════════

// ── 图表过渡动画工具 ──
const ANIM_DURATION = 550;

// 数据 key 变化时重放的 0→1 进度(View 层动画用,配合 useAnimatedStyle)
function useProgress(key: string, duration = ANIM_DURATION): SharedValue<number> {
  const p = useSharedValue(0);
  useEffect(() => {
    p.value = 0;
    p.value = withTiming(1, { duration, easing: Easing.out(Easing.cubic) });
  }, [key, duration, p]);
  return p;
}

// JS 驱动的 0→1 进度(每帧 setState;SVG 属性逐帧插值用——Fabric 上 Reanimated animatedProps 对 svg 组件不生效)
function useJsProgress(key: string, duration = ANIM_DURATION): number {
  const [p, setP] = useState(0);
  useEffect(() => {
    setP(0);
    const av = new RNAnimated.Value(0);
    const id = av.addListener((e) => setP(e.value));
    const anim = RNAnimated.timing(av, { toValue: 1, duration, easing: RNEasing.out(RNEasing.cubic), useNativeDriver: false });
    anim.start();
    return () => { av.removeListener(id); av.stopAnimation(); };
  }, [key, duration]);
  return p;
}

// 堆叠柱段:随进度从底部生长(整柱按同比例展开)
function GrowStackBar({ p, x, width, baseY, y, barH, ...rest }: {
  p: number; x: number; width: number; baseY: number; y: number; barH: number;
  [key: string]: unknown;
}) {
  return <Rect x={x} y={baseY - (baseY - y) * p} width={width} height={barH * p} {...(rest as object)} />;
}

// ── 三线折线图(收入/支出/结余) ──
function TripleLineChart({ income, expense, labels, height = CHART_H }: {
  income: number[]; expense: number[]; labels: string[]; height?: number;
}) {
  const { colors } = useTheme();
  // 进场/数据切换:实线用 dasharray 从起点画出,结余虚线逐点延伸
  const progress = useJsProgress(`${income.join(',')}|${expense.join(',')}`);
  const n = labels.length;
  // 空数据防御:避免除零产生 NaN 坐标导致 SVG 渲染崩溃
  if (n < 2 || income.length !== n || expense.length !== n) {
    return <Text style={{ fontSize: 12, color: colors.mutedForeground, textAlign: 'center', paddingVertical: 40 }}>暂无数据</Text>;
  }
  const padL = 44, padR = 8, padT = 20, padB = 24;
  const chartW = CW - padL - padR;
  const chartH = height - padT - padB;
  const allVals = [...income, ...expense, ...income.map((v, i) => v - expense[i])];
  const maxVal = Math.max(...allVals, 1);
  const minVal = Math.min(...allVals, 0);
  const range = maxVal - minVal || 1;

  const x = (i: number) => padL + (i / (n - 1)) * chartW;
  const y = (v: number) => padT + chartH - ((v - minVal) / range) * chartH;
  const net = income.map((v, i) => v - expense[i]);
  // 折线长度估算(dasharray 揭示用); upto 为虚线已绘制的点数
  const lineLen = (data: number[]) => {
    let len = 0;
    for (let i = 1; i < data.length; i++) len += Math.hypot(x(i) - x(i - 1), y(data[i]) - y(data[i - 1]));
    return len || 1;
  };
  const upto = Math.max(2, Math.ceil(n * progress));

  const line = (data: number[], color: string, dashed = false) => {
    const pts = (dashed ? data.slice(0, upto) : data).map((v, i) => `${x(i)},${y(v)}`).join(' ');
    const len = lineLen(data);
    return (
      <Polyline
        points={pts} fill="none" stroke={color} strokeWidth={2} strokeLinejoin="round"
        strokeDasharray={dashed ? '4,3' : `${len * progress} ${len + 10}`}
      />
    );
  };

  return (
    <ChartInteraction
      n={n}
      xFromIdx={(i) => x(i)}
      idxFromX={(px) => Math.round(((px - padL) / chartW) * (n - 1))}
      height={height}
      renderTip={(idx) => (
        <>
          <Text style={{ fontSize: 9, color: colors.mutedForeground }}>{labels[idx]}</Text>
          <TipRow color="#22c55e" label="收入" value={`¥${fmtMoney(income[idx])}`} />
          <TipRow color="#ef4444" label="支出" value={`¥${fmtMoney(expense[idx])}`} />
          <TipRow color={colors.primary} label="结余" value={`¥${fmtMoney(net[idx])}`} />
        </>
      )}
    >
      <Svg width={CW} height={height} style={{ alignSelf: 'center' }}>
        {[0, 0.5, 1].map((t, i) => {
          const val = minVal + t * range;
          return (
            <G key={i}>
              <SvgLine x1={padL} y1={y(val)} x2={CW - padR} y2={y(val)} stroke={colors.border} strokeWidth={0.5} strokeDasharray="3,3" />
              <SvgText x={padL - 4} y={y(val) + 4} fontSize={9} fill={colors.mutedForeground} textAnchor="end">{fmtMoney(val)}</SvgText>
            </G>
          );
        })}
        {line(income, '#22c55e')}
        {line(expense, '#ef4444')}
        {line(net, colors.primary, true)}
        {labels.map((l, i) => <SvgText key={i} x={x(i)} y={height - 4} fontSize={9} fill={colors.mutedForeground} textAnchor="middle">{l}</SvgText>)}
        {/* 图例 */}
        <Circle cx={padL + 8} cy={padT - 6} r={3} fill="#22c55e" />
        <SvgText x={padL + 14} y={padT - 2} fontSize={9} fill={colors.mutedForeground}>收入</SvgText>
        <Circle cx={padL + 48} cy={padT - 6} r={3} fill="#ef4444" />
        <SvgText x={padL + 54} y={padT - 2} fontSize={9} fill={colors.mutedForeground}>支出</SvgText>
        <SvgLine x1={padL + 88} y1={padT - 6} x2={padL + 96} y2={padT - 6} stroke={colors.primary} strokeWidth={2} strokeDasharray="2,2" />
        <SvgText x={padL + 100} y={padT - 2} fontSize={9} fill={colors.mutedForeground}>结余</SvgText>
      </Svg>
    </ChartInteraction>
  );
}

// ── 单线图(资产净值) ──
function AreaLineChart({ data, labels, color, height = CHART_H }: {
  data: number[]; labels: string[]; color: string; height?: number;
}) {
  const { colors } = useTheme();
  // 进场/数据切换:线条 dasharray 画出 + 面积淡入 + 数据点逐个出现
  const progress = useJsProgress(data.join(','));
  const n = data.length;
  if (n < 2 || labels.length !== n) {
    return <Text style={{ fontSize: 12, color: colors.mutedForeground, textAlign: 'center', paddingVertical: 40 }}>暂无数据</Text>;
  }
  const padL = 44, padR = 8, padT = 16, padB = 24;
  const chartW = CW - padL - padR;
  const chartH = height - padT - padB;
  const maxVal = Math.max(...data, 1);
  const minVal = Math.min(...data, 0);
  const range = maxVal - minVal || 1;

  const x = (i: number) => padL + (i / (n - 1)) * chartW;
  const y = (v: number) => padT + chartH - ((v - minVal) / range) * chartH;
  const lineLen = () => {
    let len = 0;
    for (let i = 1; i < n; i++) len += Math.hypot(x(i) - x(i - 1), y(data[i]) - y(data[i - 1]));
    return len || 1;
  };
  const len = lineLen();
  const upto = Math.max(2, Math.ceil(n * progress));
  const points = data.map((v, i) => `${x(i)},${y(v)}`).join(' ');

  return (
    <ChartInteraction
      n={n}
      xFromIdx={(i) => x(i)}
      idxFromX={(px) => Math.round(((px - padL) / chartW) * (n - 1))}
      height={height}
      renderTip={(idx) => (
        <>
          <Text style={{ fontSize: 9, color: colors.mutedForeground }}>{labels[idx]}</Text>
          <TipRow color={color} label="净值" value={`¥${fmtMoney(data[idx])}`} />
        </>
      )}
    >
      <Svg width={CW} height={height} style={{ alignSelf: 'center' }}>
        {[0, 0.5, 1].map((t, i) => {
          const val = minVal + t * range;
          return (
            <G key={i}>
              <SvgLine x1={padL} y1={y(val)} x2={CW - padR} y2={y(val)} stroke={colors.border} strokeWidth={0.5} strokeDasharray="3,3" />
              <SvgText x={padL - 4} y={y(val) + 4} fontSize={9} fill={colors.mutedForeground} textAnchor="end">{fmtMoney(val)}</SvgText>
            </G>
          );
        })}
        <Path d={`M${x(0)},${padT + chartH} L${data.slice(0, upto).map((v, i) => `${x(i)},${y(v)}`).join(' L')} L${x(upto - 1)},${padT + chartH} Z`} fill={alpha(color, 0.1 * progress)} />
        <Polyline points={points} fill="none" stroke={color} strokeWidth={2} strokeLinejoin="round" strokeDasharray={`${len * progress} ${len + 10}`} />
        {data.slice(0, upto).map((v, i) => <Circle key={i} cx={x(i)} cy={y(v)} r={3} fill={color} />)}
        {labels.map((l, i) => <SvgText key={i} x={x(i)} y={height - 4} fontSize={9} fill={colors.mutedForeground} textAnchor="middle">{l}</SvgText>)}
      </Svg>
    </ChartInteraction>
  );
}

// ── 多线图(账户余额变化) ──
function MultiLineChart({ series, labels, height = CHART_H }: {
  series: { name: string; data: number[]; color?: string }[]; labels: string[]; height?: number;
}) {
  const { colors } = useTheme();
  // 进场/数据切换:线条 dasharray 从起点画出
  const progress = useJsProgress(series.map((s) => s.data.join(',')).join('|'));
  const n = labels.length;
  if (n < 2 || series.length === 0) {
    return <Text style={{ fontSize: 12, color: colors.mutedForeground, textAlign: 'center', paddingVertical: 40 }}>暂无数据</Text>;
  }
  const padL = 44, padR = 8, padT = 20, padB = 24;
  const chartW = CW - padL - padR;
  const chartH = height - padT - padB;
  const allVals = series.flatMap(s => s.data);
  const maxVal = Math.max(...allVals, 1);
  const minVal = Math.min(...allVals, 0);
  const range = maxVal - minVal || 1;

  const x = (i: number) => padL + (i / (n - 1)) * chartW;
  const y = (v: number) => padT + chartH - ((v - minVal) / range) * chartH;
  // 折线长度估算(dasharray 揭示用); x 轴标签按点数稀疏(近60天约60个点)
  const lineLen = (data: number[]) => {
    let len = 0;
    for (let i = 1; i < data.length; i++) len += Math.hypot(x(i) - x(i - 1), y(data[i]) - y(data[i - 1]));
    return len || 1;
  };
  const labelStep = Math.max(1, Math.ceil(n / 8));

  return (
    <ChartInteraction
      n={n}
      xFromIdx={(i) => x(i)}
      idxFromX={(px) => Math.round(((px - padL) / chartW) * (n - 1))}
      height={height}
      renderTip={(idx) => (
        <>
          <Text style={{ fontSize: 9, color: colors.mutedForeground }}>{labels[idx]}</Text>
          {series.slice(0, 4).map((s, si) => (
            <TipRow
              key={si}
              color={s.color ?? CHART_COLORS[si % CHART_COLORS.length]}
              label={s.name}
              value={`¥${fmtMoney(s.data[idx] ?? 0)}`}
            />
          ))}
        </>
      )}
    >
      <Svg width={CW} height={height} style={{ alignSelf: 'center' }}>
        {[0, 0.5, 1].map((t, i) => {
          const val = minVal + t * range;
          return (
            <G key={i}>
              <SvgLine x1={padL} y1={y(val)} x2={CW - padR} y2={y(val)} stroke={colors.border} strokeWidth={0.5} strokeDasharray="3,3" />
              <SvgText x={padL - 4} y={y(val) + 4} fontSize={9} fill={colors.mutedForeground} textAnchor="end">{fmtMoney(val)}</SvgText>
            </G>
          );
        })}
        {series.map((s, si) => {
          const len = lineLen(s.data);
          return (
            <Polyline
              key={si} points={s.data.map((v, i) => `${x(i)},${y(v)}`).join(' ')} fill="none"
              stroke={s.color ?? CHART_COLORS[si % CHART_COLORS.length]} strokeWidth={1.5} strokeLinejoin="round"
              strokeDasharray={`${len * progress} ${len + 10}`}
            />
          );
        })}
        {labels.map((l, i) => i % labelStep === 0
          ? <SvgText key={i} x={x(i)} y={height - 4} fontSize={9} fill={colors.mutedForeground} textAnchor="middle">{l}</SvgText>
          : null)}
        {/* 图例 */}
        {series.slice(0, 4).map((s, i) => (
          <G key={`leg${i}`}>
            <Circle cx={padL + 8 + i * 64} cy={padT - 6} r={3} fill={s.color ?? CHART_COLORS[i % CHART_COLORS.length]} />
            <SvgText x={padL + 14 + i * 64} y={padT - 2} fontSize={9} fill={colors.mutedForeground}>{s.name.slice(0, 3)}</SvgText>
          </G>
        ))}
      </Svg>
    </ChartInteraction>
  );
}

// ── 双柱状图(收入/支出对比) ──
function DualBarChart({ income, expense, labels, height = CHART_H }: {
  income: number[]; expense: number[]; labels: string[]; height?: number;
}) {
  const { colors } = useTheme();
  const n = labels.length;
  const padL = 44, padR = 8, padT = 20, padB = 24;
  const chartW = CW - padL - padR;
  const chartH = height - padT - padB;
  if (n === 0) {
    return <Text style={{ fontSize: 12, color: colors.mutedForeground, textAlign: 'center', paddingVertical: 40 }}>暂无数据</Text>;
  }
  const maxVal = Math.max(...income, ...expense, 1);
  const gap = chartW / n;
  const barW = gap * 0.32;

  return (
    <ChartInteraction
      n={n}
      xFromIdx={(i) => padL + i * gap + gap / 2}
      idxFromX={(px) => Math.floor((px - padL) / gap)}
      height={height}
      renderTip={(idx) => (
        <>
          <Text style={{ fontSize: 9, color: colors.mutedForeground }}>{labels[idx]}</Text>
          <TipRow color="#22c55e" label="收入" value={`¥${fmtMoney(income[idx] ?? 0)}`} />
          <TipRow color="#ef4444" label="支出" value={`¥${fmtMoney(expense[idx] ?? 0)}`} />
        </>
      )}
    >
      <Svg width={CW} height={height} style={{ alignSelf: 'center' }}>
        {[0, 0.5, 1].map((t, i) => {
          const val = t * maxVal;
          const yy = padT + chartH - (val / maxVal) * chartH;
          return (
            <G key={i}>
              <SvgLine x1={padL} y1={yy} x2={CW - padR} y2={yy} stroke={colors.border} strokeWidth={0.5} strokeDasharray="3,3" />
              <SvgText x={padL - 4} y={yy + 4} fontSize={9} fill={colors.mutedForeground} textAnchor="end">{fmtMoney(val)}</SvgText>
            </G>
          );
        })}
        {income.map((v, i) => {
          const barH = (v / maxVal) * chartH;
          const bx = padL + i * gap + gap * 0.1;
          return <Rect key={`i${i}`} x={bx} y={padT + chartH - barH} width={barW} height={barH} fill="#22c55e" rx={2} />;
        })}
        {expense.map((v, i) => {
          const barH = (v / maxVal) * chartH;
          const bx = padL + i * gap + gap * 0.1 + barW + 2;
          return <Rect key={`e${i}`} x={bx} y={padT + chartH - barH} width={barW} height={barH} fill="#ef4444" rx={2} />;
        })}
        {labels.map((l, i) => <SvgText key={i} x={padL + i * gap + gap / 2} y={height - 4} fontSize={9} fill={colors.mutedForeground} textAnchor="middle">{l}</SvgText>)}
        <Rect x={padL + 8} y={padT - 8} width={8} height={8} fill="#22c55e" rx={2} />
        <SvgText x={padL + 20} y={padT} fontSize={9} fill={colors.mutedForeground}>收入</SvgText>
        <Rect x={padL + 52} y={padT - 8} width={8} height={8} fill="#ef4444" rx={2} />
        <SvgText x={padL + 64} y={padT} fontSize={9} fill={colors.mutedForeground}>支出</SvgText>
      </Svg>
    </ChartInteraction>
  );
}

// ── 堆叠柱状图(分类支出构成;点击图例隐藏/显示该项对齐 web,点击柱段选中) ──
function StackedBarChart({ periods, categories, selectedIndex, onSelect, height = 240 }: {
  periods: string[]; categories: { name: string; data: number[] }[]; height?: number;
  selectedIndex?: { periodIdx: number; catIdx: number } | null;
  onSelect?: (periodIdx: number, catIdx: number) => void;
}) {
  const { colors } = useTheme();
  // 隐藏分类集合(点击图例切换,对齐 web ECharts legend 行为);分类集合变化时重置
  const [hidden, setHidden] = useState<Set<number>>(new Set());
  const catKey = categories.map((c) => c.name).join('|');
  useEffect(() => { setHidden(new Set()); }, [catKey]);
  const toggleHidden = (i: number) => setHidden((prev) => {
    const next = new Set(prev);
    if (next.has(i)) next.delete(i); else next.add(i);
    return next;
  });

  const n = periods.length;
  // 进场/数据变化/图例切换:柱段从底部生长
  const growthKey = `${periods.join('|')}#${catKey}#${categories.map((c) => c.data.join(',')).join(';')}#${[...hidden].join(',')}`;
  const progress = useJsProgress(growthKey);
  if (n === 0 || categories.length === 0) {
    return <Text style={{ fontSize: 12, color: colors.mutedForeground, textAlign: 'center', paddingVertical: 40 }}>暂无数据</Text>;
  }
  const padL = 44, padR = 8, padT = 16, padB = 28;
  const chartW = CW - padL - padR;
  const chartH = height - padT - padB;
  // 隐藏后按可见分类重新堆叠
  const visibleCats = categories.map((c, i) => ({ ...c, i })).filter((c) => !hidden.has(c.i));
  const totals = periods.map((_, pi) => visibleCats.reduce((s, c) => s + (c.data[pi] ?? 0), 0));
  const maxVal = Math.max(...totals, 1);
  const barW = chartW / n * 0.6;
  const gap = chartW / n;

  return (
    <View>
      <Svg width={CW} height={height} style={{ alignSelf: 'center' }}>
        {[0, 0.5, 1].map((t, i) => {
          const val = t * maxVal;
          const yy = padT + chartH - (val / maxVal) * chartH;
          return (
            <G key={i}>
              <SvgLine x1={padL} y1={yy} x2={CW - padR} y2={yy} stroke={colors.border} strokeWidth={0.5} strokeDasharray="3,3" />
              <SvgText x={padL - 4} y={yy + 4} fontSize={9} fill={colors.mutedForeground} textAnchor="end">{fmtMoney(val)}</SvgText>
            </G>
          );
        })}
        {periods.map((p, pi) => {
          const bx = padL + pi * gap + (gap - barW) / 2;
          const baseY = padT + chartH;
          return (
            <G key={pi}>
              {visibleCats.map((c) => {
                const v = c.data[pi] ?? 0;
                if (v <= 0) return null;
                const barH = (v / maxVal) * chartH;
                // 累计该柱段以下的可见段高度,得到最终 y
                const below = visibleCats.slice(0, visibleCats.indexOf(c)).reduce((s, pc) => s + Math.max(0, (pc.data[pi] ?? 0) / maxVal * chartH), 0);
                const yTop = baseY - below - barH;
                const isSelected = selectedIndex?.periodIdx === pi && selectedIndex?.catIdx === c.i;
                return (
                  <GrowStackBar
                    key={c.i}
                    p={progress}
                    x={bx} width={barW} baseY={baseY} y={yTop} barH={barH}
                    fill={CHART_COLORS[c.i % CHART_COLORS.length]}
                    fillOpacity={selectedIndex && !isSelected ? 0.45 : 1}
                    stroke={isSelected ? colors.foreground : 'none'}
                    strokeWidth={isSelected ? 1.5 : 0}
                    onPress={onSelect ? () => onSelect(pi, c.i) : undefined}
                  />
                );
              })}
              <SvgText x={bx + barW / 2} y={height - 6} fontSize={8} fill={colors.mutedForeground} textAnchor="middle">{p.length > 7 ? p.slice(5) : p}</SvgText>
            </G>
          );
        })}
      </Svg>
      {/* 图例(点击隐藏/显示该项) */}
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 4 }}>
        {categories.map((c, i) => {
          const isHidden = hidden.has(i);
          return (
            <Pressable
              key={i}
              onPress={() => toggleHidden(i)}
              style={{ flexDirection: 'row', alignItems: 'center', gap: 3, paddingVertical: 2, paddingHorizontal: 4, borderRadius: 6, opacity: isHidden ? 0.35 : 1, backgroundColor: !isHidden && selectedIndex?.catIdx === i ? alpha(CHART_COLORS[i % CHART_COLORS.length], 0.12) : 'transparent' }}
            >
              <View style={{ width: 8, height: 8, borderRadius: 2, backgroundColor: CHART_COLORS[i % CHART_COLORS.length] }} />
              <Text style={{ fontSize: 10, color: colors.mutedForeground }}>{c.name}</Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

// ── 饼图扇区层:按角度顺序扫描展开(路径 d 逐帧插值,段数少 JS 开销可忽略) ──
function DonutSlices({ visible, size, selectedIndex, onSelect }: {
  visible: { name: string; value: number; color?: string; i: number }[]; size: number;
  selectedIndex?: number | null;
  onSelect?: (index: number) => void;
}) {
  const { colors } = useTheme();
  const cx = size / 2;
  const cy = size / 2;
  const r = size / 2 - 10;
  const innerR = r * 0.55;
  const sum = visible.reduce((s, d) => s + d.value, 0);
  const total = sum || 1;
  const animKey = visible.map((d) => `${d.i}:${d.value}`).join('|');

  // JS 驱动 0→1 进度,扇区按顺序跟随扫描线出现
  const p = useJsProgress(animKey, 650);
  const sweep = Math.PI * 2 * p;
  let angle = -Math.PI / 2;
  const paths = visible.map((d) => {
    const startAngle = angle;
    const endAngle = angle + (d.value / total) * Math.PI * 2;
    angle = endAngle;
    const drawEnd = Math.min(endAngle, -Math.PI / 2 + sweep);
    if (drawEnd <= startAngle) return null;
    const frac = (drawEnd - startAngle) / (Math.PI * 2);
    const color = d.color ?? CHART_COLORS[d.i % CHART_COLORS.length];
    const isSelected = selectedIndex === d.i;
    let d2: string;
    if (frac >= 0.9999) {
      // 比例 ≥99.99% 时用两段半圆弧画整环(SVG 弧起终点重合时无法绘制)
      d2 = `M${cx},${cy - r} A${r},${r} 0 1 1 ${cx},${cy + r} A${r},${r} 0 1 1 ${cx},${cy - r} L${cx},${cy - innerR} A${innerR},${innerR} 0 1 0 ${cx},${cy + innerR} A${innerR},${innerR} 0 1 0 ${cx},${cy - innerR} Z`;
    } else {
      const largeArc = frac > 0.5 ? 1 : 0;
      const x1 = cx + r * Math.cos(startAngle), y1 = cy + r * Math.sin(startAngle);
      const x2 = cx + r * Math.cos(drawEnd), y2 = cy + r * Math.sin(drawEnd);
      const ix1 = cx + innerR * Math.cos(drawEnd), iy1 = cy + innerR * Math.sin(drawEnd);
      const ix2 = cx + innerR * Math.cos(startAngle), iy2 = cy + innerR * Math.sin(startAngle);
      d2 = `M${x1},${y1} A${r},${r} 0 ${largeArc} 1 ${x2},${y2} L${ix1},${iy1} A${innerR},${innerR} 0 ${largeArc} 0 ${ix2},${iy2} Z`;
    }
    return (
      <Path
        key={d.i}
        d={d2}
        fill={color}
        fillOpacity={isSelected ? 1 : 0.88}
        stroke={isSelected ? colors.foreground : 'none'}
        strokeWidth={isSelected ? 1.5 : 0}
        onPress={onSelect ? () => onSelect(d.i) : undefined}
      />
    );
  });

  return (
    <Svg width={size} height={size}>
      {paths}
      <SvgText x={cx} y={cy + 5} fontSize={13} fontWeight="700" fill={colors.foreground} textAnchor="middle">
        {fmtMoney(sum)}
      </SvgText>
    </Svg>
  );
}

// ── 饼图(环形;点击图例隐藏/显示该项对齐 web,点击扇区选中;数据/隐藏项变化时扇区扫描展开) ──
function DonutChart({ data, size = 180, selectedIndex, onSelect }: {
  data: { name: string; value: number; color?: string }[]; size?: number;
  selectedIndex?: number | null;
  onSelect?: (index: number) => void;
}) {
  const { colors } = useTheme();
  // 隐藏项集合(点击图例切换,对齐 web ECharts legend 行为);数据源变化时重置
  const [hidden, setHidden] = useState<Set<number>>(new Set());
  const dataKey = data.map((d) => d.name).join('|');
  useEffect(() => { setHidden(new Set()); }, [dataKey]);
  const toggleHidden = (i: number) => setHidden((prev) => {
    const next = new Set(prev);
    if (next.has(i)) next.delete(i); else next.add(i);
    return next;
  });

  const visible = data.map((d, i) => ({ ...d, i })).filter((d) => !hidden.has(d.i));
  const total = visible.reduce((s, d) => s + d.value, 0) || 1;

  return (
    <View style={{ alignItems: 'center' }}>
      <DonutSlices visible={visible} size={size} selectedIndex={selectedIndex} onSelect={onSelect} />
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 6, justifyContent: 'center' }}>
        {data.map((d, i) => {
          const isHidden = hidden.has(i);
          return (
            <Pressable
              key={i}
              onPress={() => toggleHidden(i)}
              style={{ flexDirection: 'row', alignItems: 'center', gap: 3, paddingVertical: 2, paddingHorizontal: 4, borderRadius: 6, opacity: isHidden ? 0.35 : 1, backgroundColor: !isHidden && selectedIndex === i ? alpha(CHART_COLORS[i % CHART_COLORS.length], 0.12) : 'transparent' }}
            >
              <View style={{ width: 8, height: 8, borderRadius: 2, backgroundColor: d.color ?? CHART_COLORS[i % CHART_COLORS.length] }} />
              <Text style={{ fontSize: 10, color: colors.mutedForeground }}>{d.name}</Text>
              <Text style={{ fontSize: 10, fontWeight: '600', color: colors.foreground }}>{isHidden ? '-' : `${Math.round(d.value / total * 100)}%`}</Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

// ── 时间段5维雷达图 ──
function TimeRadar({ metrics, size = 240 }: { metrics: { name: string; value: number; detail?: string }[]; size?: number }) {
  const { colors } = useTheme();
  // 进场/数据切换:数据多边形从中心展开
  const progress = useProgress(metrics.map((m) => `${m.name}:${m.value}`).join('|'), 600);
  const chartAnimStyle = useAnimatedStyle(() => ({
    opacity: progress.value,
    transform: [{ scale: 0.6 + 0.4 * progress.value }],
  }));
  const n = metrics.length;
  if (n === 0) {
    return <Text style={{ fontSize: 12, color: colors.mutedForeground, textAlign: 'center', paddingVertical: 40 }}>暂无数据</Text>;
  }
  const cx = size / 2, cy = size / 2;
  const radius = size / 2 - 30;
  const angleFor = (i: number) => (Math.PI * 2 * i) / n - Math.PI / 2;
  // 数值异常(NaN/越界)按 0 处理,避免 SVG 坐标 NaN 崩溃
  const clampVal = (v: number) => (Number.isFinite(v) ? Math.max(0, Math.min(100, v)) : 0);
  const point = (i: number, r: number): [number, number] => [cx + r * Math.cos(angleFor(i)), cy + r * Math.sin(angleFor(i))];
  const rings = [0.25, 0.5, 0.75, 1].map(t => Array.from({ length: n }, (_, i) => point(i, radius * t)));
  const axes = Array.from({ length: n }, (_, i) => point(i, radius));
  const dataPts = metrics.map((m, i) => point(i, (radius * clampVal(m.value)) / 100));

  return (
    <Animated.View style={[{ alignItems: 'center' }, chartAnimStyle]}>
      <Svg width={size} height={size}>
        {rings.map((ring, ri) => <Polygon key={ri} points={ring.map(p => p.join(',')).join(' ')} fill="none" stroke={colors.border} strokeWidth={0.5} />)}
        {axes.map((p, i) => <SvgLine key={i} x1={cx} y1={cy} x2={p[0]} y2={p[1]} stroke={colors.border} strokeWidth={0.5} />)}
        <Polygon points={dataPts.map(p => p.join(',')).join(' ')} fill={colors.primary} fillOpacity={0.18} stroke={colors.primary} strokeWidth={2} />
        {dataPts.map((p, i) => <SvgText key={i} x={p[0]} y={p[1] - 6} fontSize={14} fontWeight="700" fill={colors.primary} textAnchor="middle">{metrics[i].value}</SvgText>)}
        {metrics.map((m, i) => { const [x, y] = point(i, radius + 18); return <SvgText key={m.name} x={x} y={y} fontSize={9} fill={colors.mutedForeground} textAnchor="middle" fontWeight="600">{m.name}</SvgText>; })}
      </Svg>
    </Animated.View>
  );
}

// ════════════════════════════════════════
// 辅助组件
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
        <SummaryCard icon={TrendingUp} label="总收入" value={summary.income} color="#22c55e" />
        <SummaryCard icon={TrendingDown} label="总支出" value={summary.expense} color="#ef4444" />
      </View>
      <View style={{ flexDirection: 'row', gap: 8 }}>
        <SummaryCard icon={Activity} label="净收入" value={summary.netIncome} color={summary.netIncome >= 0 ? '#22c55e' : '#ef4444'} />
        <SummaryCard icon={Wallet} label="转账总额" value={summary.transfer} color="#3b82f6" />
      </View>

      <ChartCard title="月度收支趋势">
        <TripleLineChart income={trend.income} expense={trend.expense} labels={monthlyLabels} />
      </ChartCard>

      <ChartCard title="资产净值趋势">
        <AreaLineChart data={netWorth.values} labels={netWorthLabels} color={colors.primary} />
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
            <SummaryCard icon={TrendingUp} label="总收入" value={(rangeSummary ?? summary).income} color="#22c55e" />
            <SummaryCard icon={TrendingDown} label="总支出" value={(rangeSummary ?? summary).expense} color="#ef4444" />
          </View>
          <View style={{ flexDirection: 'row', gap: 8 }}>
            <SummaryCard icon={Activity} label="净收入" value={(rangeSummary ?? summary).netIncome} color={(rangeSummary ?? summary).netIncome >= 0 ? '#22c55e' : '#ef4444'} />
            <SummaryCard icon={Wallet} label="转账总额" value={(rangeSummary ?? summary).transfer} color="#3b82f6" />
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
                { key: 'EXPENSE', label: '支出', color: '#ef4444' },
                { key: 'INCOME', label: '收入', color: '#22c55e' },
                { key: 'TRANSFER', label: '转账', color: '#3b82f6' },
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
                      color={CHART_COLORS[(selIdx >= 0 ? selIdx : 0) % CHART_COLORS.length]}
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
                color={CHART_COLORS[barSelected.catIdx % CHART_COLORS.length]}
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

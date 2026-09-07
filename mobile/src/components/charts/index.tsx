// 图表原语库:点按交互浮层 / 过渡动画 / 折线·柱状·环形·雷达等自绘原语。
// 从 stats 页面拆出 —— 页面只做 数据 → props 映射,绘制细节(含 Fabric SVG 动画 workaround)收敛于此。
import { useState, useEffect, useMemo, type ReactNode } from 'react';
import { View, Pressable, Dimensions, Platform } from 'react-native';
import { GestureDetector, Gesture } from 'react-native-gesture-handler';
import Animated, { Easing, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import type { SharedValue } from 'react-native-reanimated';
import { Animated as RNAnimated, Easing as RNEasing } from 'react-native';
import { Svg, Line as SvgLine, Polyline, Rect, Circle, Text as SvgText, G, Path, Polygon } from 'react-native-svg';
import { useTheme, alpha, haptics, useChartColors } from '@/theme';
import { Text } from '@/components/ui/Text';

const SCREEN_W = Dimensions.get('window').width;
// 外层 ScrollView padding 16×2 = 32; 卡片 padding 14×2 = 28; 总扣减 60
export const CW = SCREEN_W - 60;
const CHART_H = 200;

// ── 金额格式化 ──
export const fmtMoney = (v: number) => v >= 10000 ? `${(v / 10000).toFixed(1)}万` : `${Math.round(v)}`;

// ── 图表点按交互:点按/拖动选择最近数据点,参考线 + 具体值浮层 ──
export function ChartInteraction({ n, xFromIdx, idxFromX, renderTip, height, children }: {
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
export function TipRow({ color, label, value }: { color: string; label: string; value: string }) {
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
export function useProgress(key: string, duration = ANIM_DURATION): SharedValue<number> {
  const p = useSharedValue(0);
  useEffect(() => {
    p.value = 0;
    p.value = withTiming(1, { duration, easing: Easing.out(Easing.cubic) });
  }, [key, duration, p]);
  return p;
}

// JS 驱动的 0→1 进度(每帧 setState;SVG 属性逐帧插值用——Fabric 上 Reanimated animatedProps 对 svg 组件不生效)
export function useJsProgress(key: string, duration = ANIM_DURATION): number {
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
export function GrowStackBar({ p, x, width, baseY, y, barH, ...rest }: {
  p: number; x: number; width: number; baseY: number; y: number; barH: number;
  [key: string]: unknown;
}) {
  return <Rect x={x} y={baseY - (baseY - y) * p} width={width} height={barH * p} {...(rest as object)} />;
}

// ── 三线折线图(收入/支出/结余) ──
export function TripleLineChart({ income, expense, labels, height = CHART_H }: {
  income: number[]; expense: number[]; labels: string[]; height?: number;
}) {
  const { colors } = useTheme();
  const cc = useChartColors();
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
          <TipRow color={cc.income} label="收入" value={`¥${fmtMoney(income[idx])}`} />
          <TipRow color={cc.expense} label="支出" value={`¥${fmtMoney(expense[idx])}`} />
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
        {line(income, cc.income)}
        {line(expense, cc.expense)}
        {line(net, colors.primary, true)}
        {labels.map((l, i) => <SvgText key={i} x={x(i)} y={height - 4} fontSize={9} fill={colors.mutedForeground} textAnchor="middle">{l}</SvgText>)}
        {/* 图例 */}
        <Circle cx={padL + 8} cy={padT - 6} r={3} fill={cc.income} />
        <SvgText x={padL + 14} y={padT - 2} fontSize={9} fill={colors.mutedForeground}>收入</SvgText>
        <Circle cx={padL + 48} cy={padT - 6} r={3} fill={cc.expense} />
        <SvgText x={padL + 54} y={padT - 2} fontSize={9} fill={colors.mutedForeground}>支出</SvgText>
        <SvgLine x1={padL + 88} y1={padT - 6} x2={padL + 96} y2={padT - 6} stroke={colors.primary} strokeWidth={2} strokeDasharray="2,2" />
        <SvgText x={padL + 100} y={padT - 2} fontSize={9} fill={colors.mutedForeground}>结余</SvgText>
      </Svg>
    </ChartInteraction>
  );
}

// ── 单线图(资产净值) ──
export function AreaLineChart({ data, labels, color, height = CHART_H }: {
  data: number[]; labels: string[]; color: string; height?: number;
}) {
  const { colors } = useTheme();
  // 进场/数据切换:线条 dasharray 画出 + 面积淡入 + 数据点逐个出现
  const progress = useJsProgress(data.join(','));
  const n = data.length;
  if (n < 2 || labels.length !== n) {
    return <Text style={{ fontSize: 12, color: colors.mutedForeground, textAlign: 'center', paddingVertical: 40 }}>暂无数据</Text>;
  }
  // padB 需容纳 -45° 倾斜标签的纵向延伸(最长日期约 54px·sin45° ≈ 38px + 锚点下移 12px)
  const padL = 44, padR = 8, padT = 16, padB = 60;
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
  // x 轴标签倾斜 45°,可容纳更多节点(约为水平排布的 2 倍)
  const labelStep = Math.max(1, Math.ceil(n / 16));

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
        {labels.map((l, i) => i % labelStep === 0
          ? (
            <SvgText
              key={i} x={x(i)} y={height - padB + 12} fontSize={9} fill={colors.mutedForeground}
              textAnchor="end" transform={`rotate(-45, ${x(i)}, ${height - padB + 12})`}
            >
              {l}
            </SvgText>
          )
          : null)}
      </Svg>
    </ChartInteraction>
  );
}

// ── 多线图(账户余额变化) ──
export function MultiLineChart({ series, labels, height = CHART_H }: {
  series: { name: string; data: number[]; color?: string }[]; labels: string[]; height?: number;
}) {
  const { colors } = useTheme();
  const cc = useChartColors();
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
              color={s.color ?? cc.COLORS[si % cc.COLORS.length]}
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
              stroke={s.color ?? cc.COLORS[si % cc.COLORS.length]} strokeWidth={1.5} strokeLinejoin="round"
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
            <Circle cx={padL + 8 + i * 64} cy={padT - 6} r={3} fill={s.color ?? cc.COLORS[i % cc.COLORS.length]} />
            <SvgText x={padL + 14 + i * 64} y={padT - 2} fontSize={9} fill={colors.mutedForeground}>{s.name.slice(0, 3)}</SvgText>
          </G>
        ))}
      </Svg>
    </ChartInteraction>
  );
}

// ── 双柱状图(收入/支出对比) ──
export function DualBarChart({ income, expense, labels, height = CHART_H }: {
  income: number[]; expense: number[]; labels: string[]; height?: number;
}) {
  const { colors } = useTheme();
  const cc = useChartColors();
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
          <TipRow color={cc.income} label="收入" value={`¥${fmtMoney(income[idx] ?? 0)}`} />
          <TipRow color={cc.expense} label="支出" value={`¥${fmtMoney(expense[idx] ?? 0)}`} />
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
          return <Rect key={`i${i}`} x={bx} y={padT + chartH - barH} width={barW} height={barH} fill={cc.income} rx={2} />;
        })}
        {expense.map((v, i) => {
          const barH = (v / maxVal) * chartH;
          const bx = padL + i * gap + gap * 0.1 + barW + 2;
          return <Rect key={`e${i}`} x={bx} y={padT + chartH - barH} width={barW} height={barH} fill={cc.expense} rx={2} />;
        })}
        {labels.map((l, i) => <SvgText key={i} x={padL + i * gap + gap / 2} y={height - 4} fontSize={9} fill={colors.mutedForeground} textAnchor="middle">{l}</SvgText>)}
        <Rect x={padL + 8} y={padT - 8} width={8} height={8} fill={cc.income} rx={2} />
        <SvgText x={padL + 20} y={padT} fontSize={9} fill={colors.mutedForeground}>收入</SvgText>
        <Rect x={padL + 52} y={padT - 8} width={8} height={8} fill={cc.expense} rx={2} />
        <SvgText x={padL + 64} y={padT} fontSize={9} fill={colors.mutedForeground}>支出</SvgText>
      </Svg>
    </ChartInteraction>
  );
}

// ── 堆叠柱状图(分类支出构成;点击图例隐藏/显示该项对齐 web,点击柱段选中) ──
export function StackedBarChart({ periods, categories, selectedIndex, onSelect, height = 240 }: {
  periods: string[]; categories: { name: string; data: number[] }[]; height?: number;
  selectedIndex?: { periodIdx: number; catIdx: number } | null;
  onSelect?: (periodIdx: number, catIdx: number) => void;
}) {
  const { colors } = useTheme();
  const cc = useChartColors();
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
                    fill={cc.COLORS[c.i % cc.COLORS.length]}
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
              style={{ flexDirection: 'row', alignItems: 'center', gap: 3, paddingVertical: 2, paddingHorizontal: 4, borderRadius: 6, opacity: isHidden ? 0.35 : 1, backgroundColor: !isHidden && selectedIndex?.catIdx === i ? alpha(cc.COLORS[i % cc.COLORS.length], 0.12) : 'transparent' }}
            >
              <View style={{ width: 8, height: 8, borderRadius: 2, backgroundColor: cc.COLORS[i % cc.COLORS.length] }} />
              <Text style={{ fontSize: 10, color: colors.mutedForeground }}>{c.name}</Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

// ── 饼图扇区层:按角度顺序扫描展开(路径 d 逐帧插值,段数少 JS 开销可忽略) ──
export function DonutSlices({ visible, size, selectedIndex, onSelect }: {
  visible: { name: string; value: number; color?: string; i: number }[]; size: number;
  selectedIndex?: number | null;
  onSelect?: (index: number) => void;
}) {
  const cc = useChartColors();
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
    const color = d.color ?? cc.COLORS[d.i % cc.COLORS.length];
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
export function DonutChart({ data, size = 180, selectedIndex, onSelect }: {
  data: { name: string; value: number; color?: string }[]; size?: number;
  selectedIndex?: number | null;
  onSelect?: (index: number) => void;
}) {
  const { colors } = useTheme();
  const cc = useChartColors();
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
              style={{ flexDirection: 'row', alignItems: 'center', gap: 3, paddingVertical: 2, paddingHorizontal: 4, borderRadius: 6, opacity: isHidden ? 0.35 : 1, backgroundColor: !isHidden && selectedIndex === i ? alpha(cc.COLORS[i % cc.COLORS.length], 0.12) : 'transparent' }}
            >
              <View style={{ width: 8, height: 8, borderRadius: 2, backgroundColor: d.color ?? cc.COLORS[i % cc.COLORS.length] }} />
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
export function TimeRadar({ metrics, size = 240 }: { metrics: { name: string; value: number; detail?: string }[]; size?: number }) {
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

import { useState, useMemo } from 'react';
import {
  ScrollView, View, Pressable, TextInput, Dimensions, Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
  TrendingUp, TrendingDown, Wallet, PieChart as PieIcon, BarChart3,
  Activity, Search, ChevronLeft, ChevronRight, Users,
} from 'lucide-react-native';
import Svg, {
  Line as SvgLine, Polyline, Rect, Circle, Text as SvgText, G, Path, Polygon,
} from 'react-native-svg';
import { useTheme, alpha } from '@/theme';
import { Text } from '@/components/ui/Text';
import {
  mockSummary, mockMonthlyTrend, mockRadar,
  mockAssetNetWorth, mockAccountBalance, mockCategoryPie,
  mockAccounts, mockUsers,
} from '@/mock/data';

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

// ════════════════════════════════════════
// 自绘图表组件
// ════════════════════════════════════════

// ── 三线折线图(收入/支出/结余) ──
function TripleLineChart({ income, expense, labels, height = CHART_H }: {
  income: number[]; expense: number[]; labels: string[]; height?: number;
}) {
  const { colors } = useTheme();
  const n = labels.length;
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

  const line = (data: number[], color: string, dashed = false) =>
    <Polyline points={data.map((v, i) => `${x(i)},${y(v)}`).join(' ')} fill="none" stroke={color} strokeWidth={2} strokeLinejoin="round" strokeDasharray={dashed ? '4,3' : undefined} />;

  return (
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
  );
}

// ── 单线图(资产净值) ──
function AreaLineChart({ data, labels, color, height = CHART_H }: {
  data: number[]; labels: string[]; color: string; height?: number;
}) {
  const { colors } = useTheme();
  const n = data.length;
  const padL = 44, padR = 8, padT = 16, padB = 24;
  const chartW = CW - padL - padR;
  const chartH = height - padT - padB;
  const maxVal = Math.max(...data, 1);
  const minVal = Math.min(...data, 0);
  const range = maxVal - minVal || 1;

  const x = (i: number) => padL + (i / (n - 1)) * chartW;
  const y = (v: number) => padT + chartH - ((v - minVal) / range) * chartH;
  const points = data.map((v, i) => `${x(i)},${y(v)}`).join(' ');
  const areaPath = `M${x(0)},${padT + chartH} L${data.map((v, i) => `${x(i)},${y(v)}`).join(' L')} L${x(n - 1)},${padT + chartH} Z`;

  return (
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
      <Path d={areaPath} fill={alpha(color, 0.1)} />
      <Polyline points={points} fill="none" stroke={color} strokeWidth={2} strokeLinejoin="round" />
      {data.map((v, i) => <Circle key={i} cx={x(i)} cy={y(v)} r={3} fill={color} />)}
      {labels.map((l, i) => <SvgText key={i} x={x(i)} y={height - 4} fontSize={9} fill={colors.mutedForeground} textAnchor="middle">{l}</SvgText>)}
    </Svg>
  );
}

// ── 多线图(账户余额变化) ──
function MultiLineChart({ series, labels, height = CHART_H }: {
  series: { name: string; data: number[]; color: string }[]; labels: string[]; height?: number;
}) {
  const { colors } = useTheme();
  const n = labels.length;
  const padL = 44, padR = 8, padT = 20, padB = 24;
  const chartW = CW - padL - padR;
  const chartH = height - padT - padB;
  const allVals = series.flatMap(s => s.data);
  const maxVal = Math.max(...allVals, 1);
  const minVal = Math.min(...allVals, 0);
  const range = maxVal - minVal || 1;

  const x = (i: number) => padL + (i / (n - 1)) * chartW;
  const y = (v: number) => padT + chartH - ((v - minVal) / range) * chartH;

  return (
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
      {series.map((s, si) => (
        <G key={si}>
          <Polyline points={s.data.map((v, i) => `${x(i)},${y(v)}`).join(' ')} fill="none" stroke={s.color} strokeWidth={1.5} strokeLinejoin="round" />
        </G>
      ))}
      {labels.map((l, i) => <SvgText key={i} x={x(i)} y={height - 4} fontSize={9} fill={colors.mutedForeground} textAnchor="middle">{l}</SvgText>)}
      {/* 图例 */}
      {series.slice(0, 4).map((s, i) => (
        <G key={`leg${i}`}>
          <Circle cx={padL + 8 + i * 64} cy={padT - 6} r={3} fill={s.color} />
          <SvgText x={padL + 14 + i * 64} y={padT - 2} fontSize={9} fill={colors.mutedForeground}>{s.name.slice(0, 3)}</SvgText>
        </G>
      ))}
    </Svg>
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
  const maxVal = Math.max(...income, ...expense, 1);
  const gap = chartW / n;
  const barW = gap * 0.32;

  return (
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
  );
}

// ── 堆叠柱状图(分类支出构成) ──
function StackedBarChart({ periods, categories, height = 240 }: {
  periods: string[]; categories: { name: string; data: number[] }[]; height?: number;
}) {
  const { colors } = useTheme();
  const n = periods.length;
  const padL = 44, padR = 8, padT = 16, padB = 28;
  const chartW = CW - padL - padR;
  const chartH = height - padT - padB;
  const totals = periods.map((_, i) => categories.reduce((s, c) => s + (c.data[i] ?? 0), 0));
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
          let accY = padT + chartH;
          const bx = padL + pi * gap + (gap - barW) / 2;
          return (
            <G key={pi}>
              {categories.map((c, ci) => {
                const v = c.data[pi] ?? 0;
                const barH = (v / maxVal) * chartH;
                accY -= barH;
                return <Rect key={ci} x={bx} y={accY} width={barW} height={barH} fill={CHART_COLORS[ci % CHART_COLORS.length]} />;
              })}
              <SvgText x={bx + barW / 2} y={height - 6} fontSize={8} fill={colors.mutedForeground} textAnchor="middle">{p.length > 7 ? p.slice(5) : p}</SvgText>
            </G>
          );
        })}
      </Svg>
      {/* 图例 */}
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 4 }}>
        {categories.map((c, i) => (
          <View key={i} style={{ flexDirection: 'row', alignItems: 'center', gap: 3 }}>
            <View style={{ width: 8, height: 8, borderRadius: 2, backgroundColor: CHART_COLORS[i % CHART_COLORS.length] }} />
            <Text style={{ fontSize: 10, color: colors.mutedForeground }}>{c.name}</Text>
          </View>
        ))}
      </View>
    </View>
  );
}

// ── 饼图(环形) ──
function DonutChart({ data, size = 180 }: {
  data: { name: string; value: number; color?: string }[]; size?: number;
}) {
  const { colors } = useTheme();
  const cx = size / 2;
  const cy = size / 2;
  const r = size / 2 - 10;
  const innerR = r * 0.55;
  const total = data.reduce((s, d) => s + d.value, 0) || 1;

  let angle = -Math.PI / 2;
  const slices = data.map((d, i) => {
    const pct = d.value / total;
    const startAngle = angle;
    const endAngle = angle + pct * Math.PI * 2;
    angle = endAngle;
    const largeArc = pct > 0.5 ? 1 : 0;
    const color = d.color ?? CHART_COLORS[i % CHART_COLORS.length];
    const x1 = cx + r * Math.cos(startAngle), y1 = cy + r * Math.sin(startAngle);
    const x2 = cx + r * Math.cos(endAngle), y2 = cy + r * Math.sin(endAngle);
    const ix1 = cx + innerR * Math.cos(endAngle), iy1 = cy + innerR * Math.sin(endAngle);
    const ix2 = cx + innerR * Math.cos(startAngle), iy2 = cy + innerR * Math.sin(startAngle);
    const d2 = `M${x1},${y1} A${r},${r} 0 ${largeArc} 1 ${x2},${y2} L${ix1},${iy1} A${innerR},${innerR} 0 ${largeArc} 0 ${ix2},${iy2} Z`;
    return { ...d, pct, path: d2, color };
  });

  return (
    <View style={{ alignItems: 'center' }}>
      <Svg width={size} height={size}>
        {slices.map((s, i) => <Path key={i} d={s.path} fill={s.color} fillOpacity={0.88} />)}
        <SvgText x={cx} y={cy + 5} fontSize={13} fontWeight="700" fill={colors.foreground} textAnchor="middle">
          {fmtMoney(total)}
        </SvgText>
      </Svg>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 6, justifyContent: 'center' }}>
        {data.map((d, i) => (
          <View key={i} style={{ flexDirection: 'row', alignItems: 'center', gap: 3 }}>
            <View style={{ width: 8, height: 8, borderRadius: 2, backgroundColor: d.color ?? CHART_COLORS[i % CHART_COLORS.length] }} />
            <Text style={{ fontSize: 10, color: colors.mutedForeground }}>{d.name}</Text>
            <Text style={{ fontSize: 10, fontWeight: '600', color: colors.foreground }}>{(d.value / total * 100).toFixed(0)}%</Text>
          </View>
        ))}
      </View>
    </View>
  );
}

// ── 时间段5维雷达图 ──
function TimeRadar({ metrics, size = 240 }: { metrics: { name: string; value: number; detail?: string }[]; size?: number }) {
  const { colors } = useTheme();
  const n = metrics.length;
  const cx = size / 2, cy = size / 2;
  const radius = size / 2 - 30;
  const angleFor = (i: number) => (Math.PI * 2 * i) / n - Math.PI / 2;
  const point = (i: number, r: number): [number, number] => [cx + r * Math.cos(angleFor(i)), cy + r * Math.sin(angleFor(i))];
  const rings = [0.25, 0.5, 0.75, 1].map(t => Array.from({ length: n }, (_, i) => point(i, radius * t)));
  const axes = Array.from({ length: n }, (_, i) => point(i, radius));
  const dataPts = metrics.map((m, i) => point(i, (radius * Math.max(0, Math.min(100, m.value))) / 100));

  return (
    <View style={{ alignItems: 'center' }}>
      <Svg width={size} height={size}>
        {rings.map((ring, ri) => <Polygon key={ri} points={ring.map(p => p.join(',')).join(' ')} fill="none" stroke={colors.border} strokeWidth={0.5} />)}
        {axes.map((p, i) => <SvgLine key={i} x1={cx} y1={cy} x2={p[0]} y2={p[1]} stroke={colors.border} strokeWidth={0.5} />)}
        <Polygon points={dataPts.map(p => p.join(',')).join(' ')} fill={colors.primary} fillOpacity={0.18} stroke={colors.primary} strokeWidth={2} />
        {dataPts.map((p, i) => <SvgText key={i} x={p[0]} y={p[1] - 6} fontSize={14} fontWeight="700" fill={colors.primary} textAnchor="middle">{metrics[i].value}</SvgText>)}
        {metrics.map((m, i) => { const [x, y] = point(i, radius + 18); return <SvgText key={m.name} x={x} y={y} fontSize={9} fill={colors.mutedForeground} textAnchor="middle" fontWeight="600">{m.name}</SvgText>; })}
      </Svg>
    </View>
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

// ── mock:模拟时间段5维雷达 ──
const TIME_RADAR = [
  { name: '储蓄率', value: 82, detail: '储蓄率 35.2%' },
  { name: '收支平衡', value: 100, detail: '收入/支出 ≥100%' },
  { name: '预算执行', value: 76, detail: '预算契合度 76分' },
  { name: '偿债压力', value: 100, detail: '无贷款' },
  { name: '财务自由度', value: 30, detail: '被动收入覆盖18%' },
];

// ── mock:堆叠柱状图数据(各月分类支出) ──
const STACKED_PERIODS = ['1月', '2月', '3月', '4月', '5月', '6月', '7月', '8月'];
const STACKED_CATEGORIES = [
  { name: '住房', data: [2800, 2800, 2800, 2800, 2800, 2800, 2800, 2600] },
  { name: '餐饮', data: [1900, 2100, 1700, 1800, 2200, 1600, 1800, 1860] },
  { name: '购物', data: [800, 1200, 600, 1400, 900, 1100, 1300, 1420] },
  { name: '交通', data: [300, 200, 400, 350, 280, 320, 300, 320] },
  { name: '其他', data: [400, 600, 200, 500, 300, 380, 420, 180] },
];

// ── mock:分析面板数据 ──
const ANALYSIS_EXPENSE_PIE = [
  { name: '住房', value: 2600 }, { name: '餐饮', value: 1860 }, { name: '购物', value: 1420 },
  { name: '交通', value: 320 }, { name: '其他', value: 180 },
];
const ANALYSIS_OWNER_PIE = [
  { name: '张三', value: 5200 }, { name: '李四', value: 1800 }, { name: '王五', value: 680 },
];
const ANALYSIS_ACCOUNT_PIE = [
  { name: '工资卡', value: 4100 }, { name: '支付宝', value: 2300 }, { name: '微信', value: 680 },
  { name: '信用卡', value: 600 },
];

// ── mock:多线账户余额 ──
const ACCOUNT_BALANCE_SERIES = [
  { name: '工资卡', data: [11500, 12000, 12000, 12500, 12500, 12860], color: '#3b82f6' },
  { name: '支付宝', data: [2800, 3000, 3100, 3200, 3350, 3450], color: '#06b6d4' },
  { name: '基金', data: [49000, 50000, 50500, 51000, 51500, 52000], color: '#a855f7' },
];

// ════════════════════════════════════════
// 主页面
// ════════════════════════════════════════
export default function StatsPage() {
  const { colors } = useTheme();
  const [tab, setTab] = useState<StatsTab>('overview');
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [analysisType, setAnalysisType] = useState<'EXPENSE' | 'INCOME' | 'TRANSFER'>('EXPENSE');
  // 自由筛选
  const [freeDateFrom, setFreeDateFrom] = useState('');
  const [freeDateTo, setFreeDateTo] = useState('');
  const [freeSearched, setFreeSearched] = useState(false);

  // ── 首页(Overview):对齐网页 StatsOverview ──
  const renderOverview = () => (
    <View style={{ gap: 16 }}>
      <View style={{ flexDirection: 'row', gap: 8 }}>
        <SummaryCard icon={TrendingUp} label="总收入" value={mockSummary.income} color="#22c55e" />
        <SummaryCard icon={TrendingDown} label="总支出" value={mockSummary.expense} color="#ef4444" />
      </View>
      <View style={{ flexDirection: 'row', gap: 8 }}>
        <SummaryCard icon={Activity} label="净收入" value={mockSummary.netIncome} color={mockSummary.netIncome >= 0 ? '#22c55e' : '#ef4444'} />
        <SummaryCard icon={Wallet} label="转账总额" value={mockSummary.transfer} color="#3b82f6" />
      </View>

      <ChartCard title="月度收支趋势">
        <TripleLineChart income={mockMonthlyTrend.income} expense={mockMonthlyTrend.expense} labels={mockMonthlyTrend.months} />
      </ChartCard>

      <ChartCard title="资产净值趋势">
        <AreaLineChart data={mockAssetNetWorth.values} labels={mockAssetNetWorth.months} color={colors.primary} />
      </ChartCard>

      <ChartCard title="账户余额变化(近60天)">
        <MultiLineChart series={ACCOUNT_BALANCE_SERIES} labels={mockAssetNetWorth.months} />
      </ChartCard>

      <ChartCard title="财务健康评估(7维)">
        <View style={{ alignItems: 'center' }}>
          <TimeRadar metrics={mockRadar} size={Math.min(CW, 300)} />
        </View>
        <View style={{ gap: 6, marginTop: 8 }}>
          {mockRadar.map(m => (
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
      {/* 自由筛选 */}
      {mode === 'free' && (
        <View style={{ gap: 10 }}>
          <View style={{ flexDirection: 'row', gap: 8 }}>
            <View style={{ flex: 1 }}>
              <Text style={{ fontSize: 11, color: colors.mutedForeground, marginBottom: 4 }}>开始日期</Text>
              <TextInput value={freeDateFrom} onChangeText={setFreeDateFrom} placeholder="YYYY-MM-DD" placeholderTextColor={colors.mutedForeground} style={{ borderWidth: 1, borderColor: colors.border, borderRadius: 8, padding: 10, fontSize: 13, color: colors.foreground, backgroundColor: colors.card }} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={{ fontSize: 11, color: colors.mutedForeground, marginBottom: 4 }}>结束日期</Text>
              <TextInput value={freeDateTo} onChangeText={setFreeDateTo} placeholder="YYYY-MM-DD" placeholderTextColor={colors.mutedForeground} style={{ borderWidth: 1, borderColor: colors.border, borderRadius: 8, padding: 10, fontSize: 13, color: colors.foreground, backgroundColor: colors.card }} />
            </View>
          </View>
          <Pressable onPress={() => setFreeSearched(true)} style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 10, borderRadius: 10, backgroundColor: colors.primary }}>
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
          {/* 汇总卡片 */}
          <View style={{ flexDirection: 'row', gap: 8 }}>
            <SummaryCard icon={TrendingUp} label="总收入" value={mockSummary.income} color="#22c55e" />
            <SummaryCard icon={TrendingDown} label="总支出" value={mockSummary.expense} color="#ef4444" />
          </View>
          <View style={{ flexDirection: 'row', gap: 8 }}>
            <SummaryCard icon={Activity} label="净收入" value={mockSummary.netIncome} color={mockSummary.netIncome >= 0 ? '#22c55e' : '#ef4444'} />
            <SummaryCard icon={Wallet} label="转账总额" value={mockSummary.transfer} color="#3b82f6" />
          </View>

          {/* 5维雷达 */}
          <ChartCard title="财务健康评估(5维)">
            <View style={{ alignItems: 'center' }}>
              <TimeRadar metrics={TIME_RADAR} size={Math.min(CW, 260)} />
            </View>
            <View style={{ gap: 6, marginTop: 8 }}>
              {TIME_RADAR.map(m => (
                <View key={m.name} style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                  <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: m.value >= 80 ? '#22c55e' : m.value >= 50 ? '#f59e0b' : '#ef4444' }} />
                  <Text style={{ fontSize: 12, color: colors.mutedForeground, flex: 1 }}>{m.name}</Text>
                  <Text style={{ fontSize: 12, fontWeight: '600', color: colors.foreground }}>{m.value}分</Text>
                  <Text style={{ fontSize: 11, color: colors.mutedForeground, flex: 1.2, textAlign: 'right' }}>{m.detail}</Text>
                </View>
              ))}
            </View>
          </ChartCard>

          {/* 分析面板:支出/收入/转账 × 分类/成员/账户 饼图 */}
          <ChartCard title="分析面板">
            {/* 类型切换 */}
            <View style={{ flexDirection: 'row', gap: 6, marginBottom: 8 }}>
              {([
                { key: 'EXPENSE', label: '支出', color: '#ef4444' },
                { key: 'INCOME', label: '收入', color: '#22c55e' },
                { key: 'TRANSFER', label: '转账', color: '#3b82f6' },
              ] as const).map(t => (
                <Pressable key={t.key} onPress={() => setAnalysisType(t.key)} style={{
                  flex: 1, paddingVertical: 7, alignItems: 'center', borderRadius: 8,
                  backgroundColor: analysisType === t.key ? alpha(t.color, 0.12) : colors.muted,
                  borderWidth: 1, borderColor: analysisType === t.key ? t.color : 'transparent',
                }}>
                  <Text style={{ fontSize: 12, fontWeight: '600', color: analysisType === t.key ? t.color : colors.mutedForeground }}>{t.label}</Text>
                </Pressable>
              ))}
            </View>
            {/* 三个饼图 */}
            <View style={{ gap: 16 }}>
              <View style={{ alignItems: 'center' }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, marginBottom: 6 }}>
                  <PieIcon size={12} color={colors.mutedForeground} />
                  <Text style={{ fontSize: 12, color: colors.mutedForeground }}>分类占比</Text>
                </View>
                <DonutChart data={ANALYSIS_EXPENSE_PIE} size={Math.min(CW, 180)} />
              </View>
              <View style={{ alignItems: 'center' }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, marginBottom: 6 }}>
                  <Users size={12} color={colors.mutedForeground} />
                  <Text style={{ fontSize: 12, color: colors.mutedForeground }}>归属占比</Text>
                </View>
                <DonutChart data={ANALYSIS_OWNER_PIE} size={Math.min(CW, 180)} />
              </View>
              <View style={{ alignItems: 'center' }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, marginBottom: 6 }}>
                  <Wallet size={12} color={colors.mutedForeground} />
                  <Text style={{ fontSize: 12, color: colors.mutedForeground }}>支付账户占比</Text>
                </View>
                <DonutChart data={ANALYSIS_ACCOUNT_PIE} size={Math.min(CW, 180)} />
              </View>
            </View>
          </ChartCard>

          {/* 堆叠柱状图 */}
          <ChartCard title={mode === 'yearly' ? '各月分类支出构成' : '每日分类支出构成'}>
            <StackedBarChart periods={STACKED_PERIODS} categories={STACKED_CATEGORIES} />
          </ChartCard>
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

      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 16, paddingBottom: 40 }}>
        {tab === 'overview' && renderOverview()}
        {tab === 'yearly' && renderTimeView('yearly')}
        {tab === 'monthly' && renderTimeView('monthly')}
        {tab === 'free' && renderTimeView('free')}
      </ScrollView>
    </SafeAreaView>
  );
}

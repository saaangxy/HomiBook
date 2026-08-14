import { View } from 'react-native';
import Svg, { Polygon, Line, Polyline, Text as SvgText } from 'react-native-svg';
import type { RadarMetric } from '@/types';
import { useTheme } from '@/theme';

interface RadarChartProps {
  metrics: RadarMetric[];
  size?: number;
}

// 七维雷达图(react-native-svg 手绘)
export function RadarChart({ metrics, size = 260 }: RadarChartProps) {
  const { colors } = useTheme();
  const n = metrics.length;
  const cx = size / 2;
  const cy = size / 2;
  const radius = size / 2 - 34;

  const angleFor = (i: number) => (Math.PI * 2 * i) / n - Math.PI / 2;
  const point = (i: number, r: number): [number, number] => [
    cx + r * Math.cos(angleFor(i)),
    cy + r * Math.sin(angleFor(i)),
  ];

  // 网格环(4 层)
  const rings = [0.25, 0.5, 0.75, 1].map((t) =>
    Array.from({ length: n }, (_, i) => point(i, radius * t)),
  );

  // 轴线
  const axes = Array.from({ length: n }, (_, i) => point(i, radius));

  // 数据多边形
  const dataPts = metrics
    .map((m, i) => Math.max(0, Math.min(100, m.value)))
    .map((v, i) => point(i, (radius * v) / 100));

  return (
    <View style={{ alignItems: 'center' }}>
      <Svg width={size} height={size}>
        {rings.map((ring, ri) => (
          <Polygon key={ri} points={ring.map((p) => p.join(',')).join(' ')} fill="none" stroke={colors.border} strokeWidth={1} />
        ))}
        {axes.map((p, i) => (
          <Line key={i} x1={cx} y1={cy} x2={p[0]} y2={p[1]} stroke={colors.border} strokeWidth={1} />
        ))}
        <Polygon points={dataPts.map((p) => p.join(',')).join(' ')} fill={colors.primary} fillOpacity={0.18} stroke={colors.primary} strokeWidth={2} />
        {dataPts.map((p, i) => (
          <SvgText key={i} x={p[0]} y={p[1] - 6} fontSize={18} fontWeight="700" fill={colors.primary} textAnchor="middle">
            {metrics[i].value}
          </SvgText>
        ))}
        {metrics.map((m, i) => {
          const [x, y] = point(i, radius + 22);
          return (
            <SvgText key={m.name} x={x} y={y} fontSize={11} fill={colors.mutedForeground} textAnchor="middle" fontWeight="600">
              {m.name}
            </SvgText>
          );
        })}
      </Svg>
    </View>
  );
}
import { ScrollView } from 'react-native';
import { useTheme } from '@/theme';
import { Text } from '@/components/ui/Text';
import { View } from 'react-native';

// 横向可滚动简易表格(web Table 等价)。从 AIAssistant.tsx 拆出,供工具卡/导入预览卡共用。

// 按内容估算统一列宽:取全部行(含表头)该列的最大文本宽(全角 1 / 半角 0.55 折算),
// 上下限截断后作为固定 width 应用到每一行,保证列对齐(各行列宽一致,长文本单行截断)
export function computeColWidths(rows: readonly (readonly string[])[], colCount: number, maxW = 150): number[] {
  const charUnit = 10.5; // fontSize 10.5 全角字符近似宽
  return Array.from({ length: colCount }, (_, ci) => {
    let maxUnits = 0;
    for (const row of rows) {
      let units = 0;
      for (const ch of row[ci] ?? '') units += ch.charCodeAt(0) > 255 ? 1 : 0.55;
      if (units > maxUnits) maxUnits = units;
    }
    return Math.max(44, Math.min(Math.ceil(maxUnits * charUnit) + 13, maxW));
  });
}

export function MiniTable({ columns, rows, aligns, maxHeight }: { columns: string[]; rows: string[][]; aligns?: ('left' | 'right')[]; maxHeight?: number }) {
  const { colors } = useTheme();
  // 列宽 = 表头 + 全部单元格按内容统一计算(行长短不一不再错位)
  const colWidths = computeColWidths([columns, ...rows], columns.length);
  return (
    <View style={{ borderRadius: 8, borderWidth: 1, borderColor: colors.hairline, overflow: 'hidden', ...(maxHeight ? { maxHeight } : {}) }}>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} nestedScrollEnabled>
        <View>
          <View style={{ flexDirection: 'row', backgroundColor: colors.muted }}>
            {columns.map((c, i) => (
              <View key={`${c}-${i}`} style={{ width: colWidths[i], paddingHorizontal: 6, paddingVertical: 4 }}>
                <Text numberOfLines={1} style={{ fontSize: 10.5, color: colors.mutedForeground, fontWeight: '600', textAlign: aligns?.[i] ?? 'left' }}>{c}</Text>
              </View>
            ))}
          </View>
          {rows.map((row, ri) => (
            <View key={ri} style={{ flexDirection: 'row', borderTopWidth: 1, borderTopColor: colors.hairline }}>
              {row.map((cell, ci) => (
                <View key={ci} style={{ width: colWidths[ci], paddingHorizontal: 6, paddingVertical: 4 }}>
                  <Text numberOfLines={1} style={{ fontSize: 10.5, color: colors.foreground, textAlign: aligns?.[ci] ?? 'left' }}>{cell}</Text>
                </View>
              ))}
            </View>
          ))}
        </View>
      </ScrollView>
    </View>
  );
}

import { View } from 'react-native';
import type { RecordItem } from '@/types';
import { useTheme } from '@/theme';
import { Text } from '@/components/ui/Text';
import { formatMoney } from '@/lib/format';

interface RecordRowProps {
  record: RecordItem;
  showDivider?: boolean;
}

const TYPE_LABEL: Record<string, string> = {
  INCOME: '收入',
  EXPENSE: '支出',
  TRANSFER: '转账',
};

// 流水卡片:商家/标题(粗体) + 类型|分类|账户(浅灰) + 备注(浅灰) + 右侧金额
export function RecordRow({ record, showDivider = false }: RecordRowProps) {
  const { colors } = useTheme();
  const isIncome = record.type === 'INCOME';
  const isTransfer = record.type === 'TRANSFER';
  const amountColor = isTransfer ? colors.transfer : isIncome ? colors.income : colors.expense;
  // 标题:优先用交易方(商家/对方),回退到分类名
  const title = record.counterparty?.trim() || record.categoryName || '未分类';
  const typeLabel = TYPE_LABEL[record.type] ?? '';
  const categoryName = record.categoryName ?? '未分类';
  const accountName = record.accountName ?? '';

  return (
    <View>
      <View className="flex-row items-start gap-3 py-1">
        <View className="flex-1">
          <Text numberOfLines={1} style={{ fontSize: 16, fontWeight: '700', color: colors.foreground }}>
            {title}
          </Text>
          <Text numberOfLines={1} style={{ fontSize: 12, color: colors.mutedForeground, marginTop: 4 }}>
            {typeLabel} | {categoryName} | {accountName}
          </Text>
          {record.remark ? (
            <Text numberOfLines={1} style={{ fontSize: 12, color: colors.mutedForeground, marginTop: 2 }}>
              {record.remark}
            </Text>
          ) : null}
        </View>
        <Text style={{ color: amountColor, fontWeight: '700', fontSize: 16, fontVariant: ['tabular-nums'] }}>
          {isIncome ? '+' : '-'}{formatMoney(record.amount)}
        </Text>
      </View>
      {showDivider && <View className="h-px mt-3" style={{ backgroundColor: colors.hairline }} />}
    </View>
  );
}

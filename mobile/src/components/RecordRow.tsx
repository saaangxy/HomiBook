import { View } from 'react-native';
import { Utensils, ShoppingBag, Car, Home, BookOpen, HeartPulse, Gamepad2, Shield, Wallet, Gift, TrendingUp, Landmark, CircleDollarSign, type LucideIcon } from 'lucide-react-native';
import type { RecordItem } from '@/types';
import { useTheme } from '@/theme';
import { Text } from '@/components/ui/Text';
import { formatMoney } from '@/lib/format';

const ICON_MAP: Record<string, LucideIcon> = {
  utensils: Utensils,
  'shopping-bag': ShoppingBag,
  car: Car,
  home: Home,
  'book-open': BookOpen,
  'heart-pulse': HeartPulse,
  'gamepad-2': Gamepad2,
  shield: Shield,
  wallet: Wallet,
  gift: Gift,
  'trending-up': TrendingUp,
  landmark: Landmark,
};

interface RecordRowProps {
  record: RecordItem;
  icon?: string;
}

// 流水行:分类图标 + 名称/备注 + 金额(收入绿/支出红)
export function RecordRow({ record, icon }: RecordRowProps) {
  const { colors } = useTheme();
  const Icon = ICON_MAP[icon ?? ''] ?? CircleDollarSign;
  const isIncome = record.type === 'INCOME';
  const amountColor = isIncome ? colors.income : colors.expense;

  return (
    <View className="flex-row items-center gap-3">
      <View className="w-11 h-11 rounded-2xl items-center justify-center" style={{ backgroundColor: colors.muted }}>
        <Icon size={20} color={colors.primary} />
      </View>
      <View className="flex-1">
        <Text numberOfLines={1} style={{ color: colors.foreground, fontWeight: '600', fontSize: 15 }}>
          {record.categoryName ?? '未分类'}
        </Text>
        <Text numberOfLines={1} variant="muted" style={{ fontSize: 12, marginTop: 2 }}>
          {record.remark || record.accountName || record.date}
        </Text>
      </View>
      <Text style={{ color: amountColor, fontWeight: '700', fontSize: 15, fontVariant: ['tabular-nums'] }}>
        {isIncome ? '+' : '-'}{formatMoney(record.amount)}
      </Text>
    </View>
  );
}
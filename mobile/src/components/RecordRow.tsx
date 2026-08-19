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
  showDivider?: boolean;
}

// 精致流水行:44px 圆角图标(收入绿/支出红淡彩底) + 分类/备注 + 金额
export function RecordRow({ record, icon, showDivider = false }: RecordRowProps) {
  const { colors } = useTheme();
  const Icon = ICON_MAP[icon ?? ''] ?? CircleDollarSign;
  const isIncome = record.type === 'INCOME';
  const isTransfer = record.type === 'TRANSFER';
  const amountColor = isTransfer ? colors.transfer : isIncome ? colors.income : colors.expense;
  const iconBg = isTransfer ? 'rgba(59,130,246,0.12)' : isIncome ? 'rgba(34,197,94,0.12)' : 'rgba(249,115,22,0.12)';
  const iconColor = isTransfer ? colors.transfer : isIncome ? colors.income : colors.primary;
  const subtitle = isTransfer
    ? `${record.accountName ?? ''} → ${record.toAccountName ?? '其他账户'}`
    : (record.remark || record.accountName || record.date);

  return (
    <View>
      <View className="flex-row items-center gap-3">
        <View className="w-11 h-11 rounded-[14px] items-center justify-center" style={{ backgroundColor: iconBg }}>
          <Icon size={20} color={iconColor} />
        </View>
        <View className="flex-1">
          <Text numberOfLines={1} style={{ fontSize: 15, fontWeight: '600' }}>
            {record.categoryName ?? '未分类'}
          </Text>
          <Text numberOfLines={1} variant="muted" style={{ fontSize: 12, marginTop: 2 }}>
            {subtitle}
          </Text>
        </View>
        <Text style={{ color: amountColor, fontWeight: '700', fontSize: 16, fontVariant: ['tabular-nums'] }}>
          {isIncome ? '+' : '-'}{formatMoney(record.amount)}
        </Text>
      </View>
      {showDivider && <View className="h-px mt-3" style={{ backgroundColor: colors.hairline }} />}
    </View>
  );
}
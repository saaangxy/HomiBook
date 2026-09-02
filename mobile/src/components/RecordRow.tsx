import { useState } from 'react';
import { Pressable, View } from 'react-native';
import { Paperclip } from 'lucide-react-native';
import type { RecordItem } from '@/types';
import { useTheme, haptics } from '@/theme';
import { Text } from '@/components/ui/Text';
import { AttachmentViewer } from '@/components/ui/AttachmentViewer';
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
// 有附件时在标题旁显示回形针角标,点击直接弹出附件查看器(网格展示/预览/下载)
export function RecordRow({ record, showDivider = false }: RecordRowProps) {
  const { colors } = useTheme();
  const [viewerOpen, setViewerOpen] = useState(false);
  const isIncome = record.type === 'INCOME';
  const isTransfer = record.type === 'TRANSFER';
  const amountColor = isTransfer ? colors.transfer : isIncome ? colors.income : colors.expense;
  // 标题:优先用交易方(商家/对方),回退到分类名
  const title = record.counterparty?.trim() || record.categoryName || '未分类';
  const typeLabel = TYPE_LABEL[record.type] ?? '';
  const categoryName = record.categoryName ?? '未分类';
  const accountName = record.accountName ?? '';
  const attachments = record.attachments ?? [];
  const attCount = attachments.length;

  return (
    <View>
      <View className="flex-row items-start gap-3 py-1">
        <View className="flex-1">
          <View className="flex-row items-center gap-1.5">
            <Text numberOfLines={1} style={{ fontSize: 16, fontWeight: '700', color: colors.foreground }}>
              {title}
            </Text>
            {attCount > 0 && (
              <Pressable
                hitSlop={6}
                onPress={() => {
                  haptics.tap();
                  setViewerOpen(true);
                }}
                style={{ flexDirection: 'row', alignItems: 'center', gap: 2 }}
              >
                <Paperclip size={12} color={colors.mutedForeground} />
                {attCount > 1 && (
                  <Text style={{ fontSize: 10, color: colors.mutedForeground }}>{attCount}</Text>
                )}
              </Pressable>
            )}
          </View>
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
      {/* 附件查看器:参考 web 端,网格展示 + 点击预览 + 单项下载 */}
      <AttachmentViewer visible={viewerOpen} attachments={attachments} onClose={() => setViewerOpen(false)} />
    </View>
  );
}

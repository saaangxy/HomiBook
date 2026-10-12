import { memo, useState } from 'react';
import { Pressable, View } from 'react-native';
import { Paperclip } from 'lucide-react-native';
import type { RecordItem } from '@/types';
import { useTheme, haptics } from '@/theme';
import { Text } from '@/components/ui/Text';
import { AttachmentViewer } from '@/components/ui/AttachmentViewer';
import { formatMoney } from '@/lib/format';
import { RECORD_TYPE_LABELS as TYPE_LABEL } from '@homibook/core';

interface RecordRowProps {
  record: RecordItem;
  showDivider?: boolean;
  /** 账户展示名(可选)。record.accountName 只有账户名,多归属人账本下同名账户分不开,
   *  由调用方传入 accountLabel 的结果(如统计明细页) */
  accountText?: string;
}

// 流水卡片:商家/标题(粗体) + 类型|分类|账户(浅灰) + 备注(浅灰) + 右侧金额
// 有附件时在标题旁显示回形针角标,点击直接弹出附件查看器(网格展示/预览/下载)
// memo:流水列表 cell 内可能挂十几次,父级重渲染(筛选/汇总变化)时按 record 引用跳过
export const RecordRow = memo(function RecordRow({ record, showDivider = false, accountText }: RecordRowProps) {
  const { colors } = useTheme();
  const [viewerOpen, setViewerOpen] = useState(false);
  const isIncome = record.type === 'INCOME';
  const isTransfer = record.type === 'TRANSFER';
  const amountColor = isTransfer ? colors.transfer : isIncome ? colors.income : colors.expense;
  // 标题:优先用交易方(商家/对方),回退到分类名
  const title = record.counterparty?.trim() || record.categoryName || '未分类';
  const typeLabel = TYPE_LABEL[record.type] ?? '';
  const categoryName = record.categoryName ?? '未分类';
  // 账户名:调用方(如统计明细)传入带归属人的展示名时优先用;否则回退流水数据里的账户名
  const accountName = accountText ?? record.accountName ?? '';
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
      {/* 附件查看器:参考 web 端,网格展示 + 点击预览 + 单项下载;无附件时不挂载(省一个视图) */}
      {attCount > 0 && (
        <AttachmentViewer visible={viewerOpen} attachments={attachments} onClose={() => setViewerOpen(false)} />
      )}
    </View>
  );
});

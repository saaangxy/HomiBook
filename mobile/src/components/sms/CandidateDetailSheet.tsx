import { ScrollView, View } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { useTheme, alpha, haptics } from '@/theme';
import { Text } from '@/components/ui/Text';
import { FormSheet } from '@/components/chrome/FormSheet';
import { Btn } from '@/components/settings/shared';
import { showToast } from '@/components/chrome/Toast';
import { needsConfirm, SMS_LOW_CONFIDENCE, type SmsCandidate } from '@/services/sms-import';
import type { ParsedImportRow } from '@/services/import';

// 候选详情:点开看**原文**与解析/匹配的每一项。
//
// 为什么需要它:候选行只展示摘要(remark 刻意不含正文),而解析是否正确、为什么「未识别账户」、
// 置信度为何偏低,都要对着原文看才知道。原文只在本机内存里(raw 从不上送后端),
// 这里提供一个显式入口 + 一键复制,便于核对与反馈。

type DetailCandidate = SmsCandidate & { parsedBy?: 'ai' };

const TYPE_LABEL: Record<string, string> = {
  INCOME: '收入', EXPENSE: '支出', TRANSFER: '转账', UNKNOWN: '未识别',
};

export function CandidateDetailSheet({ visible, candidate, previewRow, checked, onClose, onToggle }: {
  visible: boolean;
  candidate: DetailCandidate;
  /** 服务端预览结果(账户匹配 / 分类 / 疑似重复);预览失败时为 undefined */
  previewRow?: ParsedImportRow;
  checked: boolean;
  onClose: () => void;
  onToggle: () => void;
}) {
  const { colors } = useTheme();

  const rows: { label: string; value: string; warn?: boolean }[] = [
    { label: '时间', value: candidate.date.replace('T', ' ').slice(0, 19) },
    { label: '方向', value: TYPE_LABEL[candidate.type] ?? candidate.type, warn: candidate.type === 'UNKNOWN' },
    {
      label: '金额',
      value: `${candidate.type === 'EXPENSE' ? '-' : candidate.type === 'INCOME' ? '+' : ''}${candidate.amount.toFixed(2)}`,
    },
    { label: '机构', value: candidate.bankName || '—' },
    { label: '卡尾号', value: candidate.cardTail ? `尾号${candidate.cardTail}` : '—' },
    { label: '交易类型', value: candidate.tradeKind || '—' },
    { label: '对方 / 商户', value: candidate.payer || '—' },
    {
      label: '账户匹配',
      value: previewRow?.accountName || candidate.accountName || '未匹配(导入时需指定账户)',
      warn: !(previewRow?.accountName || candidate.accountName),
    },
    {
      label: '分类',
      value: previewRow ? (previewRow.mappedCategoryCode || previewRow.categoryCode || '未匹配(导入时按名称映射)') : '—(未完成预览)',
    },
    {
      label: '置信度',
      value: `${Math.round(candidate.confidence * 100)}%${
        candidate.confidence < SMS_LOW_CONFIDENCE ? `(低于 ${SMS_LOW_CONFIDENCE},需人工确认)` : ''
      }`,
      warn: candidate.confidence < SMS_LOW_CONFIDENCE,
    },
    { label: '解析方式', value: candidate.parsedBy === 'ai' ? 'AI 兜底(模型抽取)' : '本地规则' },
    { label: '来源', value: `${candidate.channel === 'notification' ? '通知' : '短信'} · ${candidate.sourceId}` },
    ...(previewRow?.possibleDuplicate
      ? [{ label: '重复检测', value: '疑似重复(同账户同日同额同向已存在)', warn: true }]
      : []),
    ...(previewRow?.remark ? [{ label: '备注(入库值)', value: previewRow.remark }] : []),
  ];

  return (
    // scrollBody:字段多 + 原文块,内容必然超过一屏,交给 FormSheet 限高内部滚动(否则弹窗顶到状态栏)
    <FormSheet visible={visible} title="候选详情" onClose={onClose} scrollBody>
      <View style={{ gap: 12 }}>
        <View style={{ gap: 6 }}>
          <Text variant="muted" style={{ fontSize: 11.5 }}>原文（仅本机,不上送后端）</Text>
          <View
            style={{
              maxHeight: 160,
              borderRadius: 10,
              borderWidth: 1,
              borderColor: colors.hairline,
              backgroundColor: colors.muted,
              padding: 10,
            }}
          >
            <ScrollView nestedScrollEnabled>
              <Text selectable style={{ fontSize: 12.5, lineHeight: 19 }}>
                {candidate.raw || '(无原文)'}
              </Text>
            </ScrollView>
          </View>
        </View>

        <View style={{ borderRadius: 10, borderWidth: 1, borderColor: colors.hairline, overflow: 'hidden' }}>
          {rows.map((r, i) => (
            <View
              key={r.label}
              style={{
                flexDirection: 'row', alignItems: 'flex-start', gap: 10, paddingHorizontal: 10, paddingVertical: 8,
                borderTopWidth: i === 0 ? 0 : 1, borderTopColor: colors.hairline,
                backgroundColor: r.warn ? alpha(colors.expense, 0.06) : 'transparent',
              }}
            >
              <Text variant="muted" style={{ fontSize: 11.5, width: 78 }}>{r.label}</Text>
              <Text
                style={{ flex: 1, fontSize: 12.5, lineHeight: 18, color: r.warn ? colors.expense : colors.foreground }}
              >
                {r.value}
              </Text>
            </View>
          ))}
        </View>

        <View style={{ flexDirection: 'row', gap: 10 }}>
          <View style={{ flex: 1 }}>
            <Btn
              title="复制原文"
              variant="secondary"
              onPress={async () => {
                await Clipboard.setStringAsync(candidate.raw || '');
                haptics.tap();
                showToast('原文已复制');
              }}
            />
          </View>
          <View style={{ flex: 1 }}>
            <Btn title={checked ? '取消选中' : '选中这条'} onPress={() => { onToggle(); onClose(); }} />
          </View>
        </View>

        <Text variant="muted" style={{ fontSize: 11, lineHeight: 16 }}>
          {checked ? '已选中,导入时会包含。' : '未选中,导入时不包含。'}
          {needsConfirm(candidate, previewRow) ? ' 本条「需确认」,默认不勾选。' : ''}
          {candidate.parsedBy === 'ai' ? ' 字段由模型抽取,核对原文后再导入。' : ''}
        </Text>
      </View>
    </FormSheet>
  );
}

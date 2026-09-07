import { useState } from 'react';
import { ActivityIndicator, Linking, Platform, Pressable, ScrollView, TextInput, View } from 'react-native';
import { AlertTriangle, CheckCircle2, ChevronDown, ExternalLink, HelpCircle, Loader2, MessageSquareMore, Wrench, XCircle } from 'lucide-react-native';
import { useTheme, alpha } from '@/theme';
import { Text } from '@/components/ui/Text';
import { useChatStore, useSessionView } from '@/stores/chat';
import { getToolDisplayName } from '@/services/chat';
import { IMPORT_SOURCE_LABELS, resolveToolCallStatus, type ToolCallEntry } from '@homibook/core';
import { MiniTable, computeColWidths } from './MiniTable';
import { ImportPreviewCard } from './ImportPreviewCard';
import type { Ledger } from '@/types';

// 工具卡片(复刻 web ToolCallCard:状态语义色/参数折叠/确认预览/建议补充/切换账本/web_search)。
// 状态推断单一来源 core resolveToolCallStatus;从 AIAssistant.tsx 拆出。
// ── 工具卡片(复刻 web ToolCallCard:状态语义色/参数折叠/确认预览/建议补充/切换账本/web_search) ──

// 确认预览数据结构(web ConfirmPreview)
type ConfirmPreviewType = 'records-table' | 'record-changes' | 'budget-card' | 'generic';
interface PreviewCell { text: string; highlight?: boolean; color?: 'green' | 'red' }
interface ConfirmPreview {
  type?: ConfirmPreviewType;
  title?: string;
  description?: string;
  columns?: string[];
  rows?: PreviewCell[][];
  changes?: { id: string; date: string; fields: { label: string; before: string; after: string }[] }[];
  budgetFields?: { label: string; value: string }[];
  text?: string;
}

function parsePreview(preview?: string): ConfirmPreview | null {
  if (!preview) return null;
  try { return JSON.parse(preview) as ConfirmPreview; } catch { return null; }
}

// 英文字段名 → 中文(web FIELD_LABELS)
const FIELD_LABELS: Record<string, string> = {
  name: '名称', type: '类型', amount: '金额', date: '日期', remark: '备注', payer: '交易方',
  tags: '标签', cron: '触发时间', active: '启用', id: 'ID', ids: 'ID 列表',
  recurringType: '周期类型', accountId: '账户', toAccountId: '目标账户',
  categoryCode: '分类编码', loanTotalAmount: '贷款总额', loanInterestRate: '年利率',
  loanInterestMethod: '还款方式', loanStartDate: '开始日期', loanTermMonths: '期数',
  currency: '货币', initialBalance: '初始余额', accountNo: '账号', bankName: '银行名称',
  visibility: '可见性', status: '状态', balanceAfter: '调整后余额', year: '年份',
  month: '月份', months: '月份列表', startDate: '开始日期', endDate: '结束日期',
  sourceYear: '源年份', sourceMonth: '源月份', targetMonths: '目标月份',
  bookId: '账本', ownerId: '归属人', generateAll: '生成全部',
};
const fieldLabel = (key: string) => FIELD_LABELS[key] || key;

// generic 确认预览:JSON → 表格数据(web toTableData)
function toTableData(raw: string): { keys: string[]; rows: Record<string, string>[] } | null {
  try {
    const outer = JSON.parse(raw);
    const inner = outer?.text ? (typeof outer.text === 'string' ? JSON.parse(outer.text) : outer.text) : outer;
    if (Array.isArray(inner) && inner.length > 0 && typeof inner[0] === 'object' && inner[0] !== null) {
      const keys = Object.keys(inner[0]);
      return { keys, rows: inner.map((item: any) => Object.fromEntries(keys.map((k) => [k, typeof item[k] === 'object' ? JSON.stringify(item[k]) : String(item[k] ?? '')]))) };
    }
    if (typeof inner === 'object' && inner !== null && !Array.isArray(inner)) {
      const keys = Object.keys(inner);
      return { keys, rows: [Object.fromEntries(keys.map((k) => [k, typeof inner[k] === 'object' ? JSON.stringify(inner[k]) : String(inner[k] ?? '')]))] };
    }
    return null;
  } catch { return null; }
}

// 状态语义色(对齐 web:blue/red/amber/green/violet/emerald)
const STATUS_COLORS: Record<string, string> = {
  pending: '#3b82f6',
  error: '#ef4444',
  confirming: '#f59e0b',
  suggesting: '#8b5cf6',
  switching: '#10b981',
  success: '#22c55e',
};


export function BatchIndicator({ toolCallId }: { toolCallId: string }) {
  const { messages } = useSessionView();
  // 待决定状态:confirming(待确认)/suggesting(待选择)/switching(待选账本)
  const remaining = messages.filter((m) => m.role === 'assistant').reduce((acc, m) => acc + m.blocks.filter((b) => b.type === 'tool-call' && ['confirming', 'suggesting', 'switching'].includes((b as ToolCallEntry).status)).length, 0);
  if (remaining <= 1) return null;
  return <Text style={{ fontSize: 11, color: '#f59e0b', marginTop: 4 }}>等待全部确认 · 剩余 {remaining} 个</Text>;
}

// 确认预览(记录表格/变更对比/预算卡/通用 JSON 表格)
function ConfirmPreviewView({ preview, submitted, submitting, onConfirm }: {
  preview?: string;
  submitted: boolean;
  submitting: boolean;
  onConfirm: (approved: boolean) => void;
}) {
  const { colors } = useTheme();
  const parsed = parsePreview(preview);
  const cellColor = (c?: 'green' | 'red') => (c === 'green' ? '#16a34a' : c === 'red' ? '#dc2626' : colors.foreground);

  return (
    <View style={{ marginTop: 8, gap: 8 }}>
      {parsed?.title ? <Text style={{ fontSize: 13, fontWeight: '600', color: colors.foreground }}>{parsed.title}</Text> : null}
      {parsed?.description ? <Text style={{ fontSize: 11.5, color: colors.mutedForeground }}>{parsed.description}</Text> : null}

      {/* records-table:表头+高亮/着色单元格 */}
      {parsed?.type === 'records-table' && parsed.columns && parsed.rows && (() => {
        const c = colors;
        // 列宽按表头+全部单元格统一计算,保证各行列对齐
        const colWidths = computeColWidths([parsed.columns, ...parsed.rows.map((r) => r.map((cell) => cell.text))], parsed.columns.length);
        return (
          <View style={{ borderRadius: 8, borderWidth: 1, borderColor: c.hairline, overflow: 'hidden', maxHeight: 180 }}>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} nestedScrollEnabled>
              <View>
                <View style={{ flexDirection: 'row', backgroundColor: c.muted }}>
                  {parsed.columns!.map((col, i) => (
                    <View key={`${col}-${i}`} style={{ width: colWidths[i], paddingHorizontal: 6, paddingVertical: 4 }}>
                      <Text numberOfLines={1} style={{ fontSize: 10.5, color: c.mutedForeground, fontWeight: '600' }}>{col}</Text>
                    </View>
                  ))}
                </View>
                {parsed.rows!.map((row, ri) => (
                  <View key={ri} style={{ flexDirection: 'row', borderTopWidth: 1, borderTopColor: c.hairline }}>
                    {row.map((cell, ci) => (
                      <View key={ci} style={{ width: colWidths[ci], paddingHorizontal: 6, paddingVertical: 4 }}>
                        <Text numberOfLines={1} style={{ fontSize: 10.5, color: cellColor(cell.color), fontWeight: cell.highlight ? '700' : '400' }}>{cell.text}</Text>
                      </View>
                    ))}
                  </View>
                ))}
              </View>
            </ScrollView>
          </View>
        );
      })()}

      {/* record-changes:变更对比(前值划线 → 新值) */}
      {parsed?.type === 'record-changes' && parsed.changes?.map((ch) => (
        <View key={ch.id} style={{ borderRadius: 8, borderWidth: 1, borderColor: colors.hairline, overflow: 'hidden' }}>
          <View style={{ paddingHorizontal: 8, paddingVertical: 4, backgroundColor: colors.muted }}>
            <Text style={{ fontSize: 10.5, color: colors.mutedForeground }}>ID: {ch.id} | 日期: {ch.date}</Text>
          </View>
          {ch.fields.map((f) => (
            <View key={f.label} style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 8, paddingVertical: 4, borderTopWidth: 1, borderTopColor: colors.hairline }}>
              <Text style={{ fontSize: 10.5, color: colors.mutedForeground, width: 60 }}>{f.label}</Text>
              <Text style={{ fontSize: 10.5, color: '#dc2626', textDecorationLine: 'line-through', flex: 1 }} numberOfLines={1}>{f.before}</Text>
              <Text style={{ fontSize: 10.5, color: colors.mutedForeground, paddingHorizontal: 4 }}>→</Text>
              <Text style={{ fontSize: 10.5, color: '#16a34a', fontWeight: '500', flex: 1 }} numberOfLines={1}>{f.after}</Text>
            </View>
          ))}
        </View>
      ))}

      {/* budget-card:字段列表 */}
      {parsed?.type === 'budget-card' && parsed.budgetFields && (
        <View style={{ borderRadius: 8, borderWidth: 1, borderColor: colors.hairline, padding: 8, gap: 4 }}>
          {parsed.budgetFields.map((f) => (
            <View key={f.label} style={{ flexDirection: 'row', gap: 8 }}>
              <Text style={{ fontSize: 10.5, color: colors.mutedForeground, width: 60 }}>{f.label}</Text>
              <Text style={{ fontSize: 10.5, color: colors.foreground, fontWeight: '500', flex: 1 }}>{f.value}</Text>
            </View>
          ))}
        </View>
      )}

      {/* generic 或解析失败:JSON 表格 */}
      {(!parsed || parsed.type === 'generic') && (() => {
        const table = toTableData(preview || '');
        if (!table) {
          return <Text style={{ fontSize: 10.5, color: colors.mutedForeground }}>{preview}</Text>;
        }
        return <MiniTable columns={table.keys.map(fieldLabel)} rows={table.rows.map((r) => table.keys.map((k) => r[k]))} maxHeight={192} />;
      })()}

      <View style={{ flexDirection: 'row', gap: 8 }}>
        <Pressable onPress={() => onConfirm(true)} disabled={submitted} style={{ flex: 1, borderRadius: 10, paddingVertical: 8, alignItems: 'center', backgroundColor: colors.primary, flexDirection: 'row', justifyContent: 'center', gap: 6, opacity: submitted ? 0.6 : 1 }}>
          {submitting && <ActivityIndicator size="small" color="#fff" />}
          <Text style={{ color: '#fff', fontSize: 12.5, fontWeight: '600' }}>{submitting ? '提交中...' : '确认'}</Text>
        </Pressable>
        <Pressable onPress={() => onConfirm(false)} disabled={submitted} style={{ flex: 1, borderRadius: 10, paddingVertical: 8, alignItems: 'center', borderWidth: 1, borderColor: colors.border, backgroundColor: colors.card, opacity: submitted ? 0.6 : 1 }}>
          <Text style={{ fontSize: 12.5, color: colors.foreground }}>拒绝</Text>
        </Pressable>
      </View>
    </View>
  );
}

export function ToolCard({ toolCall, bookId }: { toolCall: ToolCallEntry; bookId: string }) {
  const { colors } = useTheme();
  const [expanded, setExpanded] = useState(false);
  const [selected, setSelected] = useState<Record<string, string>>({});
  const [custom, setCustom] = useState<Record<string, string>>({});
  const [bookChoice, setBookChoice] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const { confirmAndContinue, respondToSuggestion, switchBook } = useChatStore();
  const { messages } = useSessionView();

  const name = getToolDisplayName(toolCall.toolName);
  const args = typeof toolCall.args === 'object' && toolCall.args != null ? toolCall.args as Record<string, unknown> : null;

  // 历史数据 status=pending 时按已有字段推断实际状态(单一来源 core resolveToolCallStatus)
  const { effectiveStatus, effectiveSuggestion, isExpired, expiredMessage } = resolveToolCallStatus(toolCall);

  const suggestion = effectiveSuggestion;

  const isInteractivePreview = toolCall.toolName === 'preview_import' && args?.mode === 'preview';
  const confirmResult = toolCall.toolName === 'confirm_import' && effectiveStatus === 'success' ? ((toolCall.result as any)?.data ?? null) : null;
  const isConfirmCard = confirmResult && (confirmResult.mode === 'confirm_preview' || confirmResult.imported != null);
  const isImportPending = isInteractivePreview && effectiveStatus === 'success' && !(toolCall.result as any)?.data?.confirmed;

  const color = STATUS_COLORS[effectiveStatus] ?? colors.primary;
  const StatusIcon =
    effectiveStatus === 'pending' ? Loader2
    : isImportPending ? HelpCircle
    : effectiveStatus === 'success' ? CheckCircle2
    : effectiveStatus === 'error' ? XCircle
    : effectiveStatus === 'confirming' ? HelpCircle
    : effectiveStatus === 'suggesting' ? MessageSquareMore
    : HelpCircle;

  const showArgs = toolCall.args != null;
  const showResult = effectiveStatus === 'success' && toolCall.result != null;
  const showError = effectiveStatus === 'error';

  const handleConfirm = (approved: boolean) => {
    if (submitted) return;
    setSubmitted(true);
    confirmAndContinue(bookId, toolCall.toolCallId, approved);
  };

  const getValue = (field: string) => {
    const sel = selected[field];
    if (!sel) return '';
    return sel === '__custom__' ? (custom[field] || '').trim() : sel;
  };
  const suggestionQuestions = suggestion?.questions;
  const allFilled = (suggestionQuestions ?? []).every((q) => !!getValue(q.field));

  const btnText = { fontSize: 12.5, fontWeight: '600' as const };

  return (
    <View style={{ borderRadius: 12, borderWidth: 1, borderColor: alpha(color, 0.35), backgroundColor: alpha(color, 0.07), paddingHorizontal: 10, paddingVertical: 8, gap: 6 }}>
      {/* 可点击头部:状态图标 + 工具名 + 耗时 + 展开 */}
      <Pressable onPress={() => setExpanded((v) => !v)} style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        {effectiveStatus === 'pending'
          ? <Loader2 size={14} color={color} />
          : <StatusIcon size={14} color={color} />}
        <Wrench size={13} color={colors.mutedForeground} />
        <Text style={{ flex: 1, fontSize: 12.5, fontWeight: '600', color: colors.foreground }} numberOfLines={1}>{name}</Text>
        {toolCall.durationMs != null && <Text style={{ fontSize: 10, color: colors.mutedForeground }}>{toolCall.durationMs}ms</Text>}
        {showArgs && <ChevronDown size={12} color={colors.mutedForeground} style={{ transform: [{ rotate: expanded ? '180deg' : '0deg' }] }} />}
      </Pressable>

      {/* 参数折叠 */}
      {expanded && showArgs && (
        <View>
          <Text style={{ fontSize: 9.5, textTransform: 'uppercase', color: colors.mutedForeground, letterSpacing: 0.5 }}>参数</Text>
          <View style={{ backgroundColor: colors.card, borderRadius: 6, padding: 6, marginTop: 2, maxHeight: 96, overflow: 'hidden' }}>
            <Text style={{ fontFamily: Platform.select({ ios: 'Menlo', android: 'monospace' }), fontSize: 10.5, color: colors.mutedForeground }}>
              {typeof toolCall.args === 'string' ? toolCall.args : JSON.stringify(toolCall.args, null, 2)}
            </Text>
          </View>
        </View>
      )}

      {/* 错误信息(始终可见) */}
      {showError && (
        <Text style={{ fontSize: 11.5, color: '#dc2626' }}>
          {typeof toolCall.result === 'object' && (toolCall.result as any)?.error ? (toolCall.result as any).error : '执行失败'}
        </Text>
      )}

      {/* web_search 结果(展开时) */}
      {toolCall.toolName === 'web_search' && showResult && expanded && (
        <View style={{ gap: 6 }}>
          {(() => {
            const data = (toolCall.result as any)?.data;
            if (!data?.results?.length) return <Text style={{ fontSize: 11, color: colors.mutedForeground }}>无搜索结果</Text>;
            return data.results.map((r: any, i: number) => (
              <Pressable key={i} onPress={() => { Linking.openURL(r.url).catch(() => {}); }} style={{ borderRadius: 8, borderWidth: 1, borderColor: colors.hairline, backgroundColor: colors.card, padding: 8 }}>
                <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 4 }}>
                  <ExternalLink size={11} color="#2563eb" style={{ marginTop: 2 }} />
                  <Text style={{ flex: 1, fontSize: 11.5, fontWeight: '500', color: '#2563eb' }}>{r.title}</Text>
                </View>
                {r.snippet ? <Text numberOfLines={2} style={{ fontSize: 10.5, color: colors.mutedForeground, marginTop: 3 }}>{r.snippet}</Text> : null}
              </Pressable>
            ));
          })()}
        </View>
      )}

      {/* 其他工具结果(折叠内) */}
      {!isInteractivePreview && !isConfirmCard && toolCall.toolName !== 'web_search' && showResult && expanded && (
        <View>
          <Text style={{ fontSize: 9.5, textTransform: 'uppercase', color: colors.mutedForeground, letterSpacing: 0.5 }}>结果</Text>
          <Text style={{ fontSize: 10.5, color: colors.mutedForeground, marginTop: 2 }}>
            {typeof toolCall.result === 'string' ? toolCall.result : JSON.stringify(toolCall.result, null, 2)}
          </Text>
        </View>
      )}

      {/* preview_import 预览模式:完整交互卡(复刻 web ImportPreviewInteractive) */}
      {isInteractivePreview && showResult && (() => {
        const d = (toolCall.result as any)?.data ?? toolCall.result;
        if (!d?.accountBookId) {
          return (
            <Text style={{ fontSize: 10.5, color: colors.mutedForeground }}>
              {typeof d === 'object' ? JSON.stringify(d).slice(0, 200) : String(d ?? '')}
            </Text>
          );
        }
        return <ImportPreviewCard toolCall={toolCall} bookId={bookId} />;
      })()}

      {/* confirm_import 结果卡(简版复刻 web ImportConfirmCard) */}
      {isConfirmCard && showResult && (() => {
        const data = confirmResult as any;
        if (data.mode !== 'confirm_preview') {
          // 导入完成结果
          return (
            <View style={{ borderRadius: 8, borderWidth: 1, borderColor: alpha('#22c55e', 0.35), backgroundColor: alpha('#22c55e', 0.1), padding: 8, flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 2 }}>
              <CheckCircle2 size={14} color="#22c55e" />
              <Text style={{ fontSize: 11.5, color: colors.foreground }}>
                已导入 <Text style={{ fontWeight: '700' }}>{data.imported}</Text> 条记录{data.accountsCreated ? `，新建 ${data.accountsCreated} 个账户` : ''}
              </Text>
            </View>
          );
        }
        return (
          <View style={{ marginTop: 2, gap: 8 }}>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
              {[IMPORT_SOURCE_LABELS[data.source] || data.source, `${data.stats?.totalRecords ?? 0} 条记录`, `收入 ${data.stats?.incomeCount ?? 0}`, `支出 ${data.stats?.expenseCount ?? 0}`]
                .concat(data.stats?.transferCount > 0 ? [`转账 ${data.stats.transferCount}`] : [])
                .concat(data.stats?.accountsToCreate > 0 ? [`新增 ${data.stats.accountsToCreate} 个账户`] : [])
                .map((t, i) => (
                  <View key={i} style={{ paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6, backgroundColor: colors.muted }}>
                    <Text style={{ fontSize: 10.5, color: colors.mutedForeground }}>{t}</Text>
                  </View>
                ))}
            </View>
            {data.records?.length > 0 && (
              <MiniTable
                columns={['#', '日期', '类型', '金额', '账户', '分类', '说明']}
                rows={data.records.slice(0, 50).map((r: any) => [String(r.rowIndex), r.date, r.type, (r.amount ?? 0).toFixed(2), r.accountName, r.categoryLabel || r.categoryCode || '-', r.remark || '-'])}
                maxHeight={220}
              />
            )}
            <View style={{ flexDirection: 'row', gap: 8 }}>
              <Pressable onPress={() => confirmAndContinue(data.accountBookId || bookId, toolCall.toolCallId, true, { fileId: data.fileId, ownerId: data.ownerId })} disabled={submitted} style={{ flex: 1, borderRadius: 10, paddingVertical: 8, alignItems: 'center', backgroundColor: colors.primary, flexDirection: 'row', justifyContent: 'center', gap: 6, opacity: submitted ? 0.6 : 1 }}>
                {submitted && <ActivityIndicator size="small" color="#fff" />}
                <Text style={{ color: '#fff', ...btnText }}>{submitted ? '提交中...' : `确认导入 ${data.stats?.totalRecords ?? 0} 条记录`}</Text>
              </Pressable>
              <Pressable onPress={() => confirmAndContinue(data.accountBookId || bookId, toolCall.toolCallId, false)} disabled={submitted} style={{ flex: 1, borderRadius: 10, paddingVertical: 8, alignItems: 'center', borderWidth: 1, borderColor: colors.border, backgroundColor: colors.card, opacity: submitted ? 0.6 : 1 }}>
                <Text style={{ fontSize: 12.5, color: colors.foreground }}>取消</Text>
              </Pressable>
            </View>
          </View>
        );
      })()}

      {/* 历史数据过期提示(始终可见) */}
      {isExpired && (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 2 }}>
          <AlertTriangle size={12} color={effectiveStatus === 'error' ? '#dc2626' : '#f59e0b'} />
          <Text style={{ fontSize: 10.5, color: effectiveStatus === 'error' ? '#dc2626' : '#f59e0b', flex: 1 }}>
            {expiredMessage || '此操作在重新加载后已过期，请重新发起请求'}
          </Text>
        </View>
      )}

      {/* 批量确认计数 */}
      {effectiveStatus === 'confirming' && <BatchIndicator toolCallId={toolCall.toolCallId} />}

      {/* 确认按钮(始终可见) */}
      {(effectiveStatus === 'confirming' || (isExpired && toolCall.preview)) && (
        <ConfirmPreviewView preview={toolCall.preview} submitted={submitted} submitting={submitted} onConfirm={handleConfirm} />
      )}

      {/* 建议补充(始终可见) */}
      {effectiveStatus === 'suggesting' && suggestionQuestions && (
        <View style={{ marginTop: 4, gap: 10 }}>
          {suggestionQuestions.map((q, qi) => {
            const sel = selected[q.field] || '';
            return (
              <View key={q.field} style={{ gap: 6 }}>
                <Text style={{ fontSize: 12.5, fontWeight: '600', color: colors.foreground }}>
                  {suggestionQuestions.length > 1 && <Text style={{ color: colors.mutedForeground }}>{qi + 1}. </Text>}{q.question}
                </Text>
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
                  {q.options.map((opt) => {
                    const label = typeof opt === 'string' ? opt : (opt?.label || opt?.name || opt?.description || JSON.stringify(opt));
                    const value = typeof opt === 'string' ? opt : (opt?.value || opt?.code || label);
                    const active = sel === value;
                    return (
                      <Pressable key={value} onPress={() => setSelected((p) => ({ ...p, [q.field]: value }))} style={{ paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8, backgroundColor: active ? colors.primary : 'transparent', borderWidth: 1, borderColor: active ? colors.primary : colors.border }}>
                        <Text style={{ fontSize: 11.5, color: active ? '#fff' : colors.foreground }}>{label}</Text>
                      </Pressable>
                    );
                  })}
                  {q.allowCustom && (
                    <Pressable onPress={() => setSelected((p) => ({ ...p, [q.field]: '__custom__' }))} style={{ paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8, backgroundColor: sel === '__custom__' ? colors.primary : 'transparent', borderWidth: 1, borderColor: sel === '__custom__' ? colors.primary : colors.border }}>
                      <Text style={{ fontSize: 11.5, color: sel === '__custom__' ? '#fff' : colors.foreground }}>自定义</Text>
                    </Pressable>
                  )}
                </View>
                {sel === '__custom__' && (
                  <TextInput
                    value={custom[q.field] || ''}
                    onChangeText={(t) => setCustom((p) => ({ ...p, [q.field]: t }))}
                    placeholder="输入自定义内容..."
                    placeholderTextColor={colors.mutedForeground}
                    style={{ borderWidth: 1, borderColor: colors.hairline, borderRadius: 8, paddingHorizontal: 8, paddingVertical: 5, fontSize: 11.5, color: colors.foreground }}
                  />
                )}
              </View>
            );
          })}
          {isExpired && (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
              <AlertTriangle size={12} color="#f59e0b" />
              <Text style={{ fontSize: 10.5, color: '#f59e0b', flex: 1 }}>此操作在重新加载后已过期，请在聊天输入框中直接回复你的选择</Text>
            </View>
          )}
          <View style={{ flexDirection: 'row', gap: 8 }}>
            <Pressable
              onPress={() => { if (!allFilled || submitted) return; setSubmitted(true); respondToSuggestion(bookId, toolCall.toolCallId, Object.fromEntries((suggestionQuestions ?? []).map((q) => [q.field, getValue(q.field)]))); }}
              disabled={!allFilled || submitted}
              style={{ flex: 1, borderRadius: 10, paddingVertical: 8, alignItems: 'center', backgroundColor: colors.primary, flexDirection: 'row', justifyContent: 'center', gap: 6, opacity: (!allFilled || submitted) ? 0.5 : 1 }}
            >
              {submitted && <ActivityIndicator size="small" color="#fff" />}
              <Text style={{ color: '#fff', ...btnText }}>{submitted ? '提交中...' : '提交'}</Text>
            </Pressable>
            <Pressable onPress={() => respondToSuggestion(bookId, toolCall.toolCallId, null)} disabled={submitted} style={{ flex: 1, borderRadius: 10, paddingVertical: 8, alignItems: 'center', opacity: submitted ? 0.6 : 1 }}>
              <Text style={{ fontSize: 12.5, color: colors.mutedForeground }}>取消</Text>
            </Pressable>
          </View>
        </View>
      )}

      {/* 切换账本(始终可见) */}
      {effectiveStatus === 'switching' && (
        <View style={{ marginTop: 4, gap: 8 }}>
          <Text style={{ fontSize: 12.5, fontWeight: '600', color: colors.foreground }}>选择要切换的账本：</Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            {((toolCall.result as any)?.books ?? []).map((b: Ledger) => {
              const active = bookChoice === b.id;
              return (
                <Pressable
                  key={b.id}
                  onPress={() => setBookChoice(b.id)}
                  style={{ width: 150, borderRadius: 10, borderWidth: 1, padding: 10, borderColor: active ? '#10b981' : colors.hairline, backgroundColor: active ? alpha('#10b981', 0.08) : colors.card }}
                >
                  <Text style={{ fontSize: 12.5, fontWeight: '600', color: colors.foreground }} numberOfLines={1}>{b.name}</Text>
                  <Text style={{ fontSize: 10.5, color: colors.mutedForeground, marginTop: 2 }}>{b.memberCount} 位成员</Text>
                </Pressable>
              );
            })}
          </View>
          {isExpired && (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
              <AlertTriangle size={12} color="#f59e0b" />
              <Text style={{ fontSize: 10.5, color: '#f59e0b', flex: 1 }}>切换操作已过期，请在聊天输入框中直接说明要切换的账本</Text>
            </View>
          )}
          <Pressable
            onPress={() => { if (bookChoice) { setSubmitted(true); switchBook(toolCall.toolCallId, bookChoice); } }}
            disabled={!bookChoice}
            style={{ borderRadius: 10, paddingVertical: 8, alignItems: 'center', backgroundColor: '#10b981', opacity: !bookChoice ? 0.5 : 1 }}
          >
            <Text style={{ color: '#fff', ...btnText }}>切换到此账本</Text>
          </Pressable>
        </View>
      )}
    </View>
  );
}

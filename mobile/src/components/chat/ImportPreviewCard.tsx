import { useEffect, useState } from 'react';
import { ActivityIndicator, Platform, Pressable, ScrollView, Switch, TextInput, View } from 'react-native';
import { AlertTriangle, CheckCircle2, ChevronDown, Copy, FileSpreadsheet, Search, Trash2, HelpCircle, Loader2, MessageSquareMore, Wrench, XCircle } from 'lucide-react-native';
import { useTheme, alpha, semanticTypeColor } from '@/theme';
import { Text } from '@/components/ui/Text';
import { FormSheet } from '@/components/chrome/FormSheet';
import { useChatStore } from '@/stores/chat';
import { getToolDisplayName } from '@/services/chat';
import { accountLabel, isMultiOwnerAccounts } from '@/lib/account';
import { MiniTable } from './MiniTable';
import { ACCOUNT_TYPE_LABELS, TYPE_TO_GROUP, IMPORT_SOURCE_LABELS, initAccountResolutions, unresolvedAccountCount, type AccountResolution, type ToolCallEntry } from '@homibook/core';

// ── 导入预览交互卡(复刻 web ImportPreviewInteractive,UI 适配移动端)。从 AIAssistant.tsx 拆出 ──
// ── 导入消息文件卡片:把"请导入XX账单文件/fileId/source/文件名"文本渲染为附件卡片 ──

/** 解析导入消息文本(发送时为 AI 解析拼接的元数据行,渲染时转为文件卡片) */
export function parseImportMeta(text: string): { desc: string; fileName: string; source: string } | null {
  const m = text.match(/^([\s\S]*?)\s*\nfileId:\s*(\S+)\s*\nsource:\s*(\S+)\s*\n文件名:\s*(.+?)\s*$/);
  if (!m) return null;
  return { desc: m[1].trim(), fileName: m[4], source: IMPORT_SOURCE_LABELS[m[3] as keyof typeof IMPORT_SOURCE_LABELS] ?? m[3] };
}

/** 导入账单文件卡片(用户主色气泡内:白色半透明底) */
export function ImportFileCard({ fileName, source }: { fileName: string; source: string }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 9, backgroundColor: alpha('#ffffff', 0.18), borderRadius: 12, paddingHorizontal: 11, paddingVertical: 9 }}>
      <View style={{ width: 36, height: 36, borderRadius: 9, alignItems: 'center', justifyContent: 'center', backgroundColor: alpha('#ffffff', 0.22) }}>
        <FileSpreadsheet size={18} color="#fff" />
      </View>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text numberOfLines={1} style={{ fontSize: 13, fontWeight: '600', color: '#fff' }}>{fileName}</Text>
        <Text style={{ fontSize: 10.5, color: alpha('#ffffff', 0.75), marginTop: 1 }}>{source}账单 · 待导入</Text>
      </View>
    </View>
  );
}

// ── 导入预览交互卡(复刻 web ImportPreviewInteractive,UI 适配移动端) ──

// 收支类型标签/字典组映射统一来自 @homibook/core;UNKNOWN 标签与分组标题为本卡片展示所需
const IMPORT_TYPE_LABELS: Record<string, string> = { INCOME: '收入', EXPENSE: '支出', TRANSFER: '转账', UNKNOWN: '未知' };
const IMPORT_TYPE_TO_GROUP = TYPE_TO_GROUP;
const IMPORT_GROUP_HEADING: Record<string, string> = {
  transaction_category_expense: '支出分类',
  transaction_category_income: '收入分类',
  transaction_category_transfer: '转账分类',
};

// 分类字典项(与 web ImportPreviewData.allDictItems 同构)
interface ImportDictEntry { code: string; label: string; group: string }

export function ImportPreviewCard({ toolCall, bookId }: { toolCall: ToolCallEntry; bookId: string }) {
  const { colors } = useTheme();
  const { confirmAndContinue } = useChatStore();
  const [tab, setTab] = useState<'records' | 'accounts' | 'categories' | 'unrec'>('records');
  const [submitted, setSubmitted] = useState(false);
  const [confirmError, setConfirmError] = useState('');
  // 账户解析:同一 csvName → 新建(名称+类型) 或 映射已有账户(类型与初始化来自 core)
  const [accountRes, setAccountRes] = useState<Record<string, AccountResolution>>({});
  // 分类解析规则(可复制成多条,带正则条件与保存开关)
  interface CategoryResolution { id: string; sourceCategory: string; type: string; targetCode: string; save: boolean; payerContains: string; descriptionContains: string }
  const [categoryRes, setCategoryRes] = useState<CategoryResolution[]>([]);
  // 未识别记录的手动指定
  const [unrecRes, setUnrecRes] = useState<Record<number, { type: string; accountId: string; categoryCode: string }>>({});
  // 底部选择弹窗(FormSheet)
  const [picker, setPicker] = useState<null | { kind: 'acct-existing' | 'acct-type' | 'cat-target' | 'unrec-type' | 'unrec-acct' | 'unrec-cat'; key: string; type?: string }>(null);
  const [catSearch, setCatSearch] = useState('');

  const data = (toolCall.result as any)?.data ?? toolCall.result ?? {};
  const aiArgs = (toolCall.args ?? {}) as any;
  const records: any[] = data.records ?? [];
  const unrec: any[] = data.unrecognizedRecords ?? [];
  const unmatchedAccounts: any[] = data.unmatchedAccounts ?? [];
  const accounts: { id: string; name: string; type: string; ownerId?: string; ownerName?: string }[] = data.accounts ?? [];
  const multiOwnerAccounts = isMultiOwnerAccounts(accounts);
  const dictItems: ImportDictEntry[] = data.allDictItems ?? [];
  const stats = data.stats;
  const isConfirmed = !!data.confirmed;
  const accountBookId: string = data.accountBookId || bookId;

  // 初始化解析默认值(统一策略见 core initAccountResolutions:AI 决议 → 候选首位 → 新建建议 → AI 参数覆盖)
  useEffect(() => {
    setAccountRes(initAccountResolutions(unmatchedAccounts, aiArgs.accountResolutions));

    setCategoryRes(
      (data.unmatchedCategories ?? [])
        .filter((uc: any) => uc.aiRecordType || uc.types?.[0])
        .map((uc: any, i: number) => ({
          id: String(i),
          sourceCategory: uc.sourceCategory,
          type: uc.aiRecordType || uc.types?.[0] || '',
          targetCode: uc.suggestedCode || '',
          save: true,
          payerContains: uc.payerContains || '',
          descriptionContains: uc.descriptionContains || '',
        })),
    );

    const unres: Record<number, { type: string; accountId: string; categoryCode: string }> = {};
    for (const r of unrec) {
      unres[r.rowIndex] = { type: '', accountId: r.accountId || accounts[0]?.id || '', categoryCode: r.mappedCategoryCode || r.categoryCode || '' };
    }
    setUnrecRes(unres);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 后端确认成功(data.confirmed=true)后复位提交标记,按钮切换为「已确认」
  useEffect(() => {
    if (isConfirmed) setSubmitted(false);
  }, [isConfirmed]);

  const unresolvedAcctCount = unresolvedAccountCount(unmatchedAccounts, accountRes);
  const unresolvedCatCount = categoryRes.filter((cr) => !cr.targetCode).length;
  const unresolvedUnrecCount = unrec.filter((r) => {
    const res = unrecRes[r.rowIndex];
    return !res?.type || !res?.accountId;
  }).length;

  const allRecords = [...records, ...unrec];
  const tabs = [
    { key: 'records' as const, label: `记录 (${allRecords.length})` },
    { key: 'accounts' as const, label: `未匹配账户 (${unmatchedAccounts.length})` },
    { key: 'categories' as const, label: `未匹配分类 (${categoryRes.length})` },
    { key: 'unrec' as const, label: `需处理 (${unrec.length})` },
  ];

  // 分类候选:按记录类型过滤字典 + 搜索
  const filteredDict = (type: string) => {
    const group = IMPORT_TYPE_TO_GROUP[type];
    const items = group ? dictItems.filter((d) => d.group === group) : dictItems;
    if (!catSearch) return items;
    const s = catSearch.toLowerCase();
    return items.filter((d) => d.label.toLowerCase().includes(s) || d.code.toLowerCase().includes(s));
  };
  const groupedDict = (type: string) => {
    const groups = new Map<string, ImportDictEntry[]>();
    for (const d of filteredDict(type)) {
      const list = groups.get(d.group) ?? [];
      list.push(d);
      groups.set(d.group, list);
    }
    return groups;
  };

  // ── 选择弹窗内容 ──
  const pickerTitle =
    picker?.kind === 'acct-existing' ? '选择已有账户'
    : picker?.kind === 'acct-type' ? '账户类型'
    : picker?.kind === 'cat-target' ? '选择目标分类'
    : picker?.kind === 'unrec-type' ? '记录类型'
    : picker?.kind === 'unrec-acct' ? '选择账户'
    : '选择分类';
  const pickerOptions: { value: string; label: string }[] = (() => {
    if (!picker) return [];
    if (picker.kind === 'acct-existing') {
      const ua = unmatchedAccounts.find((u) => u.csvName === picker.key);
      return (ua?.candidates?.length ? ua.candidates : accounts).map((a: any) => ({ value: a.id, label: accountLabel(a, multiOwnerAccounts) }));
    }
    if (picker.kind === 'acct-type' || picker.kind === 'unrec-type') {
      return Object.entries(ACCOUNT_TYPE_LABELS).map(([k, v]) => ({ value: k, label: v as string }));
    }
    if (picker.kind === 'unrec-acct') return accounts.map((a) => ({ value: a.id, label: accountLabel(a, multiOwnerAccounts) }));
    if (picker.kind === 'unrec-cat') {
      const res = unrecRes[Number(picker.key)];
      const items = res?.type ? dictItems.filter((d) => d.group === IMPORT_TYPE_TO_GROUP[res.type]) : dictItems;
      return items.map((d) => ({ value: d.code, label: d.label }));
    }
    return [];
  })();
  const pickerValue = (() => {
    if (!picker) return undefined;
    if (picker.kind === 'acct-existing') return (accountRes[picker.key] as any)?.accountId;
    if (picker.kind === 'acct-type') return (accountRes[picker.key] as any)?.type;
    if (picker.kind === 'unrec-type') return unrecRes[Number(picker.key)]?.type;
    if (picker.kind === 'unrec-acct') return unrecRes[Number(picker.key)]?.accountId;
    if (picker.kind === 'unrec-cat') return unrecRes[Number(picker.key)]?.categoryCode;
    return undefined;
  })();
  const onPickerSelect = (v: string) => {
    if (!picker) return;
    if (picker.kind === 'acct-existing') setAccountRes((p) => ({ ...p, [picker.key]: { action: 'existing', accountId: v } }));
    else if (picker.kind === 'acct-type') setAccountRes((p) => ({ ...p, [picker.key]: { ...(p[picker.key] as any), action: 'create', type: v } }));
    else if (picker.kind === 'unrec-type') setUnrecRes((p) => ({ ...p, [Number(picker.key)]: { ...p[Number(picker.key)], type: v, categoryCode: '' } }));
    else if (picker.kind === 'unrec-acct') setUnrecRes((p) => ({ ...p, [Number(picker.key)]: { ...p[Number(picker.key)], accountId: v } }));
    else if (picker.kind === 'unrec-cat') setUnrecRes((p) => ({ ...p, [Number(picker.key)]: { ...p[Number(picker.key)], categoryCode: v } }));
    setPicker(null);
  };

  // ── 确认导入(构建 overrides 发起 confirm_import) ──
  const handleConfirm = () => {
    if (submitted) return;
    setSubmitted(true);
    setConfirmError('');
    const overrides: Record<string, unknown> = {};
    if (aiArgs.fileId) overrides.fileId = aiArgs.fileId;
    const userAccounts = Object.entries(accountRes).map(([csvName, res]) =>
      res.action === 'existing'
        ? { sourceAccountName: csvName, action: 'existing', targetAccountId: res.accountId }
        : { sourceAccountName: csvName, action: 'create', targetAccountName: res.name, accountType: res.type },
    ).filter((r) => (r as any).targetAccountId || (r as any).targetAccountName);
    if (userAccounts.length > 0) overrides.accountResolutions = userAccounts;
    const userCats = categoryRes.filter((cr) => cr.targetCode && cr.save).map((cr) => ({
      sourceCategory: cr.sourceCategory,
      targetCategoryCode: cr.targetCode,
      recordType: cr.type,
      payerContains: cr.payerContains || undefined,
      descriptionContains: cr.descriptionContains || undefined,
    }));
    if (userCats.length > 0) overrides.categoryResolutions = userCats;
    const userUnrec = unrec.filter((r) => {
      const res = unrecRes[r.rowIndex];
      return res?.type && res?.accountId;
    }).map((r) => ({ rowIndex: r.rowIndex, type: unrecRes[r.rowIndex].type, accountId: unrecRes[r.rowIndex].accountId, categoryCode: unrecRes[r.rowIndex].categoryCode || '' }));
    if (userUnrec.length > 0) overrides.unrecognizedResolutions = userUnrec;

    try {
      confirmAndContinue(accountBookId, toolCall.toolCallId, true, Object.keys(overrides).length > 0 ? overrides : undefined);
    } catch (e: any) {
      setConfirmError(e?.message || '确认请求失败');
      setSubmitted(false);
    }
  };

  const inputStyle = { backgroundColor: colors.card, borderWidth: 1, borderColor: colors.hairline, borderRadius: 8, paddingHorizontal: 8, paddingVertical: 5, fontSize: 11, color: colors.foreground } as const;
  const selectBtnStyle = { flex: 1, flexDirection: 'row' as const, alignItems: 'center' as const, justifyContent: 'space-between' as const, borderWidth: 1, borderColor: colors.hairline, borderRadius: 8, paddingHorizontal: 8, paddingVertical: 6, backgroundColor: colors.card };

  return (
    <View style={{ marginTop: 4, gap: 8 }}>
      {/* 统计摘要 */}
      {stats && (
        <View style={{ flexDirection: 'row', gap: 4 }}>
          {[['总行数', String(stats.totalLines ?? '-')], ['已解析', String(stats.parsedRows ?? '-')], ['跳过', String(stats.skippedRows ?? '-')], ['待处理', String(unresolvedAcctCount + unresolvedCatCount + unresolvedUnrecCount)]].map(([label, val], i) => (
            <View key={label} style={{ flex: 1, backgroundColor: colors.card, borderRadius: 6, paddingHorizontal: 4, paddingVertical: 3, alignItems: 'center' }}>
              <Text style={{ fontSize: 9.5, color: colors.mutedForeground }}>{label}</Text>
              <Text style={{ fontSize: 11, fontWeight: '600', color: i === 1 ? '#22c55e' : i === 2 ? '#f59e0b' : i === 3 ? '#ef4444' : colors.foreground }}>{val}</Text>
            </View>
          ))}
        </View>
      )}
      {/* 跳过/错误详情 */}
      {!!stats?.errors?.length && (
        <Text style={{ fontSize: 10, color: colors.mutedForeground }}>跳过/错误 {stats.errors.length} 条{stats.errors[0] ? `：${stats.errors[0]}` : ''}</Text>
      )}

      {/* Tab 切换 */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6 }}>
        {tabs.map((t) => {
          const active = tab === t.key;
          return (
            <Pressable key={t.key} onPress={() => setTab(t.key)} style={{ paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999, borderWidth: 1, borderColor: active ? colors.primary : colors.hairline, backgroundColor: active ? alpha(colors.primary, 0.12) : 'transparent' }}>
              <Text style={{ fontSize: 10.5, fontWeight: active ? '600' : '400', color: active ? colors.primary : colors.mutedForeground }}>{t.label}</Text>
            </Pressable>
          );
        })}
      </ScrollView>

      {/* 记录列表 */}
      {tab === 'records' && (
        <MiniTable
          columns={['#', '日期', '类型', '金额', '账户', '分类', '映射分类', '交易方', '说明']}
          aligns={['left', 'left', 'left', 'right']}
          rows={allRecords.map((r) => {
            let displayDate = r.date;
            try {
              const d = new Date(r.date);
              if (!isNaN(d.getTime())) displayDate = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
            } catch { /* 原样展示 */ }
            return [String(r.rowIndex), displayDate, IMPORT_TYPE_LABELS[r.type] || r.type, (r.amount ?? 0).toFixed(2), r.accountName ?? '-', r.categoryLabel || r.categoryCode || '-', r.mappedCategoryLabel || r.mappedCategoryCode || '-', r.payer || '-', r.remark || '-'];
          })}
          maxHeight={220}
        />
      )}

      {/* 未匹配账户 */}
      {tab === 'accounts' && (
        <View style={{ gap: 8 }}>
          {unmatchedAccounts.length === 0 ? (
            <Text style={{ fontSize: 11.5, color: colors.mutedForeground }}>全部账户已匹配</Text>
          ) : (
            <>
              <Text style={{ fontSize: 10.5, color: colors.mutedForeground }}>同一银行账户可能有多个名称变体，设为相同名称即可合并</Text>
              {unmatchedAccounts.map((ua) => {
                const res = accountRes[ua.csvName];
                return (
                  <View key={ua.csvName} style={{ backgroundColor: colors.muted, borderRadius: 10, padding: 8, gap: 6 }}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                      <Text style={{ flex: 1, fontSize: 11.5, fontWeight: '600' }} numberOfLines={1}>{ua.csvName}</Text>
                      <View style={{ paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6, backgroundColor: colors.card }}>
                        <Text style={{ fontSize: 9.5, color: colors.mutedForeground }}>{res?.action === 'create' ? '新建' : '已有'}</Text>
                      </View>
                      <Pressable
                        onPress={() => {
                          if (res?.action === 'create') setAccountRes((p) => ({ ...p, [ua.csvName]: { action: 'existing', accountId: accounts[0]?.id || '' } }));
                          else setAccountRes((p) => ({ ...p, [ua.csvName]: { action: 'create', name: ua.suggestedName, type: ua.suggestedType } }));
                        }}
                        style={{ paddingHorizontal: 8, paddingVertical: 3 }}
                      >
                        <Text style={{ fontSize: 10.5, color: colors.mutedForeground }}>切换</Text>
                      </Pressable>
                    </View>
                    {res?.action === 'create' ? (
                      <View style={{ flexDirection: 'row', gap: 6 }}>
                        <TextInput value={res.name} onChangeText={(t) => setAccountRes((p) => ({ ...p, [ua.csvName]: { ...res, name: t } }))} style={{ ...inputStyle, flex: 1 }} />
                        <Pressable onPress={() => setPicker({ kind: 'acct-type', key: ua.csvName })} style={{ ...selectBtnStyle, minWidth: 84 }}>
                          <Text style={{ fontSize: 11 }} numberOfLines={1}>{ACCOUNT_TYPE_LABELS[res.type as keyof typeof ACCOUNT_TYPE_LABELS] ?? res.type ?? '类型'}</Text>
                          <ChevronDown size={11} color={colors.mutedForeground} />
                        </Pressable>
                      </View>
                    ) : (
                      <Pressable onPress={() => setPicker({ kind: 'acct-existing', key: ua.csvName })} style={selectBtnStyle}>
                        <Text style={{ fontSize: 11, color: (res as any)?.accountId ? colors.foreground : colors.mutedForeground }} numberOfLines={1}>
                          {(() => {
                            const a = accounts.find((x) => x.id === (res as any)?.accountId);
                            return a ? accountLabel(a, multiOwnerAccounts) : ((res as any)?.accountId || '选择已有账户...');
                          })()}
                        </Text>
                        <ChevronDown size={11} color={colors.mutedForeground} />
                      </Pressable>
                    )}
                  </View>
                );
              })}
            </>
          )}
        </View>
      )}

      {/* 未匹配分类 */}
      {tab === 'categories' && (
        <View style={{ gap: 10 }}>
          {categoryRes.length === 0 ? (
            <Text style={{ fontSize: 11.5, color: colors.mutedForeground }}>全部分类已映射</Text>
          ) : (
            [...new Map(categoryRes.map((cr) => [cr.type, categoryRes.filter((e) => e.type === cr.type)])).entries()].map(([type, items]) => (
              <View key={type} style={{ gap: 6 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                  <View style={{ paddingHorizontal: 8, paddingVertical: 2, borderRadius: 6, backgroundColor: alpha(semanticTypeColor(colors, type, colors.primary), 0.12) }}>
                    <Text style={{ fontSize: 10, color: semanticTypeColor(colors, type, colors.primary) }}>{IMPORT_TYPE_LABELS[type] ?? type}</Text>
                  </View>
                  <Text style={{ fontSize: 10, color: colors.mutedForeground }}>{items.length} 项</Text>
                </View>
                {items.map((cr) => {
                  const updateCr = (patch: Partial<CategoryResolution>) => setCategoryRes((prev) => prev.map((e) => (e.id === cr.id ? { ...e, ...patch } : e)));
                  return (
                    <View key={cr.id} style={{ backgroundColor: colors.muted, borderRadius: 10, padding: 8, gap: 6 }}>
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                        <Text style={{ flex: 1, fontSize: 11, fontWeight: '600' }} numberOfLines={1}>{cr.sourceCategory}</Text>
                        <Pressable hitSlop={4} onPress={() => setCategoryRes((prev) => [...prev, { ...cr, id: String(prev.length), payerContains: '', descriptionContains: '' }])} style={{ padding: 2 }}>
                          <Copy size={12} color={colors.mutedForeground} />
                        </Pressable>
                        <Pressable hitSlop={4} onPress={() => setCategoryRes((prev) => prev.filter((e) => e.id !== cr.id))} style={{ padding: 2 }}>
                          <Trash2 size={12} color="#ef4444" />
                        </Pressable>
                      </View>
                      <View style={{ flexDirection: 'row', gap: 6 }}>
                        <TextInput value={cr.payerContains} onChangeText={(t) => updateCr({ payerContains: t })} placeholder="交易方正则" placeholderTextColor={colors.mutedForeground} style={{ ...inputStyle, flex: 1 }} />
                        <TextInput value={cr.descriptionContains} onChangeText={(t) => updateCr({ descriptionContains: t })} placeholder="说明正则" placeholderTextColor={colors.mutedForeground} style={{ ...inputStyle, flex: 1 }} />
                      </View>
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                        <Pressable onPress={() => { setCatSearch(''); setPicker({ kind: 'cat-target', key: cr.id, type: cr.type }); }} style={{ ...selectBtnStyle, flex: 1 }}>
                          <Text style={{ fontSize: 11, color: cr.targetCode ? colors.foreground : colors.mutedForeground }} numberOfLines={1}>
                            {cr.targetCode ? (dictItems.find((d) => d.code === cr.targetCode)?.label || cr.targetCode) : '选择分类...'}
                          </Text>
                          <ChevronDown size={11} color={colors.mutedForeground} />
                        </Pressable>
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                          <Text style={{ fontSize: 10.5, color: colors.mutedForeground }}>保存</Text>
                          <Switch value={cr.save} onValueChange={(v: boolean) => updateCr({ save: v })} trackColor={{ true: colors.primary }} style={{ transform: [{ scale: 0.75 }] }} />
                        </View>
                      </View>
                    </View>
                  );
                })}
              </View>
            ))
          )}
        </View>
      )}

      {/* 未识别记录 */}
      {tab === 'unrec' && (
        <View style={{ gap: 8 }}>
          {unrec.length === 0 ? (
            <Text style={{ fontSize: 11.5, color: colors.mutedForeground }}>无未识别记录</Text>
          ) : (
            unrec.map((r) => {
              const res = unrecRes[r.rowIndex] ?? { type: '', accountId: '', categoryCode: '' };
              const resolved = !!res.type && !!res.accountId;
              return (
                <View key={r.rowIndex} style={{ borderRadius: 10, borderWidth: 1, padding: 8, gap: 6, borderColor: resolved ? alpha('#22c55e', 0.3) : '#fb923c', backgroundColor: resolved ? alpha('#22c55e', 0.05) : alpha('#fb923c', 0.08) }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                    <Text style={{ fontSize: 10.5 }}>{r.date}</Text>
                    <Text style={{ fontSize: 10.5, fontWeight: '600', fontVariant: ['tabular-nums'] }}>{(r.amount ?? 0).toFixed(2)}</Text>
                    <Text style={{ flex: 1, fontSize: 10.5, color: colors.mutedForeground }} numberOfLines={1}>{r.accountName}{r.remark ? ` · ${r.remark}` : ''}</Text>
                    {resolved ? <CheckCircle2 size={12} color="#22c55e" /> : <Text style={{ fontSize: 9.5, color: '#fb923c' }}>未设置</Text>}
                  </View>
                  <View style={{ flexDirection: 'row', gap: 6 }}>
                    <Pressable onPress={() => setPicker({ kind: 'unrec-type', key: String(r.rowIndex) })} style={selectBtnStyle}>
                      <Text style={{ fontSize: 10.5, color: res.type ? colors.foreground : colors.mutedForeground }} numberOfLines={1}>{IMPORT_TYPE_LABELS[res.type] ?? '类型'}</Text>
                      <ChevronDown size={10} color={colors.mutedForeground} />
                    </Pressable>
                    <Pressable onPress={() => setPicker({ kind: 'unrec-acct', key: String(r.rowIndex) })} style={selectBtnStyle}>
                      <Text style={{ fontSize: 10.5, color: res.accountId ? colors.foreground : colors.mutedForeground }} numberOfLines={1}>{(() => {
                        const a = accounts.find((x) => x.id === res.accountId);
                        return a ? accountLabel(a, multiOwnerAccounts) : '账户';
                      })()}</Text>
                      <ChevronDown size={10} color={colors.mutedForeground} />
                    </Pressable>
                    <Pressable onPress={() => setPicker({ kind: 'unrec-cat', key: String(r.rowIndex) })} style={selectBtnStyle}>
                      <Text style={{ fontSize: 10.5, color: res.categoryCode ? colors.foreground : colors.mutedForeground }} numberOfLines={1}>{dictItems.find((d) => d.code === res.categoryCode)?.label ?? '分类'}</Text>
                      <ChevronDown size={10} color={colors.mutedForeground} />
                    </Pressable>
                  </View>
                </View>
              );
            })
          )}
        </View>
      )}

      {/* 操作栏 */}
      {confirmError ? (
        <View style={{ borderRadius: 8, borderWidth: 1, borderColor: alpha('#ef4444', 0.4), backgroundColor: alpha('#ef4444', 0.08), padding: 8 }}>
          <Text style={{ fontSize: 11, color: '#ef4444' }}>{confirmError}</Text>
        </View>
      ) : null}
      {!isConfirmed ? (
        <Pressable
          onPress={handleConfirm}
          disabled={submitted}
          style={{ borderRadius: 10, paddingVertical: 9, alignItems: 'center', flexDirection: 'row', justifyContent: 'center', gap: 6, backgroundColor: colors.primary, opacity: submitted ? 0.6 : 1 }}
        >
          {submitted && <ActivityIndicator size="small" color={colors.primaryForeground} />}
          <Text style={{ fontSize: 12.5, fontWeight: '600', color: colors.primaryForeground }}>{submitted ? '提交中...' : '确认无误，继续导入'}</Text>
        </Pressable>
      ) : (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          <CheckCircle2 size={14} color="#22c55e" />
          <Text style={{ fontSize: 11.5, color: '#22c55e' }}>已确认，等待导入...</Text>
        </View>
      )}

      {/* 底部选择弹窗 */}
      <FormSheet visible={picker !== null} title={pickerTitle} onClose={() => setPicker(null)}>
        <View style={{ maxHeight: 420 }}>
          {/* 目标分类:带搜索 + 分组 */}
          {picker?.kind === 'cat-target' ? (
            <View style={{ gap: 8 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: colors.muted, borderRadius: 10, paddingHorizontal: 10, paddingVertical: 7 }}>
                <Search size={13} color={colors.mutedForeground} />
                <TextInput value={catSearch} onChangeText={setCatSearch} placeholder="搜索分类..." placeholderTextColor={colors.mutedForeground} style={{ flex: 1, fontSize: 12.5, color: colors.foreground, padding: 0 }} />
              </View>
              <ScrollView style={{ maxHeight: 340 }} keyboardShouldPersistTaps="handled">
                {[...groupedDict(picker.type ?? '').entries()].map(([group, items]) => (
                  <View key={group}>
                    <Text style={{ fontSize: 10, color: colors.mutedForeground, paddingHorizontal: 4, paddingVertical: 4, fontWeight: '600' }}>{IMPORT_GROUP_HEADING[group] ?? group}</Text>
                    {items.map((d) => (
                      <Pressable key={d.code} onPress={() => { const p = picker; setCategoryRes((prev) => prev.map((e) => (e.id === p.key ? { ...e, targetCode: d.code } : e))); setPicker(null); }} style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 6, paddingVertical: 9 }}>
                        <CheckCircle2 size={13} color={categoryRes.find((e) => e.id === picker.key)?.targetCode === d.code ? '#22c55e' : 'transparent'} />
                        <Text style={{ fontSize: 13 }}>{d.label}</Text>
                      </Pressable>
                    ))}
                  </View>
                ))}
                {filteredDict(picker.type ?? '').length === 0 && (
                  <Text style={{ fontSize: 12, color: colors.mutedForeground, textAlign: 'center', paddingVertical: 16 }}>无匹配结果</Text>
                )}
              </ScrollView>
            </View>
          ) : (
            <ScrollView style={{ maxHeight: 340 }} keyboardShouldPersistTaps="handled">
              {pickerOptions.map((o) => (
                <Pressable key={o.value} onPress={() => onPickerSelect(o.value)} style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 11 }}>
                  <CheckCircle2 size={13} color={pickerValue === o.value ? '#22c55e' : 'transparent'} />
                  <Text style={{ flex: 1, fontSize: 13 }}>{o.label}</Text>
                </Pressable>
              ))}
              {pickerOptions.length === 0 && (
                <Text style={{ fontSize: 12, color: colors.mutedForeground, textAlign: 'center', paddingVertical: 16 }}>无可选项</Text>
              )}
            </ScrollView>
          )}
        </View>
      </FormSheet>
    </View>
  );
}

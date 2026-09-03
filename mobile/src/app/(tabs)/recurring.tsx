import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Pressable, RefreshControl, ScrollView, Switch, TextInput, View } from 'react-native';
import { Plus, ArrowUpRight, ArrowDownRight, ArrowLeftRight, Trash2, FileText, Pencil } from 'lucide-react-native';
import { useTheme, alpha } from '@/theme';
import { Screen } from '@/components/Screen';
import { Card } from '@/components/ui/Card';
import { Text } from '@/components/ui/Text';
import { Button } from '@/components/ui/Button';
import { FadeInView } from '@/components/FadeInView';
import { ChipSelect } from '@/components/ui/ChipSelect';
import { DatePicker } from '@/components/ui/DatePicker';
import { CronBuilder } from '@/components/ui/CronBuilder';
import { TagPicker } from '@/components/ui/TagPicker';
import { FormSheet } from '@/components/chrome/FormSheet';
import { useUIShell } from '@/components/chrome/chrome';
import {
  createRecurringApi, deleteRecurringApi, fetchRecurring, fetchRepaymentPlanApi,
  loanPreviewApi, toggleRecurringApi, updateRecurringApi,
} from '@/services/recurring';
import { fetchBudgetTags, fetchRecordTags } from '@/services/records';
import { useRecords } from '@/stores/records';
import { formatMoney, formatMoneyShort } from '@/lib/format';
import type { AccountItem, LoanInterestMethod, LoanPreview, RecordType, RecurringTransaction, RepaymentPlan } from '@/types';

const TYPE_KEYS: RecordType[] = ['INCOME', 'EXPENSE', 'TRANSFER'];
const TYPE_LABEL: Record<RecordType, string> = { INCOME: '收入', EXPENSE: '支出', TRANSFER: '转账' };
const TYPE_ICON = { INCOME: ArrowUpRight, EXPENSE: ArrowDownRight, TRANSFER: ArrowLeftRight } as const;
const TYPE_COLOR: Record<RecordType, 'income' | 'expense' | 'transfer'> = { INCOME: 'income', EXPENSE: 'expense', TRANSFER: 'transfer' };
const REC_TYPE_LABELS = { PERIODIC: '周期', LOAN: '贷款' } as const;
const METHOD_LABELS: Record<string, string> = { EQUAL_INSTALLMENT: '等额本息', EQUAL_PRINCIPAL: '等额本金' };

const fmtDateTime = (s?: string | null) => (s ? new Date(s).toLocaleString('zh-CN') : '-');

// 固定收支:对齐网页端完整新增/编辑 —— 周期/贷款两种类型、贷款预览与还款计划、全量表单字段
export default function RecurringScreen() {
  const { colors } = useTheme();
  const { currentLedger } = useUIShell();
  const bookId = currentLedger.id;
  // 分类/账户复用 records store
  const { categories: allCategories, accounts: allAccounts, refresh } = useRecords();
  const accounts = useMemo(() => allAccounts.filter((a) => a.status === 'ACTIVE'), [allAccounts]);

  const [items, setItems] = useState<RecurringTransaction[]>([]);

  // ── 表单状态 ──
  const [sheet, setSheet] = useState(false);
  const [editing, setEditing] = useState<RecurringTransaction | null>(null);
  const [name, setName] = useState('');
  const [type, setType] = useState<RecordType>('EXPENSE');
  const [amount, setAmount] = useState('');
  const [accountId, setAccountId] = useState('');
  const [toAccountId, setToAccountId] = useState('');
  const [categoryCode, setCategoryCode] = useState('');
  const [payer, setPayer] = useState('');
  const [remark, setRemark] = useState('');
  const [cron, setCron] = useState('0 0 * * *');
  const [recType, setRecType] = useState<'PERIODIC' | 'LOAN'>('PERIODIC');
  const [active, setActive] = useState(true);
  // 贷款字段
  const [loanTotal, setLoanTotal] = useState('');
  const [loanRate, setLoanRate] = useState('');
  const [loanMethod, setLoanMethod] = useState<LoanInterestMethod>('EQUAL_INSTALLMENT');
  const [loanStartDate, setLoanStartDate] = useState('');
  const [loanTermMonths, setLoanTermMonths] = useState('');
  const [loanDay, setLoanDay] = useState(1); // 每月还款日
  const [loanGenerateAll, setLoanGenerateAll] = useState(true); // 全部生成|只生成未还款
  const [tags, setTags] = useState<string[]>(['固定收支']);
  const [tagSuggestions, setTagSuggestions] = useState<string[]>([]);
  const [formError, setFormError] = useState('');
  const [saving, setSaving] = useState(false);

  // 贷款预览
  const [loanPreview, setLoanPreview] = useState<LoanPreview | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);

  // 还款计划查看
  const [planTarget, setPlanTarget] = useState<RecurringTransaction | null>(null);
  const [plans, setPlans] = useState<RepaymentPlan[]>([]);

  // 标签建议(预算标签 + 流水标签)
  useEffect(() => {
    if (!bookId) return;
    Promise.all([fetchBudgetTags(bookId), fetchRecordTags(bookId)]).then(([b, r]) => {
      setTagSuggestions([...new Set([...b, ...r])]);
    }).catch(() => {});
  }, [bookId]);

  const reload = useCallback(() => {
    if (bookId) fetchRecurring(bookId).then(setItems);
  }, [bookId]);

  useEffect(() => { reload(); }, [reload]);

  const [refreshing, setRefreshing] = useState(false);
  // 下拉刷新:固定收支 + store(分类/账户)
  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await Promise.all([fetchRecurring(bookId).then(setItems).catch(() => {}), refresh()]);
    } finally {
      setRefreshing(false);
    }
  }, [bookId, refresh]);

  // 分类选项:按类型过滤(转账用 transfer 字典,缺失时回退为全部)
  const catOptions = useMemo(() => {
    const want = type === 'EXPENSE' ? 'EXPENSE' : type === 'INCOME' ? 'INCOME' : 'TRANSFER';
    let list = allCategories.filter((c) => c.type === want);
    if (list.length === 0) list = allCategories;
    return list.map((c) => ({ value: c.code, label: c.label }));
  }, [allCategories, type]);

  const resetForm = () => {
    setName('');
    setType('EXPENSE');
    setAmount('');
    setAccountId(accounts[0]?.id ?? '');
    setToAccountId(accounts[1]?.id ?? '');
    setCategoryCode('');
    setPayer('');
    setRemark('');
    setCron('0 0 * * *');
    setRecType('PERIODIC');
    setLoanTotal('');
    setLoanRate('');
    setLoanMethod('EQUAL_INSTALLMENT');
    setLoanStartDate('');
    setLoanTermMonths('');
    setLoanDay(1);
    setLoanGenerateAll(true);
    setTags(['固定收支']);
    setActive(true);
    setFormError('');
    setLoanPreview(null);
  };

  const openCreate = () => {
    resetForm();
    setEditing(null);
    setSheet(true);
  };

  const openEdit = (t: RecurringTransaction) => {
    setEditing(t);
    setName(t.name ?? '');
    setType(t.type);
    setAmount(t.recurringType !== 'LOAN' && t.amount ? String(t.amount) : '');
    setAccountId(t.accountId);
    setToAccountId(t.toAccountId ?? '');
    setCategoryCode(t.categoryCode ?? '');
    setPayer(t.payer ?? '');
    setRemark(t.remark ?? '');
    setCron(t.cron);
    setRecType(t.recurringType);
    setTags(t.tags?.length ? t.tags : ['固定收支']);
    setActive(t.active);
    if (t.recurringType === 'LOAN') {
      setLoanTotal(t.loanTotalAmount ? String(t.loanTotalAmount) : '');
      setLoanRate(t.loanInterestRate ? String(t.loanInterestRate) : '');
      setLoanMethod(t.loanInterestMethod ?? 'EQUAL_INSTALLMENT');
      setLoanStartDate(t.loanStartDate ? t.loanStartDate.slice(0, 10) : '');
      setLoanTermMonths(t.loanTermMonths ? String(t.loanTermMonths) : '');
      // 从 cron 解析还款日: 0 0 <day> * *
      setLoanDay(parseInt(t.cron.split(' ')[2]) || 1);
    }
    setFormError('');
    setLoanPreview(null);
    setSheet(true);
  };

  // 切换周期/贷款类型时的联动(仅创建模式可切)
  const switchRecType = (t: 'PERIODIC' | 'LOAN') => {
    setRecType(t);
    setLoanPreview(null);
    if (t === 'PERIODIC') {
      setLoanTotal(''); setLoanRate(''); setLoanStartDate(''); setLoanTermMonths('');
      setCron('0 0 * * *');
    } else {
      const d = loanStartDate ? new Date(loanStartDate).getDate() : 1;
      setLoanDay(d);
      setCron(`0 0 ${d} * *`);
    }
  };

  // 每月还款日 -> cron
  const applyLoanDay = (raw: number) => {
    const d = Math.min(28, Math.max(1, Math.round(raw) || 1));
    setLoanDay(d);
    setCron(`0 0 ${d} * *`);
  };

  // 手动计算预览
  const handleLoanPreview = async () => {
    const total = parseFloat(loanTotal);
    const rate = parseFloat(loanRate);
    const months = parseInt(loanTermMonths);
    if (!total || !months || !loanStartDate) return;
    setPreviewLoading(true);
    try {
      const preview = await loanPreviewApi({ total, annualRate: rate || 0, months, startDate: new Date(loanStartDate).toISOString(), method: loanMethod });
      setLoanPreview(preview);
    } catch (e) {
      setFormError(e instanceof Error ? e.message : '贷款预览失败');
    } finally {
      setPreviewLoading(false);
    }
  };

  // 创建模式下字段变化自动触发预览(debounce 500ms)
  const previewTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (recType !== 'LOAN' || editing) return;
    const total = parseFloat(loanTotal);
    const months = parseInt(loanTermMonths);
    if (!total || !months || !loanStartDate || total <= 0 || months <= 0) {
      setLoanPreview(null);
      return;
    }
    if (previewTimer.current) clearTimeout(previewTimer.current);
    previewTimer.current = setTimeout(handleLoanPreview, 500);
    return () => {
      if (previewTimer.current) clearTimeout(previewTimer.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loanTotal, loanRate, loanTermMonths, loanStartDate, loanMethod, recType, editing]);

  // 标签变更:「固定收支」为保护标签,始终保留在首位
  const changeTags = (next: string[]) => setTags(next.includes('固定收支') ? next : ['固定收支', ...next]);

  const toggle = async (t: RecurringTransaction) => {
    await toggleRecurringApi(t.id, !t.active);
    reload();
  };

  const remove = (t: RecurringTransaction) => {
    // 先关表单,再弹确认(避免叠加)
    setSheet(false);
    Alert.alert('删除固定收支', `确定要删除「${t.name}」吗？已生成的流水不会被删除。`, [
      { text: '取消', style: 'cancel' },
      {
        text: '删除', style: 'destructive',
        onPress: async () => {
          await deleteRecurringApi(t.id);
          setEditing(null);
          reload();
        },
      },
    ]);
  };

  const openPlan = (t: RecurringTransaction) => {
    setPlans([]);
    setPlanTarget(t);
    fetchRepaymentPlanApi(t.id).then(setPlans).catch(() => {});
  };

  const save = async () => {
    setFormError('');
    if (!name.trim()) { setFormError('请输入名称'); return; }
    if (!accountId) { setFormError('请选择账户'); return; }
    if (type === 'TRANSFER' && !toAccountId) { setFormError('请选择目标账户'); return; }
    if (!cron) { setFormError('请设置触发时间'); return; }
    const isLoan = recType === 'LOAN';
    const amt = parseFloat(amount);
    if (!isLoan && (!amt || amt <= 0)) { setFormError('请输入有效金额'); return; }

    setSaving(true);
    try {
      const baseData = {
        name: name.trim(),
        type,
        amount: isLoan ? 0 : amt,
        remark: remark || undefined,
        tags,
        accountId,
        toAccountId: type === 'TRANSFER' ? toAccountId : undefined,
        categoryCode: categoryCode || undefined,
        payer: payer || undefined,
        cron,
        recurringType: recType,
      };
      if (isLoan) {
        const lTotal = parseFloat(loanTotal);
        const lRate = parseFloat(loanRate);
        const lTerm = parseInt(loanTermMonths);
        if (!lTotal || !lTerm || !loanStartDate) { setFormError('请填写完整的贷款信息'); setSaving(false); return; }
        if (editing) {
          // 编辑模式:不更新 amount(贷款金额由系统计算)
          const { amount: _a, ...updateData } = baseData;
          await updateRecurringApi(editing.id, { ...updateData, active });
        } else {
          await createRecurringApi(bookId, {
            ...baseData,
            loanTotalAmount: lTotal,
            loanInterestRate: lRate || 0,
            loanInterestMethod: loanMethod,
            loanStartDate: new Date(loanStartDate).toISOString(),
            loanTermMonths: lTerm,
            generateAll: loanGenerateAll,
          });
        }
      } else if (editing) {
        await updateRecurringApi(editing.id, { ...baseData, active });
      } else {
        await createRecurringApi(bookId, baseData);
      }
      setSheet(false);
      setEditing(null);
      resetForm();
      reload();
    } catch (e) {
      setFormError(e instanceof Error ? e.message : '保存失败');
    } finally {
      setSaving(false);
    }
  };

  const opBtn = {
    flexDirection: 'row' as const, alignItems: 'center' as const, gap: 4,
    paddingHorizontal: 10, paddingVertical: 5, borderRadius: 8, backgroundColor: colors.muted,
  };
  const inputStyle = {
    backgroundColor: colors.elevated, borderWidth: 1, borderColor: colors.border, borderRadius: 14,
    paddingHorizontal: 14, paddingVertical: 11, color: colors.foreground, fontSize: 15,
  };
  const fieldLabel = (t: string) => <Text style={{ fontSize: 12, color: colors.mutedForeground, marginBottom: 6, marginTop: 12 }}>{t}</Text>;
  // 分段控件(仿网页 inline-flex 按钮)
  const seg = (opts: { key: string; label: string; hintColor?: string }[], cur: string, onPress: (k: string) => void) => (
    <View style={{ flexDirection: 'row', backgroundColor: colors.muted, borderRadius: 10, padding: 3 }}>
      {opts.map((o, i) => {
        const sel = o.key === cur;
        return (
          <Pressable key={o.key} onPress={() => onPress(o.key)} style={[{ flex: 1, paddingVertical: 7, alignItems: 'center', borderRadius: 8 }, i > 0 && { marginLeft: 2 }, { backgroundColor: sel ? colors.card : 'transparent' }]}>
            <Text style={{ fontSize: 13, fontWeight: sel ? '700' : '500', color: sel ? o.hintColor ?? colors.foreground : colors.mutedForeground }}>{o.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );

  const isLoanCreate = recType === 'LOAN' && !editing;

  // 还款计划行(期次/到期日/月供/本金/利息/剩余)—— 兼容预览与已生成计划两种数据
  const planRow = (p: Pick<RepaymentPlan, 'period' | 'dueDate' | 'totalPayment' | 'principal' | 'interest' | 'remainingPrincipal'>) => (
    <View key={`${p.period}-${p.dueDate}`} style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 6, borderBottomWidth: 1, borderBottomColor: colors.hairline }}>
      <Text style={{ width: 34, fontSize: 11, color: colors.foreground }}>#{p.period}</Text>
      <Text style={{ width: 72, fontSize: 11, color: colors.mutedForeground }}>{p.dueDate.slice(0, 10)}</Text>
      <Text style={{ width: 58, fontSize: 11, color: colors.foreground, textAlign: 'right' }}>{formatMoneyShort(p.totalPayment)}</Text>
      <Text style={{ width: 52, fontSize: 11, color: colors.primary, textAlign: 'right' }}>{formatMoneyShort(p.principal)}</Text>
      <Text style={{ width: 52, fontSize: 11, color: colors.expense, textAlign: 'right' }}>{formatMoneyShort(p.interest)}</Text>
      <Text style={{ flex: 1, fontSize: 11, color: colors.mutedForeground, textAlign: 'right' }}>{formatMoneyShort(p.remainingPrincipal)}</Text>
    </View>
  );

  return (
    <Screen>
      <View style={{ flex: 1, paddingHorizontal: 20, paddingTop: 8 }}>
        {/* 标题栏 */}
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
          <Text style={{ fontSize: 20, fontWeight: '700' }}>固定收支</Text>
          <Pressable onPress={openCreate} style={{ width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center', backgroundColor: alpha(colors.primary, 0.12) }}>
            <Plus size={18} color={colors.primary} />
          </Pressable>
        </View>

        <ScrollView contentContainerStyle={{ paddingBottom: 40 }} showsVerticalScrollIndicator={false} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} colors={[colors.primary]} />}>
          {items.length === 0 ? (
            <Card className="items-center py-12">
              <Text style={{ fontSize: 30, marginBottom: 6 }}>🔁</Text>
              <Text variant="muted">暂无固定收支</Text>
            </Card>
          ) : (
            items.map((t, i) => {
              const Icon = TYPE_ICON[t.type];
              const color = colors[TYPE_COLOR[t.type]];
              return (
                <FadeInView key={t.id} index={i}>
                  <Card className="px-5 py-4 mb-3" onPress={() => openEdit(t)}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
                      <View style={{ width: 44, height: 44, borderRadius: 14, alignItems: 'center', justifyContent: 'center', backgroundColor: alpha(color, 0.12) }}>
                        <Icon size={20} color={color} />
                      </View>
                      <View style={{ flex: 1 }}>
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                          <Text style={{ fontSize: 15, fontWeight: '600' }}>{t.name}</Text>
                          <View style={{ paddingHorizontal: 7, paddingVertical: 2, borderRadius: 6, backgroundColor: alpha(color, 0.12) }}>
                            <Text style={{ fontSize: 10, color, fontWeight: '600' }}>{TYPE_LABEL[t.type]}</Text>
                          </View>
                          <Text variant="muted" style={{ fontSize: 10 }}>{REC_TYPE_LABELS[t.recurringType]}</Text>
                        </View>
                        <Text variant="muted" style={{ fontSize: 12, marginTop: 2 }} numberOfLines={1}>
                          {t.type === 'TRANSFER'
                            ? `${t.accountName || '-'} → ${t.toAccountName || '-'}`
                            : `${t.categoryCode || '未分类'} · ${t.accountName || '-'}`}
                        </Text>
                        <Text variant="muted" style={{ fontSize: 11, marginTop: 1 }} numberOfLines={1}>
                          {t.cron}{t.nextGenerateAt ? ` · 下次 ${fmtDateTime(t.nextGenerateAt)}` : ''}
                        </Text>
                      </View>
                      {t.recurringType !== 'LOAN' && (
                        <Text style={{ fontSize: 16, fontWeight: '700', fontVariant: ['tabular-nums'], color }} numberOfLines={1}>
                          {t.type === 'INCOME' ? '+' : '-'}{formatMoney(t.amount)}
                        </Text>
                      )}
                    </View>
                    {t.recurringType === 'LOAN' && !!t.loanTotalAmount && (
                      <Text variant="muted" style={{ fontSize: 11, marginTop: 8 }}>
                        总额 {formatMoney(t.loanTotalAmount)} · 剩余 {formatMoney(t.loanRemainingAmount ?? 0)} · {t.loanTermMonths}期 · 利率{t.loanInterestRate ?? 0}%
                      </Text>
                    )}
                    <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 10 }}>
                      <Switch value={t.active} onValueChange={() => toggle(t)} trackColor={{ true: colors.primary }} thumbColor="#fff" />
                      <Text style={{ fontSize: 12, marginLeft: 6, color: t.active ? colors.primary : colors.mutedForeground, fontWeight: '500' }}>{t.active ? '已启用' : '已停用'}</Text>
                      <View style={{ flex: 1 }} />
                      {t.recurringType === 'LOAN' && (
                        <Pressable onPress={() => openPlan(t)} style={opBtn}>
                          <FileText size={13} color={colors.foreground} />
                          <Text style={{ fontSize: 12, color: colors.foreground }}>还款计划</Text>
                        </Pressable>
                      )}
                      <Pressable onPress={() => openEdit(t)} style={[opBtn, { marginLeft: 6 }]}>
                        <Pencil size={13} color={colors.foreground} />
                        <Text style={{ fontSize: 12, color: colors.foreground }}>编辑</Text>
                      </Pressable>
                      <Pressable onPress={() => remove(t)} style={[opBtn, { marginLeft: 6 }]}>
                        <Trash2 size={13} color={colors.expense} />
                        <Text style={{ fontSize: 12, color: colors.expense }}>删除</Text>
                      </Pressable>
                    </View>
                  </Card>
                </FadeInView>
              );
            })
          )}
        </ScrollView>
      </View>

      {/* 新增/编辑 */}
      <FormSheet visible={sheet} title={editing ? '编辑固定收支' : '新增固定收支'} onClose={() => { setSheet(false); setEditing(null); }} onSave={save} saveLabel={editing ? '保存' : '创建'} saveLoading={saving}>
        <ScrollView keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false} style={{ maxHeight: 520 }}>
          {/* 固定收支类型(仅创建可选) */}
          {!editing ? (
            <>
              {fieldLabel('固定收支类型')}
              {seg([{ key: 'PERIODIC', label: '周期' }, { key: 'LOAN', label: '贷款' }], recType, (k) => switchRecType(k as 'PERIODIC' | 'LOAN'))}
            </>
          ) : (
            <Text variant="muted" style={{ fontSize: 12, marginTop: 4 }}>类型:{REC_TYPE_LABELS[recType]}{recType === 'LOAN' ? '(金额由系统按期生成)' : ''}</Text>
          )}

          {fieldLabel('名称')}
          <TextInput value={name} onChangeText={(v) => { setName(v); setFormError(''); }} placeholder="如 每月房租" placeholderTextColor={colors.mutedForeground} style={inputStyle} />

          {/* 启用开关(编辑模式) */}
          {editing && (
            <>
              {fieldLabel('启用状态')}
              {seg([
                { key: 'on', label: '启用', hintColor: colors.income },
                { key: 'off', label: '停用', hintColor: colors.mutedForeground },
              ], active ? 'on' : 'off', (k) => setActive(k === 'on'))}
            </>
          )}

          {/* 类型 + 金额(贷款隐藏金额区块) */}
          {recType !== 'LOAN' && (
            <>
              {fieldLabel('类型')}
              {seg(TYPE_KEYS.map((tk) => ({ key: tk, label: TYPE_LABEL[tk], hintColor: colors[TYPE_COLOR[tk]] })), type, (k) => { setType(k as RecordType); setCategoryCode(''); })}

              {fieldLabel('金额')}
              <TextInput value={amount} onChangeText={(v) => { setAmount(v); setFormError(''); }} placeholder="0.00" placeholderTextColor={colors.mutedForeground} keyboardType="decimal-pad" style={inputStyle} />
            </>
          )}

          {/* 账户 */}
          {fieldLabel(type === 'TRANSFER' ? '源账户' : '账户')}
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            {accounts.map((a: AccountItem) => {
              const selected = accountId === a.id;
              return (
                <Pressable key={a.id} onPress={() => setAccountId(a.id)} style={{ paddingHorizontal: 12, paddingVertical: 6, borderRadius: 999, borderWidth: 1, borderColor: selected ? colors.primary : colors.border, backgroundColor: selected ? alpha(colors.primary, 0.1) : colors.muted }}>
                  <Text style={{ fontSize: 12, color: selected ? colors.primary : colors.mutedForeground, fontWeight: selected ? '600' : '400' }}>{a.name}</Text>
                </Pressable>
              );
            })}
          </View>

          {/* 目标账户(转账) */}
          {type === 'TRANSFER' && (
            <>
              {fieldLabel('目标账户')}
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                {accounts.filter((a) => a.id !== accountId).map((a) => {
                  const selected = toAccountId === a.id;
                  return (
                    <Pressable key={a.id} onPress={() => setToAccountId(a.id)} style={{ paddingHorizontal: 12, paddingVertical: 6, borderRadius: 999, borderWidth: 1, borderColor: selected ? colors.primary : colors.border, backgroundColor: selected ? alpha(colors.primary, 0.1) : colors.muted }}>
                      <Text style={{ fontSize: 12, color: selected ? colors.primary : colors.mutedForeground, fontWeight: selected ? '600' : '400' }}>{a.name}</Text>
                    </Pressable>
                  );
                })}
              </View>
            </>
          )}

          {/* 分类 */}
          {fieldLabel('分类')}
          <ChipSelect value={categoryCode} onChange={setCategoryCode} options={catOptions} />

          {/* 交易方 */}
          {fieldLabel('交易方')}
          <TextInput value={payer} onChangeText={setPayer} placeholder="选填" placeholderTextColor={colors.mutedForeground} style={inputStyle} />

          {/* 备注 */}
          {fieldLabel('备注')}
          <TextInput value={remark} onChangeText={setRemark} placeholder="添加备注..." placeholderTextColor={colors.mutedForeground} multiline style={[inputStyle, { minHeight: 60, textAlignVertical: 'top' }]} />

          {/* 标签 */}
          {fieldLabel('标签')}
          <TagPicker value={tags} onChange={changeTags} suggestions={tagSuggestions} />

          {/* 贷款字段(仅创建) */}
          {isLoanCreate && (
            <>
              <View style={{ flexDirection: 'row', marginTop: 4, gap: 10 }}>
                <View style={{ flex: 1 }}>
                  {fieldLabel('贷款总额')}
                  <TextInput value={loanTotal} onChangeText={(v) => { setLoanTotal(v); setLoanPreview(null); }} keyboardType="decimal-pad" placeholderTextColor={colors.mutedForeground} style={inputStyle} />
                </View>
                <View style={{ flex: 1 }}>
                  {fieldLabel('年利率(%)')}
                  <TextInput value={loanRate} onChangeText={(v) => { setLoanRate(v); setLoanPreview(null); }} keyboardType="decimal-pad" placeholderTextColor={colors.mutedForeground} style={inputStyle} />
                </View>
              </View>

              <View style={{ flexDirection: 'row', marginTop: 4, gap: 10 }}>
                <View style={{ flex: 1 }}>
                  {fieldLabel('计息方式')}
                  <ChipSelect
                    value={loanMethod}
                    onChange={(v) => { setLoanMethod(v as LoanInterestMethod); setLoanPreview(null); }}
                    options={[
                      { value: 'EQUAL_INSTALLMENT', label: '等额本息' },
                      { value: 'EQUAL_PRINCIPAL', label: '等额本金' },
                    ]}
                  />
                </View>
                <View style={{ flex: 1 }}>
                  {fieldLabel('还款期数(月)')}
                  <TextInput value={loanTermMonths} onChangeText={(v) => { setLoanTermMonths(v.replace(/[^0-9]/g, '')); setLoanPreview(null); }} keyboardType="number-pad" placeholderTextColor={colors.mutedForeground} style={inputStyle} />
                </View>
              </View>

              {fieldLabel('开始日期')}
              <DatePicker
                value={loanStartDate}
                onChange={(v) => {
                  setLoanStartDate(v);
                  setLoanPreview(null);
                  const d = v ? new Date(v).getDate() : 1;
                  setLoanDay(d);
                  setCron(`0 0 ${d} * *`);
                }}
              />

              {/* 生成方式 */}
              {fieldLabel('生成方式')}
              {seg([
                { key: 'all', label: '全部生成' },
                { key: 'pending', label: '只生成未还款' },
              ], loanGenerateAll ? 'all' : 'pending', (k) => { setLoanGenerateAll(k === 'all'); setLoanPreview(null); })}
              <Text variant="muted" style={{ fontSize: 11, marginTop: 6 }}>
                {loanGenerateAll ? '将立即为已到期月份创建流水记录' : '仅从下次还款日开始生成流水'}
              </Text>

              {/* 预览结果 */}
              {(previewLoading || loanPreview) && (
                <View style={{ marginTop: 12 }}>
                  {previewLoading && <Text variant="muted" style={{ fontSize: 12 }}>正在计算还款计划...</Text>}
                  {loanPreview && (
                    <>
                      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
                        <Text style={{ fontSize: 12, color: colors.foreground }}>月还款额: <Text style={{ fontWeight: '700', color: colors.primary }}>{formatMoney(loanPreview.monthlyPayment)}</Text></Text>
                        <Text style={{ fontSize: 12, color: colors.mutedForeground }}>总还款 {formatMoney(loanPreview.totalPayment)}</Text>
                        <Text style={{ fontSize: 12, color: colors.mutedForeground }}>总利息 {formatMoney(loanPreview.totalInterest)}</Text>
                      </View>
                      {loanGenerateAll && (
                        <Text style={{ fontSize: 11, color: colors.primary, marginTop: 4 }}>
                          将立即生成 {loanPreview.plan.filter((p) => new Date(p.dueDate) <= new Date()).length} 期历史流水
                        </Text>
                      )}
                      <ScrollView showsVerticalScrollIndicator={false} style={{ maxHeight: 180, marginTop: 8 }} nestedScrollEnabled keyboardShouldPersistTaps="handled">
                        <View style={{ flexDirection: 'row', paddingVertical: 4, borderBottomWidth: 1, borderBottomColor: colors.hairline }}>
                          <Text style={{ width: 34, fontSize: 10, color: colors.mutedForeground }}>期次</Text>
                          <Text style={{ width: 72, fontSize: 10, color: colors.mutedForeground }}>到期日</Text>
                          <Text style={{ width: 58, fontSize: 10, color: colors.mutedForeground, textAlign: 'right' }}>月供</Text>
                          <Text style={{ width: 52, fontSize: 10, color: colors.mutedForeground, textAlign: 'right' }}>本金</Text>
                          <Text style={{ width: 52, fontSize: 10, color: colors.mutedForeground, textAlign: 'right' }}>利息</Text>
                          <Text style={{ flex: 1, fontSize: 10, color: colors.mutedForeground, textAlign: 'right' }}>剩余</Text>
                        </View>
                        {loanPreview.plan.map(planRow)}
                      </ScrollView>
                    </>
                  )}
                </View>
              )}
            </>
          )}

          {/* 触发时间 */}
          {fieldLabel('触发时间')}
          {recType === 'LOAN' ? (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <Text style={{ fontSize: 14, color: colors.mutedForeground }}>每月</Text>
              <TextInput
                value={String(loanDay)}
                onChangeText={(v) => applyLoanDay(parseInt(v) || 1)}
                keyboardType="number-pad"
                style={[inputStyle, { width: 70, paddingVertical: 8, textAlign: 'center' }]}
              />
              <Text style={{ fontSize: 14, color: colors.mutedForeground }}>号</Text>
            </View>
          ) : (
            <CronBuilder value={cron} onChange={setCron} />
          )}

          {formError ? <Text style={{ fontSize: 13, color: colors.expense, marginTop: 12 }}>{formError}</Text> : null}
        </ScrollView>
      </FormSheet>

      {/* 还款计划查看 */}
      <FormSheet visible={!!planTarget} title={`还款计划 · ${planTarget?.name ?? ''}`} onClose={() => setPlanTarget(null)}>
        {planTarget && (
          <ScrollView showsVerticalScrollIndicator={false} style={{ maxHeight: 420 }}>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginBottom: 10 }}>
              <Text style={{ fontSize: 12, color: colors.mutedForeground }}>总额 <Text style={{ fontWeight: '600', color: colors.foreground }}>{formatMoney(planTarget.loanTotalAmount ?? 0)}</Text></Text>
              <Text style={{ fontSize: 12, color: colors.mutedForeground }}>剩余 <Text style={{ fontWeight: '600', color: colors.foreground }}>{formatMoney(planTarget.loanRemainingAmount ?? 0)}</Text></Text>
              <Text style={{ fontSize: 12, color: colors.mutedForeground }}>方式 <Text style={{ fontWeight: '600', color: colors.foreground }}>{METHOD_LABELS[planTarget.loanInterestMethod ?? ''] ?? '-'}</Text></Text>
              <Text style={{ fontSize: 12, color: colors.mutedForeground }}>利率 <Text style={{ fontWeight: '600', color: colors.foreground }}>{planTarget.loanInterestRate ?? 0}%</Text></Text>
            </View>
            {plans.length === 0 ? (
              <Text variant="muted" style={{ textAlign: 'center', paddingVertical: 24, fontSize: 13 }}>暂无还款计划</Text>
            ) : (
              <>
                <View style={{ flexDirection: 'row', paddingVertical: 4, borderBottomWidth: 1, borderBottomColor: colors.hairline }}>
                  <Text style={{ width: 34, fontSize: 10, color: colors.mutedForeground }}>期次</Text>
                  <Text style={{ width: 72, fontSize: 10, color: colors.mutedForeground }}>到期日</Text>
                  <Text style={{ width: 58, fontSize: 10, color: colors.mutedForeground, textAlign: 'right' }}>月供</Text>
                  <Text style={{ width: 52, fontSize: 10, color: colors.mutedForeground, textAlign: 'right' }}>本金</Text>
                  <Text style={{ width: 52, fontSize: 10, color: colors.mutedForeground, textAlign: 'right' }}>利息</Text>
                  <Text style={{ flex: 1, fontSize: 10, color: colors.mutedForeground, textAlign: 'right' }}>剩余</Text>
                </View>
                {plans.map(planRow)}
              </>
            )}
          </ScrollView>
        )}
      </FormSheet>
    </Screen>
  );
}

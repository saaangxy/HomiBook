import { useState, useCallback, useMemo, useEffect } from 'react';
import { RefreshControl, ScrollView, View, Pressable, Alert, TextInput } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Plus, Pencil, Trash2, Search, X } from 'lucide-react-native';
import { useTheme, alpha } from '@/theme';
import { Text } from '@/components/ui/Text';
import { EmptyState } from '@/components/ui/EmptyState';
import { ChipSelect } from '@/components/ui/ChipSelect';
import { DatePicker } from '@/components/ui/DatePicker';
import { TagPicker } from '@/components/ui/TagPicker';
import { FormSheet } from '@/components/chrome/FormSheet';
import { useUIShell } from '@/components/chrome/chrome';
import { useRecords } from '@/stores/records';
import {
  fetchBudgets, fetchBudgetTags, createBudgetApi, updateBudgetApi,
  deleteBudgetApi, batchCreateBudgetApi, copyBudgetApi,
} from '@/services/records';
import type { BudgetItem, BudgetType } from '@/types';

const MONTHS = Array.from({ length: 12 }, (_, i) => i + 1);
const BUDGET_TYPES: { key: BudgetType | 'ALL'; label: string }[] = [
  { key: 'ALL', label: '全部' },
  { key: 'FIXED', label: '固定' },
  { key: 'FREE', label: '自由' },
];

// 预算管理页:对齐网页端完整新增/编辑 —— 固定/自由两种类型、批量添加、复制到多月份
export default function BudgetPage() {
  const { colors } = useTheme();
  const { currentLedger } = useUIShell();
  const bookId = currentLedger.id;
  // 分类复用 records store(关联分类取 支出+收入 两字典,对齐网页端)
  const { categories: allCategories } = useRecords();
  const now = new Date();
  const [budgets, setBudgets] = useState<BudgetItem[]>([]);
  const [tagSuggestions, setTagSuggestions] = useState<string[]>([]);
  const [typeFilter, setTypeFilter] = useState<BudgetType | 'ALL'>('ALL');
  const [search, setSearch] = useState('');
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);

  // ── 新建/编辑 ──
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<BudgetItem | null>(null);
  const [formName, setFormName] = useState('');
  const [formType, setFormType] = useState<BudgetType>('FIXED');
  const [formAmount, setFormAmount] = useState('');
  const [formCategory, setFormCategory] = useState('');
  const [formMonth, setFormMonth] = useState(now.getMonth() + 1);
  const [formTags, setFormTags] = useState<string[]>([]);
  const [formStartDate, setFormStartDate] = useState('');
  const [formEndDate, setFormEndDate] = useState('');
  const [formRemark, setFormRemark] = useState('');
  const [formError, setFormError] = useState('');
  const [formSaving, setFormSaving] = useState(false);

  // ── 批量添加 ──
  const [batchOpen, setBatchOpen] = useState(false);
  const [batchName, setBatchName] = useState('');
  const [batchType, setBatchType] = useState<BudgetType>('FIXED');
  const [batchAmount, setBatchAmount] = useState('');
  const [batchCategory, setBatchCategory] = useState('');
  const [batchTags, setBatchTags] = useState<string[]>([]);
  const [batchStartDate, setBatchStartDate] = useState('');
  const [batchEndDate, setBatchEndDate] = useState('');
  const [batchMonths, setBatchMonths] = useState<number[]>([]);
  const [batchYear, setBatchYear] = useState(now.getFullYear());
  const [batchRemark, setBatchRemark] = useState('');
  const [batchSaving, setBatchSaving] = useState(false);

  // ── 复制预算 ──
  const [copyOpen, setCopyOpen] = useState(false);
  const [copySourceYear, setCopySourceYear] = useState(now.getFullYear());
  const [copySourceMonth, setCopySourceMonth] = useState(now.getMonth() + 1);
  const [copyTargetYear, setCopyTargetYear] = useState(now.getFullYear());
  const [copyTargets, setCopyTargets] = useState<Array<{ year: number; month: number }>>([]);
  const [copySaving, setCopySaving] = useState(false);

  useEffect(() => {
    if (!bookId) return;
    fetchBudgets(bookId).then(setBudgets);
  }, [bookId]);

  // 标签建议(预算标签,与网页端 getTags 一致)
  useEffect(() => {
    if (!bookId) return;
    fetchBudgetTags(bookId).then(setTagSuggestions).catch(() => {});
  }, [bookId]);

  const reload = useCallback(() => {
    if (bookId) fetchBudgets(bookId).then(setBudgets);
  }, [bookId]);

  const [refreshing, setRefreshing] = useState(false);
  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await Promise.all([fetchBudgets(bookId).then(setBudgets), fetchBudgetTags(bookId).then(setTagSuggestions)]);
    } finally {
      setRefreshing(false);
    }
  }, [bookId]);

  // ── 筛选(自由预算不受月份筛选影响) ──
  const filtered = useMemo(() => {
    return budgets.filter((b) => {
      if (typeFilter !== 'ALL' && b.type !== typeFilter) return false;
      if (search && !b.name.includes(search)) return false;
      if (b.year !== year) return false;
      if (b.month !== null && b.month !== month) return false;
      return true;
    });
  }, [budgets, typeFilter, search, year, month]);

  // ── 统计 ──
  const totalBudget = useMemo(() => filtered.reduce((s, b) => s + b.amount, 0), [filtered]);
  const totalActual = useMemo(() => filtered.reduce((s, b) => s + b.actualAmount, 0), [filtered]);
  const overCount = useMemo(() => filtered.filter((b) => b.actualAmount > b.amount).length, [filtered]);

  const resetForm = useCallback(() => {
    setFormName(''); setFormType('FIXED'); setFormAmount(''); setFormCategory('');
    setFormMonth(month); setFormTags([]); setFormStartDate(''); setFormEndDate(''); setFormRemark(''); setFormError('');
  }, [month]);

  // ── 新建/编辑保存(对齐网页端 handleSave 校验与载荷) ──
  const handleSave = async () => {
    if (!formName.trim()) { setFormError('请输入预算名称'); return; }
    if (!formAmount || Number(formAmount) <= 0) { setFormError('请输入有效金额'); return; }
    if (formType === 'FIXED' && !formCategory) { setFormError('请选择分类'); return; }
    setFormSaving(true);
    try {
      if (editing) {
        await updateBudgetApi(editing.id, {
          name: formName.trim(),
          amount: Number(formAmount),
          categoryCode: formType === 'FIXED' ? formCategory : null,
          tags: formTags,
          startDate: formType === 'FREE' ? (formStartDate ? formStartDate.slice(0, 10) : null) : null,
          endDate: formType === 'FREE' ? (formEndDate ? formEndDate.slice(0, 10) : null) : null,
          remark: formRemark || null,
        });
      } else {
        await createBudgetApi(bookId, {
          name: formName.trim(),
          type: formType,
          year,
          month: formType === 'FREE' ? 0 : formMonth,
          amount: Number(formAmount),
          categoryCode: formType === 'FIXED' ? formCategory : undefined,
          tags: formTags.length > 0 ? formTags : undefined,
          startDate: formType === 'FREE' ? (formStartDate ? formStartDate.slice(0, 10) : undefined) : undefined,
          endDate: formType === 'FREE' ? (formEndDate ? formEndDate.slice(0, 10) : undefined) : undefined,
          remark: formRemark || undefined,
        });
      }
      setCreating(false);
      setEditing(null);
      resetForm();
      reload();
    } catch (e) {
      setFormError(e instanceof Error ? e.message : '保存失败');
    } finally {
      setFormSaving(false);
    }
  };

  const openEdit = useCallback((b: BudgetItem) => {
    setEditing(b);
    setFormName(b.name);
    setFormType(b.type);
    setFormAmount(String(b.amount));
    setFormCategory(b.categoryCode ?? '');
    setFormMonth(b.month ?? now.getMonth() + 1);
    setFormTags(b.tags ?? []);
    setFormStartDate(b.startDate ? b.startDate.slice(0, 10) : '');
    setFormEndDate(b.endDate ? b.endDate.slice(0, 10) : '');
    setFormRemark(b.remark ?? '');
    setFormError('');
  }, []);

  const handleDelete = useCallback((budget: BudgetItem) => {
    Alert.alert('删除预算', `确定要删除「${budget.name}」吗？此操作不可撤销。`, [
      { text: '取消', style: 'cancel' },
      {
        text: '删除', style: 'destructive', onPress: async () => {
          await deleteBudgetApi(budget.id);
          reload();
        },
      },
    ]);
  }, [reload]);

  // ── 批量添加 ──
  const openBatch = () => {
    setBatchName(''); setBatchType('FIXED'); setBatchAmount(''); setBatchCategory(''); setBatchTags([]);
    setBatchStartDate(''); setBatchEndDate(''); setBatchMonths([]); setBatchYear(year); setBatchRemark('');
    setBatchOpen(true);
  };

  const handleBatchCreate = async () => {
    if (!batchName.trim() || !batchAmount || Number(batchAmount) <= 0) return;
    if (batchType === 'FIXED' && batchMonths.length === 0) return;
    setBatchSaving(true);
    try {
      await batchCreateBudgetApi(bookId, {
        name: batchName.trim(),
        type: batchType,
        amount: Number(batchAmount),
        categoryCode: batchType === 'FIXED' ? batchCategory : undefined,
        tags: batchTags.length > 0 ? batchTags : undefined,
        months: batchType === 'FREE' ? [0] : batchMonths,
        year: batchType === 'FREE' ? now.getFullYear() : batchYear,
        startDate: batchType === 'FREE' ? (batchStartDate ? batchStartDate.slice(0, 10) : undefined) : undefined,
        endDate: batchType === 'FREE' ? (batchEndDate ? batchEndDate.slice(0, 10) : undefined) : undefined,
        remark: batchRemark || undefined,
      });
      setBatchOpen(false);
      reload();
    } finally {
      setBatchSaving(false);
    }
  };

  // ── 复制预算 ──
  const openCopy = () => {
    setCopySourceYear(year);
    setCopySourceMonth(month);
    setCopyTargets([]);
    setCopyTargetYear(year);
    setCopyOpen(true);
  };

  const toggleCopyTarget = (ty: number, tm: number) => {
    setCopyTargets((prev) => {
      const exists = prev.some((t) => t.year === ty && t.month === tm);
      if (exists) return prev.filter((t) => !(t.year === ty && t.month === tm));
      return [...prev, { year: ty, month: tm }];
    });
  };

  const handleCopy = async () => {
    if (copyTargets.length === 0) return;
    setCopySaving(true);
    try {
      await copyBudgetApi(bookId, {
        sourceYear: copySourceYear,
        sourceMonth: copySourceMonth,
        targetMonths: copyTargets,
      });
      setCopyOpen(false);
      reload();
    } finally {
      setCopySaving(false);
    }
  };

  // ── 渲染辅助 ──
  const inputStyle = {
    backgroundColor: colors.elevated, borderWidth: 1, borderColor: colors.border, borderRadius: 12,
    paddingHorizontal: 14, paddingVertical: 11, color: colors.foreground, fontSize: 15,
  };
  const fieldLabel = (t: string) => <Text style={{ fontSize: 12, color: colors.mutedForeground, marginBottom: 6, marginTop: 14 }}>{t}</Text>;
  const seg = (opts: { key: string; label: string }[], cur: string, onPress: (k: string) => void) => (
    <View style={{ flexDirection: 'row', gap: 8 }}>
      {opts.map((o) => {
        const sel = o.key === cur;
        return (
          <Pressable key={o.key} onPress={() => onPress(o.key)} style={{
            flex: 1, paddingVertical: 8, alignItems: 'center', borderRadius: 9,
            backgroundColor: sel ? colors.primary : colors.muted, borderWidth: 1, borderColor: sel ? colors.primary : colors.border,
          }}>
            <Text style={{ fontSize: 13, fontWeight: sel ? '700' : '500', color: sel ? colors.primaryForeground : colors.foreground }}>{o.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
  const yearStepper = (y: number, onChange: (v: number) => void) => (
    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: colors.elevated, borderWidth: 1, borderColor: colors.border, borderRadius: 12, paddingHorizontal: 6, paddingVertical: 5 }}>
      <Pressable onPress={() => onChange(y - 1)} style={{ width: 30, height: 30, alignItems: 'center', justifyContent: 'center', borderRadius: 8, backgroundColor: colors.muted }}>
        <Text style={{ fontSize: 16, color: colors.foreground }}>‹</Text>
      </Pressable>
      <Text style={{ fontSize: 15, fontWeight: '600', color: colors.foreground }}>{y}</Text>
      <Pressable onPress={() => onChange(y + 1)} style={{ width: 30, height: 30, alignItems: 'center', justifyContent: 'center', borderRadius: 8, backgroundColor: colors.muted }}>
        <Text style={{ fontSize: 16, color: colors.foreground }}>›</Text>
      </Pressable>
    </View>
  );
  const monthMultiGrid = (selected: number[], onToggle: (m: number) => void) => (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
      {MONTHS.map((m) => {
        const sel = selected.includes(m);
        return (
          <Pressable key={m} onPress={() => onToggle(m)} style={{ width: '25%', padding: 4 }}>
            <View style={{ height: 38, borderRadius: 10, alignItems: 'center', justifyContent: 'center', backgroundColor: sel ? colors.primary : colors.muted, borderWidth: 1, borderColor: sel ? colors.primary : colors.border }}>
              <Text style={{ fontSize: 13, fontWeight: sel ? '700' : '400', color: sel ? colors.primaryForeground : colors.foreground }}>{m}月</Text>
            </View>
          </Pressable>
        );
      })}
    </View>
  );
  const freeDateFields = (start: string, end: string, onStart: (v: string) => void, onEnd: (v: string) => void) => (
    <>
      {fieldLabel('统计起始日期(可选)')}
      <DatePicker value={start} onChange={onStart} />
      {fieldLabel('统计结束日期(可选)')}
      <DatePicker value={end} onChange={onEnd} />
    </>
  );

  // 分类选项:支出 + 收入(对齐网页端 DictCombobox groups)
  const allCatOptions = useMemo(
    () => allCategories.filter((c) => c.type !== 'TRANSFER').map((c) => ({ value: c.code, label: c.label })),
    [allCategories],
  );

  const renderFormSheet = () => (
    <ScrollView keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false} style={{ maxHeight: 520 }}>
      {fieldLabel('类型')}
      {editing ? (
        <Text style={{ fontSize: 14, color: colors.foreground }}>{formType === 'FIXED' ? '固定预算(每月固定支出)' : '自由预算(临时项目预算)'}</Text>
      ) : (
        seg([
          { key: 'FIXED', label: '固定预算' },
          { key: 'FREE', label: '自由预算' },
        ], formType, (k) => setFormType(k as BudgetType))
      )}

      {fieldLabel('名称')}
      <TextInput value={formName} onChangeText={(v) => { setFormName(v); setFormError(''); }} placeholder="如 房租、饮食、三亚旅游" placeholderTextColor={colors.mutedForeground} style={inputStyle} />

      {fieldLabel('金额')}
      <TextInput value={formAmount} onChangeText={(v) => { setFormAmount(v); setFormError(''); }} placeholder="预算金额" keyboardType="decimal-pad" placeholderTextColor={colors.mutedForeground} style={inputStyle} />

      {formType === 'FIXED' ? (
        <>
          {fieldLabel('关联分类')}
          <ChipSelect value={formCategory} onChange={setFormCategory} options={allCatOptions} />
        </>
      ) : (
        <>
          {fieldLabel('关联标签(多标签为或关系)')}
          <TagPicker value={formTags} onChange={setFormTags} suggestions={tagSuggestions} />
          {freeDateFields(formStartDate, formEndDate, setFormStartDate, setFormEndDate)}
        </>
      )}

      {formType === 'FIXED' && (
        <>
          {fieldLabel('月份')}
          {editing ? (
            <Text style={{ fontSize: 14, color: colors.foreground }}>{editing.month}月</Text>
          ) : (
            <ChipSelect value={String(formMonth)} onChange={(v) => setFormMonth(Number(v))} options={MONTHS.map((m) => ({ value: String(m), label: `${m}月` }))} />
          )}
        </>
      )}

      {fieldLabel('备注(可选)')}
      <TextInput value={formRemark} onChangeText={setFormRemark} placeholder="备注" placeholderTextColor={colors.mutedForeground} style={inputStyle} />

      {formError ? <Text style={{ fontSize: 13, color: colors.expense, marginTop: 12 }}>{formError}</Text> : null}
    </ScrollView>
  );

  const renderBudgetCard = (b: BudgetItem) => {
    const pct = b.amount > 0 ? (b.actualAmount / b.amount) * 100 : 0;
    const barW = Math.min(pct, 100);
    const over = b.actualAmount > b.amount;
    // 颜色阈值对齐网页端 UsageBar:>100 红、>80 主题色、>60 黄、其余绿
    let barColor = '#22c55e';
    if (pct > 100) barColor = colors.destructive;
    else if (pct > 80) barColor = colors.primary;
    else if (pct > 60) barColor = '#eab308';
    const remaining = b.amount - b.actualAmount;
    return (
      <View key={b.id} style={{
        backgroundColor: colors.card, borderRadius: 14, padding: 14,
        borderWidth: 1, borderColor: colors.border, gap: 10,
      }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
          <View style={{
            paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6,
            backgroundColor: b.type === 'FIXED' ? alpha(colors.primary, 0.12) : alpha('#22c55e', 0.12),
          }}>
            <Text style={{ fontSize: 11, fontWeight: '600', color: b.type === 'FIXED' ? colors.primary : '#22c55e' }}>
              {b.type === 'FIXED' ? '固定' : '自由'}
            </Text>
          </View>
          <Text style={{ flex: 1, fontSize: 15, fontWeight: '600', color: colors.foreground }} numberOfLines={1}>{b.name}</Text>
          <Text style={{ fontSize: 12, color: colors.mutedForeground }}>{b.month ? `${b.month}月` : '自由区间'}</Text>
          <Text style={{ fontSize: 14, fontWeight: '700', fontVariant: ['tabular-nums'], color: colors.foreground }}>¥{b.amount.toLocaleString()}</Text>
        </View>
        {/* FREE:标签 + 统计区间 */}
        {b.type === 'FREE' && ((b.tags?.length ?? 0) > 0 || b.startDate || b.endDate) && (
          <View style={{ gap: 4 }}>
            {(b.tags?.length ?? 0) > 0 && (
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 4 }}>
                {b.tags.map((t) => (
                  <View key={t} style={{ paddingHorizontal: 7, paddingVertical: 2, borderRadius: 999, backgroundColor: colors.muted }}>
                    <Text style={{ fontSize: 10, color: colors.foreground }}>{t}</Text>
                  </View>
                ))}
              </View>
            )}
            {(b.startDate || b.endDate) && (
              <Text variant="muted" style={{ fontSize: 11 }}>
                {b.startDate ? b.startDate.slice(0, 10) : '...'} ~ {b.endDate ? b.endDate.slice(0, 10) : '...'}
              </Text>
            )}
          </View>
        )}
        {/* 进度条 */}
        <View style={{ gap: 4 }}>
          <View style={{ height: 8, borderRadius: 4, backgroundColor: colors.muted, overflow: 'hidden' }}>
            <View style={{ height: '100%', width: `${barW}%`, borderRadius: 4, backgroundColor: barColor }} />
          </View>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
            <Text style={{ fontSize: 12, color: colors.mutedForeground, fontVariant: ['tabular-nums'] }}>
              ¥{b.actualAmount.toLocaleString()} / ¥{b.amount.toLocaleString()}({pct.toFixed(0)}%)
            </Text>
            <Text style={{ fontSize: 12, fontWeight: '600', fontVariant: ['tabular-nums'], color: remaining < 0 ? colors.destructive : colors.mutedForeground }}>
              {remaining < 0 ? `超支 ¥${Math.abs(remaining).toLocaleString()}` : `剩余 ¥${remaining.toLocaleString()}`}
            </Text>
          </View>
        </View>
        {/* 操作 */}
        <View style={{ flexDirection: 'row', gap: 8 }}>
          <Pressable onPress={() => openEdit(b)} style={{
            flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 10, paddingVertical: 5,
            borderRadius: 8, backgroundColor: colors.muted,
          }}>
            <Pencil size={14} color={colors.foreground} />
            <Text style={{ fontSize: 12, color: colors.foreground }}>编辑</Text>
          </Pressable>
          <Pressable onPress={() => handleDelete(b)} style={{
            flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 10, paddingVertical: 5,
            borderRadius: 8, backgroundColor: alpha(colors.destructive, 0.1),
          }}>
            <Trash2 size={14} color={colors.destructive} />
            <Text style={{ fontSize: 12, color: colors.destructive }}>删除</Text>
          </Pressable>
          {b.remark ? (
            <View style={{ flex: 1, justifyContent: 'center' }}>
              <Text variant="muted" style={{ fontSize: 11, textAlign: 'right' }} numberOfLines={1}>{b.remark}</Text>
            </View>
          ) : null}
        </View>
      </View>
    );
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }} edges={['bottom']}>
      <ScrollView contentContainerStyle={{ padding: 16, gap: 12 }} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} colors={[colors.primary]} />}>
        {/* 标题 + 操作 */}
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <Text style={{ flex: 1, fontSize: 20, fontWeight: '700', color: colors.foreground }}>预算管理</Text>
          <Pressable onPress={openCopy} style={{
            flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
            paddingHorizontal: 12, paddingVertical: 9, borderRadius: 10, backgroundColor: colors.muted, borderWidth: 1, borderColor: colors.border,
          }}>
            <Text style={{ color: colors.foreground, fontWeight: '600', fontSize: 13 }}>复制预算</Text>
          </Pressable>
          <Pressable onPress={openBatch} style={{
            flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
            paddingHorizontal: 12, paddingVertical: 9, borderRadius: 10, backgroundColor: colors.muted, borderWidth: 1, borderColor: colors.border,
          }}>
            <Text style={{ color: colors.foreground, fontWeight: '600', fontSize: 13 }}>批量添加</Text>
          </Pressable>
          <Pressable onPress={() => { resetForm(); setCreating(true); setEditing(null); }} style={{
            flexDirection: 'row', alignItems: 'center', gap: 4,
            paddingHorizontal: 12, paddingVertical: 9, borderRadius: 10, backgroundColor: colors.primary,
          }}>
            <Plus size={16} color={colors.primaryForeground} />
            <Text style={{ color: colors.primaryForeground, fontWeight: '600', fontSize: 13 }}>新建</Text>
          </Pressable>
        </View>

        {/* 年月选择 + 搜索 */}
        <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
          <Pressable onPress={() => setYear(y => y - 1)} style={{
            width: 32, height: 36, alignItems: 'center', justifyContent: 'center',
            borderRadius: 8, backgroundColor: colors.muted,
          }}>
            <Text style={{ color: colors.foreground }}>‹</Text>
          </Pressable>
          <Pressable onPress={() => setMonth(m => (m <= 1 ? (setYear(y => y - 1), 12) : m - 1))} style={{
            width: 36, height: 36, alignItems: 'center', justifyContent: 'center',
            borderRadius: 8, backgroundColor: colors.muted,
          }}>
            <Text style={{ color: colors.foreground }}>月‹</Text>
          </Pressable>
          <Text style={{ fontSize: 15, fontWeight: '600', color: colors.foreground, minWidth: 96, textAlign: 'center' }}>
            {year}年{month}月
          </Text>
          <Pressable onPress={() => setMonth(m => (m >= 12 ? (setYear(y => y + 1), 1) : m + 1))} style={{
            width: 36, height: 36, alignItems: 'center', justifyContent: 'center',
            borderRadius: 8, backgroundColor: colors.muted,
          }}>
            <Text style={{ color: colors.foreground }}>月›</Text>
          </Pressable>
          <Pressable onPress={() => setYear(y => y + 1)} style={{
            width: 32, height: 36, alignItems: 'center', justifyContent: 'center',
            borderRadius: 8, backgroundColor: colors.muted,
          }}>
            <Text style={{ color: colors.foreground }}>›</Text>
          </Pressable>
          <View style={{
            flex: 1, flexDirection: 'row', alignItems: 'center', gap: 6,
            paddingHorizontal: 10, height: 36, borderRadius: 8, backgroundColor: colors.muted,
          }}>
            <Search size={16} color={colors.mutedForeground} />
            <TextInput
              placeholder="搜索" value={search} onChangeText={setSearch}
              style={{ flex: 1, fontSize: 14, color: colors.foreground, padding: 0 }}
              placeholderTextColor={colors.mutedForeground}
            />
          </View>
        </View>

        {/* 类型筛选 */}
        <View style={{ flexDirection: 'row', gap: 8 }}>
          {BUDGET_TYPES.map(t => (
            <Pressable key={t.key} onPress={() => setTypeFilter(t.key)} style={{
              paddingHorizontal: 14, paddingVertical: 6, borderRadius: 20,
              backgroundColor: typeFilter === t.key ? colors.primary : colors.muted,
            }}>
              <Text style={{
                fontSize: 13, fontWeight: '500',
                color: typeFilter === t.key ? colors.primaryForeground : colors.foreground,
              }}>{t.label}</Text>
            </Pressable>
          ))}
        </View>

        {/* 汇总 */}
        <View style={{
          flexDirection: 'row', gap: 8, padding: 12, borderRadius: 12,
          backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border,
        }}>
          <View style={{ flex: 1, alignItems: 'center' }}>
            <Text style={{ fontSize: 11, color: colors.mutedForeground }}>总预算</Text>
            <Text style={{ fontSize: 16, fontWeight: '700', color: colors.foreground }}>
              ¥{totalBudget.toLocaleString()}
            </Text>
          </View>
          <View style={{ width: 1, backgroundColor: colors.border }} />
          <View style={{ flex: 1, alignItems: 'center' }}>
            <Text style={{ fontSize: 11, color: colors.mutedForeground }}>已使用</Text>
            <Text style={{ fontSize: 16, fontWeight: '700', color: totalActual > totalBudget ? colors.destructive : colors.foreground }}>
              ¥{totalActual.toLocaleString()}
            </Text>
          </View>
          <View style={{ width: 1, backgroundColor: colors.border }} />
          <View style={{ flex: 1, alignItems: 'center' }}>
            <Text style={{ fontSize: 11, color: colors.mutedForeground }}>超支数</Text>
            <Text style={{ fontSize: 16, fontWeight: '700', color: overCount > 0 ? colors.destructive : colors.foreground }}>
              {overCount}
            </Text>
          </View>
        </View>

        {/* 列表 */}
        {filtered.length === 0 ? (
          <EmptyState icon="" title="暂无预算" description="创建一个预算开始管理支出" />
        ) : filtered.map(b => renderBudgetCard(b))}
      </ScrollView>

      {/* ── 新建/编辑弹出 ── */}
      <FormSheet visible={creating || !!editing} title={editing ? '编辑预算' : '添加预算'} onClose={() => { setCreating(false); setEditing(null); resetForm(); }} onSave={handleSave} saveLabel={editing ? '保存' : '创建'} saveLoading={formSaving}>
        {renderFormSheet()}
      </FormSheet>

      {/* ── 批量添加 ── */}
      <FormSheet visible={batchOpen} title="批量添加预算" onClose={() => setBatchOpen(false)} onSave={handleBatchCreate} saveLabel={batchType === 'FREE' ? '创建' : `生成(${batchMonths.length}个月)`} saveLoading={batchSaving}>
        <ScrollView keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false} style={{ maxHeight: 520 }}>
          {fieldLabel('类型')}
          {seg([{ key: 'FIXED', label: '固定预算' }, { key: 'FREE', label: '自由预算' }], batchType, (k) => setBatchType(k as BudgetType))}

          {fieldLabel('名称')}
          <TextInput value={batchName} onChangeText={setBatchName} placeholder="预算名称" placeholderTextColor={colors.mutedForeground} style={inputStyle} />

          {fieldLabel('金额')}
          <TextInput value={batchAmount} onChangeText={setBatchAmount} keyboardType="decimal-pad" placeholderTextColor={colors.mutedForeground} style={inputStyle} />

          {batchType === 'FIXED' ? (
            <>
              {fieldLabel('关联分类')}
              <ChipSelect value={batchCategory} onChange={setBatchCategory} options={allCatOptions} />
            </>
          ) : (
            <>
              {fieldLabel('关联标签(多标签为或关系)')}
              <TagPicker value={batchTags} onChange={setBatchTags} suggestions={tagSuggestions} />
              {freeDateFields(batchStartDate, batchEndDate, setBatchStartDate, setBatchEndDate)}
            </>
          )}

          {batchType === 'FIXED' && (
            <>
              {fieldLabel('年份')}
              {yearStepper(batchYear, setBatchYear)}
              {fieldLabel('选择月份(可多选)')}
              {monthMultiGrid(batchMonths, (m) => setBatchMonths((prev) => (prev.includes(m) ? prev.filter((x) => x !== m) : [...prev, m].sort())))}
            </>
          )}

          {fieldLabel('备注(可选)')}
          <TextInput value={batchRemark} onChangeText={setBatchRemark} placeholderTextColor={colors.mutedForeground} style={inputStyle} />
        </ScrollView>
      </FormSheet>

      {/* ── 复制预算 ── */}
      <FormSheet visible={copyOpen} title="复制预算" onClose={() => setCopyOpen(false)} onSave={handleCopy} saveLabel={`复制(${copyTargets.length}个目标)`} saveLoading={copySaving}>
        <ScrollView keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false} style={{ maxHeight: 480 }}>
          {fieldLabel('源年份 · 源月份')}
          <View style={{ flexDirection: 'row', gap: 10 }}>
            <View style={{ flex: 1 }}>{yearStepper(copySourceYear, setCopySourceYear)}</View>
            <View style={{ flex: 1 }}>
              <ChipSelect value={String(copySourceMonth)} onChange={(v) => setCopySourceMonth(Number(v))} options={MONTHS.map((m) => ({ value: String(m), label: `${m}月` }))} />
            </View>
          </View>

          {fieldLabel('目标年份')}
          {yearStepper(copyTargetYear, setCopyTargetYear)}

          {fieldLabel('目标月份(可多选)')}
          {monthMultiGrid(
            copyTargets.filter((t) => t.year === copyTargetYear).map((t) => t.month),
            (m) => toggleCopyTarget(copyTargetYear, m),
          )}

          {copyTargets.length > 0 && (
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 12 }}>
              {copyTargets.map((t, i) => (
                <Pressable key={`${t.year}-${t.month}`} onPress={() => toggleCopyTarget(t.year, t.month)} style={{ flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 9, paddingVertical: 4, borderRadius: 999, backgroundColor: alpha(colors.primary, 0.12) }}>
                  <Text style={{ fontSize: 12, color: colors.primary }}>{t.year}/{t.month}月</Text>
                  <X size={12} color={colors.primary} />
                </Pressable>
              ))}
            </View>
          )}
        </ScrollView>
      </FormSheet>
    </SafeAreaView>
  );
}

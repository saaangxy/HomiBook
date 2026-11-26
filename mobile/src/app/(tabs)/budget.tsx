import { useState, useCallback, useMemo, useEffect, useRef } from 'react';
import { RefreshControl, ScrollView, View, Pressable, TextInput, Keyboard, Dimensions } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useIsFocused } from 'expo-router';
import { Calendar, ChevronDown, ChevronUp, Plus, Pencil, Trash2, SlidersHorizontal, X, Info } from 'lucide-react-native';
import { useTheme, alpha, haptics } from '@/theme';
import { Text } from '@/components/ui/Text';
import { EmptyState } from '@/components/ui/EmptyState';
import { LoadingState } from '@/components/ui/LoadingState';
import { ConfirmSheet } from '@/components/chrome/ConfirmSheet';
import { showToast } from '@/components/chrome/Toast';
import { ChipSelect } from '@/components/ui/ChipSelect';
import { DatePicker } from '@/components/ui/DatePicker';
import { TagPicker } from '@/components/ui/TagPicker';
import { FormSheet } from '@/components/chrome/FormSheet';
import { BudgetDetailSheet } from '@/components/budget/BudgetDetailSheet';
import {
  BudgetFilterSheet, countActiveBudgetFilters, emptyBudgetFilters, type BudgetFilters,
} from '@/components/budget/BudgetFilterSheet';
import { useUIShell, usePageRefresh } from '@/components/chrome/chrome';
import { useRecords } from '@/stores/records';
import {
  fetchBudgets, fetchBudgetTags, fetchBudgetMembers, createBudgetApi, updateBudgetApi,
  deleteBudgetApi, batchCreateBudgetApi, copyBudgetApi,
} from '@/services/records';
import type { BudgetItem, BudgetType } from '@/types';
import { BUDGET_DIMENSION_LABELS, BUDGET_TYPE_LABELS } from '@homibook/core';

const MONTHS = Array.from({ length: 12 }, (_, i) => i + 1);

/** 全局查询条件(类型*之外*的分类/标签/成员/关键词):对月度与项目预算同时生效 */
function matchesBudgetFilters(b: BudgetItem, filters: BudgetFilters, keyword: string): boolean {
  if (keyword && !b.name.includes(keyword)) return false;
  if (filters.categoryCode && b.categoryCode !== filters.categoryCode) return false;
  if (filters.tag && !(b.tags ?? []).includes(filters.tag)) return false;
  if (filters.ownerId && b.ownerId !== filters.ownerId) return false;
  return true;
}

/**
 * 项目预算日期筛选(与后端 /api/budgets/free 同口径):
 * 预算日期区间与查询区间有交集即命中;未设置任何日期的预算视为长期,始终命中。
 */
function freeBudgetInRange(b: BudgetItem, start: string, end: string): boolean {
  const s = start ? start.slice(0, 10) : '';
  const e = end ? end.slice(0, 10) : '';
  if (!s && !e) return true;
  const bs = b.startDate ? b.startDate.slice(0, 10) : '';
  const be = b.endDate ? b.endDate.slice(0, 10) : '';
  if (!bs && !be) return true;
  if (s && e) {
    if (bs && bs > e) return false;
    if (be && be < s) return false;
    return true;
  }
  if (s) return !be || be >= s;
  return !bs || bs <= e;
}

// 预算管理页:对齐网页端多维度预算 —— 月度/项目两种类型、分类/项目/成员组合、批量添加、复制到多月份
export default function BudgetPage() {
  const { colors } = useTheme();
  const { currentLedger } = useUIShell();
  const bookId = currentLedger.id;
  // 分类复用 records store(支出+收入两字典,对齐网页端维度选择)
  // 刷新时机:切到本页时(isFocused)重拉预算数据
  const { categories: allCategories } = useRecords();
  const isFocused = useIsFocused();
  const now = new Date();
  const [budgets, setBudgets] = useState<BudgetItem[]>([]);

  // 键盘高度:(tabs) 内 FormSheet 的 KeyboardAvoidingView 不生效,添加预算弹窗需手动收缩,避免顶部被状态栏裁切
  const winH = useRef(Dimensions.get('window').height).current;
  const [kbH, setKbH] = useState(0);
  useEffect(() => {
    const show = Keyboard.addListener('keyboardDidShow', (e) => setKbH(e.endCoordinates.height));
    const hide = Keyboard.addListener('keyboardDidHide', () => setKbH(0));
    return () => {
      show.remove();
      hide.remove();
    };
  }, []);
  const [tagSuggestions, setTagSuggestions] = useState<string[]>([]);
  const [budgetMembers, setBudgetMembers] = useState<{ userId: string; name: string }[]>([]);
  const [filterOpen, setFilterOpen] = useState(false);
  const [monthPickerOpen, setMonthPickerOpen] = useState(false);
  const [summaryOpen, setSummaryOpen] = useState(false);
  /** 筛选条件(与流水管理同构:类型多选 + 分类/标签/成员 + 关键词) */
  const [filters, setFilters] = useState<BudgetFilters>(emptyBudgetFilters);
  /** 活跃条件胶囊:默认单行横向滚动,展开后换行限高 */
  const [chipsExpanded, setChipsExpanded] = useState(false);
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState<number | null>(now.getMonth() + 1);
  // 项目预算的时间筛选与月度预算分开(对齐网页端:月度=年/月,项目=日期区间)
  const [freeStartDate, setFreeStartDate] = useState('');
  const [freeEndDate, setFreeEndDate] = useState('');
  const [freeDateOpen, setFreeDateOpen] = useState(false);

  // ── 新建/编辑 ──
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<BudgetItem | null>(null);
  const [detailBudget, setDetailBudget] = useState<BudgetItem | null>(null);
  const [formName, setFormName] = useState('');
  const [formType, setFormType] = useState<BudgetType>('FIXED');
  const [formAmount, setFormAmount] = useState('');
  const [formCategory, setFormCategory] = useState('');
  const [formMonth, setFormMonth] = useState(now.getMonth() + 1);
  const [formTags, setFormTags] = useState<string[]>([]);
  const [formOwner, setFormOwner] = useState('');
  const [formStartDate, setFormStartDate] = useState('');
  const [formEndDate, setFormEndDate] = useState('');
  const [formRemark, setFormRemark] = useState('');
  const [formError, setFormError] = useState('');

  // 危险操作二次确认(ConfirmSheet 统一替代系统 Alert)
  const [confirm, setConfirm] = useState<{
    title: string; message?: string; confirmLabel?: string; onConfirm: () => void;
  } | null>(null);
  const [formSaving, setFormSaving] = useState(false);

  // ── 批量添加 ──
  const [batchOpen, setBatchOpen] = useState(false);
  const [batchName, setBatchName] = useState('');
  const [batchType, setBatchType] = useState<BudgetType>('FIXED');
  const [batchAmount, setBatchAmount] = useState('');
  const [batchCategory, setBatchCategory] = useState('');
  const [batchTags, setBatchTags] = useState<string[]>([]);
  const [batchOwner, setBatchOwner] = useState('');
  const [batchStartDate, setBatchStartDate] = useState('');
  const [batchEndDate, setBatchEndDate] = useState('');
  const [batchMonths, setBatchMonths] = useState<number[]>([]);
  const [batchYear, setBatchYear] = useState(now.getFullYear());
  const [batchRemark, setBatchRemark] = useState('');
  const [batchSaving, setBatchSaving] = useState(false);
  /** 首屏加载态:数据回来后置 false;切页/保存后的静默刷新不闪 loading */
  const [loading, setLoading] = useState(true);

  // ── 复制预算 ──
  const [copyOpen, setCopyOpen] = useState(false);
  const [copySourceYear, setCopySourceYear] = useState(now.getFullYear());
  const [copySourceMonth, setCopySourceMonth] = useState(now.getMonth() + 1);
  const [copyTargetYear, setCopyTargetYear] = useState(now.getFullYear());
  const [copyTargets, setCopyTargets] = useState<Array<{ year: number; month: number }>>([]);
  const [copySaving, setCopySaving] = useState(false);

  useEffect(() => {
    if (!isFocused || !bookId) return;
    fetchBudgets(bookId).then(setBudgets).catch(() => {}).finally(() => setLoading(false));
  }, [isFocused, bookId]);

  // 标签建议(预算标签,与网页端 getTags 一致)
  useEffect(() => {
    if (!bookId) return;
    fetchBudgetTags(bookId).then(setTagSuggestions).catch(() => {});
  }, [bookId]);

  // 家庭成员维度选项(账本归属人 + 成员)
  useEffect(() => {
    if (!bookId) return;
    fetchBudgetMembers(bookId).then(setBudgetMembers).catch(() => {});
  }, [bookId]);

  const reload = useCallback(() => {
    if (bookId) fetchBudgets(bookId).then(setBudgets);
  }, [bookId]);

  // 记一笔/编辑保存后由 RecordModal 直接调用:重拉预算已用金额
  usePageRefresh(reload);

  const [refreshing, setRefreshing] = useState(false);
  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await Promise.all([fetchBudgets(bookId).then(setBudgets), fetchBudgetTags(bookId).then(setTagSuggestions)]);
    } finally {
      setRefreshing(false);
    }
  }, [bookId]);

  // ── 筛选 ──
  // 与网页端一致:月度预算按「年/月」筛,项目预算按独立「日期区间」筛;分类/标签/成员/关键词为全局条件。
  const showFixed = filters.types.length === 0 || filters.types.includes('FIXED');
  const showFree = filters.types.length === 0 || filters.types.includes('FREE');

  const filteredFixed = useMemo(() => {
    if (!showFixed) return [];
    const keyword = filters.keyword.trim();
    return budgets.filter((b) => {
      if (b.type !== 'FIXED') return false;
      if (b.year !== year) return false;
      if (month !== null && b.month !== month) return false;
      return matchesBudgetFilters(b, filters, keyword);
    });
  }, [budgets, showFixed, filters, year, month]);

  const filteredFree = useMemo(() => {
    if (!showFree) return [];
    const keyword = filters.keyword.trim();
    return budgets.filter((b) =>
      b.type === 'FREE' &&
      freeBudgetInRange(b, freeStartDate, freeEndDate) &&
      matchesBudgetFilters(b, filters, keyword),
    );
  }, [budgets, showFree, filters, freeStartDate, freeEndDate]);

  /** 汇总与维度统计的可见范围:月度(按年月) + 项目(按日期区间) */
  const filtered = useMemo(() => [...filteredFixed, ...filteredFree], [filteredFixed, filteredFree]);

  /** 项目预算时间筛选的按钮文案 */
  const freeDateLabel = useMemo(() => {
    const s = freeStartDate ? freeStartDate.slice(0, 10) : '';
    const e = freeEndDate ? freeEndDate.slice(0, 10) : '';
    if (!s && !e) return '全部日期';
    if (s && e) {
      return s.slice(0, 4) === e.slice(0, 4) ? `${s.slice(5)} ~ ${e.slice(5)}` : `${s} ~ ${e}`;
    }
    return s ? `${s.slice(5)} 起` : `至 ${e.slice(5)}`;
  }, [freeStartDate, freeEndDate]);

  // ── 统计 ──
  const totalBudget = useMemo(() => filtered.reduce((s, b) => s + b.amount, 0), [filtered]);
  const totalActual = useMemo(() => filtered.reduce((s, b) => s + b.actualAmount, 0), [filtered]);
  const overCount = useMemo(() => filtered.filter((b) => b.actualAmount > b.amount).length, [filtered]);

  // 维度汇总:同一预算会同时计入其涉及的每个维度;多标签预算分别计入各项目
  const dimensionSummary = useMemo(() => {
    type Group = { key: string; name: string; amount: number; actual: number };
    const member = new Map<string, Group>();
    const category = new Map<string, Group>();
    const project = new Map<string, Group>();
    const add = (map: Map<string, Group>, key: string, name: string, b: BudgetItem) => {
      const g = map.get(key) ?? { key, name, amount: 0, actual: 0 };
      g.amount += b.amount;
      g.actual += b.actualAmount;
      map.set(key, g);
    };
    const categoryLabel = (code: string) => allCategories.find((c) => c.code === code)?.label ?? code;
    for (const b of filtered) {
      if (b.ownerId) add(member, b.ownerId, b.ownerName || '成员', b);
      if (b.categoryCode) add(category, b.categoryCode, categoryLabel(b.categoryCode), b);
      for (const t of b.tags ?? []) add(project, t, t, b);
    }
    const top = (map: Map<string, Group>) => Array.from(map.values()).sort((a, b) => b.amount - a.amount).slice(0, 3);
    return { member: top(member), category: top(category), project: top(project) };
  }, [filtered, allCategories]);

  // ── 活跃筛选条件胶囊(对齐流水管理:可单个移除、可一键清空) ──
  const activeCount = countActiveBudgetFilters(filters);
  const categoryLabelOf = (code: string) => allCategories.find((c) => c.code === code)?.label ?? code;
  const activeChips: { key: string; label: string; onClear: () => void }[] = [
    ...filters.types.map((t) => ({
      key: `t-${t}`,
      label: BUDGET_TYPE_LABELS[t],
      onClear: () => setFilters((f) => ({ ...f, types: f.types.filter((x) => x !== t) })),
    })),
    ...(filters.categoryCode
      ? [{
          key: 'category',
          label: categoryLabelOf(filters.categoryCode),
          onClear: () => setFilters((f) => ({ ...f, categoryCode: '' })),
        }]
      : []),
    ...(filters.tag
      ? [{
          key: 'tag',
          label: `${BUDGET_DIMENSION_LABELS.project}: ${filters.tag}`,
          onClear: () => setFilters((f) => ({ ...f, tag: '' })),
        }]
      : []),
    ...(filters.ownerId
      ? [{
          key: 'owner',
          label: `${BUDGET_DIMENSION_LABELS.member}: ${budgetMembers.find((m) => m.userId === filters.ownerId)?.name ?? filters.ownerId}`,
          onClear: () => setFilters((f) => ({ ...f, ownerId: '' })),
        }]
      : []),
    ...(filters.keyword.trim()
      ? [{
          key: 'kw',
          label: `「${filters.keyword.trim()}」`,
          onClear: () => setFilters((f) => ({ ...f, keyword: '' })),
        }]
      : []),
  ];

  // 单条条件胶囊(限宽 + 省略号,避免长标签吃掉整行)
  const renderChip = (c: { key: string; label: string; onClear: () => void }) => (
    <View key={c.key} style={{ flexDirection: 'row', alignItems: 'center', gap: 4, paddingLeft: 12, paddingRight: 8, paddingVertical: 6, borderRadius: 999, backgroundColor: alpha(colors.primary, 0.1), borderWidth: 1, borderColor: alpha(colors.primary, 0.3), maxWidth: 200 }}>
      <Text style={{ fontSize: 12, color: colors.primary, flexShrink: 1 }} numberOfLines={1}>{c.label}</Text>
      <Pressable onPress={c.onClear} hitSlop={6}>
        <X size={12} color={colors.primary} />
      </Pressable>
    </View>
  );

  const clearAllChip = (
    <Pressable onPress={() => { setFilters(emptyBudgetFilters); haptics.tap(); }} hitSlop={6} style={{ flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 12, paddingVertical: 6, borderRadius: 999, backgroundColor: colors.muted, borderWidth: 1, borderColor: colors.border }}>
      <Text style={{ fontSize: 12, color: colors.mutedForeground }}>清空</Text>
    </Pressable>
  );

  const resetForm = useCallback(() => {
    setFormName(''); setFormType('FIXED'); setFormAmount(''); setFormCategory('');
    setFormMonth(month ?? now.getMonth() + 1); setFormTags([]); setFormOwner(''); setFormStartDate(''); setFormEndDate(''); setFormRemark(''); setFormError('');
  }, [month]);

  // ── 新建/编辑保存(对齐网页端 handleSave 校验与载荷) ──
  const handleSave = async () => {
    if (!formName.trim()) { setFormError('请输入预算名称'); return; }
    if (!formAmount || Number(formAmount) <= 0) { setFormError('请输入有效金额'); return; }
    if (formType === 'FREE' && !formCategory && formTags.length === 0 && !formOwner) {
      setFormError('项目预算请至少选择分类、标签或成员之一');
      return;
    }
    setFormSaving(true);
    try {
      if (editing) {
        await updateBudgetApi(editing.id, {
          name: formName.trim(),
          amount: Number(formAmount),
          categoryCode: formCategory || null,
          tags: formTags,
          ownerId: formOwner || null,
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
          categoryCode: formCategory || undefined,
          tags: formTags.length > 0 ? formTags : undefined,
          ownerId: formOwner || undefined,
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
    setFormOwner(b.ownerId ?? '');
    setFormStartDate(b.startDate ? b.startDate.slice(0, 10) : '');
    setFormEndDate(b.endDate ? b.endDate.slice(0, 10) : '');
    setFormRemark(b.remark ?? '');
    setFormError('');
  }, []);

  const handleDelete = useCallback((budget: BudgetItem) => {
    setConfirm({
      title: '删除预算',
      message: `确定要删除「${budget.name}」吗？此操作不可撤销。`,
      onConfirm: async () => {
        await deleteBudgetApi(budget.id);
        reload();
      },
    });
  }, [reload]);

  // ── 批量添加 ──
  const openBatch = () => {
    setBatchName(''); setBatchType('FIXED'); setBatchAmount(''); setBatchCategory(''); setBatchTags([]); setBatchOwner('');
    setBatchStartDate(''); setBatchEndDate(''); setBatchMonths([]); setBatchYear(year); setBatchRemark('');
    setBatchOpen(true);
  };

  const handleBatchCreate = async () => {
    if (!batchName.trim() || !batchAmount || Number(batchAmount) <= 0) return;
    if (batchType === 'FIXED' && batchMonths.length === 0) return;
    if (batchType === 'FREE' && !batchCategory && batchTags.length === 0 && !batchOwner) {
      showToast('项目预算请至少选择分类、标签或成员之一');
      return;
    }
    setBatchSaving(true);
    try {
      await batchCreateBudgetApi(bookId, {
        name: batchName.trim(),
        type: batchType,
        amount: Number(batchAmount),
        categoryCode: batchCategory || undefined,
        tags: batchTags.length > 0 ? batchTags : undefined,
        ownerId: batchOwner || undefined,
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
    setCopySourceMonth(month ?? now.getMonth() + 1);
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
    <ScrollView keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false} style={{ maxHeight: Math.min(460, winH - 260 - kbH) }}>
      {fieldLabel('类型')}
      {editing ? (
        <Text style={{ fontSize: 14, color: colors.foreground }}>
          {formType === 'FIXED' ? '月度预算(按自然月统计)' : '项目预算(按标签统计,可跨月)'}
        </Text>
      ) : (
        seg([
          { key: 'FIXED', label: BUDGET_TYPE_LABELS.FIXED },
          { key: 'FREE', label: BUDGET_TYPE_LABELS.FREE },
        ], formType, (k) => setFormType(k as BudgetType))
      )}

      {fieldLabel('名称')}
      <TextInput value={formName} onChangeText={(v) => { setFormName(v); setFormError(''); }} placeholder="如 房租、饮食、三亚旅游" placeholderTextColor={colors.mutedForeground} style={inputStyle} />

      {fieldLabel('金额')}
      <TextInput value={formAmount} onChangeText={(v) => { setFormAmount(v); setFormError(''); }} placeholder="预算金额" keyboardType="decimal-pad" placeholderTextColor={colors.mutedForeground} style={inputStyle} />

      {/* 维度：分类 / 项目 / 成员，可组合 */}
      {fieldLabel(`${BUDGET_DIMENSION_LABELS.category}(可选)`)}
      <ChipSelect
        value={formCategory}
        onChange={setFormCategory}
        options={[{ value: '', label: '不限' }, ...allCatOptions]}
      />

      {fieldLabel('标签(可选,多标签为或关系)')}
      <TagPicker value={formTags} onChange={setFormTags} suggestions={tagSuggestions} />

      {fieldLabel(`${BUDGET_DIMENSION_LABELS.member}(可选)`)}
      <ChipSelect
        value={formOwner}
        onChange={setFormOwner}
        options={[{ value: '', label: '不限' }, ...budgetMembers.map((m) => ({ value: m.userId, label: m.name }))]}
      />

      {formType === 'FREE' && freeDateFields(formStartDate, formEndDate, setFormStartDate, setFormEndDate)}

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
            backgroundColor: b.type === 'FIXED' ? alpha(colors.primary, 0.12) : alpha(colors.income, 0.12),
          }}>
            <Text style={{ fontSize: 11, fontWeight: '600', color: b.type === 'FIXED' ? colors.primary : colors.income }}>
              {BUDGET_TYPE_LABELS[b.type]}
            </Text>
          </View>
          <Text style={{ flex: 1, fontSize: 15, fontWeight: '600', color: colors.foreground }} numberOfLines={1}>{b.name}</Text>
          <Text style={{ fontSize: 14, fontWeight: '700', fontVariant: ['tabular-nums'], color: colors.foreground }}>¥{b.amount.toLocaleString()}</Text>
        </View>
        {/* 维度：分类 / 项目 / 成员 + 项目区间 */}
        {(b.categoryCode || (b.tags?.length ?? 0) > 0 || b.ownerId || ((b.startDate || b.endDate) && b.type === 'FREE')) && (
          <View style={{ gap: 4 }}>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 4 }}>
              {b.categoryCode && (
                <View style={{ paddingHorizontal: 7, paddingVertical: 2, borderRadius: 999, backgroundColor: alpha(colors.primary, 0.1) }}>
                  <Text style={{ fontSize: 10, color: colors.primary }}>
                    {allCategories.find((c) => c.code === b.categoryCode)?.label ?? b.categoryCode}
                  </Text>
                </View>
              )}
              {b.tags?.map((t) => (
                <View key={t} style={{ paddingHorizontal: 7, paddingVertical: 2, borderRadius: 999, backgroundColor: colors.muted }}>
                  <Text style={{ fontSize: 10, color: colors.foreground }}>{t}</Text>
                </View>
              ))}
              {b.ownerId && (
                <View style={{ paddingHorizontal: 7, paddingVertical: 2, borderRadius: 999, backgroundColor: colors.muted }}>
                  <Text style={{ fontSize: 10, color: colors.foreground }}>{b.ownerName || '成员'}</Text>
                </View>
              )}
            </View>
            {b.type === 'FREE' && (b.startDate || b.endDate) && (
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
          <Pressable onPress={() => setDetailBudget(b)} style={{
            flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 10, paddingVertical: 5,
            borderRadius: 8, backgroundColor: alpha(colors.primary, 0.1),
          }}>
            <Info size={14} color={colors.primary} />
            <Text style={{ fontSize: 12, color: colors.primary }}>明细</Text>
          </Pressable>
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
        {/* 标题 + 新建 */}
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <Text style={{ flex: 1, fontSize: 20, fontWeight: '700', color: colors.foreground }}>预算管理</Text>
          <Pressable onPress={() => { resetForm(); setCreating(true); setEditing(null); }} style={{
            flexDirection: 'row', alignItems: 'center', gap: 4,
            paddingHorizontal: 14, paddingVertical: 9, borderRadius: 10, backgroundColor: colors.primary,
          }}>
            <Plus size={16} color={colors.primaryForeground} />
            <Text style={{ color: colors.primaryForeground, fontWeight: '600', fontSize: 13 }}>新建</Text>
          </Pressable>
        </View>

        {/* 全局筛选 + 快捷操作(时间筛选按预算类型分开放到各自区块) */}
        <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
          <Pressable
            onPress={() => { setFilterOpen(true); haptics.tap(); }}
            style={{ flex: 1, position: 'relative', justifyContent: 'center', flexDirection: 'row', alignItems: 'center', gap: 4, paddingVertical: 7, borderRadius: 999, backgroundColor: colors.muted, borderWidth: 1, borderColor: colors.border }}
          >
            <SlidersHorizontal size={13} color={colors.foreground} />
            <Text style={{ flexShrink: 0, fontSize: 13, color: colors.foreground, fontWeight: '500' }}>筛选</Text>
            {activeCount > 0 && (
              <View style={{ position: 'absolute', top: -5, right: -5, minWidth: 16, height: 16, borderRadius: 8, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 4, borderWidth: 1.5, borderColor: colors.background }}>
                <Text style={{ fontSize: 9, color: colors.primaryForeground, fontWeight: '700' }}>{activeCount}</Text>
              </View>
            )}
          </Pressable>
          <Pressable onPress={() => { openCopy(); haptics.tap(); }} style={{ flex: 1, justifyContent: 'center', flexDirection: 'row', alignItems: 'center', gap: 4, paddingVertical: 7, borderRadius: 999, backgroundColor: colors.muted, borderWidth: 1, borderColor: colors.border }}>
            <Text style={{ flexShrink: 0, fontSize: 13, color: colors.foreground, fontWeight: '500' }}>复制</Text>
          </Pressable>
          <Pressable onPress={() => { openBatch(); haptics.tap(); }} style={{ flex: 1, justifyContent: 'center', flexDirection: 'row', alignItems: 'center', gap: 4, paddingVertical: 7, borderRadius: 999, backgroundColor: colors.muted, borderWidth: 1, borderColor: colors.border }}>
            <Text style={{ flexShrink: 0, fontSize: 13, color: colors.foreground, fontWeight: '500' }}>批量</Text>
          </Pressable>
        </View>

        {/* 活跃条件胶囊:默认单行横向滚动,展开后换行并限高 */}
        {activeChips.length > 0 && (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            {chipsExpanded ? (
              <ScrollView style={{ flex: 1, maxHeight: 124 }} nestedScrollEnabled showsVerticalScrollIndicator={false}>
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                  {activeChips.map(renderChip)}
                  {clearAllChip}
                </View>
              </ScrollView>
            ) : (
              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ flex: 1 }} contentContainerStyle={{ gap: 8, alignItems: 'center', paddingRight: 4 }}>
                {activeChips.map(renderChip)}
                {clearAllChip}
              </ScrollView>
            )}
            {activeChips.length > 1 && (
              <Pressable
                onPress={() => { setChipsExpanded((v) => !v); haptics.tap(); }}
                hitSlop={8}
                style={{ width: 30, height: 30, borderRadius: 15, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.muted, borderWidth: 1, borderColor: colors.border }}
              >
                {chipsExpanded ? <ChevronUp size={15} color={colors.foreground} /> : <ChevronDown size={15} color={colors.foreground} />}
              </Pressable>
            )}
          </View>
        )}

        {/* 汇总 */}
        <View style={{
          padding: 14, borderRadius: 12, gap: 10,
          backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border,
        }}>
          <View style={{ flexDirection: 'row', alignItems: 'flex-end' }}>
            <View style={{ flex: 1 }}>
              <Text style={{ fontSize: 11, color: colors.mutedForeground }}>总预算</Text>
              <Text style={{ fontSize: 18, fontWeight: '700', color: colors.foreground, fontVariant: ['tabular-nums'] }}>
                ¥{totalBudget.toLocaleString()}
              </Text>
            </View>
            <View style={{ alignItems: 'flex-end' }}>
              <Text style={{ fontSize: 11, color: colors.mutedForeground }}>使用率</Text>
              <Text style={{
                fontSize: 18, fontWeight: '700', fontVariant: ['tabular-nums'],
                color: totalActual > totalBudget ? colors.destructive : colors.foreground,
              }}>
                {totalBudget > 0 ? `${((totalActual / totalBudget) * 100).toFixed(0)}%` : '—'}
              </Text>
            </View>
          </View>

          <View style={{ height: 8, borderRadius: 4, backgroundColor: colors.muted, overflow: 'hidden' }}>
            <View style={{
              height: '100%', borderRadius: 4,
              width: `${totalBudget > 0 ? Math.min((totalActual / totalBudget) * 100, 100) : 0}%`,
              backgroundColor: totalActual > totalBudget ? colors.destructive : colors.primary,
            }} />
          </View>

          <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
            <Text style={{ fontSize: 12, color: colors.mutedForeground, fontVariant: ['tabular-nums'] }}>
              已用 ¥{totalActual.toLocaleString()}
            </Text>
            <Text style={{
              fontSize: 12, fontWeight: '600', fontVariant: ['tabular-nums'],
              color: totalActual > totalBudget ? colors.destructive : colors.mutedForeground,
            }}>
              {totalActual > totalBudget
                ? `超支 ¥${(totalActual - totalBudget).toLocaleString()}${overCount > 0 ? ` · ${overCount} 项` : ''}`
                : `剩余 ¥${(totalBudget - totalActual).toLocaleString()}${overCount > 0 ? ` · 超支 ${overCount} 项` : ''}`}
            </Text>
          </View>
        </View>

        {/* 维度汇总 */}
        {(dimensionSummary.member.length > 0 || dimensionSummary.category.length > 0 || dimensionSummary.project.length > 0) && (
          <View style={{ borderRadius: 12, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.card, overflow: 'hidden' }}>
            <Pressable onPress={() => setSummaryOpen((v) => !v)} style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, paddingVertical: 10 }}>
              <Text style={{ flex: 1, fontSize: 13, fontWeight: '600', color: colors.foreground }}>维度汇总</Text>
              <Text style={{ fontSize: 12, color: colors.mutedForeground }}>{summaryOpen ? '收起' : '展开'}</Text>
            </Pressable>
            {summaryOpen && (
              <View style={{ paddingHorizontal: 12, paddingBottom: 12, gap: 10 }}>
                {[
                  { title: `按${BUDGET_DIMENSION_LABELS.member}`, groups: dimensionSummary.member },
                  { title: `按${BUDGET_DIMENSION_LABELS.category}`, groups: dimensionSummary.category },
                  { title: `按${BUDGET_DIMENSION_LABELS.project}`, groups: dimensionSummary.project },
                ].filter((s) => s.groups.length > 0).map((section) => (
                  <View key={section.title} style={{ gap: 5 }}>
                    <Text variant="muted" style={{ fontSize: 11 }}>{section.title}</Text>
                    {section.groups.map((g) => {
                      const pct = g.amount > 0 ? (g.actual / g.amount) * 100 : 0;
                      return (
                        <View key={`${section.title}-${g.key}`} style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                          <Text style={{ flex: 1, fontSize: 12, color: colors.foreground }} numberOfLines={1}>{g.name}</Text>
                          <Text style={{ fontSize: 11, fontVariant: ['tabular-nums'], color: pct > 100 ? colors.destructive : colors.mutedForeground }}>
                            ¥{g.actual.toLocaleString()} / ¥{g.amount.toLocaleString()} · {pct.toFixed(0)}%
                          </Text>
                        </View>
                      );
                    })}
                  </View>
                ))}
              </View>
            )}
          </View>
        )}

        {/* 列表:月度/项目各自带时间筛选(与网页端一致),分类/标签/成员等全局条件对两者同时生效 */}
        {loading ? (
          <LoadingState />
        ) : filtered.length === 0 ? (
          <EmptyState
            icon=""
            title={activeCount > 0 ? '没有符合条件的预算' : '暂无预算'}
            description={activeCount > 0 ? '试试调整或清空筛选条件' : '创建一个预算开始管理支出'}
          />
        ) : (
          <View style={{ gap: 16 }}>
            {showFixed && (
              <View style={{ gap: 10 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                  <Text style={{ flex: 1, fontSize: 15, fontWeight: '700', color: colors.foreground }}>
                    {BUDGET_TYPE_LABELS.FIXED}预算
                  </Text>
                  <Pressable onPress={() => { setMonthPickerOpen(true); haptics.tap(); }} style={{
                    flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 11, paddingVertical: 6,
                    borderRadius: 999, backgroundColor: colors.muted, borderWidth: 1, borderColor: colors.border,
                  }}>
                    <Text style={{ fontSize: 12.5, fontWeight: '600', color: colors.foreground }} numberOfLines={1}>
                      {year}年{month === null ? ' · 全年' : `${month}月`}
                    </Text>
                    <ChevronDown size={12} color={colors.mutedForeground} />
                  </Pressable>
                </View>
                {filteredFixed.length === 0 ? (
                  <Text variant="muted" style={{ fontSize: 12 }}>当前时间范围内暂无月度预算</Text>
                ) : filteredFixed.map(renderBudgetCard)}
              </View>
            )}

            {showFree && (
              <View style={{ gap: 10 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                  <Text style={{ flex: 1, fontSize: 15, fontWeight: '700', color: colors.foreground }}>
                    {BUDGET_TYPE_LABELS.FREE}预算
                  </Text>
                  <Pressable onPress={() => { setFreeDateOpen(true); haptics.tap(); }} style={{
                    flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 11, paddingVertical: 6,
                    borderRadius: 999, borderWidth: 1,
                    borderColor: freeStartDate || freeEndDate ? colors.primary : colors.border,
                    backgroundColor: freeStartDate || freeEndDate ? alpha(colors.primary, 0.1) : colors.muted,
                  }}>
                    <Calendar size={12} color={freeStartDate || freeEndDate ? colors.primary : colors.mutedForeground} />
                    <Text style={{ fontSize: 12.5, fontWeight: '600', color: freeStartDate || freeEndDate ? colors.primary : colors.foreground }} numberOfLines={1}>
                      {freeDateLabel}
                    </Text>
                  </Pressable>
                </View>
                {filteredFree.length === 0 ? (
                  <Text variant="muted" style={{ fontSize: 12 }}>当前日期范围内暂无项目预算</Text>
                ) : filteredFree.map(renderBudgetCard)}
              </View>
            )}
          </View>
        )}

      </ScrollView>

      {/* ── 新建/编辑弹出 ── */}
      <FormSheet visible={creating || !!editing} title={editing ? '编辑预算' : '添加预算'} onClose={() => { setCreating(false); setEditing(null); resetForm(); }} onSave={handleSave} saveLabel={editing ? '保存' : '创建'} saveLoading={formSaving}>
        {renderFormSheet()}
      </FormSheet>

      {/* ── 批量添加 ── */}
      <FormSheet visible={batchOpen} title="批量添加预算" onClose={() => setBatchOpen(false)} onSave={handleBatchCreate} saveLabel={batchType === 'FREE' ? '创建' : `生成(${batchMonths.length}个月)`} saveLoading={batchSaving}>
        <ScrollView keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false} style={{ maxHeight: 520 }}>
          {fieldLabel('类型')}
          {seg([{ key: 'FIXED', label: BUDGET_TYPE_LABELS.FIXED }, { key: 'FREE', label: BUDGET_TYPE_LABELS.FREE }], batchType, (k) => setBatchType(k as BudgetType))}

          {fieldLabel('名称')}
          <TextInput value={batchName} onChangeText={setBatchName} placeholder="预算名称" placeholderTextColor={colors.mutedForeground} style={inputStyle} />

          {fieldLabel('金额')}
          <TextInput value={batchAmount} onChangeText={setBatchAmount} keyboardType="decimal-pad" placeholderTextColor={colors.mutedForeground} style={inputStyle} />

          {fieldLabel(`${BUDGET_DIMENSION_LABELS.category}(可选)`)}
          <ChipSelect value={batchCategory} onChange={setBatchCategory} options={[{ value: '', label: '不限' }, ...allCatOptions]} />

          {fieldLabel('标签(可选,多标签为或关系)')}
          <TagPicker value={batchTags} onChange={setBatchTags} suggestions={tagSuggestions} />

          {fieldLabel(`${BUDGET_DIMENSION_LABELS.member}(可选)`)}
          <ChipSelect
            value={batchOwner}
            onChange={setBatchOwner}
            options={[{ value: '', label: '不限' }, ...budgetMembers.map((m) => ({ value: m.userId, label: m.name }))]}
          />

          {batchType === 'FREE' && freeDateFields(batchStartDate, batchEndDate, setBatchStartDate, setBatchEndDate)}

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
              {copyTargets.map((t) => (
                <Pressable key={`${t.year}-${t.month}`} onPress={() => toggleCopyTarget(t.year, t.month)} style={{ flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 9, paddingVertical: 4, borderRadius: 999, backgroundColor: alpha(colors.primary, 0.12) }}>
                  <Text style={{ fontSize: 12, color: colors.primary }}>{t.year}/{t.month}月</Text>
                  <X size={12} color={colors.primary} />
                </Pressable>
              ))}
            </View>
          )}
        </ScrollView>
      </FormSheet>

      {/* ── 项目预算日期筛选(与月度预算的年/月筛选分开) ── */}
      <FormSheet visible={freeDateOpen} title="项目预算日期" onClose={() => setFreeDateOpen(false)} onSave={() => setFreeDateOpen(false)} saveLabel="完成">
        <ScrollView keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false} style={{ maxHeight: 420 }}>
          {fieldLabel('起始日期(可选)')}
          <DatePicker value={freeStartDate} onChange={setFreeStartDate} />
          {fieldLabel('结束日期(可选)')}
          <DatePicker value={freeEndDate} onChange={setFreeEndDate} />
          <Pressable
            onPress={() => { setFreeStartDate(''); setFreeEndDate(''); }}
            style={{ marginTop: 16, alignItems: 'center', paddingVertical: 10, borderRadius: 10, backgroundColor: colors.muted }}
          >
            <Text style={{ fontSize: 13, color: colors.foreground }}>清空日期</Text>
          </Pressable>
        </ScrollView>
      </FormSheet>
      {/* ── 月份选择 ── */}
      <FormSheet visible={monthPickerOpen} title="选择月份" onClose={() => setMonthPickerOpen(false)} onSave={() => setMonthPickerOpen(false)} saveLabel="完成">
        <ScrollView keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false} style={{ maxHeight: 420 }}>
          {fieldLabel('年份')}
          {yearStepper(year, setYear)}
          {fieldLabel('月份')}
          <ChipSelect
            value={month === null ? 'all' : String(month)}
            onChange={(v) => setMonth(v === 'all' ? null : Number(v))}
            options={[{ value: 'all', label: '全年' }, ...MONTHS.map((m) => ({ value: String(m), label: `${m}月` }))]}
          />
        </ScrollView>
      </FormSheet>

      {/* ── 筛选(与流水管理同款抽屉:chip 选择 + 重置/应用) ── */}
      <BudgetFilterSheet
        visible={filterOpen}
        initial={filters}
        categoryOptions={allCatOptions}
        tagOptions={tagSuggestions}
        memberOptions={budgetMembers.map((m) => ({ value: m.userId, label: m.name }))}
        onApply={setFilters}
        onClose={() => setFilterOpen(false)}
      />

      {/* ── 预算明细 ── */}
      <BudgetDetailSheet budget={detailBudget} bookId={bookId} onClose={() => setDetailBudget(null)} />

      {/* 危险操作二次确认 */}
      <ConfirmSheet
        visible={!!confirm}
        title={confirm?.title ?? ''}
        message={confirm?.message}
        confirmLabel={confirm?.confirmLabel}
        onConfirm={() => { const c = confirm; setConfirm(null); c?.onConfirm(); }}
        onClose={() => setConfirm(null)}
      />
    </SafeAreaView>
  );
}

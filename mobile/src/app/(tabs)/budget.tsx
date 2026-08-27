import { useState, useCallback, useMemo, useEffect } from 'react';
import {
  RefreshControl, ScrollView, View, Pressable, Alert, TextInput, Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Plus, Pencil, Trash2, Search, ChevronDown, Copy } from 'lucide-react-native';
import { useTheme, alpha } from '@/theme';
import { Text } from '@/components/ui/Text';
import { EmptyState } from '@/components/ui/EmptyState';
import { useUIShell } from '@/components/chrome/chrome';
import { copyBudgetApi, createBudgetApi, deleteBudgetApi, fetchBudgets, fetchCategories, updateBudgetApi } from '@/services/records';
import type { BudgetItem, BudgetType, Category } from '@/types';

const BUDGET_TYPES: { key: BudgetType | 'ALL'; label: string }[] = [
  { key: 'ALL', label: '全部' },
  { key: 'FIXED', label: '固定' },
  { key: 'FREE', label: '自由' },
];

// 预算管理页:对齐网页端 CRUD + 类型筛选 + 搜索 + 年月筛选
export default function BudgetPage() {
  const { colors } = useTheme();
  const { currentLedger } = useUIShell();
  const bookId = currentLedger.id;
  const [budgets, setBudgets] = useState<BudgetItem[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [typeFilter, setTypeFilter] = useState<BudgetType | 'ALL'>('ALL');
  const [search, setSearch] = useState('');
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<BudgetItem | null>(null);
  const [deleting, setDeleting] = useState<BudgetItem | null>(null);

  // 表单状态
  const [formName, setFormName] = useState('');
  const [formType, setFormType] = useState<BudgetType>('FIXED');
  const [formAmount, setFormAmount] = useState('');
  const [formCategory, setFormCategory] = useState<string>('');

  // 加载真实预算与分类
  useEffect(() => {
    if (!bookId) return;
    fetchBudgets(bookId).then(setBudgets);
    fetchCategories().then(setCategories);
  }, [bookId]);

  // ── 筛选 ──
  const filtered = useMemo(() => {
    return budgets.filter(b => {
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
  const overCount = useMemo(() => filtered.filter(b => b.actualAmount > b.amount).length, [filtered]);

  // ── CRUD ──
  const resetForm = useCallback(() => {
    setFormName(''); setFormType('FIXED'); setFormAmount(''); setFormCategory('');
  }, []);

  const reload = useCallback(() => {
    if (bookId) fetchBudgets(bookId).then(setBudgets);
  }, [bookId]);
  const [refreshing, setRefreshing] = useState(false);
  // 下拉刷新:预算 + 分类
  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      if (bookId) await Promise.all([fetchBudgets(bookId).then(setBudgets), fetchCategories().then(setCategories)]);
      else await fetchCategories().then(setCategories);
    } finally {
      setRefreshing(false);
    }
  }, [bookId]);

  const handleCreate = useCallback(async () => {
    if (!formName.trim() || !formAmount) return;
    await createBudgetApi(bookId, {
      name: formName.trim(), type: formType,
      categoryCode: formCategory || undefined, amount: Number(formAmount),
      year, month: formType === 'FREE' ? 0 : month,
    });
    setCreating(false); resetForm(); reload();
  }, [formName, formType, formAmount, formCategory, year, month, resetForm, bookId, reload]);

  const handleEdit = useCallback(async () => {
    if (!editing || !formName.trim() || !formAmount) return;
    await updateBudgetApi(editing.id, {
      name: formName.trim(), amount: Number(formAmount),
      categoryCode: formCategory || undefined,
    });
    setEditing(null); resetForm(); reload();
  }, [editing, formName, formAmount, formCategory, resetForm, reload]);

  const handleDelete = useCallback((budget: BudgetItem) => {
    Alert.alert('删除预算', `确定要删除「${budget.name}」吗？`, [
      { text: '取消', style: 'cancel' },
      {
        text: '删除', style: 'destructive', onPress: async () => {
          await deleteBudgetApi(budget.id);
          reload();
        },
      },
    ]);
    setDeleting(null);
  }, [reload]);

  const openEdit = useCallback((b: BudgetItem) => {
    setEditing(b); setFormName(b.name); setFormType(b.type);
    setFormAmount(String(b.amount)); setFormCategory(b.categoryCode ?? '');
  }, []);

  // ── 复制预算到指定月份 ──
  const [copying, setCopying] = useState<BudgetItem | null>(null);
  const [copyTarget, setCopyTarget] = useState('');
  const handleCopy = useCallback(async () => {
    if (!copying || !copyTarget) return;
    const [ty, tm] = copyTarget.split('-').map(Number);
    await copyBudgetApi(bookId, { sourceYear: year, sourceMonth: month, targetMonths: [{ year: ty, month: tm }] });
    setCopying(null); setCopyTarget(''); reload();
  }, [copying, copyTarget, bookId, year, month, reload]);

  const expenseCategories = categories.filter(c => c.type === 'EXPENSE');

  // ── 渲染 ──
  const renderFormSheet = (title: string, onConfirm: () => void) => (
    <View style={{ padding: 20, gap: 14 }}>
      <Text style={{ fontSize: 18, fontWeight: '700', color: colors.foreground }}>{title}</Text>
      {/* 类型选择 */}
      <View style={{ gap: 6 }}>
        <Text style={{ fontSize: 13, color: colors.mutedForeground }}>预算类型</Text>
        <View style={{ flexDirection: 'row', gap: 8 }}>
          {(['FIXED', 'FREE'] as BudgetType[]).map(t => (
            <Pressable key={t} onPress={() => setFormType(t)} style={{
              flex: 1, paddingVertical: 8, alignItems: 'center', borderRadius: 8,
              backgroundColor: formType === t ? colors.primary : colors.muted,
              borderWidth: 1, borderColor: formType === t ? colors.primary : colors.border,
            }}>
              <Text style={{ fontSize: 13, fontWeight: '600', color: formType === t ? colors.primaryForeground : colors.foreground }}>
                {t === 'FIXED' ? '固定预算' : '自由预算'}
              </Text>
            </Pressable>
          ))}
        </View>
      </View>
      <TextInput
        placeholder="预算名称" value={formName} onChangeText={setFormName}
        style={{
          borderWidth: 1, borderColor: colors.border, borderRadius: 10, padding: 12,
          fontSize: 15, color: colors.foreground, backgroundColor: colors.card,
        }}
        placeholderTextColor={colors.mutedForeground}
      />
      <TextInput
        placeholder="预算金额" value={formAmount} onChangeText={setFormAmount}
        keyboardType="decimal-pad"
        style={{
          borderWidth: 1, borderColor: colors.border, borderRadius: 10, padding: 12,
          fontSize: 15, color: colors.foreground, backgroundColor: colors.card,
        }}
        placeholderTextColor={colors.mutedForeground}
      />
      {/* 分类选择 */}
      <View style={{ gap: 6 }}>
        <Text style={{ fontSize: 13, color: colors.mutedForeground }}>关联分类(可选)</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginHorizontal: -4 }}>
          <Pressable onPress={() => setFormCategory('')} style={{
            paddingHorizontal: 12, paddingVertical: 6, borderRadius: 20, marginRight: 6,
            backgroundColor: !formCategory ? colors.primary : colors.muted,
          }}>
            <Text style={{ fontSize: 12, color: !formCategory ? colors.primaryForeground : colors.foreground }}>不限</Text>
          </Pressable>
          {expenseCategories.map(c => (
            <Pressable key={c.code} onPress={() => setFormCategory(c.code)} style={{
              paddingHorizontal: 12, paddingVertical: 6, borderRadius: 20, marginRight: 6,
              backgroundColor: formCategory === c.code ? colors.primary : colors.muted,
            }}>
              <Text style={{ fontSize: 12, color: formCategory === c.code ? colors.primaryForeground : colors.foreground }}>{c.label}</Text>
            </Pressable>
          ))}
        </ScrollView>
      </View>
      <View style={{ flexDirection: 'row', gap: 10, justifyContent: 'flex-end', marginTop: 4 }}>
        <Pressable onPress={() => { setCreating(false); setEditing(null); resetForm(); }}
          style={{ paddingVertical: 8, paddingHorizontal: 16, borderRadius: 8 }}>
          <Text style={{ color: colors.mutedForeground }}>取消</Text>
        </Pressable>
        <Pressable onPress={onConfirm} style={{
          paddingVertical: 8, paddingHorizontal: 20, borderRadius: 8, backgroundColor: colors.primary,
        }}>
          <Text style={{ color: colors.primaryForeground, fontWeight: '600' }}>确定</Text>
        </Pressable>
      </View>
    </View>
  );

  const renderBudgetCard = (b: BudgetItem) => {
    const pct = b.amount > 0 ? Math.min((b.actualAmount / b.amount) * 100, 100) : 0;
    const over = b.actualAmount > b.amount;
    const barColor = over ? colors.destructive : pct > 80 ? '#f59e0b' : colors.primary;
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
          <Text style={{ flex: 1, fontSize: 15, fontWeight: '600', color: colors.foreground }}>{b.name}</Text>
          {b.categoryCode && (
            <Text style={{ fontSize: 12, color: colors.mutedForeground }}>{b.categoryCode}</Text>
          )}
        </View>
        {/* 进度条 */}
        <View style={{ gap: 4 }}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
            <Text style={{ fontSize: 13, color: colors.mutedForeground }}>
              ¥{b.actualAmount.toLocaleString()} / ¥{b.amount.toLocaleString()}
            </Text>
            <Text style={{ fontSize: 13, fontWeight: '600', color: over ? colors.destructive : colors.foreground }}>
              {pct.toFixed(0)}%
            </Text>
          </View>
          <View style={{ height: 8, borderRadius: 4, backgroundColor: colors.muted, overflow: 'hidden' }}>
            <View style={{
              height: '100%', width: `${pct}%`, borderRadius: 4, backgroundColor: barColor,
            }} />
          </View>
          {over && (
            <Text style={{ fontSize: 11, color: colors.destructive }}>
              超支 ¥{(b.actualAmount - b.amount).toLocaleString()}
            </Text>
          )}
        </View>
        {/* 操作 */}
        <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
          <Pressable onPress={() => { setCopying(b); setCopyTarget(''); }} style={{
            flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 10, paddingVertical: 5,
            borderRadius: 8, backgroundColor: colors.muted,
          }}>
            <Copy size={14} color={colors.foreground} />
            <Text style={{ fontSize: 12, color: colors.foreground }}>复制</Text>
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
        </View>
      </View>
    );
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }} edges={['bottom']}>
      <ScrollView contentContainerStyle={{ padding: 16, gap: 12 }} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} colors={[colors.primary]} />}>
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

        {/* 创建按钮 */}
        <Pressable onPress={() => setCreating(true)} style={{
          flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
          paddingVertical: 10, borderRadius: 10, backgroundColor: colors.primary,
        }}>
          <Plus size={18} color={colors.primaryForeground} />
          <Text style={{ color: colors.primaryForeground, fontWeight: '600', fontSize: 14 }}>新建预算</Text>
        </Pressable>

        {/* 列表 */}
        {filtered.length === 0 ? (
          <EmptyState icon="" title="暂无预算" description="创建一个预算开始管理支出" />
        ) : filtered.map(b => renderBudgetCard(b))}
      </ScrollView>

      {/* ── 表单弹出 ── */}
      {(creating || editing) && (
        <Pressable style={{ position: 'absolute', inset: 0, backgroundColor: 'rgba(0,0,0,0.4)' }}
          onPress={() => { setCreating(false); setEditing(null); resetForm(); }}>
          <Pressable style={{
            position: 'absolute', bottom: 0, left: 0, right: 0,
            backgroundColor: colors.background, borderTopLeftRadius: 20, borderTopRightRadius: 20,
          }} onPress={() => {}}>
            {creating && renderFormSheet('新建预算', handleCreate)}
            {editing && renderFormSheet('编辑预算', handleEdit)}
          </Pressable>
        </Pressable>
      )}

      {/* 复制到月份 */}
      {copying && (
        <Pressable style={{ position: 'absolute', inset: 0, backgroundColor: 'rgba(0,0,0,0.4)' }} onPress={() => setCopying(null)}>
          <Pressable style={{ position: 'absolute', bottom: 0, left: 0, right: 0, backgroundColor: colors.background, borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 20, gap: 14 }} onPress={() => {}}>
            <Text style={{ fontSize: 18, fontWeight: '700', color: colors.foreground }}>复制到月份</Text>
            <Text style={{ fontSize: 13, color: colors.mutedForeground }}>
              将「{copying.name}」从 {year}年{month}月 复制到:
            </Text>
            <TextInput
              value={copyTarget} onChangeText={setCopyTarget}
              placeholder="格式: 2027-1" placeholderTextColor={colors.mutedForeground}
              style={{ borderWidth: 1, borderColor: colors.border, borderRadius: 10, padding: 12, fontSize: 15, color: colors.foreground }}
            />
            <View style={{ flexDirection: 'row', gap: 10, justifyContent: 'flex-end' }}>
              <Pressable onPress={() => setCopying(null)} style={{ paddingVertical: 8, paddingHorizontal: 16, borderRadius: 8 }}>
                <Text style={{ color: colors.mutedForeground }}>取消</Text>
              </Pressable>
              <Pressable onPress={handleCopy} style={{ paddingVertical: 8, paddingHorizontal: 20, borderRadius: 8, backgroundColor: colors.primary }}>
                <Text style={{ color: colors.primaryForeground, fontWeight: '600' }}>复制</Text>
              </Pressable>
            </View>
          </Pressable>
        </Pressable>
      )}
    </SafeAreaView>
  );
}

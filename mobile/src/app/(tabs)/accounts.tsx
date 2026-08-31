import { useCallback, useEffect, useState } from 'react';
import { Alert, Pressable, RefreshControl, ScrollView, TextInput, View } from 'react-native';
import { useIsFocused } from 'expo-router';
import { Plus, CreditCard, Wallet, MessageCircle, Banknote, TrendingUp, Landmark, Archive, RotateCcw, Trash2, SlidersHorizontal, Pencil } from 'lucide-react-native';
import { useTheme, alpha } from '@/theme';
import { Screen } from '@/components/Screen';
import { Card } from '@/components/ui/Card';
import { Text } from '@/components/ui/Text';
import { FadeInView } from '@/components/FadeInView';
import { FormSheet } from '@/components/chrome/FormSheet';
import { useUIShell, usePageRefresh } from '@/components/chrome/chrome';
import { createAccountApi, createAdjustmentApi, deleteAccountApi, fetchAccounts, listAdjustmentsApi, updateAccountApi } from '@/services/records';
import type { BalanceAdjustment } from '@/services/records';
import { formatMoney } from '@/lib/format';
import type { AccountItem, AccountType } from '@/types';

const FILTERS = ['全部', '活跃', '已归档'] as const;
type Filter = (typeof FILTERS)[number];
const FILTER_STATUS: Record<Filter, 'ACTIVE' | 'ARCHIVED' | null> = {
  全部: null,
  活跃: 'ACTIVE',
  已归档: 'ARCHIVED',
};

const TYPE_LABEL: Record<AccountType, string> = {
  BANK_DEBIT: '借记卡',
  CREDIT_CARD: '信用卡',
  ALIPAY: '支付宝',
  WECHAT: '微信',
  CASH: '现金',
  RECHARGE_CARD: '储值卡',
  INVESTMENT: '投资',
  OTHER: '其他',
};

const TYPE_ICON: Record<AccountType, typeof CreditCard> = {
  BANK_DEBIT: CreditCard,
  CREDIT_CARD: CreditCard,
  ALIPAY: Wallet,
  WECHAT: MessageCircle,
  CASH: Banknote,
  RECHARGE_CARD: Wallet,
  INVESTMENT: TrendingUp,
  OTHER: Landmark,
};

const TYPE_KEYS = Object.keys(TYPE_LABEL) as AccountType[];

// 账户管理:筛选 + 账户卡片列表 + 新建/编辑/归档/删除(对接真实 API)
export default function AccountsScreen() {
  const { colors } = useTheme();
  // 卡片操作按钮统一样式
  const opBtn = {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 8,
    backgroundColor: colors.muted,
  };
  const { currentLedger } = useUIShell();
  const bookId = currentLedger.id;
  // 刷新时机:切到本页时(isFocused)重拉账户余额
  const isFocused = useIsFocused();
  const [accounts, setAccounts] = useState<AccountItem[]>([]);
  const [filter, setFilter] = useState<Filter>('全部');

  const [sheet, setSheet] = useState(false); // 新建
  const [editing, setEditing] = useState<AccountItem | null>(null); // 编辑

  // 表单字段
  const [name, setName] = useState('');
  const [type, setType] = useState<AccountType>('BANK_DEBIT');
  const [initial, setInitial] = useState('');
  const [accountNo, setAccountNo] = useState('');
  const [bankName, setBankName] = useState('');

  useEffect(() => {
    if (!isFocused || !bookId) return;
    fetchAccounts(bookId).then(setAccounts);
  }, [isFocused, bookId]);

  // 记一笔/编辑保存后由 RecordModal 直接调用:重拉账户余额
  const reloadPage = useCallback(() => {
    if (bookId) fetchAccounts(bookId).then(setAccounts);
  }, [bookId]);
  usePageRefresh(reloadPage);

  const [refreshing, setRefreshing] = useState(false);
  // 下拉刷新:重拉账户列表
  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      if (bookId) await fetchAccounts(bookId).then(setAccounts);
    } finally {
      setRefreshing(false);
    }
  }, [bookId]);

  const status = FILTER_STATUS[filter];
  const visible = accounts.filter((a) => (status ? a.status === status : true));

  const resetForm = () => {
    setName('');
    setType('BANK_DEBIT');
    setInitial('');
    setAccountNo('');
    setBankName('');
  };

  const openCreate = () => {
    resetForm();
    setEditing(null);
    setSheet(true);
  };

  const openEdit = (a: AccountItem) => {
    setName(a.name);
    setType(a.type);
    setAccountNo(a.accountNo ?? '');
    setBankName(a.bankName ?? '');
    setEditing(a);
    setSheet(true);
  };

  const save = async () => {
    if (!name) return;
    if (editing) {
      await updateAccountApi(editing.id, {
        name,
        type,
        accountNo: accountNo || undefined,
        bankName: bankName || undefined,
      });
    } else {
      await createAccountApi(bookId, {
        name,
        type,
        initialBalance: parseFloat(initial) || 0,
        accountNo: accountNo || undefined,
        bankName: bankName || undefined,
      });
    }
    if (bookId) fetchAccounts(bookId).then(setAccounts);
    setSheet(false);
    resetForm();
  };

  const toggleArchive = async (a: AccountItem) => {
    await updateAccountApi(a.id, { status: a.status === 'ACTIVE' ? 'ARCHIVED' : 'ACTIVE' });
    if (bookId) fetchAccounts(bookId).then(setAccounts);
    setEditing(null);
    setSheet(false);
  };

  const remove = (a: AccountItem) => {
    // 先关表单,再弹确认(避免叠加)
    setSheet(false);
    Alert.alert('删除账户', `确定要删除「${a.name}」吗？此操作不可恢复。`, [
      { text: '取消', style: 'cancel' },
      {
        text: '删除', style: 'destructive',
        onPress: async () => {
          await deleteAccountApi(a.id);
          if (bookId) fetchAccounts(bookId).then(setAccounts);
          setEditing(null);
        },
      },
    ]);
  };

  // ── 余额调整 ──
  const [adjusting, setAdjusting] = useState(false);
  const [adjustBalance, setAdjustBalance] = useState('');
  const [adjustRemark, setAdjustRemark] = useState('');
  const openAdjust = (a: AccountItem) => {
    setEditing(a);
    setAdjustBalance(String(a.balance ?? 0));
    setAdjustRemark('');
    setSheet(false);
    setAdjusting(true);
  };
  const saveAdjust = async () => {
    if (!editing) return;
    const amt = parseFloat(adjustBalance);
    if (isNaN(amt)) return;
    await createAdjustmentApi(editing.id, {
      date: new Date().toISOString().slice(0, 10),
      balanceAfter: amt,
      remark: adjustRemark.trim() || undefined,
    });
    if (bookId) fetchAccounts(bookId).then(setAccounts);
    setAdjusting(false);
    setEditing(null);
  };

  // ── 调整历史查看 ──
  const [historyOpen, setHistoryOpen] = useState(false);
  const [historyAccount, setHistoryAccount] = useState<AccountItem | null>(null);
  const [adjustments, setAdjustments] = useState<BalanceAdjustment[]>([]);
  const openHistory = (a: AccountItem) => {
    setHistoryAccount(a);
    setHistoryOpen(true);
    listAdjustmentsApi(a.id).then(setAdjustments);
  };

  const inputStyle = {
    backgroundColor: colors.elevated,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 11,
    color: colors.foreground,
    fontSize: 15,
  };
  const labelStyle = { fontSize: 12, color: colors.mutedForeground, marginBottom: 6, marginTop: 12 };

  return (
    <Screen>
      <View style={{ flex: 1, paddingHorizontal: 20, paddingTop: 8 }}>
        {/* 标题栏 */}
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
          <Text style={{ fontSize: 20, fontWeight: '700' }}>账户管理</Text>
          <Pressable onPress={openCreate} style={{ width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center', backgroundColor: alpha(colors.primary, 0.12) }}>
            <Plus size={18} color={colors.primary} />
          </Pressable>
        </View>

        {/* 筛选 */}
        <View style={{ flexDirection: 'row', gap: 8, marginBottom: 14 }}>
          {FILTERS.map((f) => {
            const active = filter === f;
            return (
              <Pressable
                key={f}
                onPress={() => setFilter(f)}
                style={{ paddingHorizontal: 14, paddingVertical: 6, borderRadius: 999, backgroundColor: active ? colors.primary : colors.muted, borderWidth: 1, borderColor: active ? colors.primary : colors.border }}
              >
                <Text style={{ fontSize: 13, color: active ? '#fff' : colors.foreground, fontWeight: active ? '600' : '400' }}>{f}</Text>
              </Pressable>
            );
          })}
        </View>

        <ScrollView contentContainerStyle={{ paddingBottom: 40 }} showsVerticalScrollIndicator={false} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} colors={[colors.primary]} />}>
          {visible.length === 0 ? (
            <Card className="items-center py-12">
              <Text style={{ fontSize: 30, marginBottom: 6 }}>💳</Text>
              <Text variant="muted">暂无账户</Text>
            </Card>
          ) : (
            visible.map((a, i) => {
              const Icon = TYPE_ICON[a.type];
              const negative = a.balance < 0;
              return (
                <FadeInView key={a.id} index={i}>
                  <Card className="px-5 py-4 mb-3">
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
                      <View style={{ width: 44, height: 44, borderRadius: 14, alignItems: 'center', justifyContent: 'center', backgroundColor: negative ? alpha(colors.expense, 0.1) : alpha(colors.primary, 0.12) }}>
                        <Icon size={20} color={negative ? colors.expense : colors.primary} />
                      </View>
                      <View style={{ flex: 1 }}>
                        <Text style={{ fontSize: 15, fontWeight: '600' }}>{a.name}</Text>
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 3, flexWrap: 'wrap' }}>
                          <View style={{ paddingHorizontal: 7, paddingVertical: 2, borderRadius: 6, backgroundColor: colors.muted }}>
                            <Text style={{ fontSize: 10, color: colors.mutedForeground, fontWeight: '600' }}>{TYPE_LABEL[a.type]}</Text>
                          </View>
                          {a.accountNo ? <Text variant="muted" style={{ fontSize: 11 }}>{a.accountNo}</Text> : null}
                          {a.status === 'ARCHIVED' ? <Text variant="muted" style={{ fontSize: 11 }}>已归档</Text> : null}
                        </View>
                      </View>
                      <Text style={{ fontSize: 16, fontWeight: '700', fontVariant: ['tabular-nums'], color: negative ? colors.expense : colors.foreground }} numberOfLines={1}>
                        {formatMoney(a.balance)}
                      </Text>
                    </View>
                    {/* 操作按钮(直接置于列表卡片,对齐预算/账本页) */}
                    <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap', marginTop: 12, borderTopWidth: 1, borderTopColor: colors.hairline, paddingTop: 10 }}>
                      <Pressable onPress={() => openEdit(a)} style={opBtn}>
                        <Pencil size={13} color={colors.foreground} />
                        <Text style={{ fontSize: 12, color: colors.foreground }}>编辑</Text>
                      </Pressable>
                      <Pressable onPress={() => openAdjust(a)} style={opBtn}>
                        <SlidersHorizontal size={13} color={colors.foreground} />
                        <Text style={{ fontSize: 12, color: colors.foreground }}>调整</Text>
                      </Pressable>
                      <Pressable onPress={() => openHistory(a)} style={opBtn}>
                        <TrendingUp size={13} color={colors.foreground} />
                        <Text style={{ fontSize: 12, color: colors.foreground }}>记录</Text>
                      </Pressable>
                      <Pressable onPress={() => toggleArchive(a)} style={opBtn}>
                        {a.status === 'ACTIVE' ? <Archive size={13} color={colors.foreground} /> : <RotateCcw size={13} color={colors.foreground} />}
                        <Text style={{ fontSize: 12, color: colors.foreground }}>{a.status === 'ACTIVE' ? '归档' : '恢复'}</Text>
                      </Pressable>
                      <Pressable onPress={() => remove(a)} style={opBtn}>
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
      <FormSheet visible={sheet} title={editing ? '编辑账户' : '新建账户'} onClose={() => setSheet(false)} onSave={save} saveLabel={editing ? '保存' : '创建'}>
        <ScrollView keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false} style={{ maxHeight: 340 }}>
          <Text style={labelStyle}>账户名称</Text>
          <TextInput value={name} onChangeText={setName} placeholder="如 工资卡" placeholderTextColor={colors.mutedForeground} style={inputStyle} />

          <Text style={labelStyle}>类型</Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            {TYPE_KEYS.map((t) => {
              const active = type === t;
              return (
                <Pressable key={t} onPress={() => setType(t)} style={{ paddingHorizontal: 12, paddingVertical: 6, borderRadius: 999, borderWidth: 1, borderColor: active ? colors.primary : colors.border, backgroundColor: active ? alpha(colors.primary, 0.1) : colors.muted }}>
                  <Text style={{ fontSize: 12, color: active ? colors.primary : colors.mutedForeground, fontWeight: active ? '600' : '400' }}>{TYPE_LABEL[t]}</Text>
                </Pressable>
              );
            })}
          </View>

          {!editing && (
            <>
              <Text style={labelStyle}>初始余额</Text>
              <TextInput value={initial} onChangeText={setInitial} placeholder="0.00" placeholderTextColor={colors.mutedForeground} keyboardType="decimal-pad" style={inputStyle} />
            </>
          )}

          <Text style={labelStyle}>卡号/账号</Text>
          <TextInput value={accountNo} onChangeText={setAccountNo} placeholder="选填" placeholderTextColor={colors.mutedForeground} style={inputStyle} />

          <Text style={labelStyle}>开户行</Text>
          <TextInput value={bankName} onChangeText={setBankName} placeholder="选填" placeholderTextColor={colors.mutedForeground} style={inputStyle} />
        </ScrollView>
      </FormSheet>

      {/* 余额调整 */}
      <FormSheet visible={adjusting} title="余额调整" onClose={() => { setAdjusting(false); setEditing(null); }} onSave={saveAdjust} saveLabel="确认调整">
        <Text style={labelStyle}>调整后余额</Text>
        <TextInput value={adjustBalance} onChangeText={setAdjustBalance} placeholder="0.00" placeholderTextColor={colors.mutedForeground} keyboardType="decimal-pad" style={inputStyle} />
        <Text style={labelStyle}>备注(选填)</Text>
        <TextInput value={adjustRemark} onChangeText={setAdjustRemark} placeholder="如 更正账单" placeholderTextColor={colors.mutedForeground} style={inputStyle} />
      </FormSheet>

      {/* 调整历史 */}
      <FormSheet visible={historyOpen} title={`调整记录 · ${historyAccount?.name ?? ''}`} onClose={() => { setHistoryOpen(false); setHistoryAccount(null); }}>
        <Text variant="muted" style={{ fontSize: 12, marginBottom: 10 }}>当前余额 {historyAccount ? formatMoney(historyAccount.balance) : '-'}</Text>
        {adjustments.length === 0 ? (
          <Text variant="muted" style={{ textAlign: 'center', paddingVertical: 24, fontSize: 13 }}>暂无调整记录</Text>
        ) : (
          adjustments.map((adj) => (
            <View key={adj.id} style={{ paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: colors.hairline, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
              <View>
                <Text style={{ fontSize: 13, color: colors.foreground }}>调整后 {formatMoney(adj.balanceAfter)}</Text>
                <Text variant="muted" style={{ fontSize: 11, marginTop: 2 }}>{adj.date}{adj.remark ? ` · ${adj.remark}` : ''}</Text>
              </View>
            </View>
          ))
        )}
      </FormSheet>
    </Screen>
  );
}
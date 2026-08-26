import { useEffect, useState } from 'react';
import { Pressable, ScrollView, Switch, TextInput, View } from 'react-native';
import { Plus, ArrowUpRight, ArrowDownRight, ArrowLeftRight, Trash2 } from 'lucide-react-native';
import { useTheme, alpha } from '@/theme';
import { Screen } from '@/components/Screen';
import { Card } from '@/components/ui/Card';
import { Text } from '@/components/ui/Text';
import { Button } from '@/components/ui/Button';
import { FadeInView } from '@/components/FadeInView';
import { FormSheet } from '@/components/chrome/FormSheet';
import { useUIShell } from '@/components/chrome/chrome';
import { createRecurringApi, deleteRecurringApi, fetchRecurring, toggleRecurringApi, updateRecurringApi } from '@/services/recurring';
import { fetchAccounts } from '@/services/records';
import { formatMoney } from '@/lib/format';
import type { AccountItem, RecordType, RecurringTransaction } from '@/types';

const TYPE_KEYS: RecordType[] = ['INCOME', 'EXPENSE', 'TRANSFER'];
const TYPE_LABEL: Record<RecordType, string> = { INCOME: '收入', EXPENSE: '支出', TRANSFER: '转账' };
const TYPE_ICON = { INCOME: ArrowUpRight, EXPENSE: ArrowDownRight, TRANSFER: ArrowLeftRight } as const;
const TYPE_COLOR: Record<RecordType, 'income' | 'expense' | 'transfer'> = { INCOME: 'income', EXPENSE: 'expense', TRANSFER: 'transfer' };

// 固定收支:列表 + 启停 + 新增/编辑/删除(设计优先 mock;贷款特殊字段简化)
export default function RecurringScreen() {
  const { colors } = useTheme();
  const { currentLedger } = useUIShell();
  const bookId = currentLedger.id;
  const [items, setItems] = useState<RecurringTransaction[]>([]);
  const [accounts, setAccounts] = useState<AccountItem[]>([]);
  const [sheet, setSheet] = useState(false);
  const [editing, setEditing] = useState<RecurringTransaction | null>(null);

  const [name, setName] = useState('');
  const [type, setType] = useState<RecordType>('EXPENSE');
  const [amount, setAmount] = useState('');
  const [accountId, setAccountId] = useState('');
  const [category, setCategory] = useState('');
  const [cron, setCron] = useState('');
  const [active, setActive] = useState(true);

  useEffect(() => {
    if (!bookId) return;
    fetchRecurring(bookId).then(setItems);
    fetchAccounts(bookId).then(setAccounts);
  }, [bookId]);

  const resetForm = () => {
    setName('');
    setType('EXPENSE');
    setAmount('');
    setAccountId(accounts[0]?.id ?? '');
    setCategory('');
    setCron('');
    setActive(true);
  };

  const openCreate = () => {
    resetForm();
    setEditing(null);
    setSheet(true);
  };

  const openEdit = (t: RecurringTransaction) => {
    setName(t.name);
    setType(t.type);
    setAmount(String(t.amount && t.recurringType !== 'LOAN' ? t.amount : ''));
    setAccountId(t.accountId);
    setCategory(t.categoryName ?? '');
    setCron(t.cron);
    setActive(t.active);
    setEditing(t);
    setSheet(true);
  };

  const reload = () => {
    if (bookId) fetchRecurring(bookId).then(setItems);
  };

  const toggle = async (t: RecurringTransaction) => {
    await toggleRecurringApi(t.id, !t.active);
    reload();
  };

  const remove = async (t: RecurringTransaction) => {
    await deleteRecurringApi(t.id);
    setEditing(null);
    setSheet(false);
    reload();
  };

  const save = async () => {
    if (!name) return;
    const payload = {
      name,
      type,
      amount: parseFloat(amount) || 0,
      accountId,
      categoryCode: category || undefined,
      cron: cron || '0 0 1 * *',
    };
    if (editing) {
      await updateRecurringApi(editing.id, payload);
    } else {
      await createRecurringApi(bookId, payload);
    }
    setSheet(false);
    resetForm();
    reload();
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
          <Text style={{ fontSize: 20, fontWeight: '700' }}>固定收支</Text>
          <Pressable onPress={openCreate} style={{ width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center', backgroundColor: alpha(colors.primary, 0.12) }}>
            <Plus size={18} color={colors.primary} />
          </Pressable>
        </View>

        <ScrollView contentContainerStyle={{ paddingBottom: 40 }} showsVerticalScrollIndicator={false}>
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
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                          <Text style={{ fontSize: 15, fontWeight: '600' }}>{t.name}</Text>
                          <View style={{ paddingHorizontal: 7, paddingVertical: 2, borderRadius: 6, backgroundColor: alpha(color, 0.12) }}>
                            <Text style={{ fontSize: 10, color, fontWeight: '600' }}>{TYPE_LABEL[t.type]}</Text>
                          </View>
                        </View>
                        <Text variant="muted" style={{ fontSize: 12, marginTop: 2 }}>
                          {t.cron}{t.recurringType === 'LOAN' ? '· 贷款' : ''}{t.nextGenerateAt ? ` · 下次 ${t.nextGenerateAt}` : ''}
                        </Text>
                      </View>
                      {t.recurringType === 'LOAN' ? (
                        <Text style={{ fontSize: 13, color, fontWeight: '600' }}>还款计划</Text>
                      ) : (
                        <Text style={{ fontSize: 16, fontWeight: '700', fontVariant: ['tabular-nums'], color }} numberOfLines={1}>
                          {t.type === 'INCOME' ? '+' : '-'}{formatMoney(t.amount)}
                        </Text>
                      )}
                    </View>
                    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', gap: 8, marginTop: 10 }}>
                      <Switch value={t.active} onValueChange={() => toggle(t)} trackColor={{ true: colors.primary }} thumbColor="#fff" />
                      <Text style={{ fontSize: 12, color: t.active ? colors.primary : colors.mutedForeground, fontWeight: '500' }}>{t.active ? '已启用' : '已停用'}</Text>
                      <Pressable onPress={() => remove(t)} style={{ marginLeft: 4, padding: 6 }}>
                        <Trash2 size={16} color={colors.mutedForeground} />
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
      <FormSheet visible={sheet} title={editing ? '编辑固定收支' : '新增固定收支'} onClose={() => setSheet(false)} onSave={save} saveLabel={editing ? '保存' : '创建'}>
        <ScrollView keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false} style={{ maxHeight: 400 }}>
          <Text style={labelStyle}>名称</Text>
          <TextInput value={name} onChangeText={setName} placeholder="如 每月房租" placeholderTextColor={colors.mutedForeground} style={inputStyle} />

          <Text style={labelStyle}>类型</Text>
          <View style={{ flexDirection: 'row', gap: 8 }}>
            {TYPE_KEYS.map((tk) => {
              const active = type === tk;
              const c = colors[TYPE_COLOR[tk]];
              return (
                <Pressable key={tk} onPress={() => setType(tk)} style={{ flex: 1, alignItems: 'center', paddingVertical: 9, borderRadius: 999, borderWidth: 1, borderColor: active ? c : colors.border, backgroundColor: active ? alpha(c, 0.12) : colors.muted }}>
                  <Text style={{ fontSize: 13, color: active ? c : colors.mutedForeground, fontWeight: '600' }}>{TYPE_LABEL[tk]}</Text>
                </Pressable>
              );
            })}
          </View>

          <Text style={labelStyle}>金额</Text>
          <TextInput value={amount} onChangeText={setAmount} placeholder="0.00" placeholderTextColor={colors.mutedForeground} keyboardType="decimal-pad" style={inputStyle} />

          <Text style={labelStyle}>账户</Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            {accounts.map((a) => {
              const selected = accountId === a.id;
              return (
                <Pressable key={a.id} onPress={() => setAccountId(a.id)} style={{ paddingHorizontal: 12, paddingVertical: 6, borderRadius: 999, borderWidth: 1, borderColor: selected ? colors.primary : colors.border, backgroundColor: selected ? alpha(colors.primary, 0.1) : colors.muted }}>
                  <Text style={{ fontSize: 12, color: selected ? colors.primary : colors.mutedForeground, fontWeight: selected ? '600' : '400' }}>{a.name}</Text>
                </Pressable>
              );
            })}
          </View>

          <Text style={labelStyle}>分类</Text>
          <TextInput value={category} onChangeText={setCategory} placeholder="如 餐饮" placeholderTextColor={colors.mutedForeground} style={inputStyle} />

          <Text style={labelStyle}>周期</Text>
          <TextInput value={cron} onChangeText={setCron} placeholder="如 每月 10 日" placeholderTextColor={colors.mutedForeground} style={inputStyle} />

          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 14 }}>
            <Text style={{ fontSize: 14 }}>启用</Text>
            <Switch value={active} onValueChange={setActive} trackColor={{ true: colors.primary }} thumbColor="#fff" />
          </View>

          {editing && (
            <Button title="删除" variant="outline" icon={<Trash2 size={16} color={colors.expense} />} style={{ marginTop: 16, borderColor: colors.expense }} onPress={() => remove(editing)} />
          )}
        </ScrollView>
      </FormSheet>
    </Screen>
  );
}
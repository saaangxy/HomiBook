import { useEffect, useState } from 'react';
import { Pressable, ScrollView, TextInput, View } from 'react-native';
import { router } from 'expo-router';
import { X, Check, ChevronDown } from 'lucide-react-native';
import { useTheme } from '@/theme';
import { Screen } from '@/components/Screen';
import { Button } from '@/components/ui/Button';
import { Text } from '@/components/ui/Text';
import { AnimatedPressable } from '@/components/AnimatedPressable';
import { fetchCategories, fetchAccounts } from '@/services/records';
import type { Category, AccountItem } from '@/types';

type Type = 'EXPENSE' | 'INCOME';

const KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '.', '0', '⌫'];

export default function AddRecordScreen() {
  const { colors } = useTheme();
  const [type, setType] = useState<Type>('EXPENSE');
  const [amount, setAmount] = useState('');
  const [categories, setCategories] = useState<Category[]>([]);
  const [accounts, setAccounts] = useState<AccountItem[]>([]);
  const [selectedCat, setSelectedCat] = useState<string | null>(null);
  const [selectedAccount, setSelectedAccount] = useState<string | null>(null);
  const [remark, setRemark] = useState('');

  useEffect(() => {
    fetchCategories().then((c) => {
      setCategories(c.filter((x) => (type === 'EXPENSE' ? x.type === 'EXPENSE' : x.type === 'INCOME')));
    });
    fetchAccounts().then((a) => {
      setAccounts(a.filter((x) => x.status === 'ACTIVE'));
      setSelectedAccount(a[0]?.id ?? null);
    });
  }, [type]);

  const pressKey = (k: string) => {
    if (k === '⌫') setAmount((v) => v.slice(0, -1));
    else if (k === '.') { if (!amount.includes('.')) setAmount((v) => v + '.'); }
    else setAmount((v) => (v.length < 9 ? v + k : v));
  };

  const amountValue = parseFloat(amount) || 0;

  return (
    <Screen keyboard>
      <View className="flex-1 px-5 pt-3">
        {/* 顶部 */}
        <View className="flex-row items-center justify-between mb-4">
          <Pressable onPress={() => router.back()} className="w-9 h-9 rounded-full items-center justify-center" style={{ backgroundColor: colors.muted }}>
            <X size={18} color={colors.foreground} />
          </Pressable>
          <Text variant="bold" style={{ fontSize: 16 }}>记一笔</Text>
          <View style={{ width: 36 }} />
        </View>

        {/* 类型切换 */}
        <View className="flex-row rounded-full p-1 mb-4" style={{ backgroundColor: colors.muted }}>
          {(['EXPENSE', 'INCOME'] as Type[]).map((t) => (
            <Pressable key={t} className="flex-1 py-2 rounded-full items-center" style={{ backgroundColor: type === t ? (t === 'EXPENSE' ? colors.expense : colors.income) : 'transparent' }} onPress={() => setType(t)}>
              <Text style={{ color: type === t ? '#fff' : colors.mutedForeground, fontWeight: '600' }}>{t === 'EXPENSE' ? '支出' : '收入'}</Text>
            </Pressable>
          ))}
        </View>

        {/* 金额 */}
        <View className="items-center mb-4">
          <Text style={{ color: type === 'EXPENSE' ? colors.expense : colors.income, fontSize: 44, fontWeight: '800', fontVariant: ['tabular-nums'] }}>
            {amount ? `¥${amount}` : '¥0'}
          </Text>
        </View>

        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 12 }}>
          {/* 分类九宫格 */}
          <View className="flex-row flex-wrap mb-4">
            {categories.map((c) => {
              const active = selectedCat === c.code;
              return (
                <Pressable
                  key={c.code}
                  className="w-1/4 py-2 items-center"
                  onPress={() => setSelectedCat(c.code)}
                >
                  <View
                    className="w-14 h-14 rounded-2xl items-center justify-center mb-1"
                    style={{ backgroundColor: active ? colors.primary : colors.muted }}
                  >
                    <Text style={{ color: active ? colors.primaryForeground : colors.mutedForeground, fontSize: 24 }}>{c.code.slice(0, 1)}</Text>
                  </View>
                  <Text variant="muted" style={{ fontSize: 11 }}>{c.label}</Text>
                </Pressable>
              );
            })}
          </View>

          {/* 账户 + 备注 */}
          <View className="gap-3 mb-4">
            <Pressable className="flex-row items-center gap-2 rounded-2xl border px-4 py-3" style={{ borderColor: colors.border, backgroundColor: colors.card }}>
              <Text variant="muted" style={{ fontSize: 13 }}>账户</Text>
              <View className="flex-1" />
              <Text style={{ color: colors.foreground, fontSize: 14 }}>{accounts.find((a) => a.id === selectedAccount)?.name ?? '选择账户'}</Text>
              <ChevronDown size={16} color={colors.mutedForeground} />
            </Pressable>
            <TextInput
              value={remark}
              onChangeText={setRemark}
              placeholder="备注（可选）"
              placeholderTextColor={colors.mutedForeground}
              className="rounded-2xl border px-4 py-3"
              style={{ borderColor: colors.border, backgroundColor: colors.card, color: colors.foreground }}
            />
          </View>

          <Button title="保 存" size="lg" icon={<Check size={18} color="#fff" />} onPress={() => router.back()} />
        </ScrollView>

        {/* 数字键盘 */}
        <View className="flex-row flex-wrap mt-2" style={{ maxWidth: 420, alignSelf: 'center' }}>
          {KEYS.map((k) => (
            <AnimatedPressable
              key={k}
              scale={0.94}
              onPress={() => pressKey(k)}
              className="w-1/3 items-center justify-center h-12"
            >
              <Text style={{ color: colors.foreground, fontSize: 22, fontWeight: '600' }}>{k}</Text>
            </AnimatedPressable>
          ))}
        </View>
      </View>
    </Screen>
  );
}
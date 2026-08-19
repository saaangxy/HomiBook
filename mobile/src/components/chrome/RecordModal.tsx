import { useState } from 'react';
import { Modal, Pressable, ScrollView, TextInput, View } from 'react-native';
import { Send } from 'lucide-react-native';
import Animated, { FadeIn, SlideInDown } from 'react-native-reanimated';
import { useTheme } from '@/theme';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Text } from '@/components/ui/Text';
import { Button } from '@/components/ui/Button';
import { DatePicker } from '@/components/ui/DatePicker';
import { mockCategories, mockAccounts } from '@/mock/data';
import { useUIShell } from './chrome';
import { useRecords } from '@/stores/records';

type RecordType = 'EXPENSE' | 'INCOME' | 'TRANSFER';
type Mode = 'manual' | 'ai';
type ChatMsg = { role: 'user' | 'assistant'; text: string; confirm?: boolean };

const AI_GREETING =
  '你好，我是 AI 记账助手 🤖\n直接描述一笔收支就行，例如：「中午星巴克拿铁 32 元」。我会自动识别分类与金额，你确认后即可记账。';

const CAT_EMOJI: Record<string, string> = {
  餐饮: '🍔', 购物: '🛒', 交通: '🚗', 住房: '🏠', 教育: '📚', 医疗: '💊', 娱乐: '🎮', 保险: '🛡️',
  工资: '💰', 奖金: '🎁', 投资收益: '📈', 分红: '🏦', 其他: '📦',
};

// AI 关键词 -> 分类(简化 mock)
const AI_RULES: Array<[RegExp, string, RecordType]> = [
  [/咖啡|奶茶|午餐|午|早餐|晚餐|吃饭|外卖/, '餐饮', 'EXPENSE'],
  [/超市|购物|买|衣服|快递/, '购物', 'EXPENSE'],
  [/打车|地铁|公交|加油|停车|高铁|机票/, '交通', 'EXPENSE'],
  [/房租|物业|水电|房贷/, '住房', 'EXPENSE'],
  [/电影|游戏|ktv|娱乐/, '娱乐', 'EXPENSE'],
  [/工资|发薪|薪水/, '工资', 'INCOME'],
  [/奖金|绩效/, '奖金', 'INCOME'],
  [/分红|理财/, '投资收益', 'INCOME'],
];

function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// 记一笔:手动(类型/金额/分类/账户/日期/备注,仿网页 form) 或 AI(自然语言简述);保存后即时入流水
export function RecordModal() {
  const { colors } = useTheme();
  const { recordOpen, closeRecord } = useUIShell();
  const { addRecord } = useRecords();
  const insets = useSafeAreaInsets();

  const [mode, setMode] = useState<Mode>('manual');
  const [type, setType] = useState<RecordType>('EXPENSE');
  const [amount, setAmount] = useState('0');
  const [cat, setCat] = useState('餐饮');
  const [accountId, setAccountId] = useState(mockAccounts.find((a) => a.status === 'ACTIVE')?.id ?? '');
  const [toId, setToId] = useState(mockAccounts.filter((a) => a.status === 'ACTIVE')[1]?.id ?? '');
  const [date, setDate] = useState(todayStr);
  const [remark, setRemark] = useState('');
  const [chatMsgs, setChatMsgs] = useState<ChatMsg[]>([{ role: 'assistant', text: AI_GREETING }]);
  const [chatInput, setChatInput] = useState('');
  const [chatTyping, setChatTyping] = useState(false);

  const categories = mockCategories.filter((c) => (type === 'EXPENSE' ? c.type === 'EXPENSE' : c.type === 'INCOME'));
  const accounts = mockAccounts.filter((a) => a.status === 'ACTIVE');
  const account = accounts.find((a) => a.id === accountId) ?? accounts[0];

  const resetForm = () => {
    setType('EXPENSE');
    setAmount('0');
    setCat('餐饮');
    setAccountId(accounts[0]?.id ?? '');
    setToId(accounts[1]?.id ?? accounts[0]?.id ?? '');
    setDate(todayStr());
    setRemark('');
    setChatMsgs([{ role: 'assistant', text: AI_GREETING }]);
    setChatInput('');
    setChatTyping(false);
  };

  const close = () => {
    closeRecord();
    resetForm();
  };

  const save = () => {
    const amt = parseFloat(amount);
    if (!amt || amt <= 0) return;
    if (type === 'TRANSFER') {
      const from = accounts.find((a) => a.id === accountId) ?? accounts[0];
      const to = accounts.find((a) => a.id === toId) ?? accounts[1] ?? accounts[0];
      if (from?.id === to?.id) return;
      addRecord({
        type: 'TRANSFER',
        amount: amt,
        date,
        remark: remark.trim() || `转至 ${to?.name ?? ''}`,
        categoryCode: null,
        categoryName: '转账',
        accountId: from?.id ?? '',
        accountName: from?.name ?? '',
        toAccountId: to?.id,
        toAccountName: to?.name,
        ownerName: '我',
        tags: [],
      });
      close();
      return;
    }
    addRecord({
      type,
      amount: amt,
      date,
      remark: remark.trim() || null,
      categoryCode: cat,
      categoryName: cat,
      accountId: account?.id ?? '',
      accountName: account?.name ?? '',
      ownerName: '我',
      tags: [],
    });
    close();
  };

  // AI 识别:解析金额/分类/类型/备注并填入表单,返回确认气泡
  const resolveAI = (ai: string): ChatMsg => {
    const m = ai.match(/(\d+(?:\.\d+)?)/);
    const amt = m ? parseFloat(m[1]) : 0;
    const rule = AI_RULES.find(([re]) => re.test(ai));
    const t = rule ? rule[2] : 'EXPENSE';
    const c = rule ? rule[1] : '其他';
    const clean = ai.replace(/\d+(?:\.\d+)?/, '').trim();
    if (!amt) {
      return { role: 'assistant', text: '没识别到金额哦，请带上具体金额，比如「中午星巴克拿铁 32 元」。' };
    }
    setType(t);
    setAmount(String(amt));
    setCat(c);
    setRemark(clean);
    return {
      role: 'assistant',
      text: `识别到${t === 'EXPENSE' ? '支出' : '收入'} ¥${amt.toFixed(2)}，分类「${c}」${clean ? `，备注「${clean}」` : ''}。确认后即可保存。`,
      confirm: true,
    };
  };

  // AI 聊天:发送描述 → 打字 → AI 回复识别结果(仿网页 ChatWindow)
  const sendAI = () => {
    const text = chatInput.trim();
    if (!text || chatTyping) return;
    setChatMsgs((p) => [...p, { role: 'user', text }]);
    setChatInput('');
    setChatTyping(true);
    setTimeout(() => {
      setChatMsgs((p) => [...p, resolveAI(text)]);
      setChatTyping(false);
    }, 500);
  };

  const display = amount === '0' ? '0.00' : amount.indexOf('.') >= 0 ? parseFloat(amount).toFixed(2) : amount;
  const amountColor = type === 'EXPENSE' ? colors.expense : type === 'INCOME' ? colors.income : colors.transfer;
  const typeLabel = type === 'EXPENSE' ? '支出' : type === 'INCOME' ? '收入' : '转账';
  // 类型选项(仿网页 Tabs:支出红/收入绿/转账蓝)
  const TYPE_OPTS: { key: RecordType; label: string; color: string }[] = [
    { key: 'EXPENSE', label: '支出', color: colors.expense },
    { key: 'INCOME', label: '收入', color: colors.income },
    { key: 'TRANSFER', label: '转账', color: colors.transfer },
  ];

  const chip = (label: string, active: boolean, onPress: () => void) => (
    <Pressable
      key={label}
      onPress={onPress}
      style={{ paddingHorizontal: 12, paddingVertical: 7, borderRadius: 999, borderWidth: 1, backgroundColor: active ? '#f97316' : colors.muted, borderColor: active ? '#f97316' : colors.border }}
    >
      <Text style={{ fontSize: 12, color: active ? '#fff' : colors.foreground, fontWeight: active ? '600' : '400' }}>{label}</Text>
    </Pressable>
  );

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
  const fieldLabel = (t: string) => (
    <Text style={{ fontSize: 12, color: colors.mutedForeground, marginBottom: 6, marginTop: 2 }}>{t}</Text>
  );

  return (
    <Modal visible={recordOpen} transparent animationType="none" onRequestClose={close}>
      <View style={{ flex: 1, justifyContent: 'flex-end' }}>
        <Animated.View entering={FadeIn.duration(160)} style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.45)' }}>
          <Pressable style={{ flex: 1 }} onPress={close} />
        </Animated.View>

        <Animated.View
          entering={SlideInDown.springify().damping(22)}
          style={{ backgroundColor: colors.card, borderTopLeftRadius: 24, borderTopRightRadius: 24, paddingHorizontal: 20, paddingTop: 14, paddingBottom: Math.max(insets.bottom, 18), maxHeight: '94%' }}
        >
          {/* 标题 + 模式切换 + 关闭 */}
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
            <Text style={{ fontSize: 18, fontWeight: '700' }}>记一笔</Text>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
              <View style={{ flexDirection: 'row', backgroundColor: colors.muted, borderRadius: 999, padding: 3 }}>
                {(['manual', 'ai'] as Mode[]).map((md) => {
                  const active = mode === md;
                  return (
                    <Pressable key={md} onPress={() => setMode(md)} style={{ paddingHorizontal: 14, paddingVertical: 5, borderRadius: 999, backgroundColor: active ? colors.foreground : 'transparent' }}>
                      <Text style={{ fontSize: 12, fontWeight: '600', color: active ? '#fff' : colors.mutedForeground }}>{md === 'manual' ? '手动' : 'AI'}</Text>
                    </Pressable>
                  );
                })}
              </View>
              <Pressable onPress={close} style={{ width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.muted }}>
                <Text style={{ color: colors.mutedForeground, fontSize: 15 }}>✕</Text>
              </Pressable>
            </View>
          </View>

          {mode === 'manual' ? (
            <>
              <ScrollView showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
                {/* 金额 */}
                <View style={{ marginBottom: 14, marginTop: 2 }}>
                  {fieldLabel('金额')}
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                    <Text style={{ fontSize: 24, fontWeight: '700', color: amountColor }}>¥</Text>
                    <TextInput
                      value={amount}
                      onChangeText={setAmount}
                      keyboardType="decimal-pad"
                      placeholder="0.00"
                      placeholderTextColor={colors.mutedForeground}
                      style={[{ flex: 1, fontSize: 22, fontWeight: '700', color: amountColor, fontVariant: ['tabular-nums'] }, inputStyle]}
                    />
                  </View>
                </View>

                {/* 类型(仿网页 Tabs 分段控件) */}
                {fieldLabel('类型')}
                <View style={{ flexDirection: 'row', backgroundColor: colors.muted, borderRadius: 12, padding: 4, marginBottom: 14 }}>
                  {TYPE_OPTS.map((t) => {
                    const active = type === t.key;
                    return (
                      <Pressable
                        key={t.key}
                        onPress={() => setType(t.key)}
                        style={{
                          flex: 1, paddingVertical: 10, borderRadius: 9, alignItems: 'center', justifyContent: 'center',
                          backgroundColor: active ? colors.card : 'transparent',
                          shadowColor: '#000', shadowOpacity: active ? 0.08 : 0, shadowRadius: 6, shadowOffset: { width: 0, height: 2 }, elevation: active ? 2 : 0,
                        }}
                      >
                        <Text style={{ fontSize: 14, fontWeight: active ? '700' : '500', color: active ? t.color : colors.mutedForeground }}>{t.label}</Text>
                      </Pressable>
                    );
                  })}
                </View>

                {/* 分类(转账无分类) */}
                {type !== 'TRANSFER' && (
                  <>
                    {fieldLabel('分类')}
                    <View style={{ flexDirection: 'row', flexWrap: 'wrap', marginBottom: 14 }}>
                      {categories.map((c) => {
                        const active = cat === c.code;
                        return (
                          <Pressable
                            key={c.code}
                            onPress={() => setCat(c.code)}
                            style={{ width: '25%', alignItems: 'center', paddingVertical: 9, paddingHorizontal: 4, justifyContent: 'center', borderRadius: 14, borderWidth: 2, borderColor: active ? colors.primary : 'transparent', backgroundColor: active ? 'rgba(249,115,22,0.12)' : colors.muted }}
                          >
                            <Text style={{ fontSize: 21 }}>{CAT_EMOJI[c.code] ?? '📦'}</Text>
                            <Text style={{ fontSize: 11, marginTop: 4, fontWeight: active ? '600' : '400', color: active ? colors.primary : colors.mutedForeground }}>{c.label}</Text>
                          </Pressable>
                        );
                      })}
                    </View>
                  </>
                )}

                {/* 账户:转账为转出/转入,其余为单账户 */}
                {type === 'TRANSFER' ? (
                  <>
                    {fieldLabel('转出账户')}
                    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 14 }}>
                      {accounts.map((a) => chip(a.name, accountId === a.id, () => setAccountId(a.id)))}
                    </View>
                    {fieldLabel('转入账户')}
                    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 14 }}>
                      {accounts.map((a) => chip(a.name, toId === a.id, () => setToId(a.id)))}
                    </View>
                  </>
                ) : (
                  <>
                    {fieldLabel('账户')}
                    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 14 }}>
                      {accounts.map((a) => chip(a.name, accountId === a.id, () => setAccountId(a.id)))}
                    </View>
                  </>
                )}

                {/* 日期(仿网页 DatePicker) */}
                {fieldLabel('日期')}
                <View style={{ marginBottom: 14 }}>
                  <DatePicker value={date} onChange={setDate} />
                </View>

                {/* 备注 */}
                {fieldLabel('备注')}
                <TextInput
                  value={remark}
                  onChangeText={setRemark}
                  placeholder="添加备注..."
                  placeholderTextColor={colors.mutedForeground}
                  multiline
                  style={[inputStyle, { minHeight: 64, textAlignVertical: 'top' }]}
                />
              </ScrollView>

              {/* 底部操作 */}
              <View style={{ marginTop: 10 }}>
                <Button title={`保存${typeLabel} ¥${display}`} onPress={save} />
              </View>
            </>
          ) : (
            <View style={{ paddingVertical: 4 }}>
              {/* 消息列表 */}
              <ScrollView style={{ maxHeight: 340 }} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
                {chatMsgs.map((m, i) => {
                  const isUser = m.role === 'user';
                  return (
                    <View key={i} style={{ flexDirection: 'row', justifyContent: isUser ? 'flex-end' : 'flex-start', marginBottom: 10 }}>
                      <View
                        style={{
                          maxWidth: '88%', borderRadius: 16, borderTopLeftRadius: isUser ? 16 : 4, borderTopRightRadius: isUser ? 4 : 16,
                          paddingHorizontal: 12, paddingVertical: 9, backgroundColor: isUser ? colors.primary : colors.muted,
                        }}
                      >
                        <Text style={{ fontSize: 14, lineHeight: 20, color: isUser ? '#fff' : colors.foreground }}>{m.text}</Text>
                        {m.confirm && (
                          <View style={{ marginTop: 10 }}>
                            <Button title="确认记一笔" onPress={save} />
                          </View>
                        )}
                      </View>
                    </View>
                  );
                })}
                {chatTyping && (
                  <View style={{ alignItems: 'flex-start', marginBottom: 10 }}>
                    <View style={{ borderRadius: 16, borderTopLeftRadius: 4, paddingHorizontal: 12, paddingVertical: 9, backgroundColor: colors.muted }}>
                      <Text style={{ fontSize: 14, color: colors.mutedForeground }}>AI 正在识别...</Text>
                    </View>
                  </View>
                )}
              </ScrollView>

              {/* 快捷例句 */}
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 10, marginTop: 4 }}>
                {['中午星巴克拿铁 32 元', '打车去机场 45 元'].map((q) => (
                  <Pressable key={q} disabled={chatTyping} onPress={() => setChatInput(q)} style={{ paddingHorizontal: 12, paddingVertical: 6, borderRadius: 999, backgroundColor: colors.muted }}>
                    <Text style={{ fontSize: 12, color: colors.foreground }}>{q}</Text>
                  </Pressable>
                ))}
              </View>

              {/* 输入区 */}
              <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 8 }}>
                <TextInput
                  value={chatInput}
                  onChangeText={setChatInput}
                  placeholder="描述一笔收支，如「中午星巴克拿铁 32 元」"
                  placeholderTextColor={colors.mutedForeground}
                  multiline
                  editable={!chatTyping}
                  style={{ flex: 1, minHeight: 46, maxHeight: 88, borderRadius: 18, backgroundColor: colors.muted, paddingHorizontal: 14, paddingVertical: 11, color: colors.foreground, fontSize: 14, textAlignVertical: 'center', borderWidth: 1, borderColor: colors.border }}
                />
                <Pressable
                  onPress={sendAI}
                  disabled={!chatInput.trim() || chatTyping}
                  style={{ width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center', backgroundColor: !chatInput.trim() || chatTyping ? '#fbc39a' : colors.primary }}
                >
                  <Send size={17} color="#fff" />
                </Pressable>
              </View>
            </View>
          )}
        </Animated.View>
      </View>
    </Modal>
  );
}
import { useEffect, useState } from 'react';
import { Modal, Pressable, ScrollView, TextInput, View, useWindowDimensions } from 'react-native';
import { List, Plus, Send, Trash2 } from 'lucide-react-native';
import Animated, { FadeIn, SlideInDown } from 'react-native-reanimated';
import { useTheme, alpha, haptics } from '@/theme';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Text } from '@/components/ui/Text';
import { Button } from '@/components/ui/Button';
import { DatePicker } from '@/components/ui/DatePicker';
import { SelectSheet } from '@/components/ui/SelectSheet';
import { FormSheet } from './FormSheet';
import { useUIShell } from './chrome';
import { useRecords } from '@/stores/records';

type RecordType = 'EXPENSE' | 'INCOME' | 'TRANSFER';
type Mode = 'manual' | 'ai';
type ChatMsg = { role: 'user' | 'assistant'; text: string; confirm?: boolean };

interface ChatSession {
  id: string;
  title: string;
  updatedAt: number;
  msgs: ChatMsg[];
}

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

function timeAgo(ts: number): string {
  const diff = Date.now() - ts;
  if (diff < 60_000) return '刚刚';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} 分钟前`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)} 小时前`;
  const d = new Date(ts);
  return `${d.getMonth() + 1}月${d.getDate()}日`;
}

const newSession = (): ChatSession => ({
  id: `s${Date.now()}`,
  title: '新会话',
  updatedAt: Date.now(),
  msgs: [{ role: 'assistant', text: AI_GREETING }],
});

// 记一笔:手动(字段顺序对齐网页:类型/金额/账户/日期/分类下拉/交易方/备注) 或 AI(会话式聊天,可切换会话)
export function RecordModal() {
  const { colors } = useTheme();
  const { recordOpen, closeRecord, editingRecord } = useUIShell();
  const { addRecord, updateRecord, accounts: allAccounts, categories: allCategories } = useRecords();
  const insets = useSafeAreaInsets();
  const { height: screenH } = useWindowDimensions();

  const [mode, setMode] = useState<Mode>('manual');
  const [type, setType] = useState<RecordType>('EXPENSE');
  const [amount, setAmount] = useState('0');
  const [cat, setCat] = useState('餐饮');
  const [accountId, setAccountId] = useState('');
  const [toId, setToId] = useState('');
  const [date, setDate] = useState(todayStr);
  const [remark, setRemark] = useState('');
  const [counterparty, setCounterparty] = useState('');
  // AI 会话(本地 mock:多会话独立消息,首条消息自动命名)
  const [sessions, setSessions] = useState<ChatSession[]>([newSession()]);
  const [currentSessionId, setCurrentSessionId] = useState<string>('');
  const [sessionListOpen, setSessionListOpen] = useState(false);
  const [chatInput, setChatInput] = useState('');
  const [chatTyping, setChatTyping] = useState(false);

  const categories = allCategories.filter((c) => (type === 'EXPENSE' ? c.type === 'EXPENSE' : c.type === 'INCOME'));
  const accounts = allAccounts.filter((a) => a.status === 'ACTIVE');
  const account = accounts.find((a) => a.id === accountId) ?? accounts[0];

  // 当前会话(无则取第一个)
  const currentSession = sessions.find((s) => s.id === currentSessionId) ?? sessions[0];
  const chatMsgs = currentSession?.msgs ?? [];

  // 打开时:编辑模式预填表单(强制手动模式);新建则重置默认
  useEffect(() => {
    if (!recordOpen) return;
    if (editingRecord) {
      setMode('manual');
      setType(editingRecord.type);
      setAmount(String(editingRecord.amount));
      setCat(editingRecord.categoryCode ?? '餐饮');
      setAccountId(editingRecord.accountId);
      setToId(editingRecord.toAccountId ?? '');
      setDate(editingRecord.date);
      setRemark(editingRecord.remark ?? '');
      setCounterparty(editingRecord.counterparty ?? '');
    } else {
      setMode('manual');
      setType('EXPENSE');
      setAmount('0');
      setCat(categories[0]?.code ?? '餐饮');
      setAccountId(accounts[0]?.id ?? '');
      setToId(accounts[1]?.id ?? accounts[0]?.id ?? '');
      setDate(todayStr());
      setRemark('');
      setCounterparty('');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recordOpen, editingRecord]);

  const close = () => {
    closeRecord();
    setChatInput('');
    setSessionListOpen(false);
  };

  const save = () => {
    const amt = parseFloat(amount);
    if (!amt || amt <= 0) return;
    if (type === 'TRANSFER') {
      const from = accounts.find((a) => a.id === accountId) ?? accounts[0];
      const to = accounts.find((a) => a.id === toId) ?? accounts[1] ?? accounts[0];
      if (from?.id === to?.id) return;
      const payload = {
        type: 'TRANSFER' as const,
        amount: amt,
        date,
        remark: remark.trim() || `转至 ${to?.name ?? ''}`,
        categoryCode: null,
        categoryName: '转账',
        accountId: from?.id ?? '',
        accountName: from?.name ?? '',
        toAccountId: to?.id,
        toAccountName: to?.name,
        counterparty: counterparty.trim() || undefined,
        ownerName: '我',
        tags: [],
      };
      if (editingRecord) updateRecord(editingRecord.id, payload);
      else addRecord(payload);
      haptics.success();
      close();
      return;
    }
    const payload = {
      type,
      amount: amt,
      date,
      remark: remark.trim() || null,
      categoryCode: cat,
      categoryName: cat,
      accountId: account?.id ?? '',
      accountName: account?.name ?? '',
      counterparty: counterparty.trim() || undefined,
      ownerName: '我',
      tags: [],
    };
    if (editingRecord) updateRecord(editingRecord.id, payload);
    else addRecord(payload);
    haptics.success();
    close();
  };

  // ==================== AI 会话 ====================

  const patchSession = (id: string, patch: Partial<ChatSession>) => {
    setSessions((prev) => prev.map((s) => (s.id === id ? { ...s, ...patch } : s)));
  };

  const appendMsg = (id: string, msg: ChatMsg) => {
    setSessions((prev) => prev.map((s) => (s.id === id ? { ...s, msgs: [...s.msgs, msg], updatedAt: Date.now() } : s)));
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
    if (!text || chatTyping || !currentSession) return;
    const sid = currentSession.id;
    // 首条消息自动以内容命名会话(对齐网页端)
    if (currentSession.msgs.length <= 1) {
      patchSession(sid, { title: text.length > 30 ? text.slice(0, 30) + '...' : text });
    }
    appendMsg(sid, { role: 'user', text });
    setChatInput('');
    setChatTyping(true);
    setTimeout(() => {
      appendMsg(sid, resolveAI(text));
      setChatTyping(false);
    }, 500);
  };

  const createSession = () => {
    const s = newSession();
    setSessions((prev) => [s, ...prev]);
    setCurrentSessionId(s.id);
    setSessionListOpen(false);
    haptics.tap();
  };

  const deleteSession = (id: string) => {
    setSessions((prev) => {
      const rest = prev.filter((s) => s.id !== id);
      if (rest.length === 0) {
        const s = newSession();
        setCurrentSessionId(s.id);
        return [s];
      }
      if (id === (currentSessionId || prev[0]?.id)) setCurrentSessionId(rest[0].id);
      return rest;
    });
    haptics.warn();
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
      style={{ paddingHorizontal: 12, paddingVertical: 7, borderRadius: 999, borderWidth: 1, backgroundColor: active ? colors.primary : colors.muted, borderColor: active ? colors.primary : colors.border }}
    >
      <Text style={{ fontSize: 12, color: active ? colors.primaryForeground : colors.foreground, fontWeight: active ? '600' : '400' }}>{label}</Text>
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
          {/* 标题 + 模式切换(编辑模式隐藏) + 关闭 */}
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
            <Text style={{ fontSize: 18, fontWeight: '700' }}>{editingRecord ? '编辑流水' : '记一笔'}</Text>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
              {!editingRecord && (
                <View style={{ flexDirection: 'row', backgroundColor: colors.muted, borderRadius: 999, padding: 3 }}>
                  {(['manual', 'ai'] as Mode[]).map((md) => {
                    const active = mode === md;
                    return (
                      <Pressable key={md} onPress={() => setMode(md)} style={{ paddingHorizontal: 14, paddingVertical: 5, borderRadius: 999, backgroundColor: active ? colors.foreground : 'transparent' }}>
                        <Text style={{ fontSize: 12, fontWeight: '600', color: active ? colors.background : colors.mutedForeground }}>{md === 'manual' ? '手动' : 'AI'}</Text>
                      </Pressable>
                    );
                  })}
                </View>
              )}
              <Pressable onPress={close} style={{ width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.muted }}>
                <Text style={{ color: colors.mutedForeground, fontSize: 15 }}>✕</Text>
              </Pressable>
            </View>
          </View>

          {mode === 'manual' ? (
            <>
              <ScrollView showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
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

                {/* 金额 */}
                <View style={{ marginBottom: 14 }}>
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

                {/* 分类:下拉列表(对齐网页 DictCombobox;转账无分类) */}
                {type !== 'TRANSFER' && (
                  <>
                    {fieldLabel('分类')}
                    <View style={{ marginBottom: 14 }}>
                      <SelectSheet
                        value={cat}
                        onChange={setCat}
                        options={categories.map((c) => ({ value: c.code, label: c.label, icon: <Text style={{ fontSize: 18 }}>{CAT_EMOJI[c.code] ?? '📦'}</Text> }))}
                      />
                    </View>
                  </>
                )}

                {/* 交易方 */}
                {type !== 'TRANSFER' && (
                  <>
                    {fieldLabel('交易方')}
                    <TextInput
                      value={counterparty}
                      onChangeText={setCounterparty}
                      placeholder="选填,如商户/对方名称"
                      placeholderTextColor={colors.mutedForeground}
                      style={[inputStyle, { marginBottom: 14 }]}
                    />
                  </>
                )}

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
            /* AI 模式:顶部会话切换工具行(仿网页移动端) + 消息区 + 输入区;高度与手动侧一致 */
            <View style={{ paddingVertical: 4, minHeight: screenH * 0.55 }}>
              {/* 会话工具行:菜单按钮 + 当前会话标题 + 新建 */}
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingBottom: 10, borderBottomWidth: 1, borderBottomColor: colors.hairline, marginBottom: 10 }}>
                <Pressable
                  onPress={() => setSessionListOpen(true)}
                  style={{ width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.muted }}
                >
                  <List size={16} color={colors.foreground} />
                </Pressable>
                <Text numberOfLines={1} style={{ flex: 1, fontSize: 14, fontWeight: '600' }}>{currentSession?.title ?? 'AI 助手'}</Text>
                <Pressable
                  onPress={createSession}
                  style={{ width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.muted }}
                >
                  <Plus size={16} color={colors.foreground} />
                </Pressable>
              </View>

              {/* 消息列表 */}
              <ScrollView style={{ flex: 1 }} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
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
                        <Text style={{ fontSize: 14, lineHeight: 20, color: isUser ? colors.primaryForeground : colors.foreground }}>{m.text}</Text>
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
                  style={{ width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center', backgroundColor: !chatInput.trim() || chatTyping ? alpha(colors.primary, 0.4) : colors.primary }}
                >
                  <Send size={17} color={colors.primaryForeground} />
                </Pressable>
              </View>
            </View>
          )}
        </Animated.View>
      </View>

      {/* AI 会话列表(仿网页移动端会话抽屉,此处为底部弹窗形态) */}
      <FormSheet visible={sessionListOpen} title="会话列表" onClose={() => setSessionListOpen(false)}>
        <Pressable
          onPress={createSession}
          style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 12, borderRadius: 14, borderWidth: 1, borderStyle: 'dashed', borderColor: colors.primary, marginBottom: 12 }}
        >
          <Plus size={15} color={colors.primary} />
          <Text style={{ fontSize: 14, color: colors.primary, fontWeight: '600' }}>新建会话</Text>
        </Pressable>
        <ScrollView style={{ maxHeight: 360 }} showsVerticalScrollIndicator={false}>
          {sessions.map((s) => {
            const active = s.id === currentSession?.id;
            return (
              <Pressable
                key={s.id}
                onPress={() => {
                  setCurrentSessionId(s.id);
                  setSessionListOpen(false);
                  haptics.tap();
                }}
                style={{
                  flexDirection: 'row', alignItems: 'center', gap: 10,
                  paddingVertical: 12, paddingHorizontal: 12, borderRadius: 12, marginBottom: 6,
                  backgroundColor: active ? alpha(colors.primary, 0.1) : colors.muted,
                  borderWidth: 1, borderColor: active ? alpha(colors.primary, 0.35) : 'transparent',
                }}
              >
                <View style={{ flex: 1 }}>
                  <Text numberOfLines={1} style={{ fontSize: 14, fontWeight: active ? '600' : '400', color: colors.foreground }}>{s.title}</Text>
                  <Text style={{ fontSize: 11, color: colors.mutedForeground, marginTop: 2 }}>{s.msgs.length - 1} 条对话 · {timeAgo(s.updatedAt)}</Text>
                </View>
                <Pressable onPress={() => deleteSession(s.id)} hitSlop={8} style={{ width: 30, height: 30, borderRadius: 15, alignItems: 'center', justifyContent: 'center' }}>
                  <Trash2 size={15} color={colors.mutedForeground} />
                </Pressable>
              </Pressable>
            );
          })}
        </ScrollView>
      </FormSheet>
    </Modal>
  );
}

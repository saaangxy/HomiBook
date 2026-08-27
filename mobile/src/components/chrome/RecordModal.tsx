import { useEffect, useRef, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Dimensions, Keyboard, KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, TextInput, View } from 'react-native';
import { List, Plus, Send, Trash2 } from 'lucide-react-native';
import Animated, { Easing, FadeIn, SlideInDown } from 'react-native-reanimated';
import { useTheme, alpha, haptics } from '@/theme';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Text } from '@/components/ui/Text';
import { Button } from '@/components/ui/Button';
import { DatePicker } from '@/components/ui/DatePicker';
import { SelectSheet } from '@/components/ui/SelectSheet';
import { TagPicker } from '@/components/ui/TagPicker';
import { FormSheet } from './FormSheet';
import { useUIShell } from './chrome';
import { useRecords } from '@/stores/records';
import { useAuth } from '@/stores/auth';
import { fetchBookMembers, fetchRecordTags, fetchBudgetTags } from '@/services/records';
import dayjs from 'dayjs';
import { sendChatMessage } from '@/services/chat';

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

function todayStr() {
  return dayjs().format('YYYY-MM-DDTHH:mm:ss');
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
  const { recordOpen, closeRecord, editingRecord, currentLedger } = useUIShell();
  const bookId = currentLedger.id;
  const { addRecord, updateRecord, accounts: allAccounts, categories: allCategories } = useRecords();
  const { user } = useAuth();
  const insets = useSafeAreaInsets();
  // 缓存初始窗口高度:Android 键盘弹出时窗口会 resize 变小,用固定快照保持弹窗高度不变
  const screenH = useRef(Dimensions.get('window').height).current;

  const [mode, setMode] = useState<Mode>('manual');
  // 持久化 mode 记忆:关闭时是 AI → 下次打开(含重启)仍是 AI
  useEffect(() => {
    AsyncStorage.getItem('homibook.recordmodal.mode').then((v) => {
      if (v === 'manual' || v === 'ai') setMode(v);
    }).catch(() => {});
  }, []);
  useEffect(() => {
    AsyncStorage.setItem('homibook.recordmodal.mode', mode).catch(() => {});
  }, [mode]);

  // 键盘高度:用于键盘弹出时把 sheet 压缩到键盘上方(两个 tab 高度始终一致)
  const [kbH, setKbH] = useState(0);
  useEffect(() => {
    const show = Keyboard.addListener('keyboardDidShow', (e) => setKbH(e.endCoordinates.height));
    const hide = Keyboard.addListener('keyboardDidHide', () => setKbH(0));
    return () => {
      show.remove();
      hide.remove();
    };
  }, []);
  // 统一外部高度:手动/AI 两 tab 共用同一固定高度;键盘弹出时整体缩到键盘上方
  const sheetH = Math.round(kbH > 0 ? Math.min(screenH * 0.84, screenH - kbH - 12) : screenH * 0.84);
  const [type, setType] = useState<RecordType>('EXPENSE');
  const [amount, setAmount] = useState('0');
  const [cat, setCat] = useState('餐饮');
  const [accountId, setAccountId] = useState('');
  const [toId, setToId] = useState('');
  const [date, setDate] = useState(todayStr);
  const [remark, setRemark] = useState('');
  const [counterparty, setCounterparty] = useState('');
  const [tags, setTags] = useState<string[]>([]);
  const [tagSuggestions, setTagSuggestions] = useState<string[]>([]);
  // 归属人:默认本人,选项来自账本成员
  const [ownerId, setOwnerId] = useState('');
  const [members, setMembers] = useState<{ id: string; label: string }[]>([]);
  // 加载账本成员(归属人选项)
  useEffect(() => {
    if (!bookId) return;
    fetchBookMembers(bookId).then((ms) => {
      setMembers(ms.map((m) => ({ id: m.userId ?? m.id, label: m.nickname || '成员' })));
    }).catch(() => {});
  }, [bookId]);
  // 加载标签建议(预算标签 + 流水已有标签,去重)
  useEffect(() => {
    if (!bookId) return;
    Promise.all([fetchBudgetTags(bookId), fetchRecordTags(bookId)]).then(([b, r]) => {
      setTagSuggestions([...new Set([...b, ...r])]);
    }).catch(() => {});
  }, [bookId]);
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
  // 消息变化(含流式追加、识别结果替换)时自动贴底
  const chatScrollRef = useRef<ScrollView>(null);
  const lastMsgLen = currentSession?.msgs[currentSession.msgs.length - 1]?.text.length;
  useEffect(() => {
    if (mode !== 'ai') return;
    chatScrollRef.current?.scrollToEnd({ animated: false });
  }, [mode, currentSession?.msgs.length, lastMsgLen]);

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
      setTags(editingRecord.tags ?? []);
      setOwnerId(editingRecord.ownerId ?? user?.id ?? '');
    } else {
      // 新建模式:保留记忆的 tab(不强制 manual),仅重置表单字段
      setType('EXPENSE');
      setAmount('0');
      setCat(categories[0]?.code ?? '餐饮');
      setAccountId(accounts[0]?.id ?? '');
      setToId(accounts[1]?.id ?? accounts[0]?.id ?? '');
      setDate(todayStr());
      setRemark('');
      setCounterparty('');
      setTags([]);
      setOwnerId(user?.id ?? '');
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
    // 归属人:本人(id 为当前用户)时显示"我",否则取成员名
    const ownerLabel = members.find((m) => m.id === ownerId)?.label ?? (ownerId === user?.id ? '我' : '本人');
    const owner = { ownerId: ownerId || user?.id || '', ownerName: ownerId ? ownerLabel : '我' };
    if (type === 'TRANSFER') {
      const from = accounts.find((a) => a.id === accountId) ?? accounts[0];
      const to = accounts.find((a) => a.id === toId) ?? accounts[1] ?? accounts[0];
      if (from?.id === to?.id) return;
      const payload = {
        type: 'TRANSFER' as const,
        amount: amt,
        date,
        remark: remark.trim() || `转至 ${to?.name ?? ''}`,
        categoryCode: cat || null,
        categoryName: cat || '转账',
        accountId: from?.id ?? '',
        accountName: from?.name ?? '',
        toAccountId: to?.id,
        toAccountName: to?.name,
        counterparty: counterparty.trim() || undefined,
        ...owner,
        tags,
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
      ...owner,
      tags,
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

  // AI 工具调用结果 -> 填入表单并返回确认气泡
  const applyToolArgs = (args: Record<string, unknown>): ChatMsg => {
    const t = (args.type as RecordType) || 'EXPENSE';
    const amt = Number(args.amount) || 0;
    const c = (args.categoryCode as string) || '其他';
    const note = (args.remark as string) || '';
    const pay = (args.payer as string) || '';
    // 账户:优先按 ID/名称匹配,否则用第一个活跃账户
    const aid = (args.accountId as string) || '';
    const matched = accounts.find((a) => a.id === aid || a.name === aid);
    const acctId = matched ? matched.id : accounts[0]?.id ?? '';
    setType(t);
    setAmount(String(amt));
    setCat(c);
    setRemark(note);
    setCounterparty(pay);
    setAccountId(acctId);
    if (args.date) setDate(args.date as string);
    return {
      role: 'assistant',
      text: `识别到${t === 'EXPENSE' ? '支出' : t === 'INCOME' ? '收入' : '转账'} ¥${amt.toFixed(2)}，分类「${c}」${note ? `，备注「${note}」` : ''}。确认后即可保存。`,
      confirm: true,
    };
  };

  // AI 聊天:发送描述 → 流式接收后端 AI 回复(真实 SSE /api/chat/send)
  const sendAI = () => {
    const text = chatInput.trim();
    if (!text || chatTyping || !currentSession) return;
    const sid = currentSession.id;
    if (currentSession.msgs.length <= 1) {
      patchSession(sid, { title: text.length > 30 ? text.slice(0, 30) + '...' : text });
    }
    appendMsg(sid, { role: 'user', text });
    setChatInput('');
    setChatTyping(true);
    // 后端流式:先显示空助手气泡,再逐段填充
    appendMsg(sid, { role: 'assistant', text: '' });
    const streamingId = sid;
    let acc = '';
    sendChatMessage(
      bookId,
      text,
      {
        onDelta: (delta) => {
          acc += delta;
          patchSession(streamingId, { msgs: (sessions.find((s) => s.id === streamingId)?.msgs ?? []).map((m, i) => (i === (sessions.find((s) => s.id === streamingId)?.msgs.length ?? 0) - 1 ? { ...m, text: acc } : m)) });
        },
        onToolCall: (tc) => {
          if (tc.toolName === 'create_record') {
            const msg = applyToolArgs((tc.args ?? {}) as Record<string, unknown>);
            patchSession(streamingId, { msgs: (sessions.find((s) => s.id === streamingId)?.msgs ?? []).map((m, i) => (i === (sessions.find((s) => s.id === streamingId)?.msgs.length ?? 0) - 1 ? msg : m)) });
          }
        },
        onFinish: () => {
          setChatTyping(false);
        },
        onError: (errMsg) => {
          patchSession(streamingId, { msgs: (sessions.find((s) => s.id === streamingId)?.msgs ?? []).map((m, i) => (i === (sessions.find((s) => s.id === streamingId)?.msgs.length ?? 0) - 1 ? { ...m, text: errMsg || 'AI 服务异常' } : m)) });
          setChatTyping(false);
        },
      },
    );
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

  const chip = (key: string, label: string, active: boolean, onPress: () => void) => (
    <Pressable
      key={key}
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
      {/* iOS 用 padding 顶起;iOS/Android 都由 KeyboardAvoidingView 处理,弹窗高度受限时可滚动 */}
      <KeyboardAvoidingView style={{ flex: 1, justifyContent: 'flex-end' }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        <Animated.View entering={FadeIn.duration(160)} style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.45)' }}>
          <Pressable style={{ flex: 1 }} onPress={close} />
        </Animated.View>

        <Animated.View
          entering={SlideInDown.duration(260).easing(Easing.out(Easing.cubic))}
          style={{ backgroundColor: colors.card, borderTopLeftRadius: 24, borderTopRightRadius: 24, paddingHorizontal: 20, paddingTop: 14, paddingBottom: Math.max(insets.bottom, 18), height: sheetH, overflow: 'hidden' }}
        >
          {/* 弹窗内容容器:占满统一高度,内部按模式各自布局 */}
          <View style={{ flex: 1 }}>
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
            /* 手动模式:表单在固定高度内滚动,保存按钮常驻底部 */
            <View style={{ flex: 1 }}>
              <ScrollView style={{ flex: 1 }} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled" automaticallyAdjustKeyboardInsets nestedScrollEnabled>
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
                      {accounts.map((a) => chip(a.id, a.name, accountId === a.id, () => setAccountId(a.id)))}
                    </View>
                    {fieldLabel('转入账户')}
                    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 14 }}>
                      {accounts.map((a) => chip(a.id, a.name, toId === a.id, () => setToId(a.id)))}
                    </View>
                  </>
                ) : (
                  <>
                    {fieldLabel('账户')}
                    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 14 }}>
                      {accounts.map((a) => chip(a.id, a.name, accountId === a.id, () => setAccountId(a.id)))}
                    </View>
                  </>
                )}

                {/* 日期(仿网页 DatePicker) */}
                {fieldLabel('日期')}
                <View style={{ marginBottom: 14 }}>
                  <DatePicker value={date} onChange={setDate} />
                </View>

                {/* 分类:下拉列表(对齐网页,所有类型含转账都显示) */}
                {fieldLabel('分类')}
                <View style={{ marginBottom: 14 }}>
                  <SelectSheet
                    value={cat}
                    onChange={setCat}
                    options={categories.map((c) => ({ value: c.code, label: c.label }))}
                  />
                </View>

                {/* 标签(对齐网页 TagCombobox:从已有标签下拉选择或新建,多选) */}
                {fieldLabel('标签')}
                <TagPicker value={tags} onChange={setTags} suggestions={tagSuggestions} />

                {/* 交易方 */}
                {fieldLabel('交易方')}
                <TextInput
                  value={counterparty}
                  onChangeText={setCounterparty}
                  placeholder="选填,如商户/对方名称"
                  placeholderTextColor={colors.mutedForeground}
                  style={[inputStyle, { marginBottom: 14 }]}
                />

                {/* 归属人:所有类型(含转账)都显示,选项为本人+账本成员 */}
                {fieldLabel('归属人')}
                <View style={{ marginBottom: 14 }}>
                  <SelectSheet
                    value={ownerId || 'self'}
                    onChange={(v) => setOwnerId(v === 'self' ? '' : v)}
                    options={[{ value: 'self', label: '本人' }, ...members.map((m) => ({ value: m.id, label: m.label }))]}
                  />
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
            </View>
          ) : (
            /* AI 模式:会话工具行钉顶、输入框钉底,消息区占满中间并内部滚动 */
            <View style={{ flex: 1, paddingVertical: 4 }}>
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

              {/* 消息列表:占满剩余空间,内容多时内部滚动;新消息自动贴底 */}
              <ScrollView ref={chatScrollRef} style={{ flex: 1 }} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled" nestedScrollEnabled>
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

              {/* 输入区:始终在底部,键盘弹起时随之抬升 */}
              <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 8, marginTop: 10 }}>
                <TextInput
                  value={chatInput}
                  onChangeText={setChatInput}
                  placeholder="描述一笔收支..."
                  placeholderTextColor={colors.mutedForeground}
                  multiline
                  editable={!chatTyping}
                  style={{ flex: 1, minHeight: 44, maxHeight: 88, borderRadius: 18, backgroundColor: colors.elevated, paddingHorizontal: 14, paddingVertical: 10, color: colors.foreground, fontSize: 14, textAlignVertical: 'center', borderWidth: 1, borderColor: colors.border }}
                />
                <Pressable
                  onPress={sendAI}
                  disabled={!chatInput.trim() || chatTyping}
                  style={{ width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center', backgroundColor: !chatInput.trim() || chatTyping ? alpha(colors.primary, 0.4) : colors.primary }}
                >
                  <Send size={17} color={colors.primaryForeground} />
                </Pressable>
              </View>

              {/* 快捷例句:放在输入区下方作为提示,点击即填入输入框 */}
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 8 }}>
                {['中午星巴克拿铁 32 元', '打车去机场 45 元'].map((q) => (
                  <Pressable key={q} disabled={chatTyping} onPress={() => setChatInput(q)} style={{ paddingHorizontal: 12, paddingVertical: 6, borderRadius: 999, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.muted }}>
                    <Text style={{ fontSize: 12, color: colors.foreground }}>{q}</Text>
                  </Pressable>
                ))}
              </View>
            </View>
          )}
          </View>
        </Animated.View>
      </KeyboardAvoidingView>

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

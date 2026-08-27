import { useEffect, useRef, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { ActivityIndicator, Alert, Dimensions, Image, Keyboard, KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, TextInput, View } from 'react-native';
import Animated, { Easing, FadeIn, SlideInDown } from 'react-native-reanimated';
import { ImagePlus, X } from 'lucide-react-native';
import { useTheme, haptics } from '@/theme';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Text } from '@/components/ui/Text';
import { Button } from '@/components/ui/Button';
import { DatePicker } from '@/components/ui/DatePicker';
import { ChipSelect } from '@/components/ui/ChipSelect';
import { TagPicker } from '@/components/ui/TagPicker';
import { ImageLightbox, isImageUrl } from '@/components/ui/AttachmentViewer';
import { AIAssistant } from '@/components/chat/AIAssistant';
import { useUIShell } from './chrome';
import { useRecords } from '@/stores/records';
import { useAuth } from '@/stores/auth';
import { fetchBookMembers, fetchRecordTags, fetchBudgetTags, uploadRecordAttachment } from '@/services/records';
import { resolveRemoteUrl } from '@/services/http';
import dayjs from 'dayjs';

type RecordType = 'EXPENSE' | 'INCOME' | 'TRANSFER';
type Mode = 'manual' | 'ai';

function todayStr() {
  return dayjs().format('YYYY-MM-DDTHH:mm:ss');
}

// 记一笔弹窗:手动/AI 两种模式(共用同一固定外部高度)。
// AI 模式内嵌完整「AI 财务助手」聊天组件(与全局 AI 弹窗共用 components/chat/AIAssistant)
export function RecordModal() {
  const { colors } = useTheme();
  const { recordOpen, closeRecord, editingRecord, currentLedger } = useUIShell();
  const bookId = currentLedger.id;
  const { addRecord, updateRecord, accounts: allAccounts, categories: allCategories } = useRecords();
  const { user } = useAuth();
  const insets = useSafeAreaInsets();
  // 缓存初始窗口高度:Android 键盘弹出时窗口会 resize 变小,用固定快照保持弹窗高度不变
  const screenH = useRef(Dimensions.get('window').height).current;

  // 键盘高度:用于键盘弹出时把 sheet 压缩到键盘上方
  const [kbH, setKbH] = useState(0);
  useEffect(() => {
    const show = Keyboard.addListener('keyboardDidShow', (e) => setKbH(e.endCoordinates.height));
    const hide = Keyboard.addListener('keyboardDidHide', () => setKbH(0));
    return () => {
      show.remove();
      hide.remove();
    };
  }, []);
  // 固定外部高度;键盘弹出时整体缩到键盘上方
  const sheetH = Math.round(kbH > 0 ? Math.min(screenH * 0.84, screenH - kbH - 12) : screenH * 0.84);

  // 模式记忆:关闭时是 AI → 下次打开(含重启)仍是 AI;编辑流水强制手动
  const [mode, setMode] = useState<Mode>('manual');
  useEffect(() => {
    AsyncStorage.getItem('homibook.recordmodal.mode').then((v) => {
      if (v === 'manual' || v === 'ai') setMode(v);
    }).catch(() => {});
  }, []);
  useEffect(() => {
    AsyncStorage.setItem('homibook.recordmodal.mode', mode).catch(() => {});
  }, [mode]);

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
  // 流水附件(编辑回填/本地新增;提交时全量覆盖 attachmentIds,与 web 一致)
  const [formAttachments, setFormAttachments] = useState<{ id: string; url: string; originalFilename: string }[]>([]);
  const [uploadingAtt, setUploadingAtt] = useState(false);
  const [lightboxIdx, setLightboxIdx] = useState<number | null>(null);
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

  const categories = allCategories.filter((c) => (type === 'EXPENSE' ? c.type === 'EXPENSE' : c.type === 'INCOME'));
  const accounts = allAccounts.filter((a) => a.status === 'ACTIVE');
  const account = accounts.find((a) => a.id === accountId) ?? accounts[0];

  // 打开时:编辑模式预填表单;新建则重置默认
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
      setFormAttachments(editingRecord.attachments ?? []);
    } else {
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
      setFormAttachments([]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recordOpen, editingRecord]);

  const close = () => {
    closeRecord();
  };

  // 选择并上传流水附件(支持多选,单张失败不阻断其余)
  const handlePickAttachments = async () => {
    try {
      const { launchImageLibraryAsync, requestMediaLibraryPermissionsAsync } = await import('expo-image-picker');
      const perm = await requestMediaLibraryPermissionsAsync();
      if (!perm.granted) { Alert.alert('需要相册权限'); return; }
      const result = await launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.7, allowsMultipleSelection: true, selectionLimit: 9 });
      if (result.canceled || !result.assets?.length) return;
      setUploadingAtt(true);
      try {
        const uploaded: { id: string; url: string; originalFilename: string }[] = [];
        for (const asset of result.assets) {
          const fileName = asset.fileName || `receipt-${Date.now()}.jpg`;
          try {
            const up = await uploadRecordAttachment(asset.uri, fileName, asset.mimeType || 'image/jpeg');
            uploaded.push({ id: up.id, url: up.url || up.fullUrl, originalFilename: up.originalFilename || fileName });
          } catch (e: any) {
            Alert.alert('上传失败', `${fileName}: ${e?.message || '未知错误'}`);
          }
        }
        if (uploaded.length > 0) setFormAttachments((prev) => [...prev, ...uploaded]);
      } finally {
        setUploadingAtt(false);
      }
    } catch (e: any) {
      Alert.alert('选择图片失败', e?.message || '未知错误');
      setUploadingAtt(false);
    }
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
        attachmentIds: formAttachments.map((a) => a.id),
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
      attachmentIds: formAttachments.map((a) => a.id),
    };
    if (editingRecord) updateRecord(editingRecord.id, payload);
    else addRecord(payload);
    haptics.success();
    close();
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
  const chip = (key: string, label: string, active: boolean, onPress: () => void) => (
    <Pressable
      key={key}
      onPress={onPress}
      style={{ paddingHorizontal: 12, paddingVertical: 7, borderRadius: 999, borderWidth: 1, backgroundColor: active ? colors.primary : colors.muted, borderColor: active ? colors.primary : colors.border }}
    >
      <Text style={{ fontSize: 12, color: active ? colors.primaryForeground : colors.foreground, fontWeight: active ? '600' : '400' }}>{label}</Text>
    </Pressable>
  );
  const fieldLabel = (t: string) => (
    <Text style={{ fontSize: 12, color: colors.mutedForeground, marginBottom: 6, marginTop: 2 }}>{t}</Text>
  );

  return (
    <Modal visible={recordOpen} transparent animationType="none" onRequestClose={close}>
      <KeyboardAvoidingView style={{ flex: 1, justifyContent: 'flex-end' }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        <Animated.View entering={FadeIn.duration(160)} style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.45)' }}>
          <Pressable style={{ flex: 1 }} onPress={close} />
        </Animated.View>

        <Animated.View
          entering={SlideInDown.duration(260).easing(Easing.out(Easing.cubic))}
          style={{ backgroundColor: colors.card, borderTopLeftRadius: 24, borderTopRightRadius: 24, paddingHorizontal: 20, paddingTop: 14, paddingBottom: Math.max(insets.bottom, 18), height: sheetH, overflow: 'hidden' }}
        >
          {/* 弹窗内容容器:占满固定高度,表单滚动、保存按钮常驻底部 */}
          <View style={{ flex: 1 }}>
          {/* 标题行 + 模式切换(编辑模式隐藏) */}
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

              {/* 分类:胶囊选择(对齐网页,所有类型含转账都显示) */}
              {fieldLabel('分类')}
              <View style={{ marginBottom: 14 }}>
                <ChipSelect
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
                <ChipSelect
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

              {/* 附件(小票/发票等):缩略图网格,点图全屏预览,支持多选上传/本地删除(提交时全量覆盖) */}
              {fieldLabel('附件')}
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginBottom: 14 }}>
                {formAttachments.map((att, i) => {
                  const isImg = isImageUrl(att.url);
                  return (
                    <View key={att.id || `${att.url}-${i}`}>
                      <Pressable onPress={() => { if (isImg) setLightboxIdx(formAttachments.filter((a) => isImageUrl(a.url)).findIndex((x) => x.id === (att.id || att.url))); }}>
                        {isImg ? (
                          <Image source={{ uri: resolveRemoteUrl(att.url) }} style={{ width: 64, height: 64, borderRadius: 10, backgroundColor: colors.muted }} />
                        ) : (
                          <View style={{
                            width: 92, height: 64, borderRadius: 10, backgroundColor: colors.muted,
                            alignItems: 'center', justifyContent: 'center', paddingHorizontal: 6,
                          }}>
                            <Text numberOfLines={2} style={{ fontSize: 10, color: colors.mutedForeground }}>{att.originalFilename}</Text>
                          </View>
                        )}
                      </Pressable>
                      {/* 删除:纯本地移除(attachmentIds 全量覆盖后端即同步),与 web 一致 */}
                      <Pressable
                        onPress={() => setFormAttachments((prev) => prev.filter((_, idx) => idx !== i))}
                        hitSlop={8}
                        style={{ position: 'absolute', top: -7, right: -7, width: 20, height: 20, borderRadius: 10, alignItems: 'center', justifyContent: 'center' }}
                      >
                        <X size={15} color={colors.expense} />
                      </Pressable>
                    </View>
                  );
                })}
                <Pressable
                  onPress={handlePickAttachments}
                  disabled={uploadingAtt}
                  style={{
                    width: 64, height: 64, borderRadius: 10, borderWidth: 1.5, borderStyle: 'dashed',
                    borderColor: colors.border, alignItems: 'center', justifyContent: 'center',
                    backgroundColor: colors.muted,
                  }}
                >
                  {uploadingAtt ? <ActivityIndicator size="small" color={colors.primary} /> : <ImagePlus size={20} color={colors.mutedForeground} />}
                </Pressable>
              </View>
            </ScrollView>

            {/* 底部操作 */}
            <View style={{ marginTop: 10 }}>
              <Button title={`保存${typeLabel} ¥${display}`} onPress={save} />
            </View>
          </View>
          ) : (
            /* AI 模式:内嵌完整 AI 财务助手(流式/会话抽屉/工具卡,与全局弹窗共用组件) */
            recordOpen && mode === 'ai' && (
              <View style={{ flex: 1, paddingTop: 2 }}>
                <AIAssistant />
              </View>
            )
          )}
          </View>
        </Animated.View>
      </KeyboardAvoidingView>

      {/* 附件全屏预览(仅手动模式附件区) */}
      {lightboxIdx !== null && formAttachments.some((a) => isImageUrl(a.url)) && (
        <ImageLightbox
          images={formAttachments.filter((a) => isImageUrl(a.url)).map((a) => resolveRemoteUrl(a.url))}
          initialIndex={Math.max(lightboxIdx, 0)}
          onClose={() => setLightboxIdx(null)}
        />
      )}
    </Modal>
  );
}

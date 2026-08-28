import { useCallback, useEffect, useState } from 'react';
import { Alert, Modal, Pressable, ScrollView, View } from 'react-native';
import { Pencil, Plus, Trash2 } from 'lucide-react-native';
import { useTheme, alpha } from '@/theme';
import { Text } from '@/components/ui/Text';
import {
  apikeyApi, importExportApi, settingsApi,
  type AccountMapping, type ApiKeyItem, type CategoryMapping, type DictItem,
} from '@/services/settings';
import { Btn, Chips, ErrorText, LabeledInput, OptionModal, useInputStyle } from './shared';
import * as Clipboard from 'expo-clipboard';

export const DICT_GROUPS = [
  { key: 'account_type', label: '账户类型' },
  { key: 'bank_name', label: '开户行' },
  { key: 'transaction_category_income', label: '收入分类' },
  { key: 'transaction_category_expense', label: '支出分类' },
  { key: 'transaction_category_transfer', label: '转账分类' },
];

const MAPPING_SOURCES = [
  { value: 'alipay', label: '支付宝' },
  { value: 'wechat', label: '微信' },
  { value: 'jd', label: '京东' },
  { value: 'csv', label: '其他CSV' },
];

function HeadRow({ title, btnTitle, onBtn }: { title: string; btnTitle: string; onBtn: () => void }) {
  const { colors } = useTheme();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
      <Text style={{ fontSize: 13, fontWeight: '600', flex: 1 }}>{title}</Text>
      <Pressable onPress={onBtn} style={{ flexDirection: 'row', alignItems: 'center', gap: 3, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8, backgroundColor: colors.primary }}>
        <Plus size={13} color={colors.primaryForeground} />
        <Text style={{ fontSize: 12, color: colors.primaryForeground, fontWeight: '600' }}>{btnTitle}</Text>
      </Pressable>
    </View>
  );
}

function OpIcon({ onPress, children }: { onPress: () => void; children: React.ReactNode }) {
  const { colors } = useTheme();
  return (
    <Pressable hitSlop={6} onPress={onPress} style={{ width: 30, height: 30, alignItems: 'center', justifyContent: 'center', borderRadius: 8 }}>
      {children}
    </Pressable>
  );
}

function Empty({ text }: { text: string }) {
  const { colors } = useTheme();
  return (
    <View style={{ borderWidth: 1, borderStyle: 'dashed', borderColor: colors.border, borderRadius: 12, paddingVertical: 24, alignItems: 'center' }}>
      <Text variant="muted" style={{ fontSize: 12.5 }}>{text}</Text>
    </View>
  );
}

// ── 字典管理 ──
export function DictManager() {
  const { colors } = useTheme();
  const [group, setGroup] = useState(DICT_GROUPS[0].key);
  const [items, setItems] = useState<DictItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [editing, setEditing] = useState<DictItem | null>(null);
  const [adding, setAdding] = useState(false);
  const [label, setLabel] = useState('');
  const [code, setCode] = useState('');
  const [order, setOrder] = useState('0');
  const [formError, setFormError] = useState('');
  const [saving, setSaving] = useState(false);

  const load = useCallback(async (g: string) => {
    setLoading(true);
    setError('');
    try {
      setItems(await settingsApi.getDictionary(g));
    } catch (e: any) {
      setError(e?.message ?? '加载字典失败');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(group); }, [group, load]);

  const resetForm = () => { setLabel(''); setCode(''); setOrder('0'); setFormError(''); setSaving(false); };
  const openAdd = () => { resetForm(); setEditing(null); setAdding(true); };
  const openEdit = (item: DictItem) => { setLabel(item.label); setCode(item.code); setOrder(String(item.order)); setFormError(''); setEditing(item); setAdding(true); };

  const submit = async () => {
    if (!label.trim()) { setFormError('请输入名称'); return; }
    setSaving(true);
    setFormError('');
    try {
      if (editing) {
        await settingsApi.updateDictionaryItem(editing.id, { code: code.trim() || undefined, label: label.trim(), order: parseInt(order) || 0 });
        Alert.alert('成功', '字典项已更新');
      } else {
        await settingsApi.createDictionaryItem({ group, code: code.trim() || label.trim(), label: label.trim(), order: parseInt(order) || 0 });
        Alert.alert('成功', '字典项已添加');
      }
      setAdding(false);
      resetForm();
      load(group);
    } catch (e: any) {
      setFormError(e?.message ?? '保存失败');
    } finally {
      setSaving(false);
    }
  };

  const confirmDelete = (item: DictItem) => {
    Alert.alert('删除字典项', `确定要删除「${item.label}」吗？此操作不可撤销,已使用该值的记录不受影响。`, [
      { text: '取消', style: 'cancel' },
      {
        text: '删除', style: 'destructive',
        onPress: async () => {
          try {
            await settingsApi.deleteDictionaryItem(item.id);
            load(group);
          } catch (e: any) {
            Alert.alert('删除失败', e?.message);
          }
        },
      },
    ]);
  };

  const inputStyle = useInputStyle();
  const groupLabel = DICT_GROUPS.find((g) => g.key === group)?.label ?? '';

  return (
    <View style={{ gap: 12 }}>
      <Chips options={DICT_GROUPS.map((g) => ({ value: g.key, label: g.label }))} value={group} onChange={setGroup} />
      <ErrorText msg={error} />
      <HeadRow title={groupLabel} btnTitle="添加" onBtn={openAdd} />
      {loading ? (
        <Text variant="muted" style={{ fontSize: 12.5, textAlign: 'center', paddingVertical: 16 }}>加载中...</Text>
      ) : items.length === 0 ? (
        <Empty text="暂无数据,点击「添加」创建" />
      ) : (
        <View style={{ borderRadius: 12, borderWidth: 1, borderColor: colors.border, overflow: 'hidden' }}>
          {items.map((item, i) => (
            <View key={item.id} style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 12, paddingVertical: 10, borderBottomWidth: i < items.length - 1 ? 1 : 0, borderBottomColor: colors.hairline, backgroundColor: i % 2 ? colors.elevated : 'transparent' }}>
              <Text variant="muted" style={{ fontSize: 11, width: 24 }}>{item.order}</Text>
              <Text variant="muted" style={{ fontSize: 11.5, flex: 1 }} numberOfLines={1}>{item.code}</Text>
              <Text style={{ fontSize: 13.5, flex: 1 }}>{item.label}</Text>
              <OpIcon onPress={() => openEdit(item)}><Pencil size={14} color={colors.mutedForeground} /></OpIcon>
              <OpIcon onPress={() => confirmDelete(item)}><Trash2 size={14} color={colors.expense} /></OpIcon>
            </View>
          ))}
        </View>
      )}

      <Modal visible={adding} transparent animationType="fade" onRequestClose={() => setAdding(false)}>
        <Pressable style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', padding: 28 }} onPress={() => setAdding(false)}>
          <Pressable style={{ backgroundColor: colors.card, borderRadius: 16, padding: 18, gap: 12 }} onPress={() => {}}>
            <Text style={{ fontSize: 16, fontWeight: '700' }}>{editing ? '编辑字典项' : `添加${groupLabel}`}</Text>
            <ErrorText msg={formError} />
            <LabeledInput label="名称" value={label} onChangeText={(v) => { setLabel(v); setFormError(''); }} placeholder="显示名称" />
            <LabeledInput label="编码(留空则与名称相同)" value={code} onChangeText={setCode} placeholder="唯一编码" />
            <LabeledInput label="排序" value={order} onChangeText={setOrder} keyboardType="numeric" />
            <View style={{ flexDirection: 'row', gap: 10 }}>
              <Btn title="取消" variant="secondary" onPress={() => setAdding(false)} />
              <Btn title={editing ? '保存' : '添加'} onPress={submit} loading={saving} />
            </View>
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}

// ── API Key 管理 ──
export function ApiKeyManager() {
  const { colors } = useTheme();
  const [keys, setKeys] = useState<ApiKeyItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');
  const [formError, setFormError] = useState('');
  const [saving, setSaving] = useState(false);
  const [created, setCreated] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      setKeys(await apikeyApi.list());
    } catch (e: any) {
      setError(e?.message ?? '加载失败');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const submit = async () => {
    if (!name.trim()) { setFormError('请输入名称'); return; }
    setSaving(true);
    setFormError('');
    try {
      const res = await apikeyApi.create({ name: name.trim() });
      setCreated(res.key);
      setCreating(false);
      setName('');
      load();
    } catch (e: any) {
      setFormError(e?.message ?? '创建失败');
    } finally {
      setSaving(false);
    }
  };

  const confirmDelete = (item: ApiKeyItem) => {
    Alert.alert('删除 API Key', `确定要删除「${item.name}」吗?使用此密钥的客户端将立即失去访问权限。`, [
      { text: '取消', style: 'cancel' },
      {
        text: '删除', style: 'destructive',
        onPress: async () => {
          try {
            await apikeyApi.delete(item.id);
            load();
          } catch (e: any) {
            Alert.alert('删除失败', e?.message);
          }
        },
      },
    ]);
  };

  return (
    <View style={{ gap: 12 }}>
      {created && (
        <View style={{ borderRadius: 12, borderWidth: 1, borderColor: '#eab308', backgroundColor: alpha('#eab308', 0.1), padding: 12, gap: 8 }}>
          <Text style={{ fontSize: 12.5, fontWeight: '600', color: '#a16207' }}>密钥已生成,请立即复制!关闭后将无法再次查看。</Text>
          <Pressable
            onPress={async () => { await Clipboard.setStringAsync(created); Alert.alert('已复制', '密钥已复制到剪贴板'); }}
            style={{ backgroundColor: colors.elevated, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 8 }}
          >
            <Text style={{ fontSize: 11.5 }} numberOfLines={2} selectable>{created}</Text>
          </Pressable>
          <Btn title="我已复制,关闭提示" variant="secondary" onPress={() => setCreated(null)} />
        </View>
      )}
      <ErrorText msg={error} />
      <HeadRow title={`共 ${keys.length} 个 API Key`} btnTitle="创建 API Key" onBtn={() => { setName(''); setFormError(''); setCreating(true); }} />
      {loading ? (
        <Text variant="muted" style={{ fontSize: 12.5, textAlign: 'center', paddingVertical: 16 }}>加载中...</Text>
      ) : keys.length === 0 ? (
        <Empty text="暂无 API Key" />
      ) : (
        <View style={{ gap: 8 }}>
          {keys.map((k) => (
            <View key={k.id} style={{ flexDirection: 'row', alignItems: 'center', gap: 10, borderWidth: 1, borderColor: colors.border, borderRadius: 12, padding: 12 }}>
              <View style={{ flex: 1, gap: 2 }}>
                <Text style={{ fontSize: 13.5, fontWeight: '600' }}>{k.name}</Text>
                <Text variant="muted" style={{ fontSize: 11.5 }}>{k.prefix}... · {k.userName}</Text>
                <Text variant="muted" style={{ fontSize: 11 }}>
                  创建 {k.createdAt?.slice(0, 10)} · {k.lastUsedAt ? `最后使用 ${k.lastUsedAt.slice(0, 16).replace('T', ' ')}` : '从未使用'}
                </Text>
              </View>
              <OpIcon onPress={() => confirmDelete(k)}><Trash2 size={15} color={colors.expense} /></OpIcon>
            </View>
          ))}
        </View>
      )}

      <Modal visible={creating} transparent animationType="fade" onRequestClose={() => setCreating(false)}>
        <Pressable style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', padding: 28 }} onPress={() => setCreating(false)}>
          <Pressable style={{ backgroundColor: colors.card, borderRadius: 16, padding: 18, gap: 12 }} onPress={() => {}}>
            <Text style={{ fontSize: 16, fontWeight: '700' }}>创建 API Key</Text>
            <ErrorText msg={formError} />
            <LabeledInput label="名称" value={name} onChangeText={(v) => { setName(v); setFormError(''); }} placeholder="例如:数据分析脚本" />
            <View style={{ flexDirection: 'row', gap: 10 }}>
              <Btn title="取消" variant="secondary" onPress={() => setCreating(false)} />
              <Btn title="创建" onPress={submit} loading={saving} />
            </View>
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}

// ── 导入分类映射 ──
const RECORD_TYPE_OPTIONS = [
  { value: '__all__', label: '通用(不限)' },
  { value: 'INCOME', label: '收入' },
  { value: 'EXPENSE', label: '支出' },
  { value: 'TRANSFER', label: '转账' },
];

const TYPE_LABEL: Record<string, string> = { INCOME: '收入', EXPENSE: '支出', TRANSFER: '转账' };

export function CategoryMappingManager({ dictGroups }: { dictGroups: string[] }) {
  const { colors } = useTheme();
  const [source, setSource] = useState('alipay');
  const [items, setItems] = useState<CategoryMapping[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<CategoryMapping | null>(null);
  const [srcCategory, setSrcCategory] = useState('');
  const [payer, setPayer] = useState('');
  const [desc, setDesc] = useState('');
  const [recordType, setRecordType] = useState('__all__');
  const [targetCode, setTargetCode] = useState('');
  const [dicts, setDicts] = useState<{ code: string; label: string }[]>([]);
  const [dictPick, setDictPick] = useState(false);
  const [formError, setFormError] = useState('');
  const [saving, setSaving] = useState(false);

  const load = useCallback(async (src: string) => {
    setLoading(true);
    setError('');
    try {
      setItems((await importExportApi.getMappings(src)).mappings);
    } catch (e: any) {
      setError(e?.message ?? '加载失败');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(source); }, [source, load]);

  // 按记录类型拉取可选的系统分类
  useEffect(() => {
    const groups = recordType === '__all__'
      ? ['transaction_category_income', 'transaction_category_expense', 'transaction_category_transfer']
      : [`transaction_category_${recordType.toLowerCase()}`];
    Promise.all(groups.map((g) => settingsApi.getDictionary(g).catch(() => [])))
      .then((lists) => setDicts(lists.flat().map((d) => ({ code: d.code, label: d.label }))))
      .catch(() => setDicts([]));
  }, [recordType]);

  const submit = async () => {
    if (!srcCategory.trim()) { setFormError('请输入CSV分类名'); return; }
    if (!targetCode) { setFormError('请选择目标系统分类'); return; }
    setSaving(true);
    setFormError('');
    try {
      if (editing) await importExportApi.deleteMapping(editing.id);
      await importExportApi.saveMappings([{
        source,
        sourceCategory: srcCategory.trim(),
        payerContains: payer.trim() || undefined,
        descriptionContains: desc.trim() || undefined,
        recordType: recordType === '__all__' ? undefined : recordType,
        targetCategoryCode: targetCode,
      }]);
      Alert.alert('成功', editing ? '分类映射已更新' : '分类映射已添加');
      setFormOpen(false);
      load(source);
    } catch (e: any) {
      setFormError(e?.message ?? '保存失败');
    } finally {
      setSaving(false);
    }
  };

  const confirmDelete = (m: CategoryMapping) => {
    Alert.alert('删除分类映射', `确定要删除「${m.sourceCategory}」→ ${m.targetCategoryCode} 的映射吗?`, [
      { text: '取消', style: 'cancel' },
      {
        text: '删除', style: 'destructive',
        onPress: async () => {
          try {
            await importExportApi.deleteMapping(m.id);
            load(source);
          } catch (e: any) {
            Alert.alert('删除失败', e?.message);
          }
        },
      },
    ]);
  };

  const openEdit = (m: CategoryMapping) => {
    setEditing(m);
    setSrcCategory(m.sourceCategory);
    setPayer(m.payerContains || '');
    setDesc(m.descriptionContains || '');
    setRecordType(m.recordType || '__all__');
    setTargetCode(m.targetCategoryCode);
    setFormError('');
    setFormOpen(true);
  };

  const inputStyle = useInputStyle();

  return (
    <View style={{ gap: 12 }}>
      <Text variant="muted" style={{ fontSize: 12 }}>将 CSV 交易分类映射到系统分类编码,导入时自动匹配。匹配项多的规则优先。</Text>
      <ErrorText msg={error} />
      <HeadRow title="数据来源" btnTitle="新增映射" onBtn={() => { setEditing(null); setSrcCategory(''); setPayer(''); setDesc(''); setRecordType('__all__'); setTargetCode(''); setFormError(''); setFormOpen(true); }} />
      <Chips options={MAPPING_SOURCES} value={source} onChange={setSource} />
      {loading ? (
        <Text variant="muted" style={{ fontSize: 12.5, textAlign: 'center', paddingVertical: 16 }}>加载中...</Text>
      ) : items.length === 0 ? (
        <Empty text="暂无映射" />
      ) : (
        <View style={{ gap: 8 }}>
          {items.map((m) => (
            <View key={m.id} style={{ borderWidth: 1, borderColor: colors.border, borderRadius: 12, padding: 12, gap: 4 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <Text style={{ fontSize: 13.5, fontWeight: '600', flex: 1 }}>{m.sourceCategory}</Text>
                <Text variant="muted" style={{ fontSize: 11 }}>{TYPE_LABEL[m.recordType] ?? '通用'}</Text>
                <OpIcon onPress={() => openEdit(m)}><Pencil size={14} color={colors.mutedForeground} /></OpIcon>
                <OpIcon onPress={() => confirmDelete(m)}><Trash2 size={14} color={colors.expense} /></OpIcon>
              </View>
              <Text variant="muted" style={{ fontSize: 11.5 }}>
                {m.payerContains ? `交易方:${m.payerContains}` : ''}{m.payerContains && m.descriptionContains ? ' · ' : ''}{m.descriptionContains ? `说明:${m.descriptionContains}` : ''}
                {!m.payerContains && !m.descriptionContains ? '无条件限制' : ''}
              </Text>
              <Text variant="muted" style={{ fontSize: 11.5 }}>→ {m.targetCategoryCode}</Text>
            </View>
          ))}
        </View>
      )}

      <Modal visible={formOpen} transparent animationType="fade" onRequestClose={() => setFormOpen(false)}>
        <Pressable style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', padding: 24 }} onPress={() => setFormOpen(false)}>
          <ScrollView style={{ maxHeight: '80%' }} keyboardShouldPersistTaps="handled">
            <Pressable style={{ backgroundColor: colors.card, borderRadius: 16, padding: 18, gap: 12 }} onPress={() => {}}>
              <Text style={{ fontSize: 16, fontWeight: '700' }}>{editing ? '编辑分类映射' : '新增分类映射'}</Text>
              <ErrorText msg={formError} />
              <LabeledInput label="CSV 原始分类名" value={srcCategory} onChangeText={(v) => { setSrcCategory(v); setFormError(''); }} placeholder="例如:餐饮美食" />
              <LabeledInput label="交易方正则 (可选)" value={payer} onChangeText={setPayer} placeholder="例如:麦当劳|肯德基" />
              <LabeledInput label="商品说明正则 (可选)" value={desc} onChangeText={setDesc} placeholder="例如:早餐|午餐" />
              <View style={{ gap: 5 }}>
                <Text variant="muted" style={{ fontSize: 11.5 }}>记录类型 (可选)</Text>
                <Chips options={RECORD_TYPE_OPTIONS} value={recordType} onChange={(v) => { setRecordType(v); setTargetCode(''); }} />
              </View>
              <View style={{ gap: 5 }}>
                <Text variant="muted" style={{ fontSize: 11.5 }}>目标系统分类</Text>
                <Pressable onPress={() => setDictPick(true)} style={inputStyle}>
                  <Text style={{ fontSize: 13.5, color: targetCode ? colors.foreground : colors.mutedForeground }}>
                    {(dicts.find((d) => d.code === targetCode)?.label ?? targetCode) || '选择系统分类...'}
                  </Text>
                </Pressable>
              </View>
              <View style={{ flexDirection: 'row', gap: 10 }}>
                <Btn title="取消" variant="secondary" onPress={() => setFormOpen(false)} />
                <Btn title={editing ? '保存' : '添加'} onPress={submit} loading={saving} />
              </View>
            </Pressable>
          </ScrollView>
        </Pressable>
      </Modal>

      <OptionModal
        visible={dictPick}
        title="选择系统分类"
        options={dicts.map((d) => ({ value: d.code, label: d.label }))}
        value={targetCode}
        onClose={() => setDictPick(false)}
        onSelect={setTargetCode}
      />
    </View>
  );
}

// ── 导入账户映射 ──
export function AccountMappingManager() {
  const { colors } = useTheme();
  const [source, setSource] = useState('alipay');
  const [items, setItems] = useState<AccountMapping[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<AccountMapping | null>(null);
  const [srcName, setSrcName] = useState('');
  const [payer, setPayer] = useState('');
  const [desc, setDesc] = useState('');
  const [targetName, setTargetName] = useState('');
  const [formError, setFormError] = useState('');
  const [saving, setSaving] = useState(false);

  const load = useCallback(async (src: string) => {
    setLoading(true);
    setError('');
    try {
      setItems((await importExportApi.getAccountMappings(src)).mappings);
    } catch (e: any) {
      setError(e?.message ?? '加载失败');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(source); }, [source, load]);

  const resetForm = () => { setSrcName(''); setPayer(''); setDesc(''); setTargetName(''); setFormError(''); };

  const submit = async () => {
    if (!srcName.trim()) { setFormError('请输入CSV原始账户名'); return; }
    if (!targetName.trim()) { setFormError('请输入目标账户名称'); return; }
    setSaving(true);
    setFormError('');
    try {
      if (editing) await importExportApi.deleteAccountMapping(editing.id);
      await importExportApi.saveAccountMappings([{
        source,
        sourceAccountName: srcName.trim(),
        payerContains: payer.trim() || undefined,
        descriptionContains: desc.trim() || undefined,
        targetAccountName: targetName.trim(),
      }]);
      Alert.alert('成功', editing ? '账户映射已更新' : '账户映射已添加');
      setFormOpen(false);
      resetForm();
      load(source);
    } catch (e: any) {
      setFormError(e?.message ?? '保存失败');
    } finally {
      setSaving(false);
    }
  };

  const confirmDelete = (m: AccountMapping) => {
    Alert.alert('删除账户映射', `确定要删除「${m.sourceAccountName}」→ ${m.targetAccountName} 的映射吗?`, [
      { text: '取消', style: 'cancel' },
      {
        text: '删除', style: 'destructive',
        onPress: async () => {
          try {
            await importExportApi.deleteAccountMapping(m.id);
            load(source);
          } catch (e: any) {
            Alert.alert('删除失败', e?.message);
          }
        },
      },
    ]);
  };

  return (
    <View style={{ gap: 12 }}>
      <Text variant="muted" style={{ fontSize: 12 }}>将 CSV 账户名映射到系统账户,导入时自动匹配。</Text>
      <ErrorText msg={error} />
      <HeadRow title="数据来源" btnTitle="新增映射" onBtn={() => { setEditing(null); resetForm(); setFormOpen(true); }} />
      <Chips options={MAPPING_SOURCES} value={source} onChange={setSource} />
      {loading ? (
        <Text variant="muted" style={{ fontSize: 12.5, textAlign: 'center', paddingVertical: 16 }}>加载中...</Text>
      ) : items.length === 0 ? (
        <Empty text="暂无账户映射" />
      ) : (
        <View style={{ gap: 8 }}>
          {items.map((m) => (
            <View key={m.id} style={{ flexDirection: 'row', alignItems: 'center', gap: 8, borderWidth: 1, borderColor: colors.border, borderRadius: 12, padding: 12 }}>
              <View style={{ flex: 1, gap: 2 }}>
                <Text style={{ fontSize: 13, fontWeight: '600' }}>{m.sourceAccountName} → {m.targetAccountName}</Text>
                <Text variant="muted" style={{ fontSize: 11 }} numberOfLines={1}>
                  {m.payerContains ? `交易方:${m.payerContains}` : ''}{m.payerContains && m.descriptionContains ? ' · ' : ''}{m.descriptionContains ? `说明:${m.descriptionContains}` : ''}
                  {!m.payerContains && !m.descriptionContains ? '无条件限制' : ''}
                </Text>
              </View>
              <OpIcon onPress={() => { setEditing(m); setSrcName(m.sourceAccountName); setPayer(m.payerContains || ''); setDesc(m.descriptionContains || ''); setTargetName(m.targetAccountName); setFormError(''); setFormOpen(true); }}>
                <Pencil size={14} color={colors.mutedForeground} />
              </OpIcon>
              <OpIcon onPress={() => confirmDelete(m)}><Trash2 size={14} color={colors.expense} /></OpIcon>
            </View>
          ))}
        </View>
      )}

      <Modal visible={formOpen} transparent animationType="fade" onRequestClose={() => setFormOpen(false)}>
        <Pressable style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', padding: 24 }} onPress={() => setFormOpen(false)}>
          <ScrollView keyboardShouldPersistTaps="handled">
            <Pressable style={{ backgroundColor: colors.card, borderRadius: 16, padding: 18, gap: 12 }} onPress={() => {}}>
              <Text style={{ fontSize: 16, fontWeight: '700' }}>{editing ? '编辑账户映射' : '新增账户映射'}</Text>
              <ErrorText msg={formError} />
              <LabeledInput label="CSV 原始账户名" value={srcName} onChangeText={(v) => { setSrcName(v); setFormError(''); }} placeholder="例如:花呗、招商银行储蓄卡(8888)" />
              <LabeledInput label="交易方正则 (可选)" value={payer} onChangeText={setPayer} placeholder="留空则不限制" />
              <LabeledInput label="商品说明正则 (可选)" value={desc} onChangeText={setDesc} placeholder="留空则不限制" />
              <LabeledInput label="目标账户名称" value={targetName} onChangeText={(v) => { setTargetName(v); setFormError(''); }} placeholder="例如:支付宝、招商银行" />
              <View style={{ flexDirection: 'row', gap: 10 }}>
                <Btn title="取消" variant="secondary" onPress={() => setFormOpen(false)} />
                <Btn title={editing ? '保存' : '添加'} onPress={submit} loading={saving} />
              </View>
            </Pressable>
          </ScrollView>
        </Pressable>
      </Modal>
    </View>
  );
}

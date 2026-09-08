import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Modal, Pressable, ScrollView, View } from 'react-native';
import { Pencil, Plus, Trash2, Zap } from 'lucide-react-native';
import { useTheme, alpha } from '@/theme';
import { Text } from '@/components/ui/Text';
import {
  aiAdminApi, type ProviderInfo, type ToolInfo, type UserProviderConfig,
} from '@/services/settings';
import { Btn, Chips, ErrorText, Field, FieldRow, LabeledInput, OptionModal, useInputStyle } from './shared';

const LANGUAGES = [
  { value: 'zh-CN', label: '简体中文' },
  { value: 'en', label: 'English' },
];

const ENGINES = [
  { value: 'bing', label: 'Bing' },
  { value: 'baidu', label: '百度' },
  { value: 'google', label: 'Google' },
];

const BOOL_OPTIONS = [
  { value: 'false', label: '关闭' },
  { value: 'true', label: '开启' },
];

const TEST_STATUS_COLOR: Record<string, string> = { pass: '#22c55e', fail: '#ef4444', untested: '#9ca3af' };

// AI 助手设置(管理员,对齐 web AIAssistantSettings)
export function AIAssistantSettings() {
  const { colors } = useTheme();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [okMsg, setOkMsg] = useState('');

  const [cfg, setCfg] = useState({
    enabled: false,
    simpleConfigId: null as string | null,
    complexConfigId: null as string | null,
    visionConfigId: null as string | null,
    language: 'zh-CN',
    autoConfirm: false,
    maxSteps: '10',
  });
  const [configs, setConfigs] = useState<UserProviderConfig[]>([]);
  const [providers, setProviders] = useState<ProviderInfo[]>([]);
  const [toolGroups, setToolGroups] = useState<{ label: string; tools: ToolInfo[] }[]>([]);
  const [disabledTools, setDisabledTools] = useState<string[]>([]);
  const [engine, setEngine] = useState('bing');

  // 模型配置编辑弹窗
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<UserProviderConfig | null>(null);
  const [form, setForm] = useState({ provider: 'deepseek', name: '', apiKey: '', baseURL: '', models: '', temperature: '', maxTokens: '', contextWindow: '', multimodal: false });
  const [formError, setFormError] = useState('');
  const [formSaving, setFormSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testMsg, setTestMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [testingId, setTestingId] = useState<string | null>(null);
  const [modelPick, setModelPick] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [prefs, providerList, configList, toolGroupList, eng] = await Promise.all([
        aiAdminApi.fetchAIConfig(),
        aiAdminApi.fetchProviders(),
        aiAdminApi.fetchProviderConfigs(),
        aiAdminApi.fetchTools(),
        aiAdminApi.fetchSearchEngine(),
      ]);
      setCfg({
        enabled: prefs.enabled,
        simpleConfigId: prefs.simpleProviderConfigId,
        complexConfigId: prefs.complexProviderConfigId,
        visionConfigId: prefs.visionProviderConfigId,
        language: prefs.language,
        autoConfirm: prefs.autoConfirmCreate,
        maxSteps: String(prefs.maxSteps ?? 10),
      });
      setProviders(providerList);
      setConfigs(configList);
      setToolGroups(toolGroupList);
      setDisabledTools(prefs.disabledTools || []);
      setEngine(eng);
    } catch (e: any) {
      setError(e?.message ?? '加载 AI 配置失败');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const providerLabel = (v: string) => providers.find((p) => p.value === v)?.label ?? v;
  const defaultBaseURL = (v: string) => providers.find((p) => p.value === v)?.defaultBaseURL ?? '';
  const configName = (id: string | null) => {
    const c = configs.find((x) => x.id === id);
    return c ? (c.name || providerLabel(c.provider)) : '';
  };

  const save = async () => {
    setSaving(true);
    setError('');
    setOkMsg('');
    try {
      await aiAdminApi.updateAIConfig({
        enabled: cfg.enabled,
        simpleProviderConfigId: cfg.simpleConfigId,
        simpleModel: firstModel(cfg.simpleConfigId),
        complexProviderConfigId: cfg.complexConfigId,
        complexModel: firstModel(cfg.complexConfigId),
        visionProviderConfigId: cfg.visionConfigId,
        visionModel: firstModel(cfg.visionConfigId),
        language: cfg.language,
        autoConfirmCreate: cfg.autoConfirm,
        maxSteps: parseInt(cfg.maxSteps) || 10,
        disabledTools,
      });
      setOkMsg('助手配置已保存');
    } catch (e: any) {
      setError(e?.message ?? '保存失败');
    } finally {
      setSaving(false);
    }
  };

  const firstModel = (configId: string | null): string => {
    const c = configs.find((x) => x.id === configId);
    if (!c) return '';
    const list = (c.models || '').split(',').map((m) => m.trim()).filter(Boolean);
    return list[0] || providers.find((p) => p.value === c.provider)?.defaultModels[0] || '';
  };

  // ── 模型配置 CRUD ──
  const openAdd = () => {
    setEditing(null);
    setForm({ provider: 'deepseek', name: '', apiKey: '', baseURL: defaultBaseURL('deepseek'), models: '', temperature: '', maxTokens: '', contextWindow: '', multimodal: false });
    setFormError('');
    setTestMsg(null);
    setFormOpen(true);
  };

  const openEdit = (c: UserProviderConfig) => {
    setEditing(c);
    setForm({
      provider: c.provider,
      name: c.name,
      apiKey: c.apiKey === '****' ? '' : c.apiKey,
      baseURL: c.baseURL,
      models: c.models,
      temperature: c.temperature != null ? String(c.temperature) : '',
      maxTokens: c.maxTokens != null ? String(c.maxTokens) : '',
      contextWindow: c.contextWindow != null ? String(c.contextWindow) : '',
      multimodal: c.multimodal,
    });
    setFormError('');
    setTestMsg(null);
    setFormOpen(true);
  };

  const submitConfig = async () => {
    setFormSaving(true);
    setFormError('');
    try {
      const data = {
        provider: form.provider,
        name: form.name || undefined,
        apiKey: form.apiKey,
        baseURL: form.baseURL,
        temperature: form.temperature ? Number(form.temperature) : null,
        maxTokens: form.maxTokens ? Number(form.maxTokens) : null,
        contextWindow: form.contextWindow ? Number(form.contextWindow) : null,
        multimodal: form.multimodal,
        models: form.models,
      };
      if (editing) {
        const updated = await aiAdminApi.updateProviderConfig(editing.id, data);
        setConfigs((prev) => prev.map((c) => (c.id === updated.id ? updated : c)));
        Alert.alert('成功', '模型配置已更新');
      } else {
        const created = await aiAdminApi.createProviderConfig(data);
        setConfigs((prev) => [...prev, created]);
        Alert.alert('成功', '模型配置已创建');
      }
      setFormOpen(false);
    } catch (e: any) {
      setFormError(e?.message ?? '保存失败');
    } finally {
      setFormSaving(false);
    }
  };

  const testForm = async () => {
    setTesting(true);
    setTestMsg(null);
    try {
      const res = await aiAdminApi.testProviderConnection({
        provider: form.provider,
        apiKey: form.apiKey,
        baseURL: form.baseURL || defaultBaseURL(form.provider),
        model: form.models || undefined,
        configId: editing?.id,
      });
      setTestMsg({ ok: res.success, text: res.message });
    } catch (e: any) {
      setTestMsg({ ok: false, text: e?.message ?? '测试请求失败' });
    } finally {
      setTesting(false);
    }
  };

  const testFromList = async (c: UserProviderConfig) => {
    setTestingId(c.id);
    try {
      const res = await aiAdminApi.testProviderConnection({ provider: c.provider, apiKey: '', baseURL: c.baseURL, model: c.models || undefined, configId: c.id });
      setConfigs((prev) => prev.map((x) => (x.id === c.id ? { ...x, testStatus: res.success ? 'pass' : 'fail' } : x)));
      Alert.alert(res.success ? '测试通过' : '测试失败', res.message);
    } catch (e: any) {
      Alert.alert('测试失败', e?.message ?? '测试请求失败');
    } finally {
      setTestingId(null);
    }
  };

  const copyConfig = async (id: string) => {
    try {
      const created = await aiAdminApi.copyProviderConfig(id);
      setConfigs((prev) => [...prev, created]);
    } catch (e: any) {
      Alert.alert('复制失败', e?.message);
    }
  };

  const deleteConfig = (c: UserProviderConfig) => {
    Alert.alert('删除模型配置', `确定要删除「${c.name || providerLabel(c.provider)}」吗?`, [
      { text: '取消', style: 'cancel' },
      {
        text: '删除', style: 'destructive',
        onPress: async () => {
          try {
            await aiAdminApi.deleteProviderConfig(c.id);
            setConfigs((prev) => prev.filter((x) => x.id !== c.id));
          } catch (e: any) {
            Alert.alert('删除失败', e?.message);
          }
        },
      },
    ]);
  };

  const inputStyle = useInputStyle();

  const [slotPick, setSlotPick] = useState<null | 'simpleConfigId' | 'complexConfigId' | 'visionConfigId'>(null);
  const SLOT_LABELS: Record<string, string> = { simpleConfigId: '简单任务模型', complexConfigId: '复杂任务模型', visionConfigId: '视觉模型' };

  if (loading) {
    return <Text variant="muted" style={{ fontSize: 12.5, textAlign: 'center', paddingVertical: 16 }}>加载中...</Text>;
  }

  const slotOptions = configs.map((c) => ({ value: c.id, label: c.name || providerLabel(c.provider) }));
  const noneOption = [{ value: '__none__', label: '未选择' }];

  return (
    <View style={{ gap: 14 }}>
      <ErrorText msg={error} />
      <Text style={{ fontSize: 12, color: colors.income }}>{okMsg}</Text>

      {/* 启用开关 */}
      <FieldRow label="启用 AI 助手" desc="开启后首页显示聊天窗口,关闭则隐藏">
        <View style={{ width: 140 }}>
          <Chips options={BOOL_OPTIONS.map((o) => ({ value: o.value, label: o.label }))} value={String(cfg.enabled)} onChange={(v) => setCfg((s) => ({ ...s, enabled: v === 'true' }))} />
        </View>
      </FieldRow>

      {/* 模型槽位 */}
      <View style={{ gap: 8 }}>
        <Field label="模型分配" desc="不同复杂度的任务使用不同模型" />
        {([
          { key: 'simpleConfigId' as const, label: '简单任务模型' },
          { key: 'complexConfigId' as const, label: '复杂任务模型' },
          { key: 'visionConfigId' as const, label: '视觉模型(OCR,可选)' },
        ]).map((slot) => (
          <Pressable
            key={slot.key}
            onPress={() => setSlotPick(slot.key)}
            style={{ flexDirection: 'row', alignItems: 'center', gap: 10, borderWidth: 1, borderColor: colors.border, borderRadius: 10, paddingVertical: 9, paddingHorizontal: 12, backgroundColor: colors.elevated }}
          >
            <Text variant="muted" style={{ fontSize: 12, flex: 1 }}>{slot.label}</Text>
            <Text style={{ fontSize: 12.5, fontWeight: '500' }}>{configName(cfg[slot.key]) || '未选择'}</Text>
          </Pressable>
        ))}
      </View>

      {/* 对话设置 */}
      <View style={{ gap: 10 }}>
        <Field label="对话设置" />
        <FieldRow label="回复语言">
          <View style={{ width: 160 }}>
            <Chips options={LANGUAGES} value={cfg.language} onChange={(v) => setCfg((s) => ({ ...s, language: v }))} />
          </View>
        </FieldRow>
        <FieldRow label="自动确认记账">
          <View style={{ width: 160 }}>
            <Chips options={BOOL_OPTIONS} value={String(cfg.autoConfirm)} onChange={(v) => setCfg((s) => ({ ...s, autoConfirm: v === 'true' }))} />
          </View>
        </FieldRow>
        <LabeledInput label="最大迭代次数(默认 10)" value={cfg.maxSteps} onChangeText={(v) => setCfg((s) => ({ ...s, maxSteps: v }))} keyboardType="numeric" />
      </View>

      {/* 模型配置列表 */}
      <View style={{ gap: 10 }}>
        <FieldRow label={`模型配置 (${configs.length})`} desc="管理 AI 供应商的连接信息">
          <Pressable onPress={openAdd} style={{ flexDirection: 'row', alignItems: 'center', gap: 3, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8, backgroundColor: colors.primary }}>
            <Plus size={13} color={colors.primaryForeground} />
            <Text style={{ fontSize: 12, color: colors.primaryForeground, fontWeight: '600' }}>新增</Text>
          </Pressable>
        </FieldRow>
        {configs.length === 0 ? (
          <Text variant="muted" style={{ fontSize: 12.5, textAlign: 'center', paddingVertical: 12, borderWidth: 1, borderStyle: 'dashed', borderColor: colors.border, borderRadius: 12 }}>暂无模型配置,点击「新增」添加</Text>
        ) : (
          <View style={{ gap: 8 }}>
            {configs.map((c) => (
              <View key={c.id} style={{ flexDirection: 'row', alignItems: 'center', gap: 10, borderWidth: 1, borderColor: colors.border, borderRadius: 12, padding: 12 }}>
                <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: TEST_STATUS_COLOR[c.testStatus] ?? '#9ca3af' }} />
                <View style={{ flex: 1, gap: 2 }}>
                  <Text style={{ fontSize: 13, fontWeight: '600' }} numberOfLines={1}>{c.name || providerLabel(c.provider)}</Text>
                  <Text variant="muted" style={{ fontSize: 11 }} numberOfLines={1}>
                    {providerLabel(c.provider)}{c.baseURL ? ` · ${c.baseURL}` : ''}{c.apiKey ? ' · Key 已配置' : ''}{c.multimodal ? ' · 多模态' : ''}
                  </Text>
                </View>
                <Pressable hitSlop={6} disabled={testingId === c.id} onPress={() => testFromList(c)} style={{ width: 30, height: 30, alignItems: 'center', justifyContent: 'center' }}>
                  {testingId === c.id ? <ActivityIndicator size="small" color={colors.primary} /> : <Zap size={14} color={colors.primary} />}
                </Pressable>
                <Pressable hitSlop={6} onPress={() => openEdit(c)} style={{ width: 30, height: 30, alignItems: 'center', justifyContent: 'center' }}>
                  <Pencil size={14} color={colors.mutedForeground} />
                </Pressable>
                <Pressable hitSlop={6} onPress={() => copyConfig(c.id)} style={{ width: 30, height: 30, alignItems: 'center', justifyContent: 'center' }}>
                  <Plus size={14} color={colors.mutedForeground} />
                </Pressable>
                <Pressable hitSlop={6} onPress={() => deleteConfig(c)} style={{ width: 30, height: 30, alignItems: 'center', justifyContent: 'center' }}>
                  <Trash2 size={14} color={colors.expense} />
                </Pressable>
              </View>
            ))}
          </View>
        )}
      </View>

      {/* 网络搜索 */}
      <FieldRow label="搜索引擎" desc="AI 助手搜索信息时使用的引擎">
        <View style={{ width: 170 }}>
          <Chips
            options={ENGINES}
            value={engine}
            onChange={(v) => { setEngine(v); aiAdminApi.updateSearchEngine(v).catch(() => {}); }}
          />
        </View>
      </FieldRow>

      {/* 工具管理 */}
      <View style={{ gap: 8 }}>
        <Field label="工具管理" desc="控制 AI 助手可使用的工具" />
        {toolGroups.map((g) => (
          <View key={g.label} style={{ gap: 6 }}>
            <Text variant="muted" style={{ fontSize: 11.5, fontWeight: '600' }}>{g.label}</Text>
            {g.tools.map((tool) => {
              const disabled = disabledTools.includes(tool.name);
              return (
                <View key={tool.name} style={{ flexDirection: 'row', alignItems: 'center', gap: 10, borderWidth: 1, borderColor: colors.border, borderRadius: 10, padding: 10 }}>
                  <View style={{ flex: 1 }}>
                    <Text style={{ fontSize: 12.5, fontWeight: '500' }}>{tool.displayName}</Text>
                    <Text variant="muted" style={{ fontSize: 11 }} numberOfLines={1}>{tool.description}</Text>
                  </View>
                  <Pressable
                    onPress={() => setDisabledTools((prev) => (disabled ? prev.filter((n) => n !== tool.name) : [...prev, tool.name]))}
                    style={{ width: 40, height: 22, borderRadius: 11, backgroundColor: disabled ? colors.muted : colors.primary, justifyContent: 'center', paddingHorizontal: 2 }}
                  >
                    <View style={{ width: 18, height: 18, borderRadius: 9, backgroundColor: '#fff', alignSelf: disabled ? 'flex-start' : 'flex-end' }} />
                  </Pressable>
                </View>
              );
            })}
          </View>
        ))}
      </View>

      <Btn title="保存配置" onPress={save} loading={saving} />

      {/* 模型槽位选择 */}
      <OptionModal
        visible={slotPick != null}
        title={`选择${slotPick ? SLOT_LABELS[slotPick] : ''}`}
        options={[...noneOption, ...slotOptions]}
        value={slotPick ? (cfg[slotPick] ?? '__none__') : undefined}
        onClose={() => setSlotPick(null)}
        onSelect={(v) => { if (slotPick) setCfg((s) => ({ ...s, [slotPick]: v === '__none__' ? null : v })); }}
      />

      {/* 模型配置编辑弹窗 */}
      <Modal visible={formOpen} transparent animationType="fade" onRequestClose={() => setFormOpen(false)}>
        <Pressable style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', padding: 20 }} onPress={() => setFormOpen(false)}>
          <ScrollView keyboardShouldPersistTaps="handled">
            <Pressable style={{ backgroundColor: colors.card, borderRadius: 16, padding: 18, gap: 12 }} onPress={() => {}}>
              <Text style={{ fontSize: 16, fontWeight: '700' }}>{editing ? '编辑模型配置' : '新增模型配置'}</Text>
              <ErrorText msg={formError} />
              {testMsg && (
                <Text style={{ fontSize: 12, color: testMsg.ok ? colors.income : colors.expense }}>{testMsg.text}</Text>
              )}
              <View style={{ gap: 5 }}>
                <Text variant="muted" style={{ fontSize: 11.5 }}>供应商</Text>
                <Chips
                  options={providers.map((p) => ({ value: p.value, label: p.label }))}
                  value={form.provider}
                  onChange={(v) => setForm((f) => ({ ...f, provider: v, baseURL: defaultBaseURL(v) }))}
                />
              </View>
              <LabeledInput label="名称 (可选)" value={form.name} onChangeText={(v) => setForm((f) => ({ ...f, name: v }))} placeholder="例如:我的 DeepSeek" />
              <LabeledInput label={`API Key${editing ? '(留空表示不修改)' : ''}`} value={form.apiKey} onChangeText={(v) => setForm((f) => ({ ...f, apiKey: v }))} secure placeholder="输入 API Key" />
              <LabeledInput label="API 端点 URL" value={form.baseURL} onChangeText={(v) => setForm((f) => ({ ...f, baseURL: v }))} placeholder={defaultBaseURL(form.provider)} />
              <LabeledInput label="模型名称" value={form.models} onChangeText={(v) => setForm((f) => ({ ...f, models: v }))} placeholder={providers.find((p) => p.value === form.provider)?.defaultModels[0] ?? '输入模型名称'} />
              <View style={{ flexDirection: 'row', gap: 8 }}>
                <View style={{ flex: 1 }}>
                  <LabeledInput label="温度 (可选)" value={form.temperature} onChangeText={(v) => setForm((f) => ({ ...f, temperature: v }))} keyboardType="decimal-pad" placeholder="0.7" />
                </View>
                <View style={{ flex: 1 }}>
                  <LabeledInput label="最大 Token (可选)" value={form.maxTokens} onChangeText={(v) => setForm((f) => ({ ...f, maxTokens: v }))} keyboardType="numeric" placeholder="4096" />
                </View>
              </View>
              <LabeledInput label="上下文窗口 (可选)" value={form.contextWindow} onChangeText={(v) => setForm((f) => ({ ...f, contextWindow: v }))} keyboardType="numeric" placeholder="如 32768" />
              {/* 多模态开关 */}
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, borderWidth: 1, borderColor: colors.border, borderRadius: 10, padding: 10 }}>
                <View style={{ flex: 1 }}>
                  <Text style={{ fontSize: 12.5, fontWeight: '500' }}>多模态模型</Text>
                  <Text variant="muted" style={{ fontSize: 11 }}>开启后聊天图片直接发给该模型识别，不再调用 OCR 工具（仅作为主模型时生效）</Text>
                </View>
                <Pressable
                  onPress={() => setForm((f) => ({ ...f, multimodal: !f.multimodal }))}
                  style={{ width: 40, height: 22, borderRadius: 11, backgroundColor: form.multimodal ? colors.primary : colors.muted, justifyContent: 'center', paddingHorizontal: 2 }}
                >
                  <View style={{ width: 18, height: 18, borderRadius: 9, backgroundColor: '#fff', alignSelf: form.multimodal ? 'flex-end' : 'flex-start' }} />
                </Pressable>
              </View>
              <View style={{ flexDirection: 'row', gap: 10 }}>
                <Btn title="取消" variant="secondary" onPress={() => setFormOpen(false)} />
                <Btn title="测试连接" variant="secondary" onPress={testForm} loading={testing} />
                <Btn title="保存" onPress={submitConfig} loading={formSaving} />
              </View>
            </Pressable>
          </ScrollView>
        </Pressable>
      </Modal>
    </View>
  );
}

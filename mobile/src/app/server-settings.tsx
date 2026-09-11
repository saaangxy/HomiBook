import { useEffect, useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ArrowLeft, Bot, Brain, BookOpen, Database, FolderOpen, Key, Link2, Settings, Wallet } from 'lucide-react-native';
import { useTheme, paletteOrder, palettes } from '@/theme';
import { useAuth } from '@/stores/auth';
import { Text } from '@/components/ui/Text';
import { Section, Field, Chips, Btn, ErrorText, OkText, LabeledInput } from '@/components/settings/shared';
import { AccountMappingManager, ApiKeyManager, CategoryMappingManager, DictManager, DICT_GROUPS } from '@/components/settings/Managers';
import { AIAssistantSettings } from '@/components/settings/AIAssistantSettings';
import { holidayApi, memoryApi, settingsApi, type UserMemory } from '@/services/settings';
import { ConfirmProvider, useConfirm } from '@/components/chrome/ConfirmSheet';
import { showToast } from '@/components/chrome/Toast';

const MEMORY_TYPE_LABELS: Record<string, string> = { habit: '习惯', preference: '偏好', rule: '规则', fact: '事实' };

// ── AI 记忆管理 ──
function MemoryManager() {
  const { colors } = useTheme();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [memories, setMemories] = useState<UserMemory[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [content, setContent] = useState('');
  const [importance, setImportance] = useState('');

  const load = () => {
    setLoading(true);
    memoryApi.fetchMemories().then(setMemories).catch(() => setError('加载记忆失败')).finally(() => setLoading(false));
  };
  useEffect(() => { load(); }, []);

  const startEdit = (m: UserMemory) => { setEditingId(m.id); setContent(m.content); setImportance(String(m.importance)); setError(''); };

  const saveEdit = async () => {
    const imp = parseFloat(importance);
    if (isNaN(imp) || imp < 0 || imp > 1) { setError('重要程度需为 0-1 之间的数字'); return; }
    try {
      await memoryApi.updateMemory(editingId!, { content, importance: imp });
      setMemories((prev) => prev.map((m) => (m.id === editingId ? { ...m, content, importance: imp } : m)));
      setEditingId(null);
      setError('');
    } catch (e: any) {
      setError(e?.message ?? '更新记忆失败');
    }
  };

  // 删除二次确认(ConfirmSheet 已上提到页面层,通过 useConfirm 触发)
  const confirm = useConfirm();
  const del = (m: UserMemory) => {
    confirm({
      title: '删除记忆',
      message: '确定要删除这条记忆吗?',
      onConfirm: async () => {
        try {
          await memoryApi.deleteMemory(m.id);
          setMemories((prev) => prev.filter((x) => x.id !== m.id));
        } catch (e: any) {
          setError(e?.message ?? '删除记忆失败');
        }
      },
    });
  };

  return (
    <View style={{ gap: 12 }}>
      <Text variant="muted" style={{ fontSize: 12 }}>管理所有用户的 AI 记忆。AI 会在对话中自动识别消费习惯和记账偏好并保存。</Text>
      <ErrorText msg={error} />
      {loading ? (
        <Text variant="muted" style={{ fontSize: 12.5, textAlign: 'center', paddingVertical: 12 }}>加载中...</Text>
      ) : memories.length === 0 ? (
        <Text variant="muted" style={{ fontSize: 12.5, textAlign: 'center', paddingVertical: 16, borderWidth: 1, borderStyle: 'dashed', borderColor: colors.border, borderRadius: 12 }}>
          暂无记忆
        </Text>
      ) : (
        <View style={{ gap: 8 }}>
          {memories.map((m) => (
            <View key={m.id} style={{ borderWidth: 1, borderColor: colors.border, borderRadius: 12, padding: 12 }}>
              {editingId === m.id ? (
                <View style={{ gap: 8 }}>
                  <LabeledInput label="内容" value={content} onChangeText={setContent} />
                  <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 8 }}>
                    <View style={{ width: 110 }}>
                      <LabeledInput label="重要度 0-1" value={importance} onChangeText={setImportance} keyboardType="decimal-pad" />
                    </View>
                    <View style={{ flex: 1, flexDirection: 'row', gap: 8 }}>
                      <Btn title="保存" onPress={saveEdit} />
                      <Btn title="取消" variant="secondary" onPress={() => setEditingId(null)} />
                    </View>
                  </View>
                </View>
              ) : (
                <View style={{ flexDirection: 'row', gap: 10 }}>
                  <View style={{ flex: 1, gap: 4 }}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                      <View style={{ paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6, backgroundColor: colors.muted }}>
                        <Text variant="muted" style={{ fontSize: 10.5 }}>{MEMORY_TYPE_LABELS[m.memoryType] ?? m.memoryType}</Text>
                      </View>
                      <Text variant="muted" style={{ fontSize: 10.5 }}>重要度 {m.importance.toFixed(1)}</Text>
                    </View>
                    <Text style={{ fontSize: 13 }}>{m.content}</Text>
                  </View>
                  <Pressable hitSlop={6} onPress={() => startEdit(m)} style={{ width: 30, height: 30, alignItems: 'center', justifyContent: 'center' }}>
                    <Text style={{ fontSize: 12, color: colors.primary }}>编辑</Text>
                  </Pressable>
                  <Pressable hitSlop={6} onPress={() => del(m)} style={{ width: 30, height: 30, alignItems: 'center', justifyContent: 'center' }}>
                    <Text style={{ fontSize: 12, color: colors.expense }}>删除</Text>
                  </Pressable>
                </View>
              )}
            </View>
          ))}
        </View>
      )}

      {/* 删除二次确认已上提到页面层 ConfirmProvider */}
    </View>
  );
}

const CURRENCIES = ['CNY', 'USD', 'EUR', 'JPY', 'GBP', 'HKD'];
const HOLIDAY_API_OPTIONS = [
  { value: 'https://timor.tech/api/holiday/year/{year}', label: 'timor.tech(免费,推荐)' },
  { value: 'https://api.jiejiariapi.com/v1/holidays/{year}', label: 'jiejiariapi.com(备选)' },
];
const JWT_EXPIRE_OPTIONS = [
  { value: '1d', label: '1 天' },
  { value: '7d', label: '7 天' },
  { value: '30d', label: '30 天' },
];
const AUDIT_RETENTION_OPTIONS = [
  { value: '7', label: '7 天' },
  { value: '30', label: '30 天' },
  { value: '90', label: '90 天' },
  { value: '180', label: '180 天' },
];
// 全局默认主题选项:跟随系统 + 全部调色板(与移动端外观主题/网页端一致)
const THEME_OPTIONS = [
  { value: 'system', label: '跟随系统' },
  ...paletteOrder.map((id) => ({ value: id, label: palettes[id].name })),
];

// ── 通用设置(管理员) ──
function GeneralSettings() {
  const { colors } = useTheme();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [cfg, setCfg] = useState({
    registrationOpen: true,
    defaultCurrency: 'CNY',
    amountHighlightThreshold: '1000',
    holidayApiUrl: HOLIDAY_API_OPTIONS[0].value,
    defaultTheme: 'system',
    jwtExpiresIn: '7d',
    auditLogRetentionDays: '7',
  });
  const [syncing, setSyncing] = useState(false);

  useEffect(() => {
    settingsApi.getConfig()
      .then((c) => setCfg((s) => ({
        ...s,
        ...(typeof c.registrationOpen === 'boolean' ? { registrationOpen: c.registrationOpen } : {}),
        ...(typeof c.defaultCurrency === 'string' ? { defaultCurrency: c.defaultCurrency } : {}),
        ...(c.amountHighlightThreshold != null ? { amountHighlightThreshold: String(c.amountHighlightThreshold) } : {}),
        ...(typeof c.holidayApiUrl === 'string' ? { holidayApiUrl: c.holidayApiUrl } : {}),
        ...(typeof c.defaultTheme === 'string' ? { defaultTheme: c.defaultTheme } : {}),
        ...(typeof c.jwtExpiresIn === 'string' && JWT_EXPIRE_OPTIONS.some((o) => o.value === c.jwtExpiresIn) ? { jwtExpiresIn: c.jwtExpiresIn } : {}),
        ...(typeof c.auditLogRetentionDays === 'string' && AUDIT_RETENTION_OPTIONS.some((o) => o.value === c.auditLogRetentionDays) ? { auditLogRetentionDays: c.auditLogRetentionDays } : {}),
      })))
      .catch(() => setError('加载配置失败'))
      .finally(() => setLoading(false));
  }, []);

  const save = async () => {
    setSaving(true);
    setError('');
    try {
      await settingsApi.updateConfig({
        registrationOpen: cfg.registrationOpen,
        defaultCurrency: cfg.defaultCurrency,
        amountHighlightThreshold: parseFloat(cfg.amountHighlightThreshold) || 0,
        holidayApiUrl: cfg.holidayApiUrl,
        defaultTheme: cfg.defaultTheme,
        jwtExpiresIn: cfg.jwtExpiresIn,
        auditLogRetentionDays: cfg.auditLogRetentionDays,
      });
      showToast('配置已保存');
    } catch (e: any) {
      showToast(`保存失败: ${e?.message ?? '未知错误'}`);
    } finally {
      setSaving(false);
    }
  };

  const syncHolidays = async () => {
    setSyncing(true);
    try {
      const res = await holidayApi.sync();
      showToast(`同步完成,导入了 ${res.imported} 条节假日数据`);
    } catch (e: any) {
      showToast(`同步失败: ${e?.message ?? '未知错误'}`);
    } finally {
      setSyncing(false);
    }
  };

  if (loading) return <Text variant="muted" style={{ fontSize: 12.5, textAlign: 'center', paddingVertical: 12 }}>加载中...</Text>;

  // 字段间分隔线(纵向布局:label/说明在上,控件全宽在下,不再左右挤压)
  const divider = <View style={{ height: 1, backgroundColor: colors.hairline }} />;

  return (
    <View style={{ gap: 12 }}>
      <ErrorText msg={error} />
      <Field label="开放注册" desc="关闭后登录页面将隐藏注册入口">
        <Chips options={[{ value: 'true', label: '已开启' }, { value: 'false', label: '已关闭' }]} value={String(cfg.registrationOpen)} onChange={(v) => setCfg((s) => ({ ...s, registrationOpen: v === 'true' }))} />
      </Field>
      {divider}
      <Field label="默认货币" desc="新建账本时使用的默认货币单位">
        <Chips options={CURRENCIES.map((c) => ({ value: c, label: c }))} value={cfg.defaultCurrency} onChange={(v) => setCfg((s) => ({ ...s, defaultCurrency: v }))} />
      </Field>
      {divider}
      <LabeledInput label="支出高亮阈值(元)" desc="流水日历中当日支出超过此金额的日期高亮显示" value={cfg.amountHighlightThreshold} onChangeText={(v) => setCfg((s) => ({ ...s, amountHighlightThreshold: v }))} keyboardType="numeric" />
      {divider}
      <Field label="登录有效期" desc="Token 有效时长,修改仅对后续登录生效">
        <Chips options={JWT_EXPIRE_OPTIONS} value={cfg.jwtExpiresIn} onChange={(v) => setCfg((s) => ({ ...s, jwtExpiresIn: v }))} />
      </Field>
      {divider}
      <Field label="AI 审计日志保留" desc="超过保留天数的 AI 操作记录自动删除">
        <Chips options={AUDIT_RETENTION_OPTIONS} value={cfg.auditLogRetentionDays} onChange={(v) => setCfg((s) => ({ ...s, auditLogRetentionDays: v }))} />
      </Field>
      {divider}
      <Field label="节假日数据源" desc="用于同步和显示节假日/调休信息">
        <Chips options={HOLIDAY_API_OPTIONS} value={HOLIDAY_API_OPTIONS.some((o) => o.value === cfg.holidayApiUrl) ? cfg.holidayApiUrl : '__custom__'} onChange={(v) => setCfg((s) => ({ ...s, holidayApiUrl: v === '__custom__' ? '' : v }))} />
      </Field>
      <LabeledInput label="自定义节假日 API 地址({year} 为年份占位符)" value={cfg.holidayApiUrl} onChangeText={(v) => setCfg((s) => ({ ...s, holidayApiUrl: v }))} />
      <Btn title="同步节假日" variant="secondary" onPress={syncHolidays} loading={syncing} />
      {divider}
      <Field label="全局默认主题" desc="未设置个人主题的用户使用此主题">
        <Chips options={THEME_OPTIONS} value={cfg.defaultTheme} onChange={(v) => setCfg((s) => ({ ...s, defaultTheme: v }))} />
      </Field>
      {divider}
      <Btn title="保存配置" onPress={save} loading={saving} />
    </View>
  );
}

// ── 附件管理(管理员) ──
function AttachmentManager() {
  const [loading, setLoading] = useState(false);
  const [cleaning, setCleaning] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState<{ count: number; files: number } | null>(null);
  const [cleaned, setCleaned] = useState<{ deletedFiles: number; deletedRecords: number } | null>(null);

  const query = async () => {
    setLoading(true);
    setError('');
    setResult(null);
    setCleaned(null);
    try {
      const items = await settingsApi.getOrphanAttachments();
      setResult({ count: items.length, files: items.filter((i) => i.fileExists).length });
    } catch (e: any) {
      setError(e?.message ?? '查询失败');
    } finally {
      setLoading(false);
    }
  };

  // 清理二次确认(ConfirmSheet 已上提到页面层,通过 useConfirm 触发)
  const confirm = useConfirm();
  const clean = () => {
    confirm({
      title: '清理无效附件',
      message: `确定要删除所有无效附件吗?将永久删除 ${result?.files ?? 0} 个磁盘文件。`,
      confirmLabel: '确认清理',
      onConfirm: async () => {
        setCleaning(true);
        setError('');
        try {
          const res = await settingsApi.cleanOrphanAttachments();
          setCleaned(res);
          setResult(null);
        } catch (e: any) {
          setError(e?.message ?? '清理失败');
        } finally {
          setCleaning(false);
        }
      },
    });
  };

  return (
    <View style={{ gap: 12 }}>
      <Text variant="muted" style={{ fontSize: 12 }}>
        无效附件包括:上传后未关联到流水的文件,以及数据库记录已删除但文件残留的孤儿文件。清理可释放磁盘空间。
      </Text>
      <ErrorText msg={error} />
      {result && <OkText msg={`共 ${result.count} 条记录(${result.files} 个文件存在于磁盘)`} />}
      {cleaned && <OkText msg={`已清理 ${cleaned.deletedFiles} 个文件、${cleaned.deletedRecords} 条数据库记录`} />}
      <View style={{ flexDirection: 'row', gap: 10 }}>
        <View style={{ flex: 1 }}><Btn title="查询无效附件" variant="secondary" onPress={query} loading={loading} /></View>
        <View style={{ flex: 1 }}><Btn title="清理所有无效附件" variant="danger" onPress={clean} disabled={cleaning || !result || result.count === 0} loading={cleaning} /></View>
      </View>

      {/* 清理二次确认已上提到页面层 ConfirmProvider */}
    </View>
  );
}

// 服务器管理页(仅管理员,独立于设置 tab,承载服务端全局配置)
export default function ServerSettingsScreen() {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const { user } = useAuth();

  if (user?.role !== 'ADMIN') {
    return (
      <View style={{ flex: 1, backgroundColor: colors.background, alignItems: 'center', justifyContent: 'center', gap: 8 }}>
        <Text style={{ fontSize: 15, fontWeight: '600' }}>无权访问</Text>
        <Text variant="muted" style={{ fontSize: 12.5 }}>该页面仅管理员可见</Text>
        <Pressable onPress={() => router.back()} style={{ marginTop: 12, paddingHorizontal: 16, paddingVertical: 8, borderRadius: 999, backgroundColor: colors.muted }}>
          <Text style={{ fontSize: 13 }}>返回</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <ConfirmProvider>
        {/* 头部 */}
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 16, paddingTop: insets.top + 8, paddingBottom: 12 }}>
          <Pressable hitSlop={8} onPress={() => router.back()} style={{ width: 32, height: 32, borderRadius: 10, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.muted }}>
            <ArrowLeft size={17} color={colors.foreground} />
          </Pressable>
          <Text style={{ fontSize: 18, fontWeight: '700' }}>服务器管理</Text>
        </View>
        <ScrollView contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 40 }} keyboardShouldPersistTaps="handled">
          <Text variant="muted" style={{ fontSize: 11.5, marginBottom: 12 }}>
            以下为服务端全局配置,影响所有连接此服务器的用户。
          </Text>
          <View style={{ gap: 12 }}>
            <Section icon={<Settings size={15} color={colors.primaryForeground} />} title="通用设置">
              <GeneralSettings />
            </Section>
            <Section icon={<Bot size={15} color={colors.primaryForeground} />} title="AI 助手">
              <AIAssistantSettings />
            </Section>
            <Section icon={<Brain size={15} color={colors.primaryForeground} />} title="AI 记忆">
              <MemoryManager />
            </Section>
            <Section icon={<BookOpen size={15} color={colors.primaryForeground} />} title="字典管理">
              <DictManager />
            </Section>
            <Section icon={<FolderOpen size={15} color={colors.primaryForeground} />} title="附件管理">
              <AttachmentManager />
            </Section>
            <Section icon={<Database size={15} color={colors.primaryForeground} />} title="数据迁移">
              <Text variant="muted" style={{ fontSize: 12.5 }}>
                数据导出/导入(备份恢复)涉及大文件传输,请登录网页端在「设置 → 数据迁移」中操作。
              </Text>
            </Section>
            <Section icon={<Key size={15} color={colors.primaryForeground} />} title="API Key 管理">
              <ApiKeyManager />
            </Section>
            <Section icon={<Link2 size={15} color={colors.primaryForeground} />} title="导入分类映射">
              <CategoryMappingManager dictGroups={DICT_GROUPS.map((g) => g.key)} />
            </Section>
            <Section icon={<Wallet size={15} color={colors.primaryForeground} />} title="导入账户映射">
              <AccountMappingManager />
            </Section>
          </View>
        </ScrollView>
      </ConfirmProvider>
    </View>
  );
}

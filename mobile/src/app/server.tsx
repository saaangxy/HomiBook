import { useEffect, useRef, useState } from 'react';
import { Keyboard, Modal, Platform, Pressable, TextInput, View, ScrollView, ActivityIndicator } from 'react-native';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as FileSystem from 'expo-file-system/legacy';
import { File } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { X, Plus, Check, Trash2, Pencil, Copy, Server as ServerIcon, User, LogIn, Upload, Download } from 'lucide-react-native';
import { useTheme, alpha, haptics } from '@/theme';
import { useAuth } from '@/stores/auth';
import { importServers } from '@/services/auth';
import { saveFileToSafDirectory, safDirLabel } from '@/services/http';
import { showToast } from '@/components/chrome/Toast';
import { Screen } from '@/components/Screen';
import { Text } from '@/components/ui/Text';
import { FadeInView } from '@/components/FadeInView';
import type { Server } from '@/types';

type EditState = { id: string; name: string; baseUrl: string; account: string; password: string; apiKey: string } | null;

export default function ServerScreen() {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const { servers, currentServer, addServer, updateServer, removeServer, quickLogin, refreshServers } = useAuth();
  const [name, setName] = useState('');
  const [baseUrl, setBaseUrl] = useState('');
  const [account, setAccount] = useState('');
  const [password, setPassword] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<EditState>(null);
  const [loggingIn, setLoggingIn] = useState<string | null>(null); // 正在登录的服务器ID
  const [deleting, setDeleting] = useState<Server | null>(null); // 待删除确认
  const [formError, setFormError] = useState(''); // 表单内联错误提示
  const [exportConfirming, setExportConfirming] = useState(false); // 导出敏感信息确认弹窗
  const [importing, setImporting] = useState(false); // 导入进行中

  // 键盘高度监听:动态撑高滚动区底部,保证键盘不遮挡输入框(同 profile 页 JS 方案,
  // Screen 的 KeyboardAvoidingView 在 Android 无行为,Expo Go 下窗口也不 resize)
  const [kbHeight, setKbHeight] = useState(0);
  const scrollRef = useRef<ScrollView>(null);
  useEffect(() => {
    const show = Keyboard.addListener('keyboardDidShow', (e) => setKbHeight(e.endCoordinates.height));
    const hide = Keyboard.addListener('keyboardDidHide', () => setKbHeight(0));
    return () => { show.remove(); hide.remove(); };
  }, []);

  // 聚焦输入框时把它滚动到键盘上方(留 150 作为 label/边距余量)
  const scrollInputIntoView = (e: any) => {
    const node = e.nativeEvent?.target ?? e.target;
    if (typeof node === 'number') {
      scrollRef.current?.getScrollResponder()?.scrollResponderScrollNativeHandleToKeyboard(node, 150, true);
    }
  };

  // 名称、地址必填,且(账号+密码)或 API Key 至少填一种
  const validate = (n: string, u: string, acct: string, pwd: string, key: string): string => {
    if (!n.trim() || !u.trim()) return '请填写名称与服务器地址';
    const url = u.trim();
    if (!/^https?:\/\/\S+/.test(url)) return '服务器地址需以 http:// 或 https:// 开头';
    if (!((acct.trim() && pwd) || key.trim())) return '请填写账号密码,或填写 API Key';
    return '';
  };

  const handleAdd = async () => {
    const err = validate(name, baseUrl, account, password, apiKey);
    if (err) {
      setFormError(err);
      return;
    }
    setFormError('');
    await addServer(name, baseUrl, { account: account || undefined, password: password || undefined, apiKey: apiKey || undefined });
    setName(''); setBaseUrl(''); setAccount(''); setPassword(''); setApiKey('');
    setAdding(false);
  };

  const handleEdit = async () => {
    if (!editing) return;
    const err = validate(editing.name, editing.baseUrl, editing.account, editing.password, editing.apiKey);
    if (err) {
      setFormError(err);
      return;
    }
    setFormError('');
    await updateServer(editing.id, editing.name, editing.baseUrl, {
      account: editing.account || undefined,
      password: editing.password,
      apiKey: editing.apiKey,
    });
    setEditing(null);
  };

  // 点击删除:打开确认弹窗(自建 Modal,避免 RN Web 的 Alert 确认按钮不可靠)
  const handleDelete = (s: Server) => {
    setDeleting(s);
  };

  const confirmDelete = async () => {
    if (!deleting) return;
    const id = deleting.id;
    setDeleting(null);
    try {
      await removeServer(id);
    } catch (e: any) {
      showToast(`删除失败: ${e?.message || '未知错误'}`);
    }
  };

  // 复制服务器:新增一条内容完全一致的配置
  const handleCopy = async (s: Server) => {
    await addServer(`${s.name} 副本`, s.baseUrl, {
      account: s.account || undefined,
      password: s.password,
      apiKey: s.apiKey,
    });
    haptics.success();
  };

  // 导出服务器配置为 JSON 文件(Android 走 SAF 保存,iOS 走系统分享)
  const handleExport = async () => {
    setExportConfirming(false);
    try {
      const pad = (n: number) => String(n).padStart(2, '0');
      const now = new Date();
      const fileName = `homibook-servers-${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}.json`;
      // 导出格式:kind 标识数据类型,导入时校验;list 为完整服务器配置(含凭据)
      const payload = JSON.stringify(
        { app: 'homibook', kind: 'servers', version: 1, exportedAt: now.toISOString(), list: servers },
        null,
        2,
      );
      const cacheUri = `${FileSystem.cacheDirectory}${fileName}`;
      await FileSystem.writeAsStringAsync(cacheUri, payload, { encoding: FileSystem.EncodingType.UTF8 });
      if (Platform.OS === 'android') {
        const dirUri = await saveFileToSafDirectory(cacheUri, fileName, 'application/json');
        if (dirUri) showToast(`已导出到 ${safDirLabel(dirUri)}`);
        return;
      }
      const ok = await Sharing.isAvailableAsync();
      if (!ok) throw new Error('当前环境不支持保存文件');
      await Sharing.shareAsync(cacheUri, { mimeType: 'application/json', dialogTitle: fileName });
    } catch (e: any) {
      showToast(`导出失败: ${e?.message || '未知错误'}`);
    }
  };

  // 导入服务器配置:选 JSON 文件 → 解析校验 → 去重合并
  const handleImport = async () => {
    if (importing) return;
    setImporting(true);
    try {
      // 新 API 系统文件选择器:返回的 File 实例读取走原生 SAF 通道,
      // 规避 expo-document-picker 缓存副本在 legacy/expo-go 下 "isn't readable" 的白名单限制
      let picked: File | null = null;
      try {
        const pick = await File.pickFileAsync({ multipleFiles: false, mimeTypes: ['application/json', 'text/plain'] });
        picked = pick.canceled ? null : pick.result;
      } catch {
        return; // 部分版本把用户取消以异常抛出,静默退出
      }
      if (!picked) return;
      let items: unknown;
      try {
        const content = await picked.text();
        items = JSON.parse(content)?.list;
      } catch (err: any) {
        throw new Error(`文件解析失败(${err?.message ?? '未知错误'}),请选择本 App 导出的服务器配置 JSON 文件`);
      }
      if (!Array.isArray(items)) throw new Error('文件格式不正确,缺少服务器列表');
      const { added, skipped } = await importServers(items as never[]);
      await refreshServers();
      haptics.success();
      showToast(skipped > 0 ? `导入 ${added} 个,跳过 ${skipped} 个(重复或格式无效)` : `成功导入 ${added} 个服务器配置`);
    } catch (e: any) {
      showToast(`导入失败: ${e?.message || '未知错误'}`);
    } finally {
      setImporting(false);
    }
  };

  const handleServerTap = async (s: Server) => {
    if (loggingIn) return;
    haptics.tap();
    // 有完整凭证(账号+密码 或 API Key) → 一键登录进首页
    if (s.apiKey || (s.account && s.password)) {
      setLoggingIn(s.id);
      const result = await quickLogin(s.id);
      setLoggingIn(null);
      if (result.ok) {
        router.replace('/(tabs)');
      } else {
        // 一键登录失败(密码过期/凭证错误) → 跳转登录页手动输入
        router.replace('/(auth)/login');
      }
      return;
    }
    // 无凭证或凭证不全 → 仅切换服务器,跳登录页手动输入
    await quickLogin(s.id);
    router.replace('/(auth)/login');
  };

  const inputStyle = {
    backgroundColor: colors.elevated,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 11,
    color: colors.foreground,
    fontSize: 15,
  };
  const labelStyle = { fontSize: 12, color: colors.mutedForeground, marginBottom: 5 };

  const renderForm = (isEdit: boolean) => {
    const n = isEdit ? editing!.name : name;
    const u = isEdit ? editing!.baseUrl : baseUrl;
    const a = isEdit ? editing!.account : account;
    const p = isEdit ? editing!.password : password;
    const k = isEdit ? editing!.apiKey : apiKey;
    return (
      <View style={{ gap: 12 }}>
        <View>
          <Text style={labelStyle}>名称</Text>
          <TextInput
            value={n}
            onChangeText={(v) => { setFormError(''); isEdit ? setEditing({ ...editing!, name: v }) : setName(v); }}
            onFocus={scrollInputIntoView}
            placeholder="如 演示站"
            placeholderTextColor={colors.mutedForeground}
            style={inputStyle}
          />
        </View>
        <View>
          <Text style={labelStyle}>服务器地址</Text>
          <TextInput
            value={u}
            onChangeText={(v) => { setFormError(''); isEdit ? setEditing({ ...editing!, baseUrl: v }) : setBaseUrl(v); }}
            onFocus={scrollInputIntoView}
            placeholder="https://..."
            placeholderTextColor={colors.mutedForeground}
            autoCapitalize="none"
            keyboardType="url"
            style={inputStyle}
          />
        </View>
        <View>
          <Text style={labelStyle}>账号</Text>
          <TextInput
            value={a}
            onChangeText={(v) => { setFormError(''); isEdit ? setEditing({ ...editing!, account: v }) : setAccount(v); }}
            onFocus={scrollInputIntoView}
            placeholder="登录账号或邮箱"
            placeholderTextColor={colors.mutedForeground}
            autoCapitalize="none"
            style={inputStyle}
          />
        </View>
        <View>
          <Text style={labelStyle}>密码(选填)</Text>
          <TextInput
            value={p}
            onChangeText={(v) => { setFormError(''); isEdit ? setEditing({ ...editing!, password: v }) : setPassword(v); }}
            onFocus={scrollInputIntoView}
            placeholder="登录密码,填了即可一键登录"
            placeholderTextColor={colors.mutedForeground}
            secureTextEntry
            autoCapitalize="none"
            style={inputStyle}
          />
        </View>
        <View>
          <Text style={labelStyle}>API Key(选填)</Text>
          <TextInput
            value={k}
            onChangeText={(v) => { setFormError(''); isEdit ? setEditing({ ...editing!, apiKey: v }) : setApiKey(v); }}
            onFocus={scrollInputIntoView}
            placeholder="homibook_... 优先于密码登录"
            placeholderTextColor={colors.mutedForeground}
            autoCapitalize="none"
            autoCorrect={false}
            secureTextEntry
            style={inputStyle}
          />
        </View>
        {formError ? (
          <View style={{ paddingVertical: 8, paddingHorizontal: 12, borderRadius: 8, backgroundColor: alpha(colors.destructive, 0.1) }}>
            <Text style={{ color: colors.destructive, fontSize: 12 }}>{formError}</Text>
          </View>
        ) : null}
        <View style={{ flexDirection: 'row', gap: 10, marginTop: 4 }}>
          <Pressable
            onPress={() => { isEdit ? setEditing(null) : setAdding(false); }}
            style={{ flex: 1, paddingVertical: 10, alignItems: 'center', borderRadius: 10, backgroundColor: colors.muted }}
          >
            <Text style={{ color: colors.mutedForeground, fontSize: 14 }}>取消</Text>
          </Pressable>
          <Pressable
            onPress={() => isEdit ? handleEdit() : handleAdd()}
            style={{ flex: 1, paddingVertical: 10, alignItems: 'center', borderRadius: 10, backgroundColor: colors.primary }}
          >
            <Text style={{ color: colors.primaryForeground, fontWeight: '600', fontSize: 14 }}>{isEdit ? '保存' : '添加'}</Text>
          </Pressable>
        </View>
      </View>
    );
  };

  return (
    <Screen keyboard>
      <View style={{ flex: 1 }}>
        {/* 标题栏 */}
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, paddingTop: insets.top + 12, paddingBottom: 12 }}>
          <Pressable onPress={() => router.back()} hitSlop={8}>
            <X size={22} color={colors.foreground} />
          </Pressable>
          <Text style={{ fontSize: 16, fontWeight: '600' }}>服务器管理</Text>
          <View style={{ width: 22 }} />
        </View>

        <ScrollView
          ref={scrollRef}
          contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 40 + kbHeight, gap: 12 }}
          keyboardShouldPersistTaps="handled"
        >
          {servers.length === 0 && !adding && (
            <View style={{ alignItems: 'center', paddingVertical: 40 }}>
              <ServerIcon size={40} color={colors.mutedForeground} />
              <Text variant="muted" style={{ fontSize: 14, marginTop: 8 }}>暂无服务器配置</Text>
            </View>
          )}

          {/* 服务器列表 */}
          {servers.map((s, i) => {
            const active = currentServer?.id === s.id;
            const isEditingThis = editing?.id === s.id;
            const isLoading = loggingIn === s.id;
            return (
              <FadeInView key={s.id} index={i}>
                {isEditingThis ? (
                  <View style={{ backgroundColor: colors.card, borderRadius: 14, padding: 16, borderWidth: 1, borderColor: colors.border }}>
                    {renderForm(true)}
                  </View>
                ) : (
                  <View style={{
                    backgroundColor: colors.card, borderRadius: 14, padding: 14,
                    borderWidth: 1, borderColor: active ? colors.primary : colors.border,
                  }}>
                    <Pressable onPress={() => handleServerTap(s)} disabled={isLoading} style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
                      <View style={{
                        width: 40, height: 40, borderRadius: 12, alignItems: 'center', justifyContent: 'center',
                        backgroundColor: active ? alpha(colors.primary, 0.12) : colors.muted,
                      }}>
                        {isLoading ? (
                          <ActivityIndicator size="small" color={colors.primary} />
                        ) : (
                          <ServerIcon size={18} color={active ? colors.primary : colors.mutedForeground} />
                        )}
                      </View>
                      <View style={{ flex: 1 }}>
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                          <Text style={{ fontSize: 15, fontWeight: '600', color: colors.foreground }}>{s.name}</Text>
                          {active && <Check size={14} color={colors.primary} />}
                        </View>
                        <Text variant="muted" style={{ fontSize: 12, marginTop: 2 }}>{s.baseUrl}</Text>
                        {s.account && (
                          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 4 }}>
                            <User size={11} color={colors.mutedForeground} />
                            <Text variant="muted" style={{ fontSize: 11 }}>{s.account}</Text>
                            {(s.apiKey || s.password) && (
                              <Text variant="muted" style={{ fontSize: 10, marginLeft: 2 }}>
                                {s.apiKey ? '· API Key' : '· 已存密码'}
                              </Text>
                            )}
                          </View>
                        )}
                      </View>
                      {/* 一键登录提示:服务器已配置账号密码或 API Key */}
                      {!isLoading && (s.apiKey || (s.account && s.password)) && (
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 3, paddingHorizontal: 8, paddingVertical: 4, borderRadius: 8, backgroundColor: alpha(colors.primary, 0.1) }}>
                          <LogIn size={12} color={colors.primary} />
                          <Text style={{ fontSize: 11, color: colors.primary, fontWeight: '600' }}>登录</Text>
                        </View>
                      )}
                    </Pressable>
                    {/* 操作按钮 */}
                    <View style={{ flexDirection: 'row', gap: 8, marginTop: 10 }}>
                      <Pressable
                        onPress={() => handleCopy(s)}
                        style={{ flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 10, paddingVertical: 5, borderRadius: 8, backgroundColor: colors.muted }}
                      >
                        <Copy size={13} color={colors.foreground} />
                        <Text style={{ fontSize: 12, color: colors.foreground }}>复制</Text>
                      </Pressable>
                      <Pressable
                        onPress={() => setEditing({ id: s.id, name: s.name, baseUrl: s.baseUrl, account: s.account ?? '', password: s.password ?? '', apiKey: s.apiKey ?? '' })}
                        style={{ flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 10, paddingVertical: 5, borderRadius: 8, backgroundColor: colors.muted }}
                      >
                        <Pencil size={13} color={colors.foreground} />
                        <Text style={{ fontSize: 12, color: colors.foreground }}>编辑</Text>
                      </Pressable>
                      <Pressable
                        onPress={() => handleDelete(s)}
                        style={{ flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 10, paddingVertical: 5, borderRadius: 8, backgroundColor: alpha(colors.expense, 0.1) }}
                      >
                        <Trash2 size={13} color={colors.expense} />
                        <Text style={{ fontSize: 12, color: colors.expense }}>删除</Text>
                      </Pressable>
                    </View>
                  </View>
                )}
              </FadeInView>
            );
          })}

          {/* 添加表单 */}
          {adding && (
            <View style={{ backgroundColor: colors.card, borderRadius: 14, padding: 16, borderWidth: 1, borderColor: colors.border }}>
              {renderForm(false)}
            </View>
          )}

          {/* 添加按钮 */}
          {!adding && (
            <Pressable
              onPress={() => setAdding(true)}
              style={{
                flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
                paddingVertical: 12, borderRadius: 12,
                borderWidth: 1, borderStyle: 'dashed', borderColor: colors.border,
              }}
            >
              <Plus size={16} color={colors.mutedForeground} />
              <Text variant="muted" style={{ fontSize: 14 }}>添加服务器</Text>
            </Pressable>
          )}

          {/* 配置迁移:导入/导出 */}
          <View style={{ flexDirection: 'row', gap: 10, marginTop: 4 }}>
            <Pressable
              onPress={handleImport}
              disabled={importing}
              style={{
                flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
                paddingVertical: 11, borderRadius: 12, backgroundColor: colors.muted, opacity: importing ? 0.6 : 1,
              }}
            >
              {importing ? <ActivityIndicator size="small" color={colors.foreground} /> : <Upload size={15} color={colors.foreground} />}
              <Text style={{ fontSize: 13, color: colors.foreground }}>{importing ? '导入中…' : '导入配置'}</Text>
            </Pressable>
            <Pressable
              onPress={() => setExportConfirming(true)}
              disabled={servers.length === 0}
              style={{
                flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
                paddingVertical: 11, borderRadius: 12, backgroundColor: colors.muted, opacity: servers.length === 0 ? 0.5 : 1,
              }}
            >
              <Download size={15} color={colors.foreground} />
              <Text style={{ fontSize: 13, color: colors.foreground }}>导出配置</Text>
            </Pressable>
          </View>
        </ScrollView>
      </View>

      {/* 删除确认弹窗(自建 Modal,跨平台可靠) */}
      <Modal
        visible={!!deleting}
        transparent
        animationType="fade"
        onRequestClose={() => setDeleting(null)}
      >
        <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
          <View style={{ width: '100%', backgroundColor: colors.card, borderRadius: 16, padding: 18 }}>
            <Text style={{ fontSize: 16, fontWeight: '700', marginBottom: 6 }}>删除服务器</Text>
            <Text variant="muted" style={{ fontSize: 13, marginBottom: 18 }}>
              确定删除「{deleting?.name}」吗？删除后该服务器配置将从本机移除。
            </Text>
            <View style={{ flexDirection: 'row', gap: 10 }}>
              <Pressable onPress={() => setDeleting(null)} style={{ flex: 1, borderWidth: 1, borderColor: colors.border, borderRadius: 10, paddingVertical: 10, alignItems: 'center' }}>
                <Text style={{ fontSize: 14 }}>取消</Text>
              </Pressable>
              <Pressable onPress={confirmDelete} style={{ flex: 1, backgroundColor: colors.expense, borderRadius: 10, paddingVertical: 10, alignItems: 'center' }}>
                <Text style={{ color: '#fff', fontSize: 14, fontWeight: '600' }}>删除</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>

      {/* 导出确认弹窗:提示文件包含敏感信息 */}
      <Modal
        visible={exportConfirming}
        transparent
        animationType="fade"
        onRequestClose={() => setExportConfirming(false)}
      >
        <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
          <View style={{ width: '100%', backgroundColor: colors.card, borderRadius: 16, padding: 18 }}>
            <Text style={{ fontSize: 16, fontWeight: '700', marginBottom: 6 }}>导出服务器配置</Text>
            <Text variant="muted" style={{ fontSize: 13, marginBottom: 10 }}>
              将导出 {servers.length} 个服务器配置。
            </Text>
            <View style={{ padding: 10, borderRadius: 8, backgroundColor: alpha('#f59e0b', 0.12), marginBottom: 18 }}>
              <Text style={{ fontSize: 12, color: '#f59e0b' }}>
                ⚠ 导出文件包含账号、密码与 API Key 等敏感信息,将以明文保存。请妥善保管,不要分享给不可信的人。
              </Text>
            </View>
            <View style={{ flexDirection: 'row', gap: 10 }}>
              <Pressable onPress={() => setExportConfirming(false)} style={{ flex: 1, borderWidth: 1, borderColor: colors.border, borderRadius: 10, paddingVertical: 10, alignItems: 'center' }}>
                <Text style={{ fontSize: 14 }}>取消</Text>
              </Pressable>
              <Pressable onPress={handleExport} style={{ flex: 1, backgroundColor: colors.primary, borderRadius: 10, paddingVertical: 10, alignItems: 'center' }}>
                <Text style={{ color: colors.primaryForeground, fontSize: 14, fontWeight: '600' }}>导出</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </Screen>
  );
}

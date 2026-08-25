import { useState } from 'react';
import { Pressable, TextInput, View, Alert, ScrollView, ActivityIndicator } from 'react-native';
import { router } from 'expo-router';
import { X, Plus, Check, Trash2, Pencil, Server as ServerIcon, User, LogIn } from 'lucide-react-native';
import { useTheme, alpha, haptics } from '@/theme';
import { useAuth } from '@/stores/auth';
import { Screen } from '@/components/Screen';
import { Text } from '@/components/ui/Text';
import { FadeInView } from '@/components/FadeInView';
import type { Server } from '@/types';

type EditState = { id: string; name: string; baseUrl: string; account: string } | null;

export default function ServerScreen() {
  const { colors } = useTheme();
  const { servers, currentServer, addServer, updateServer, removeServer, quickLogin } = useAuth();
  const [name, setName] = useState('');
  const [baseUrl, setBaseUrl] = useState('');
  const [account, setAccount] = useState('');
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<EditState>(null);
  const [loggingIn, setLoggingIn] = useState<string | null>(null); // 正在登录的服务器ID

  const handleAdd = async () => {
    if (!name || !baseUrl) return;
    await addServer(name, baseUrl, account || undefined);
    setName(''); setBaseUrl(''); setAccount('');
    setAdding(false);
  };

  const handleEdit = async () => {
    if (!editing || !editing.name || !editing.baseUrl) return;
    await updateServer(editing.id, editing.name, editing.baseUrl, editing.account || undefined);
    setEditing(null);
  };

  const handleDelete = (s: Server) => {
    Alert.alert('删除服务器', `确定删除「${s.name}」吗？`, [
      { text: '取消', style: 'cancel' },
      { text: '删除', style: 'destructive', onPress: () => removeServer(s.id) },
    ]);
  };

  const handleServerTap = async (s: Server) => {
    if (loggingIn) return;
    haptics.tap();
    // 无绑定账号 → 仅切换服务器,返回登录页
    if (!s.account) {
      await quickLogin(s.id); // 切换服务器
      router.replace('/(auth)/login');
      return;
    }
    // 有绑定账号 → 尝试快速登录
    setLoggingIn(s.id);
    const result = await quickLogin(s.id);
    setLoggingIn(null);
    if (result.ok) {
      router.replace('/(tabs)');
    } else {
      // 快速登录失败 → 跳转登录页,让用户手动输入密码
      router.replace('/(auth)/login');
    }
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
    return (
      <View style={{ gap: 12 }}>
        <View>
          <Text style={labelStyle}>名称</Text>
          <TextInput
            value={n}
            onChangeText={(v) => isEdit ? setEditing({ ...editing!, name: v }) : setName(v)}
            placeholder="如 演示站"
            placeholderTextColor={colors.mutedForeground}
            style={inputStyle}
          />
        </View>
        <View>
          <Text style={labelStyle}>服务器地址</Text>
          <TextInput
            value={u}
            onChangeText={(v) => isEdit ? setEditing({ ...editing!, baseUrl: v }) : setBaseUrl(v)}
            placeholder="https://..."
            placeholderTextColor={colors.mutedForeground}
            autoCapitalize="none"
            style={inputStyle}
          />
        </View>
        <View>
          <Text style={labelStyle}>绑定账号(选填)</Text>
          <TextInput
            value={a}
            onChangeText={(v) => isEdit ? setEditing({ ...editing!, account: v }) : setAccount(v)}
            placeholder="登录后自动绑定"
            placeholderTextColor={colors.mutedForeground}
            autoCapitalize="none"
            style={inputStyle}
          />
        </View>
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
    <Screen>
      <View style={{ flex: 1 }}>
        {/* 标题栏 */}
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, paddingTop: 48, paddingBottom: 12 }}>
          <Pressable onPress={() => router.back()} hitSlop={8}>
            <X size={22} color={colors.foreground} />
          </Pressable>
          <Text style={{ fontSize: 16, fontWeight: '600' }}>服务器管理</Text>
          <View style={{ width: 22 }} />
        </View>

        <ScrollView contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 40, gap: 12 }} keyboardShouldPersistTaps="handled">
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
                          </View>
                        )}
                      </View>
                      {/* 登录提示图标 */}
                      {!isLoading && s.account && (
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 3, paddingHorizontal: 8, paddingVertical: 4, borderRadius: 8, backgroundColor: alpha(colors.primary, 0.1) }}>
                          <LogIn size={12} color={colors.primary} />
                          <Text style={{ fontSize: 11, color: colors.primary, fontWeight: '600' }}>登录</Text>
                        </View>
                      )}
                    </Pressable>
                    {/* 操作按钮 */}
                    <View style={{ flexDirection: 'row', gap: 8, marginTop: 10 }}>
                      <Pressable
                        onPress={() => setEditing({ id: s.id, name: s.name, baseUrl: s.baseUrl, account: s.account ?? '' })}
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
        </ScrollView>
      </View>
    </Screen>
  );
}

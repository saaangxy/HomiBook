import { useCallback, useEffect, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, TextInput, View } from 'react-native';
import { Plus, Trash2 } from 'lucide-react-native';
import { useTheme, alpha } from '@/theme';
import { useAuth } from '@/stores/auth';
import { Screen } from '@/components/Screen';
import { Card } from '@/components/ui/Card';
import { Text } from '@/components/ui/Text';
import { Button } from '@/components/ui/Button';
import { FadeInView } from '@/components/FadeInView';
import { FormSheet } from '@/components/chrome/FormSheet';
import { fetchUsers } from '@/services/admin';
import type { AdminUser, UserRole } from '@/types';

const ROLE_LABEL: Record<UserRole, string> = { ADMIN: '管理员', USER: '成员' };

// 用户管理:用户卡片(操作列表) + 创建 + 角色/启停/改密/删除(设计优先 mock)
export default function UsersScreen() {
  const { colors } = useTheme();
  const { username } = useAuth();
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [createOpen, setCreateOpen] = useState(false);
  const [manage, setManage] = useState<AdminUser | null>(null); // 编辑管理弹窗

  // 创建字段
  const [nUsername, setNUsername] = useState('');
  const [nEmail, setNEmail] = useState('');
  const [nPassword, setNPassword] = useState('');
  const [nNickname, setNNickname] = useState('');
  const [nRole, setNRole] = useState<UserRole>('USER');

  // 改密字段
  const [newPwd, setNewPwd] = useState('');

  useEffect(() => {
    fetchUsers().then(setUsers);
  }, []);

  const [refreshing, setRefreshing] = useState(false);
  // 下拉刷新:重拉用户列表
  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await fetchUsers().then(setUsers);
    } finally {
      setRefreshing(false);
    }
  }, []);

  const resetCreate = () => {
    setNUsername('');
    setNEmail('');
    setNPassword('');
    setNNickname('');
    setNRole('USER');
  };

  const create = () => {
    if (!nUsername || !nPassword) return;
    const u: AdminUser = {
      id: `u${Date.now()}`,
      email: nEmail || `${nUsername}@homibook.com`,
      username: nUsername,
      nickname: nNickname || nUsername,
      role: nRole,
      status: 'ACTIVE',
      createdAt: '2026-08-19',
    };
    setUsers((prev) => [u, ...prev]);
    setCreateOpen(false);
    resetCreate();
  };

  const toggleRole = (u: AdminUser) => {
    setUsers((prev) => prev.map((x) => (x.id === u.id ? { ...x, role: x.role === 'ADMIN' ? 'USER' : 'ADMIN' } : x)));
  };

  const toggleStatus = (u: AdminUser) => {
    setUsers((prev) => prev.map((x) => (x.id === u.id ? { ...x, status: x.status === 'ACTIVE' ? 'DISABLED' : 'ACTIVE' } : x)));
  };

  const changePwd = (u: AdminUser) => {
    if (!newPwd) return;
    setNewPwd('');
    setManage(null);
  };

  const remove = (u: AdminUser) => {
    setUsers((prev) => prev.filter((x) => x.id !== u.id));
    setManage(null);
  };

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
  const labelStyle = { fontSize: 12, color: colors.mutedForeground, marginBottom: 6, marginTop: 12 };

  return (
    <Screen>
      <View style={{ flex: 1, paddingHorizontal: 20, paddingTop: 8 }}>
        {/* 标题栏 */}
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
          <Text style={{ fontSize: 20, fontWeight: '700' }}>用户管理</Text>
          <Pressable
            onPress={() => {
              resetCreate();
              setCreateOpen(true);
            }}
            style={{ width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center', backgroundColor: alpha(colors.primary, 0.12) }}
          >
            <Plus size={18} color={colors.primary} />
          </Pressable>
        </View>

        <ScrollView contentContainerStyle={{ paddingBottom: 40 }} showsVerticalScrollIndicator={false} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} colors={[colors.primary]} />}>
          {users.map((u, i) => {
            const isMe = u.username === username;
            const active = u.status === 'ACTIVE';
            return (
              <FadeInView key={u.id} index={i}>
                <Card className="px-5 py-4 mb-3" onPress={() => setManage(u)}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
                    <View style={{ width: 44, height: 44, borderRadius: 14, alignItems: 'center', justifyContent: 'center', backgroundColor: u.role === 'ADMIN' ? alpha(colors.primary, 0.12) : colors.muted }}>
                      <Text style={{ fontSize: 18, fontWeight: '700', color: u.role === 'ADMIN' ? colors.primary : colors.mutedForeground }}>{u.nickname.slice(0, 1)}</Text>
                    </View>
                    <View style={{ flex: 1 }}>
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                        <Text style={{ fontSize: 15, fontWeight: '600' }}>{u.nickname}</Text>
                        {isMe && <Text style={{ fontSize: 10, color: colors.mutedForeground }}>(我)</Text>}
                      </View>
                      <Text variant="muted" style={{ fontSize: 12, marginTop: 2 }} numberOfLines={1}>{u.email}</Text>
                    </View>
                    <View style={{ alignItems: 'flex-end', gap: 4 }}>
                      <View style={{ paddingHorizontal: 7, paddingVertical: 2, borderRadius: 6, backgroundColor: u.role === 'ADMIN' ? alpha(colors.primary, 0.12) : colors.muted }}>
                        <Text style={{ fontSize: 10, color: u.role === 'ADMIN' ? colors.primary : colors.mutedForeground, fontWeight: '600' }}>{ROLE_LABEL[u.role]}</Text>
                      </View>
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                        <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: active ? colors.income : colors.mutedForeground }} />
                        <Text style={{ fontSize: 10, color: active ? colors.income : colors.mutedForeground }}>{active ? '正常' : '已停用'}</Text>
                      </View>
                    </View>
                  </View>
                </Card>
              </FadeInView>
            );
          })}
        </ScrollView>
      </View>

      {/* 创建用户 */}
      <FormSheet visible={createOpen} title="创建用户" onClose={() => setCreateOpen(false)} onSave={create} saveLabel="创建">
        <ScrollView keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false} style={{ maxHeight: 420 }}>
          <Text style={labelStyle}>账号</Text>
          <TextInput value={nUsername} onChangeText={setNUsername} placeholder="username" placeholderTextColor={colors.mutedForeground} autoCapitalize="none" style={inputStyle} />
          <Text style={labelStyle}>邮箱</Text>
          <TextInput value={nEmail} onChangeText={setNEmail} placeholder="user@example.com" placeholderTextColor={colors.mutedForeground} autoCapitalize="none" style={inputStyle} />
          <Text style={labelStyle}>密码</Text>
          <TextInput value={nPassword} onChangeText={setNPassword} placeholder="至少 6 位" placeholderTextColor={colors.mutedForeground} secureTextEntry style={inputStyle} />
          <Text style={labelStyle}>昵称</Text>
          <TextInput value={nNickname} onChangeText={setNNickname} placeholder="选填" placeholderTextColor={colors.mutedForeground} style={inputStyle} />
          <Text style={labelStyle}>角色</Text>
          <View style={{ flexDirection: 'row', gap: 8 }}>
            {(['USER', 'ADMIN'] as UserRole[]).map((r) => {
              const selected = nRole === r;
              const c = r === 'ADMIN' ? colors.primary : colors.foreground;
              return (
                <Pressable key={r} onPress={() => setNRole(r)} style={{ flex: 1, alignItems: 'center', paddingVertical: 9, borderRadius: 999, borderWidth: 1, borderColor: selected ? c : colors.border, backgroundColor: selected ? alpha(c, 0.12) : colors.muted }}>
                  <Text style={{ fontSize: 13, color: selected ? c : colors.mutedForeground, fontWeight: '600' }}>{ROLE_LABEL[r]}</Text>
                </Pressable>
              );
            })}
          </View>
        </ScrollView>
      </FormSheet>

      {/* 编辑管理 */}
      <FormSheet visible={!!manage} title={manage ? `管理 · ${manage.nickname}` : ''} onClose={() => setManage(null)}>
        {manage && (
          <View>
            <Text style={{ fontSize: 12, color: colors.mutedForeground, marginBottom: 8 }}>权限</Text>
            <View style={{ flexDirection: 'row', gap: 8, marginBottom: 16 }}>
              <Button title={manage.role === 'ADMIN' ? '设为成员' : '设为管理员'} variant="secondary" style={{ flex: 1 }} onPress={() => toggleRole(manage)} />
              <Button title={manage.status === 'ACTIVE' ? '停用账号' : '启用账号'} variant="outline" style={{ flex: 1 }} onPress={() => toggleStatus(manage)} />
            </View>

            <Text style={{ fontSize: 12, color: colors.mutedForeground, marginBottom: 6 }}>重置密码</Text>
            <TextInput value={newPwd} onChangeText={setNewPwd} placeholder="输入新密码(≥6位)" placeholderTextColor={colors.mutedForeground} secureTextEntry style={inputStyle} />
            <Button title="保存新密码" variant="secondary" style={{ marginTop: 10 }} onPress={() => changePwd(manage)} />

            {manage.username !== username && (
              <Button title="删除该用户" variant="outline" icon={<Trash2 size={16} color={colors.expense} />} style={{ marginTop: 16, borderColor: colors.expense }} onPress={() => remove(manage)} />
            )}
          </View>
        )}
      </FormSheet>
    </Screen>
  );
}
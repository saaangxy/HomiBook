import { useCallback, useEffect, useRef, useState } from 'react';
import { Dimensions, Keyboard, Pressable, RefreshControl, ScrollView, TextInput, View } from 'react-native';
import { useRouter } from 'expo-router';
import { Plus, Trash2, KeyRound, UserCheck, Power, PowerOff } from 'lucide-react-native';
import { useTheme, alpha } from '@/theme';
import { useAuth } from '@/stores/auth';
import { Screen } from '@/components/Screen';
import { Card } from '@/components/ui/Card';
import { Text } from '@/components/ui/Text';
import { FadeInView } from '@/components/FadeInView';
import { FormSheet } from '@/components/chrome/FormSheet';
import { ConfirmSheet } from '@/components/chrome/ConfirmSheet';
import { fetchUsers } from '@/services/admin';
import type { AdminUser, UserRole } from '@/types';

const ROLE_LABEL: Record<UserRole, string> = { ADMIN: '管理员', USER: '成员' };

// 用户管理:用户卡片(操作按钮直接置于列表卡,对齐账本管理) + 创建 + 改密弹层
// 权限对齐 web:菜单入口仅 admin 可见,页面级亦有守卫(非 admin 深链进入显示无权访问)
export default function UsersScreen() {
  const { colors } = useTheme();
  const { username, user } = useAuth();
  const router = useRouter();
  const isAdmin = user?.role === 'ADMIN';
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [createOpen, setCreateOpen] = useState(false);
  const [pwdTarget, setPwdTarget] = useState<AdminUser | null>(null); // 改密弹层

  // 创建字段
  const [nUsername, setNUsername] = useState('');
  const [nEmail, setNEmail] = useState('');
  const [nPassword, setNPassword] = useState('');
  const [nNickname, setNNickname] = useState('');
  const [nRole, setNRole] = useState<UserRole>('USER');

  // 改密字段
  const [newPwd, setNewPwd] = useState('');

  // 键盘高度:e2e 下 adjustResize 不生效,底部弹层需自行避让(同账本管理页方案)
  const winH = useRef(Dimensions.get('window').height).current;
  const [kbH, setKbH] = useState(0);
  useEffect(() => {
    const show = Keyboard.addListener('keyboardDidShow', (e) => setKbH(e.endCoordinates.height));
    const hide = Keyboard.addListener('keyboardDidHide', () => setKbH(0));
    return () => {
      show.remove();
      hide.remove();
    };
  }, []);

  useEffect(() => {
    if (!isAdmin) return;
    fetchUsers().then(setUsers);
  }, [isAdmin]);

  const [refreshing, setRefreshing] = useState(false);
  // 下拉刷新:重拉用户列表
  const onRefresh = useCallback(async () => {
    if (!isAdmin) return;
    setRefreshing(true);
    try {
      await fetchUsers().then(setUsers);
    } finally {
      setRefreshing(false);
    }
  }, [isAdmin]);

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

  const confirmPwd = () => {
    if (!newPwd || newPwd.length < 6) return;
    setNewPwd('');
    setPwdTarget(null);
  };

  // 删除二次确认(ConfirmSheet 统一替代系统 Alert)
  const [removing, setRemoving] = useState<AdminUser | null>(null);
  const remove = (u: AdminUser) => setRemoving(u);
  const confirmRemove = () => {
    const u = removing;
    if (!u) return;
    setRemoving(null);
    setUsers((prev) => prev.filter((x) => x.id !== u.id));
    setPwdTarget(null);
  };

  // 卡片操作按钮统一样式(对齐账户管理页 opBtn)
  const opBtn = {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 8,
    backgroundColor: colors.muted,
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

  // 页面级权限守卫(所有 hooks 之后,对齐 server-settings 页的兜底):非管理员深链进入显示无权访问
  if (!isAdmin) {
    return (
      <Screen>
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: 8 }}>
          <Text style={{ fontSize: 15, fontWeight: '600' }}>无权访问</Text>
          <Text variant="muted" style={{ fontSize: 12.5 }}>该页面仅管理员可见</Text>
          <Pressable onPress={() => router.back()} style={{ marginTop: 12, paddingHorizontal: 16, paddingVertical: 8, borderRadius: 999, backgroundColor: colors.muted }}>
            <Text style={{ fontSize: 13 }}>返回</Text>
          </Pressable>
        </View>
      </Screen>
    );
  }

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
                <Card className="px-5 py-4 mb-3">
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
                  {/* 操作按钮(直接置于列表卡片,对齐账本/账户管理页) */}
                  <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap', marginTop: 12, borderTopWidth: 1, borderTopColor: colors.hairline, paddingTop: 10 }}>
                    <Pressable onPress={() => toggleRole(u)} style={opBtn}>
                      <UserCheck size={13} color={colors.foreground} />
                      <Text style={{ fontSize: 12, color: colors.foreground }}>{u.role === 'ADMIN' ? '设为成员' : '设为管理员'}</Text>
                    </Pressable>
                    <Pressable onPress={() => toggleStatus(u)} style={opBtn}>
                      {active ? <Power size={13} color={colors.foreground} /> : <PowerOff size={13} color={colors.foreground} />}
                      <Text style={{ fontSize: 12, color: colors.foreground }}>{active ? '停用' : '启用'}</Text>
                    </Pressable>
                    <Pressable onPress={() => { setNewPwd(''); setPwdTarget(u); }} style={opBtn}>
                      <KeyRound size={13} color={colors.foreground} />
                      <Text style={{ fontSize: 12, color: colors.foreground }}>改密</Text>
                    </Pressable>
                    {!isMe && (
                      <Pressable onPress={() => remove(u)} style={[opBtn, { backgroundColor: alpha(colors.expense, 0.1) }]}>
                        <Trash2 size={13} color={colors.expense} />
                        <Text style={{ fontSize: 12, color: colors.expense }}>删除</Text>
                      </Pressable>
                    )}
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

      {/* 重置密码 */}
      <FormSheet visible={!!pwdTarget} title={`重置密码 · ${pwdTarget?.nickname ?? ''}`} onClose={() => { setPwdTarget(null); setNewPwd(''); }} onSave={confirmPwd} saveLabel="保存新密码">
        <ScrollView keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false} style={{ maxHeight: Math.min(420, winH - 180 - kbH) }}>
          <Text style={labelStyle}>新密码</Text>
          <TextInput value={newPwd} onChangeText={setNewPwd} placeholder="输入新密码(≥6位)" placeholderTextColor={colors.mutedForeground} secureTextEntry autoCapitalize="none" style={inputStyle} />
        </ScrollView>
      </FormSheet>

      {/* 删除二次确认 */}
      <ConfirmSheet
        visible={!!removing}
        title="删除用户"
        message={`确定要删除「${removing?.nickname ?? ''}」吗？此操作不可恢复。`}
        onConfirm={confirmRemove}
        onClose={() => setRemoving(null)}
      />
    </Screen>
  );
}

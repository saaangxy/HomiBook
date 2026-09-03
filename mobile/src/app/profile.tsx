import { useEffect, useState } from 'react';
import { Keyboard, Pressable, ScrollView, TextInput, View } from 'react-native';
import { useRouter } from 'expo-router';
import { ChevronLeft } from 'lucide-react-native';
import { useTheme, alpha, haptics } from '@/theme';
import { useAuth } from '@/stores/auth';
import { apiChangePassword } from '@/services/auth';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Screen } from '@/components/Screen';
import { Card } from '@/components/ui/Card';
import { Text } from '@/components/ui/Text';
import { FadeInView } from '@/components/FadeInView';
import { PasswordStrength } from '@/components/PasswordStrength';
import { showToast } from '@/components/chrome/Toast';

const ROLE_LABEL: Record<string, string> = { ADMIN: '管理员', USER: '成员' };

const inputStyle = (colors: ReturnType<typeof useTheme>['colors']) => ({
  backgroundColor: colors.elevated,
  borderWidth: 1,
  borderColor: colors.border,
  borderRadius: 14,
  paddingHorizontal: 14,
  paddingVertical: 11,
  color: colors.foreground,
  fontSize: 15,
});

// 个人信息:昵称修改 + 密码修改(接口与网页端一致:PATCH /api/auth/me[・/password])
export default function ProfileScreen() {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { user, updateNickname } = useAuth();

  // 昵称
  const [nickname, setNickname] = useState(user?.nickname ?? '');
  const [nickSaving, setNickSaving] = useState(false);
  const [nickError, setNickError] = useState('');

  // 改密
  const [curPwd, setCurPwd] = useState('');
  const [newPwd, setNewPwd] = useState('');
  const [confirmPwd, setConfirmPwd] = useState('');
  const [pwdSaving, setPwdSaving] = useState(false);
  const [pwdError, setPwdError] = useState('');

  // 键盘高度监听:动态撑高滚动区底部,保证键盘不遮挡输入框与按钮
  // (采用 Keyboard 监听 + JS 计算方案,与项目内 Modal 键盘处理先例一致)
  const [kbHeight, setKbHeight] = useState(0);
  useEffect(() => {
    const show = Keyboard.addListener('keyboardDidShow', (e) => setKbHeight(e.endCoordinates.height));
    const hide = Keyboard.addListener('keyboardDidHide', () => setKbHeight(0));
    return () => { show.remove(); hide.remove(); };
  }, []);

  const avatarChar = (user?.nickname || user?.username || 'U')[0].toUpperCase();

  const saveNickname = async () => {
    const nick = nickname.trim();
    if (!nick) { setNickError('昵称不能为空'); return; }
    if (nick === user?.nickname) { setNickError(''); showToast('昵称未变化'); return; }
    setNickSaving(true);
    setNickError('');
    try {
      await updateNickname(nick);
      haptics.success();
      showToast('昵称已更新');
    } catch (e: any) {
      setNickError(e?.message ?? '保存失败,请重试');
    } finally {
      setNickSaving(false);
    }
  };

  // 密码强度校验:与 web 端注册/后端 schema 一致(≥8 位,含大小写字母和数字)
  const pwdStrengthError = (pwd: string): string => {
    if (pwd.length < 8) return '密码至少 8 位';
    if (!/[a-z]/.test(pwd)) return '密码需包含小写字母';
    if (!/[A-Z]/.test(pwd)) return '密码需包含大写字母';
    if (!/[0-9]/.test(pwd)) return '密码需包含数字';
    return '';
  };

  const savePassword = async () => {
    if (!curPwd) { setPwdError('请输入当前密码'); return; }
    const strengthErr = pwdStrengthError(newPwd);
    if (strengthErr) { setPwdError(strengthErr); return; }
    if (newPwd !== confirmPwd) { setPwdError('两次输入的新密码不一致'); return; }
    setPwdSaving(true);
    setPwdError('');
    try {
      await apiChangePassword(curPwd, newPwd);
      haptics.success();
      showToast('密码已修改');
      setCurPwd(''); setNewPwd(''); setConfirmPwd('');
    } catch (e: any) {
      setPwdError(e?.message ?? '修改失败,请确认当前密码是否正确');
    } finally {
      setPwdSaving(false);
    }
  };

  const labelStyle = { fontSize: 12, color: colors.mutedForeground, marginBottom: 6, marginTop: 12 };

  return (
    // Screen 提供 主题背景+纹理;安全域顶部与键盘避让由本页自行处理(独立 Stack 页无 GlobalBar)
    <Screen>
      <ScrollView
        contentContainerStyle={{
          paddingHorizontal: 20,
          paddingTop: insets.top + 8,
          // 键盘弹出时以键盘高度撑底,任何输入项/按钮都不被遮挡
          paddingBottom: kbHeight > 0 ? kbHeight + 24 : Math.max(insets.bottom, 40),
        }}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
          {/* 返回 + 标题 */}
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 16 }}>
            <Pressable
              onPress={() => router.back()}
              style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: colors.muted, alignItems: 'center', justifyContent: 'center' }}
            >
              <ChevronLeft size={18} color={colors.foreground} />
            </Pressable>
            <Text style={{ fontSize: 20, fontWeight: '700' }}>个人信息</Text>
          </View>

          {/* 基本信息(只读) */}
          <FadeInView>
            <Card className="px-5 py-4 mb-4" style={{ flexDirection: 'row', alignItems: 'center', gap: 14 }}>
              <View style={{ width: 52, height: 52, borderRadius: 26, alignItems: 'center', justifyContent: 'center', backgroundColor: alpha(colors.primary, 0.12) }}>
                <Text style={{ fontSize: 20, fontWeight: '700', color: colors.primary }}>{avatarChar}</Text>
              </View>
              <View style={{ flex: 1 }}>
                <Text style={{ fontSize: 16, fontWeight: '600' }}>{user?.nickname || user?.username}</Text>
                <Text variant="muted" style={{ fontSize: 12, marginTop: 2 }}>
                  @{user?.username}{user?.email ? ` · ${user.email}` : ''}
                  {user?.role === 'ADMIN' ? ' · 管理员' : ''}
                </Text>
              </View>
            </Card>
          </FadeInView>

          {/* 昵称修改 */}
          <FadeInView index={1}>
            <Card className="px-5 py-4 mb-4">
              <Text style={{ fontSize: 15, fontWeight: '600' }}>昵称</Text>
              <Text style={labelStyle}>昵称</Text>
              <TextInput
                value={nickname}
                onChangeText={setNickname}
                style={inputStyle(colors)}
                placeholder="输入新昵称"
                placeholderTextColor={colors.mutedForeground}
                maxLength={20}
              />
              {!!nickError && <Text style={{ fontSize: 12, color: colors.expense, marginTop: 8 }}>{nickError}</Text>}
              <Pressable
                onPress={saveNickname}
                disabled={nickSaving}
                style={{ marginTop: 14, alignItems: 'center', paddingVertical: 12, borderRadius: 14, backgroundColor: colors.primary, opacity: nickSaving ? 0.5 : 1 }}
              >
                <Text style={{ fontSize: 14, fontWeight: '600', color: colors.primaryForeground }}>{nickSaving ? '保存中...' : '保存昵称'}</Text>
              </Pressable>
            </Card>
          </FadeInView>

          {/* 修改密码 */}
          <FadeInView index={2}>
            <Card className="px-5 py-4">
              <Text style={{ fontSize: 15, fontWeight: '600' }}>修改密码</Text>
              <Text style={labelStyle}>当前密码</Text>
              <TextInput value={curPwd} onChangeText={setCurPwd} secureTextEntry style={inputStyle(colors)} placeholder="输入当前密码" placeholderTextColor={colors.mutedForeground} />
              <Text style={labelStyle}>新密码(至少 8 位,需含大小写字母和数字)</Text>
              <TextInput value={newPwd} onChangeText={setNewPwd} secureTextEntry style={inputStyle(colors)} placeholder="输入新密码" placeholderTextColor={colors.mutedForeground} />
              {/* 实时强度提示(对齐 web 端注册) */}
              <PasswordStrength password={newPwd} />
              <Text style={labelStyle}>确认新密码</Text>
              <TextInput value={confirmPwd} onChangeText={setConfirmPwd} secureTextEntry style={inputStyle(colors)} placeholder="再次输入新密码" placeholderTextColor={colors.mutedForeground} />
              {!!pwdError && <Text style={{ fontSize: 12, color: colors.expense, marginTop: 8 }}>{pwdError}</Text>}
              <Pressable
                onPress={savePassword}
                disabled={pwdSaving}
                style={{ marginTop: 14, alignItems: 'center', paddingVertical: 12, borderRadius: 14, backgroundColor: colors.primary, opacity: pwdSaving ? 0.5 : 1 }}
              >
                <Text style={{ fontSize: 14, fontWeight: '600', color: colors.primaryForeground }}>{pwdSaving ? '提交中...' : '修改密码'}</Text>
              </Pressable>
            </Card>
          </FadeInView>
      </ScrollView>
    </Screen>
  );
}

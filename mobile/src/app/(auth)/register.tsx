import { useState } from 'react';
import { Link, router } from 'expo-router';
import { Pressable, StyleSheet, TextInput, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { ArrowLeft, Eye, EyeOff } from 'lucide-react-native';
import { useTheme } from '@/theme';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Button } from '@/components/ui/Button';
import { Text } from '@/components/ui/Text';

export default function RegisterScreen() {
  const { colors, isDark } = useTheme();
  const insets = useSafeAreaInsets();
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [nickname, setNickname] = useState('');
  const [password, setPassword] = useState('');
  const [showPwd, setShowPwd] = useState(false);

  const inputStyle = {
    backgroundColor: colors.elevated,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 14,
    paddingHorizontal: 16,
    paddingVertical: 13,
    color: colors.foreground,
    fontSize: 15,
  };

  return (
    <View style={{ flex: 1 }}>
      <LinearGradient
        colors={isDark ? ['#1e293b', '#0f172a'] : ['#fff7ed', '#ffedd5']}
        style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, paddingTop: insets.top }}
      >
        <View style={{ flex: 1, padding: 20 }}>
          <Pressable onPress={() => router.back()} style={{ width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(0,0,0,0.06)' }}>
            <ArrowLeft size={20} color={colors.foreground} />
          </Pressable>

          <View style={{ justifyContent: 'center', flex: 1 }}>
            <Text style={{ color: colors.foreground, fontSize: 30, fontWeight: '800', letterSpacing: -1, marginBottom: 6 }}>
              创建账号
            </Text>
            <Text variant="muted" style={{ fontSize: 13, marginBottom: 24 }}>注册一个家庭共用的账本</Text>

            <View style={{ backgroundColor: colors.card, borderRadius: 24, padding: 24, borderWidth: 1, borderColor: colors.border, shadowColor: '#0f172a', shadowOpacity: 0.08, shadowRadius: 20, shadowOffset: { width: 0, height: 10 }, elevation: 4, gap: 14 }}>
              <Text variant="label">账号</Text>
              <TextInput value={username} onChangeText={setUsername} placeholder="账号" placeholderTextColor={colors.mutedForeground} autoCapitalize="none" style={inputStyle} />
              <Text variant="label">邮箱地址</Text>
              <TextInput value={email} onChangeText={setEmail} placeholder="邮箱地址" placeholderTextColor={colors.mutedForeground} autoCapitalize="none" keyboardType="email-address" style={inputStyle} />
              <Text variant="label">昵称（可选）</Text>
              <TextInput value={nickname} onChangeText={setNickname} placeholder="昵称（可选）" placeholderTextColor={colors.mutedForeground} style={inputStyle} />
              <Text variant="label">密码（至少6位）</Text>
              <View style={[inputStyle, { flexDirection: 'row', alignItems: 'center' }]}>
                <TextInput value={password} onChangeText={setPassword} placeholder="密码（至少6位）" placeholderTextColor={colors.mutedForeground} secureTextEntry={!showPwd} style={{ flex: 1, color: colors.foreground, fontSize: 15, padding: 0 }} />
                <Pressable onPress={() => setShowPwd((v) => !v)}>
                  {showPwd ? <EyeOff size={18} color={colors.mutedForeground} /> : <Eye size={18} color={colors.mutedForeground} />}
                </Pressable>
              </View>

              <Button title="注册" size="lg" onPress={() => router.replace('/(tabs)')} />
              <View style={{ flexDirection: 'row', justifyContent: 'center', gap: 4 }}>
                <Text variant="muted" style={{ fontSize: 13 }}>已有账号?</Text>
                <Link href="/login" style={{ color: colors.foreground, fontSize: 13, fontWeight: '500' }}>去登录</Link>
              </View>
            </View>
          </View>
        </View>
      </LinearGradient>
    </View>
  );
}
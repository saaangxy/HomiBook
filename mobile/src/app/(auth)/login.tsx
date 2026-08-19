import { useState } from 'react';
import { router } from 'expo-router';
import { Pressable, Switch, TextInput, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Eye, EyeOff } from 'lucide-react-native';
import { useTheme } from '@/theme';
import { useAuth } from '@/stores/auth';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Button } from '@/components/ui/Button';
import { Text } from '@/components/ui/Text';
import { FadeInView } from '@/components/FadeInView';

export default function LoginScreen() {
  const { colors, isDark } = useTheme();
  const { servers, currentServer, login } = useAuth();
  const insets = useSafeAreaInsets();

  const [baseUrl, setBaseUrl] = useState(currentServer?.baseUrl ?? '');
  const [username, setUsername] = useState('demo');
  const [password, setPassword] = useState('demo123');
  const [showPwd, setShowPwd] = useState(false);
  const [remember, setRemember] = useState(true);
  const [loading, setLoading] = useState(false);

  const handleLogin = async () => {
    if (!username || !password) return;
    setLoading(true);
    try {
      const serverId = currentServer?.id ?? servers[0]?.id;
      if (!serverId) return;
      await login(username, password, serverId, remember);
      router.replace('/(tabs)');
    } finally {
      setLoading(false);
    }
  };

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
        <View style={{ flex: 1, justifyContent: 'center', padding: 20 }}>
          <FadeInView>
            {/* 品牌 */}
            <Text style={{ color: colors.foreground, fontSize: 42, fontWeight: '800', letterSpacing: -2, textAlign: 'center', marginBottom: 32 }}>
              homi<Text style={{ color: colors.primary }}>book</Text>
            </Text>

            {/* 登录卡片 */}
            <View style={{ backgroundColor: colors.card, borderRadius: 24, padding: 24, borderWidth: 1, borderColor: colors.border, shadowColor: '#0f172a', shadowOpacity: 0.08, shadowRadius: 20, shadowOffset: { width: 0, height: 10 }, elevation: 4 }}>
              <Text variant="label">服务器 Base URL</Text>
              <TextInput value={baseUrl} onChangeText={setBaseUrl} placeholder="https://..." placeholderTextColor={colors.mutedForeground} autoCapitalize="none" autoCorrect={false} style={[inputStyle, { marginBottom: 16 }]} />

              <Text variant="label">账号</Text>
              <TextInput value={username} onChangeText={setUsername} placeholder="账号" placeholderTextColor={colors.mutedForeground} autoCapitalize="none" style={[inputStyle, { marginBottom: 16 }]} />

              <Text variant="label">密码</Text>
              <View style={[inputStyle, { flexDirection: 'row', alignItems: 'center', marginBottom: 16 }]}>
                <TextInput value={password} onChangeText={setPassword} placeholder="密码" placeholderTextColor={colors.mutedForeground} secureTextEntry={!showPwd} style={{ flex: 1, color: colors.foreground, fontSize: 15, padding: 0 }} />
                <Pressable onPress={() => setShowPwd((v) => !v)}>
                  {showPwd ? <EyeOff size={18} color={colors.mutedForeground} /> : <Eye size={18} color={colors.mutedForeground} />}
                </Pressable>
              </View>

              <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 16 }}>
                <Switch value={remember} onValueChange={setRemember} trackColor={{ true: colors.primary }} thumbColor="#fff" />
                <Text variant="muted" style={{ fontSize: 12, marginLeft: 8 }}>记住登录</Text>
              </View>

              <Button title="登 录" onPress={handleLogin} loading={loading} size="lg" />
            </View>
          </FadeInView>
        </View>
      </LinearGradient>
    </View>
  );
}
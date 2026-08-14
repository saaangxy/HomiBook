import { useState } from 'react';
import { Pressable, Switch, TextInput, View } from 'react-native';
import { router, Link } from 'expo-router';
import { Eye, EyeOff, Server, Wallet, ChevronDown, Check } from 'lucide-react-native';
import { useTheme } from '@/theme';
import { useAuth } from '@/stores/auth';
import { Screen } from '@/components/Screen';
import { Button } from '@/components/ui/Button';
import { Text } from '@/components/ui/Text';
import { AnimatedPressable } from '@/components/AnimatedPressable';
import { FadeInView } from '@/components/FadeInView';

export default function LoginScreen() {
  const { colors } = useTheme();
  const { servers, currentServer, login, switchServer } = useAuth();

  const [baseUrl, setBaseUrl] = useState(currentServer?.baseUrl ?? '');
  const [username, setUsername] = useState('demo');
  const [password, setPassword] = useState('demo123');
  const [showPwd, setShowPwd] = useState(false);
  const [remember, setRemember] = useState(true);
  const [loading, setLoading] = useState(false);
  const [serverOpen, setServerOpen] = useState(false);

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
    backgroundColor: colors.card,
    borderColor: colors.border,
    color: colors.foreground,
  };

  return (
    <Screen keyboard>
      <View className="flex-1 px-6 pt-14">
        <FadeInView>
          {/* Logo */}
          <View className="items-center mb-8">
            <View className="w-20 h-20 rounded-3xl items-center justify-center mb-4" style={{ backgroundColor: colors.primary }}>
              <Wallet size={40} color={colors.primaryForeground} />
            </View>
            <Text style={{ fontSize: 26, fontWeight: '800', color: colors.foreground }}>homibook</Text>
            <Text variant="muted" style={{ fontSize: 13, marginTop: 4 }}>家庭记账本 · 移动端</Text>
          </View>

          {/* 服务器选择 */}
          <View className="mb-4">
            <AnimatedPressable
              scale={0.99}
              haptic={false}
              className="flex-row items-center gap-3 rounded-2xl border px-4 py-3.5"
              style={{ borderColor: colors.border, backgroundColor: colors.card }}
              onPress={() => setServerOpen((v) => !v)}
            >
              <Server size={18} color={colors.primary} />
              <View className="flex-1">
                <Text variant="muted" style={{ fontSize: 12 }}>服务器</Text>
                <Text style={{ color: colors.foreground, fontWeight: '600' }}>
                  {currentServer?.name ?? '选择服务器'}
                </Text>
              </View>
              <ChevronDown size={18} color={colors.mutedForeground} />
            </AnimatedPressable>

            {serverOpen && (
              <View className="mt-2 rounded-2xl border overflow-hidden" style={{ borderColor: colors.border, backgroundColor: colors.card }}>
                {servers.map((s) => (
                  <Pressable
                    key={s.id}
                    className="flex-row items-center justify-between px-4 py-3"
                    style={{ borderBottomWidth: 1, borderBottomColor: colors.border }}
                    onPress={async () => {
                      await switchServer(s.id);
                      setBaseUrl(s.baseUrl);
                      setServerOpen(false);
                    }}
                  >
                    <View>
                      <Text style={{ color: colors.foreground, fontWeight: '600' }}>{s.name}</Text>
                      <Text variant="muted" style={{ fontSize: 12 }}>{s.baseUrl}</Text>
                    </View>
                    {(currentServer?.id === s.id || (currentServer === null && servers[0]?.id === s.id)) && (
                      <Check size={18} color={colors.primary} />
                    )}
                  </Pressable>
                ))}
                <Pressable
                  className="px-4 py-3"
                  onPress={() => router.push('/server')}
                  style={{ backgroundColor: colors.primary }}
                >
                  <Text style={{ textAlign: 'center', fontWeight: '600', color: colors.primaryForeground }}>
                    管理服务器
                  </Text>
                </Pressable>
              </View>
            )}
          </View>

          {/* 表单 */}
          <View className="gap-3">
            <TextInput
              value={baseUrl}
              onChangeText={setBaseUrl}
              placeholder="服务器地址"
              placeholderTextColor={colors.mutedForeground}
              autoCapitalize="none"
              autoCorrect={false}
              className="h-[50px] rounded-2xl border px-4"
              style={[inputStyle, { borderColor: colors.border }]}
            />
            <TextInput
              value={username}
              onChangeText={setUsername}
              placeholder="账号"
              placeholderTextColor={colors.mutedForeground}
              autoCapitalize="none"
              className="h-[50px] rounded-2xl border px-4"
              style={[inputStyle, { borderColor: colors.border }]}
            />
            <View className="relative">
              <TextInput
                value={password}
                onChangeText={setPassword}
                placeholder="密码"
                placeholderTextColor={colors.mutedForeground}
                secureTextEntry={!showPwd}
                className="h-[50px] rounded-2xl border px-4 pr-12"
                style={[inputStyle, { borderColor: colors.border }]}
              />
              <Pressable
                className="absolute right-4 top-1/2"
                style={{ transform: [{ translateY: -11 }] }}
                onPress={() => setShowPwd((v) => !v)}
              >
                {showPwd ? <EyeOff size={20} color={colors.mutedForeground} /> : <Eye size={20} color={colors.mutedForeground} />}
              </Pressable>
            </View>

            <View className="flex-row items-center justify-between mt-1">
              <View className="flex-row items-center gap-2">
                <Switch value={remember} onValueChange={setRemember} trackColor={{ true: colors.primary }} />
                <Text variant="muted">记住登录</Text>
              </View>
              <Link href="/register" className="text-sm" style={{ color: colors.primary }}>
                注册账号
              </Link>
            </View>

            <Button title="登 录" onPress={handleLogin} loading={loading} size="lg" style={{ marginTop: 8 }} />
          </View>
        </FadeInView>
      </View>
    </Screen>
  );
}
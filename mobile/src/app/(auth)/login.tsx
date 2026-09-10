import { useEffect, useState } from 'react';
import { router } from 'expo-router';
import { Pressable, ScrollView, TextInput, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Eye, EyeOff, KeyRound, Plus, Server as ServerIcon } from 'lucide-react-native';
import { useTheme, haptics } from '@/theme';
import { useAuth } from '@/stores/auth';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Button } from '@/components/ui/Button';
import { Text } from '@/components/ui/Text';
import { FadeInView } from '@/components/FadeInView';

type LoginMode = 'password' | 'apikey';

export default function LoginScreen() {
  const { colors, fonts } = useTheme();
  const { servers, currentServer, login, loginWithApiKey } = useAuth();
  const insets = useSafeAreaInsets();

  const [mode, setMode] = useState<LoginMode>('password');
  const [serverId, setServerId] = useState<string | null>(currentServer?.id ?? null);
  const [account, setAccount] = useState('');
  const [password, setPassword] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [showSecret, setShowSecret] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const effectiveServerId = serverId ?? currentServer?.id ?? servers[0]?.id ?? null;

  // 切换服务器时,用该服务器内置的账号密码 / API Key 预填(可手动修改兜底)
  // 依赖取 id,避免 servers 数组重建导致覆盖用户手动输入
  useEffect(() => {
    const s = servers.find((x) => x.id === effectiveServerId);
    if (!s) return;
    if (s.account) setAccount(s.account);
    if (s.password) setPassword(s.password);
    if (s.apiKey) setApiKey(s.apiKey);
  }, [effectiveServerId]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleLogin = async () => {
    if (!effectiveServerId) {
      setError('请先添加服务器');
      return;
    }
    setError('');
    setLoading(true);
    try {
      if (mode === 'password') {
        if (!account || !password) {
          setError('请输入账号与密码');
          return;
        }
        await login(account, password, effectiveServerId ?? '');
      } else {
        if (!apiKey.startsWith('homibook_')) {
          setError('API Key 应以 homibook_ 开头');
          return;
        }
        await loginWithApiKey(apiKey, effectiveServerId ?? '');
      }
      haptics.success();
      router.replace('/(tabs)');
    } catch (e) {
      haptics.warn();
      // 展示真实报错信息(联调排雷),避免一律吞成「登录失败」
      setError(e instanceof Error ? e.message : '登录失败,请重试');
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
      <LinearGradient colors={[colors.background, colors.muted]} style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, paddingTop: insets.top }}>
        <ScrollView contentContainerStyle={{ flexGrow: 1, justifyContent: 'center', padding: 20, paddingBottom: 100 }} keyboardShouldPersistTaps="handled" automaticallyAdjustKeyboardInsets>
          <FadeInView>
            {/* 品牌 */}
            <Text style={{ fontFamily: fonts.display, color: colors.foreground, fontSize: 42, fontWeight: '800', letterSpacing: -2, textAlign: 'center' }}>
              homi<Text style={{ color: colors.primary }}>book</Text>
            </Text>
            <Text variant="muted" style={{ textAlign: 'center', fontSize: 13, marginTop: 4, marginBottom: 28 }}>
            </Text>

            {/* 登录卡片 */}
            <View style={{ backgroundColor: colors.card, borderRadius: 24, padding: 24, borderWidth: 1, borderColor: colors.border, shadowColor: '#0f172a', shadowOpacity: 0.08, shadowRadius: 20, shadowOffset: { width: 0, height: 10 }, elevation: 4 }}>
              {/* 服务器选择 */}
              <Text variant="label">服务器</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 16 }} contentContainerStyle={{ gap: 8 }}>
                {servers.map((s) => {
                  const active = s.id === effectiveServerId;
                  return (
                    <Pressable
                      key={s.id}
                      onPress={() => {
                        setServerId(s.id);
                        haptics.tap();
                      }}
                      style={{
                        flexDirection: 'row',
                        alignItems: 'center',
                        gap: 6,
                        paddingHorizontal: 14,
                        paddingVertical: 9,
                        borderRadius: 999,
                        borderWidth: 1,
                        borderColor: active ? colors.primary : colors.border,
                        backgroundColor: active ? colors.elevated : colors.card,
                      }}
                    >
                      <ServerIcon size={13} color={active ? colors.primary : colors.mutedForeground} />
                      <Text style={{ fontSize: 13, color: active ? colors.primary : colors.foreground, fontWeight: active ? '600' : '400' }}>{s.name}</Text>
                    </Pressable>
                  );
                })}
                <Pressable
                  onPress={() => router.push('/server')}
                  style={{ flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 14, paddingVertical: 9, borderRadius: 999, borderWidth: 1, borderStyle: 'dashed', borderColor: colors.border }}
                >
                  <Plus size={13} color={colors.mutedForeground} />
                  <Text variant="muted" style={{ fontSize: 13 }}>添加</Text>
                </Pressable>
              </ScrollView>
              {servers.length === 0 && (
                <Text variant="muted" style={{ fontSize: 12, marginTop: -8, marginBottom: 16 }}>
                  还没有服务器,点击「添加」配置你的自部署实例
                </Text>
              )}

              {/* 登录模式分段控件 */}
              <View style={{ flexDirection: 'row', backgroundColor: colors.muted, borderRadius: 12, padding: 3, marginBottom: 16 }}>
                {(['password', 'apikey'] as const).map((m) => {
                  const active = mode === m;
                  return (
                    <Pressable
                      key={m}
                      onPress={() => {
                        setMode(m);
                        setError('');
                        haptics.tap();
                      }}
                      style={{
                        flex: 1,
                        paddingVertical: 8,
                        borderRadius: 9,
                        alignItems: 'center',
                        backgroundColor: active ? colors.card : 'transparent',
                        shadowColor: '#000',
                        shadowOpacity: active ? 0.08 : 0,
                        shadowRadius: 4,
                        shadowOffset: { width: 0, height: 2 },
                        elevation: active ? 1 : 0,
                      }}
                    >
                      <Text style={{ fontSize: 13, fontWeight: active ? '600' : '400', color: active ? colors.foreground : colors.mutedForeground }}>
                        {m === 'password' ? '密码登录' : 'API Key'}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>

              {mode === 'password' ? (
                <>
                  <Text variant="label">账号</Text>
                  <TextInput value={account} onChangeText={setAccount} placeholder="账号或邮箱" placeholderTextColor={colors.mutedForeground} autoCapitalize="none" style={[inputStyle, { marginBottom: 16 }]} />

                  <Text variant="label">密码</Text>
                  <View style={[inputStyle, { flexDirection: 'row', alignItems: 'center', marginBottom: 16 }]}>
                    <TextInput value={password} onChangeText={setPassword} placeholder="密码" placeholderTextColor={colors.mutedForeground} secureTextEntry={!showSecret} style={{ flex: 1, color: colors.foreground, fontSize: 15, padding: 0 }} />
                    <Pressable onPress={() => setShowSecret((v) => !v)}>
                      {showSecret ? <EyeOff size={18} color={colors.mutedForeground} /> : <Eye size={18} color={colors.mutedForeground} />}
                    </Pressable>
                  </View>
                </>
              ) : (
                <>
                  <Text variant="label">API Key</Text>
                  <View style={[inputStyle, { flexDirection: 'row', alignItems: 'center', marginBottom: 8 }]}>
                    <KeyRound size={16} color={colors.mutedForeground} style={{ marginRight: 8 }} />
                    <TextInput
                      value={apiKey}
                      onChangeText={setApiKey}
                      placeholder="homibook_..."
                      placeholderTextColor={colors.mutedForeground}
                      autoCapitalize="none"
                      autoCorrect={false}
                      secureTextEntry={!showSecret}
                      style={{ flex: 1, color: colors.foreground, fontSize: 15, padding: 0 }}
                    />
                    <Pressable onPress={() => setShowSecret((v) => !v)}>
                      {showSecret ? <EyeOff size={18} color={colors.mutedForeground} /> : <Eye size={18} color={colors.mutedForeground} />}
                    </Pressable>
                  </View>
                  <Text variant="muted" style={{ fontSize: 12, lineHeight: 18, marginBottom: 16 }}>
                    在网页端「设置 → API Key」创建。Key 仅保存在本机安全存储,适合长期免密登录。
                  </Text>
                </>
              )}

              {/* 错误提示 */}
              {!!error && (
                <View style={{ backgroundColor: colors.elevated, borderWidth: 1, borderColor: colors.expense, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 10, marginBottom: 16 }}>
                  <Text variant="expense" style={{ fontSize: 13 }}>{error}</Text>
                </View>
              )}

              <Button title="登 录" onPress={handleLogin} loading={loading} size="lg" />
            </View>
          </FadeInView>
        </ScrollView>
      </LinearGradient>
    </View>
  );
}

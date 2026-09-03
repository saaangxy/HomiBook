import { useEffect, useState } from 'react';
import { Linking, Pressable, View } from 'react-native';
import Constants from 'expo-constants';
import { useRouter } from 'expo-router';
import { ChevronRight, CircleUserRound, Brain, ExternalLink, LogOut, Palette, Server, ServerCog, Smartphone, User } from 'lucide-react-native';
import { useTheme, alpha } from '@/theme';
import { useAuth } from '@/stores/auth';
import { Screen } from '@/components/Screen';
import { Card } from '@/components/ui/Card';
import { Text } from '@/components/ui/Text';
import { FadeInView } from '@/components/FadeInView';
import { UserMemorySettings } from '@/components/ai/UserMemorySettings';
import { fetchAppVersion } from '@/services/settings';

// 设置分区标题(App / 服务器)
function GroupTitle({ title }: { title: string }) {
  return (
    <Text variant="muted" style={{ fontSize: 12, fontWeight: '600', letterSpacing: 1, marginTop: 8, marginBottom: 8 }}>
      {title}
    </Text>
  );
}

function Row({ icon, label, right, onPress, last }: {
  icon: React.ReactNode; label: string; right?: React.ReactNode; onPress?: () => void; last?: boolean;
}) {
  const { colors } = useTheme();
  return (
    <Pressable onPress={onPress} className="flex-row items-center gap-3 px-5 py-4" style={!last ? { borderBottomWidth: 1, borderBottomColor: colors.hairline } : null}>
      <View style={{ width: 32, height: 32, borderRadius: 10, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.muted }}>
        {icon}
      </View>
      <Text style={{ fontSize: 15, flex: 1, fontWeight: '500' }}>{label}</Text>
      {right ?? <ChevronRight size={17} color={colors.mutedForeground} />}
    </Pressable>
  );
}

// ── 关于(App 风格信息行,并入 App 卡片) ──
function useAboutRows() {
  const { colors } = useTheme();
  const [serverVersion, setServerVersion] = useState('');
  useEffect(() => { fetchAppVersion().then(setServerVersion); }, []);
  const appVersion = Constants.expoConfig?.version ?? '';

  const rows: { icon: React.ReactNode; label: string; right: React.ReactNode; onPress?: () => void }[] = [
    { icon: <Smartphone size={15} color={colors.primary} />, label: 'App 版本', right: <Text variant="muted" style={{ fontSize: 13 }}>{appVersion ? `v${appVersion}` : '—'}</Text> },
    { icon: <Server size={15} color={colors.primary} />, label: '服务端版本', right: <Text variant="muted" style={{ fontSize: 13 }}>{serverVersion ? `v${serverVersion}` : '—'}</Text> },
    { icon: <User size={15} color={colors.primary} />, label: '开发者', right: <Text variant="muted" style={{ fontSize: 13 }}>saaangxy</Text> },
    {
      icon: <ExternalLink size={15} color={colors.primary} />, label: 'GitHub 仓库',
      right: <Text variant="muted" style={{ fontSize: 13 }}>saaangxy/HomiBook</Text>,
      onPress: () => Linking.openURL('https://github.com/saaangxy/HomiBook').catch(() => {}),
    },
  ];
  return rows;
}

// 设置页(App 本身;服务端管理拆分至 server-settings 页面)
export default function SettingsScreen() {
  const { colors, themeId, palette, resolvedId } = useTheme();
  const { user, nickname, username, currentServer, logout } = useAuth();
  const router = useRouter();
  const isAdmin = user?.role === 'ADMIN';
  const themeName = themeId === 'system' ? '跟随系统' : palette.name;
  const aboutRows = useAboutRows();

  return (
    <Screen scroll>
      {/* key 绑定解析主题:主题切换时整页重挂载,确保卡片样式必然跟随(规避冻结后样式残留) */}
      <View key={resolvedId} className="px-5 pt-4">
        <Text style={{ fontSize: 20, fontWeight: '700', marginBottom: 16 }}>设置</Text>

        {/* 用户 */}
        <FadeInView>
          <Card className="px-5 py-4 mb-4" style={{ flexDirection: 'row', alignItems: 'center', gap: 14 }}>
            <View style={{ width: 52, height: 52, borderRadius: 26, alignItems: 'center', justifyContent: 'center', backgroundColor: alpha(colors.primary, 0.12) }}>
              <CircleUserRound size={28} color={colors.primary} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={{ fontSize: 17, fontWeight: '600' }}>{nickname || username}</Text>
              <Text variant="muted" style={{ fontSize: 12, marginTop: 2 }}>@{username}{isAdmin ? ' · 管理员' : ''}</Text>
            </View>
            <ChevronRight size={17} color={colors.mutedForeground} />
          </Card>
        </FadeInView>

        {/* ══ App ══ */}
        <GroupTitle title="App" />
        <FadeInView index={1}>
          <Card className="px-0 py-2 mb-2 overflow-hidden">
            <Row
              icon={<Server size={16} color={colors.foreground} />}
              label="服务器切换"
              right={<Text variant="muted" style={{ fontSize: 12 }}>{currentServer?.name ?? '未连接'}</Text>}
              onPress={() => router.push('/server')}
            />
            <Row
              icon={<Palette size={16} color={colors.primary} />}
              label="外观主题"
              right={<Text variant="muted" style={{ fontSize: 12 }}>{themeName}</Text>}
              onPress={() => router.push('/theme')}
              last
            />
          </Card>
        </FadeInView>

        {/* ══ AI 记忆(所有用户可见,对齐 web 设置页) ══ */}
        <GroupTitle title="AI 记忆" />
        <FadeInView index={2}>
          <Card className="px-5 py-4 mb-2">
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 10 }}>
              <View style={{ width: 32, height: 32, borderRadius: 10, alignItems: 'center', justifyContent: 'center', backgroundColor: alpha(colors.primary, 0.12) }}>
                <Brain size={16} color={colors.primary} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={{ fontSize: 15, fontWeight: '500' }}>我的 AI 记忆</Text>
                <Text variant="muted" style={{ fontSize: 11.5, marginTop: 1 }}>AI 自动记录的消费习惯与记账偏好</Text>
              </View>
            </View>
            <UserMemorySettings />
          </Card>
        </FadeInView>

        {/* ══ 服务器(仅管理员:入口跳转独立管理页) ══ */}
        {isAdmin && (
          <>
            <GroupTitle title="服务器" />
            <FadeInView index={3}>
              <Card className="px-0 py-2 mb-2 overflow-hidden">
                <Row
                  icon={<ServerCog size={16} color={colors.primary} />}
                  label="服务器管理"
                  right={<Text variant="muted" style={{ fontSize: 12 }}>通用 · AI · 字典 · 记忆 · 密钥</Text>}
                  onPress={() => router.push('/server-settings')}
                  last
                />
              </Card>
            </FadeInView>
          </>
        )}

        {/* ══ 关于 ══ */}
        <GroupTitle title="关于" />
        <FadeInView index={4}>
          <Card className="px-0 py-2 overflow-hidden">
            {aboutRows.map((row, i) => (
              <Row key={row.label} icon={row.icon} label={row.label} right={row.right} onPress={row.onPress} last={i === aboutRows.length - 1} />
            ))}
          </Card>
        </FadeInView>

        {/* 退出 */}
        <FadeInView index={5}>
          <Pressable
            onPress={async () => {
              await logout();
              router.replace('/(auth)/login');
            }}
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 8,
              paddingVertical: 14,
              borderRadius: 999,
              borderWidth: 1,
              borderColor: colors.expense,
              backgroundColor: colors.card,
              marginTop: 16,
              marginBottom: 24,
            }}
          >
            <LogOut size={16} color={colors.expense} />
            <Text style={{ color: colors.expense, fontSize: 15, fontWeight: '600' }}>退出登录</Text>
          </Pressable>
        </FadeInView>
      </View>
    </Screen>
  );
}

import { Pressable, View } from 'react-native';
import { useRouter } from 'expo-router';
import { ChevronRight, Palette, LogOut, CircleUserRound, Server } from 'lucide-react-native';
import { useTheme, alpha } from '@/theme';
import { useAuth } from '@/stores/auth';
import { Screen } from '@/components/Screen';
import { Card } from '@/components/ui/Card';
import { Text } from '@/components/ui/Text';
import { FadeInView } from '@/components/FadeInView';

interface RowProps {
  icon: React.ReactNode;
  iconBg?: string;
  label: string;
  right?: React.ReactNode;
  onPress?: () => void;
  danger?: boolean;
  last?: boolean;
}

function Row({ icon, iconBg, label, right, onPress, danger, last }: RowProps) {
  const { colors } = useTheme();
  return (
    <Pressable onPress={onPress} className="flex-row items-center gap-3 px-5 py-4" style={!last ? { borderBottomWidth: 1, borderBottomColor: colors.hairline } : null}>
      <View style={{ width: 32, height: 32, borderRadius: 10, alignItems: 'center', justifyContent: 'center', backgroundColor: iconBg ?? colors.muted }}>
        {icon}
      </View>
      <Text style={{ color: danger ? colors.expense : colors.foreground, fontSize: 15, flex: 1, fontWeight: '500' }}>{label}</Text>
      {right ?? <ChevronRight size={17} color={colors.mutedForeground} />}
    </Pressable>
  );
}

export default function SettingsScreen() {
  const { colors, themeId, palette } = useTheme();
  const { nickname, username, currentServer, logout } = useAuth();
  const router = useRouter();
  const themeName = themeId === 'system' ? '跟随系统' : palette.name;

  return (
    <Screen scroll>
      <View className="px-5 pt-4">
        <Text style={{ fontSize: 20, fontWeight: '700', marginBottom: 16 }}>设置</Text>

        {/* 用户 */}
        <FadeInView>
          <Card className="px-5 py-4 mb-4" style={{ flexDirection: 'row', alignItems: 'center', gap: 14 }}>
            <View style={{ width: 52, height: 52, borderRadius: 26, alignItems: 'center', justifyContent: 'center', backgroundColor: alpha(colors.primary, 0.12) }}>
              <CircleUserRound size={28} color={colors.primary} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={{ fontSize: 17, fontWeight: '600' }}>{nickname || username}</Text>
              <Text variant="muted" style={{ fontSize: 12, marginTop: 2 }}>@{username}</Text>
            </View>
            <ChevronRight size={17} color={colors.mutedForeground} />
          </Card>
        </FadeInView>

        {/* 服务器 + 外观 */}
        <FadeInView index={1}>
          <Card className="px-0 py-2 mb-4 overflow-hidden">
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

        {/* 退出 */}
        <FadeInView index={2}>
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
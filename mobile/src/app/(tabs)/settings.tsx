import { Pressable, Switch, View } from 'react-native';
import { useRouter } from 'expo-router';
import { Server, Moon, Sun, BookOpen, Bot, LogOut, ChevronRight, CircleUserRound } from 'lucide-react-native';
import { useTheme } from '@/theme';
import { useAuth } from '@/stores/auth';
import { Screen } from '@/components/Screen';
import { Card } from '@/components/ui/Card';
import { Text } from '@/components/ui/Text';
import { FadeInView } from '@/components/FadeInView';

interface RowProps {
  icon: React.ReactNode;
  label: string;
  right?: React.ReactNode;
  onPress?: () => void;
  danger?: boolean;
}

function Row({ icon, label, right, onPress, danger }: RowProps) {
  const { colors } = useTheme();
  return (
    <Pressable onPress={onPress} className="flex-row items-center gap-3 px-4 py-3.5" style={{ borderBottomWidth: 1, borderBottomColor: colors.border }}>
      {icon}
      <Text style={{ color: danger ? colors.destructive : colors.foreground, fontSize: 15, flex: 1, fontWeight: '500' }}>{label}</Text>
      {right ?? <ChevronRight size={18} color={colors.mutedForeground} />}
    </Pressable>
  );
}

export default function SettingsScreen() {
  const { colors, isDark, toggleTheme } = useTheme();
  const { nickname, username, currentServer, logout } = useAuth();
  const router = useRouter();

  return (
    <Screen scroll>
      <View className="px-5 pt-3">
        <Text variant="title" style={{ fontSize: 22, marginBottom: 12 }}>设置</Text>

        {/* 用户信息 */}
        <FadeInView>
          <Card className="p-4 flex-row items-center gap-3 mb-5">
            <View className="w-14 h-14 rounded-full items-center justify-center" style={{ backgroundColor: colors.primary }}>
              <CircleUserRound size={30} color={colors.primaryForeground} />
            </View>
            <View className="flex-1">
              <Text variant="bold" style={{ fontSize: 17 }}>{nickname || username}</Text>
              <Text variant="muted" style={{ fontSize: 13 }}>@{username}</Text>
            </View>
          </Card>
        </FadeInView>

        {/* 服务器 */}
        <FadeInView index={1}>
          <Text variant="muted" style={{ fontSize: 12, marginBottom: 6, marginLeft: 4 }}>连接</Text>
          <Card className="mb-5 overflow-hidden">
            <Row
              icon={<Server size={18} color={colors.primary} />}
              label="服务器"
              right={
                <View className="flex-row items-center gap-1">
                  <Text variant="muted" style={{ fontSize: 12 }}>{currentServer?.name ?? '未连接'}</Text>
                  <ChevronRight size={18} color={colors.mutedForeground} />
                </View>
              }
              onPress={() => router.push('/server')}
            />
          </Card>
        </FadeInView>

        {/* 外观 */}
        <FadeInView index={2}>
          <Text variant="muted" style={{ fontSize: 12, marginBottom: 6, marginLeft: 4 }}>外观</Text>
          <Card className="mb-5 overflow-hidden">
            <Row
              icon={isDark ? <Moon size={18} color={colors.primary} /> : <Sun size={18} color={colors.primary} />}
              label="深色模式"
              right={<Switch value={isDark} onValueChange={toggleTheme} trackColor={{ true: colors.primary }} />}
            />
            <Row
              icon={<BookOpen size={18} color={colors.primary} />}
              label="账本管理"
              onPress={() => {}}
            />
            <Row
              icon={<Bot size={18} color={colors.primary} />}
              label="AI 配置"
              onPress={() => {}}
            />
          </Card>
        </FadeInView>

        {/* 退出 */}
        <FadeInView index={3}>
          <Card className="overflow-hidden">
            <Row
              icon={<LogOut size={18} color={colors.destructive} />}
              label="退出登录"
              danger
              onPress={async () => {
                await logout();
                router.replace('/(auth)/login');
              }}
            />
          </Card>
        </FadeInView>
      </View>
    </Screen>
  );
}
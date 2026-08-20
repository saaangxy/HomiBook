import { useEffect } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { usePathname, useRouter } from 'expo-router';
import Animated, { useAnimatedStyle, useSharedValue, withTiming, Easing } from 'react-native-reanimated';
import {
  ArrowLeftRight, BarChart3, Book, CalendarDays, LayoutDashboard, Repeat, Settings,
  ShieldCheck, Target, Users, Wallet, type LucideIcon,
} from 'lucide-react-native';
import { useTheme, alpha, haptics } from '@/theme';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Text } from '@/components/ui/Text';
import { useAuth } from '@/stores/auth';
import { useUIShell } from './chrome';

type MenuItem = { icon: LucideIcon; label: string; to: string; adminOnly?: boolean };

// 菜单项与网页端 MainLayout allNavItems 完全一致(顺序/图标/管理员项)
const MENU: MenuItem[] = [
  { icon: LayoutDashboard, label: '首页', to: '/' },
  { icon: BarChart3, label: '统计分析', to: '/stats' },
  { icon: CalendarDays, label: '流水日历', to: '/calendar' },
  { icon: ArrowLeftRight, label: '流水管理', to: '/records' },
  { icon: Wallet, label: '账户管理', to: '/accounts' },
  { icon: Target, label: '预算管理', to: '/budget' },
  { icon: Repeat, label: '固定收支', to: '/recurring' },
  { icon: Book, label: '账本管理', to: '/books' },
  { icon: Users, label: '用户管理', to: '/users', adminOnly: true },
  { icon: ShieldCheck, label: 'AI审计', to: '/ai-audit', adminOnly: true },
  { icon: Settings, label: '设置', to: '/settings' },
];

const PANEL_W = 280;
// 纯线性 ease:开关双向均速滑行,不加速不减速,绝无弹离感
const ANIM_CFG = { duration: 280, easing: Easing.out(Easing.ease) } as const;

// 左侧抽屉:对齐网页端侧边栏 —— Logo 头 + 单列菜单(当前路由高亮) + 底部用户卡
// 直接驱动 translateX,对称缓动绝不过冲
export function Sidebar() {
  const { colors } = useTheme();
  const { sidebarOpen, closeSidebar } = useUIShell();
  const { user } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const insets = useSafeAreaInsets();

  const translateX = useSharedValue(-PANEL_W);
  useEffect(() => {
    translateX.value = withTiming(sidebarOpen ? 0 : -PANEL_W, ANIM_CFG);
  }, [sidebarOpen, translateX]);

  const overlayStyle = useAnimatedStyle(() => {
    // translateX 从 -PANEL_W(关)到 0(开),进度 = (translateX + PANEL_W) / PANEL_W
    const p = (translateX.value + PANEL_W) / PANEL_W;
    return { backgroundColor: `rgba(0,0,0,${0.45 * p})` };
  });
  const panelStyle = useAnimatedStyle(() => ({ transform: [{ translateX: translateX.value }] }));

  const isAdmin = user?.role === 'ADMIN';
  const items = MENU.filter((m) => !m.adminOnly || isAdmin);
  const displayName = user?.nickname || user?.username || '用户';
  const avatarChar = (displayName[0] || 'U').toUpperCase();

  return (
    <View
      pointerEvents={sidebarOpen ? 'auto' : 'none'}
      style={StyleSheet.absoluteFill}
      accessibilityElementsHidden={!sidebarOpen}
      importantForAccessibility={sidebarOpen ? 'yes' : 'no-hide-descendants'}
    >
      {/* 遮罩(与面板同步淡入,点按关闭) */}
      <Animated.View style={[StyleSheet.absoluteFill, overlayStyle]}>
        <Pressable style={{ flex: 1 }} onPress={closeSidebar} />
      </Animated.View>

      {/* 面板 */}
      <Animated.View
        style={[
          panelStyle,
          {
            position: 'absolute', left: 0, top: 0, bottom: 0, width: PANEL_W,
            backgroundColor: colors.card, paddingTop: insets.top + 16, paddingHorizontal: 14, paddingBottom: insets.bottom,
            shadowColor: '#000', shadowOpacity: 0.12, shadowRadius: 24, shadowOffset: { width: 4, height: 0 }, elevation: 24,
          },
        ]}
      >
        {/* Logo 头(对齐网页:primary 圆角方块 Book 图标 + Homibook) */}
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 6, paddingTop: 4, paddingBottom: 18 }}>
          <View style={{ width: 40, height: 40, borderRadius: 12, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center' }}>
            <Book size={22} color={colors.primaryForeground} />
          </View>
          <Text style={{ fontSize: 20, fontWeight: '800', letterSpacing: -0.5, color: colors.primary }}>Homibook</Text>
        </View>

        {/* 单列菜单 */}
        <ScrollView showsVerticalScrollIndicator={false}>
          {items.map((m) => {
            const active = pathname === m.to || (m.to === '/' && pathname === '/');
            const Icon = m.icon;
            return (
              <Pressable
                key={m.label}
                onPress={() => {
                  haptics.tap();
                  router.navigate(m.to as never);
                  closeSidebar();
                }}
                style={{
                  flexDirection: 'row', alignItems: 'center', gap: 12,
                  paddingVertical: 12, paddingHorizontal: 12, borderRadius: 12, marginBottom: 2,
                  backgroundColor: active ? alpha(colors.primary, 0.1) : 'transparent',
                }}
              >
                <Icon size={19} color={active ? colors.primary : colors.mutedForeground} strokeWidth={active ? 2.3 : 1.9} />
                <Text style={{ fontSize: 15, fontWeight: active ? '600' : '400', color: active ? colors.primary : colors.foreground }}>{m.label}</Text>
              </Pressable>
            );
          })}
        </ScrollView>

        {/* 底部用户卡(对齐网页 SidebarFooter) */}
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, padding: 10, borderRadius: 12, backgroundColor: colors.muted, marginTop: 8 }}>
          <View style={{ width: 36, height: 36, borderRadius: 10, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center' }}>
            <Text style={{ fontSize: 15, fontWeight: '700', color: colors.primaryForeground }}>{avatarChar}</Text>
          </View>
          <View style={{ flex: 1 }}>
            <Text numberOfLines={1} style={{ fontSize: 14, fontWeight: '600' }}>{displayName}</Text>
            {!!user?.email && (
              <Text numberOfLines={1} variant="muted" style={{ fontSize: 11, marginTop: 1 }}>{user.email}</Text>
            )}
          </View>
        </View>
      </Animated.View>
    </View>
  );
}

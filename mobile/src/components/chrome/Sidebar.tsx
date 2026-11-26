import { useEffect, type ReactNode } from 'react';
import { Image, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { usePathname, useRouter } from 'expo-router';
import Animated, { runOnJS, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import {
  ArrowLeftRight, BarChart3, Book, CalendarDays, LayoutDashboard, Repeat, Settings,
  Target, Users, Wallet, type LucideIcon,
} from 'lucide-react-native';
import { useTheme, motion, alpha, haptics, SidebarDecor } from '@/theme';
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
  { icon: Settings, label: '设置', to: '/settings' },
];

const PANEL_W = 280;
/** 关闭态的贴边热区宽度(跟手拖动用);系统返回手势占用屏幕最左侧约 20dp,真正起效的是热区内侧部分 */
const EDGE_W = 24;
/** 页面级右滑判定的水平位移阈值:避开系统边缘手势,任意位置右滑超过该距离即可拉出抽屉 */
const PAGE_SWIPE_X = 28;
/** 页面级右滑判定的纵向容差:超过则认为用户在做纵向滚动,交给页面 */
const PAGE_SWIPE_TOLERANCE_Y = 24;

/**
 * 页面级右滑打开抽屉:包在导航内容外层。
 *
 * 不采用全屏透明热区 —— 覆盖层会吃掉下方页面的点击;包在内容外层时手势与页面点击共存,
 * 右滑可从页面任意位置起手,自然避开系统「返回」边缘手势区域。
 */
export function SidebarSwipeArea({ children }: { children: ReactNode }) {
  const { sidebarOpen, openSidebar } = useUIShell();
  const { isLoggedIn } = useAuth();

  const pan = Gesture.Pan()
    .enabled(isLoggedIn && !sidebarOpen)
    // activeOffsetX 的区间是「不激活的死区」:右边界设为阈值,只有右滑超过阈值才激活(左滑/纵向滚动不会误触)
    .activeOffsetX([-10000, PAGE_SWIPE_X])
    .failOffsetY([-PAGE_SWIPE_TOLERANCE_Y, PAGE_SWIPE_TOLERANCE_Y])
    // 直接在 JS 线程回调:无需 runOnJS,避免 worklet 内调用 setState 的限制
    .runOnJS(true)
    .onStart(() => {
      haptics.tap();
      openSidebar();
    });

  return <GestureDetector gesture={pan}>{children}</GestureDetector>;
}

// 左侧抽屉:对齐网页端侧边栏 —— Logo 头 + 单列菜单(当前路由高亮) + 底部用户卡
// 直接驱动 translateX,对称缓动绝不过冲
export function Sidebar() {
  const { palette, sidebar } = useTheme();
  const { sidebarOpen, openSidebar, closeSidebar } = useUIShell();
  const { user } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const insets = useSafeAreaInsets();

  const translateX = useSharedValue(-PANEL_W);
  useEffect(() => {
    // 纯线性 ease:开关双向均速滑行,不加速不减速,绝无弹离感(参数集中管理于 motion.sidebar)
    translateX.value = withTiming(sidebarOpen ? 0 : -PANEL_W, motion.sidebar);
  }, [sidebarOpen, translateX]);

  // ── 手势:关闭态从左边缘右滑拉出,打开态左滑收起 ──
  /** 起手位移(拖动过程中以它为基准) */
  const gestureStartX = useSharedValue(-PANEL_W);

  /** 松手落位:吸附到开/关两档,并把状态同步回 JS 侧 */
  const settleOpen = (open: boolean) => {
    haptics.tap();
    if (open) openSidebar();
    else closeSidebar();
  };

  /** 打开态:面板/遮罩上横向拖动 —— 左滑关闭、右滑回弹;纵向位移让给列表滚动 */
  const swipeGesture = Gesture.Pan()
    .activeOffsetX([-12, 12])
    .failOffsetY([-16, 16])
    .onStart(() => {
      gestureStartX.value = translateX.value;
    })
    .onUpdate((e) => {
      translateX.value = Math.max(-PANEL_W, Math.min(0, gestureStartX.value + e.translationX));
    })
    .onEnd((e) => {
      const open = translateX.value > -PANEL_W * 0.35 || e.velocityX > 500;
      translateX.value = withTiming(open ? 0 : -PANEL_W, motion.sidebar);
      runOnJS(settleOpen)(open);
    });

  /** 关闭态:左边缘右滑拉出抽屉(死区右边界=阈值,只接受向右位移,纵向滚动不触发) */
  const edgeGesture = Gesture.Pan()
    .activeOffsetX([-10000, 14])
    .failOffsetY([-16, 16])
    .onStart(() => {
      gestureStartX.value = translateX.value;
    })
    .onUpdate((e) => {
      translateX.value = Math.max(-PANEL_W, Math.min(0, gestureStartX.value + e.translationX));
    })
    .onEnd((e) => {
      const open = translateX.value > -PANEL_W * 0.3 || e.velocityX > 500;
      translateX.value = withTiming(open ? 0 : -PANEL_W, motion.sidebar);
      runOnJS(settleOpen)(open);
    });

  const overlayStyle = useAnimatedStyle(() => {
    // translateX 从 -PANEL_W(关)到 0(开),进度 = (translateX + PANEL_W) / PANEL_W
    // alpha 量化到 0.01,避免 withTiming 收敛的浮点误差(如 1.28e-8)生成 processColor 无法处理的极小 alpha
    const p = Math.min(1, Math.max(0, (translateX.value + PANEL_W) / PANEL_W));
    const a = Math.round(0.45 * p * 100) / 100;
    // 遮罩色随主题 scrim(深底主题可调),默认黑
    return { backgroundColor: `rgba(${palette.decor.scrim},${a})` };
  });
  const panelStyle = useAnimatedStyle(() => ({ transform: [{ translateX: translateX.value }] }));

  const isAdmin = user?.role === 'ADMIN';
  const items = MENU.filter((m) => !m.adminOnly || isAdmin);
  const displayName = user?.nickname || user?.username || '用户';
  const avatarChar = (displayName[0] || 'U').toUpperCase();

  return (
    <>
      {/* 关闭态:屏幕左边缘热区(右滑拉出抽屉);打开后让出触摸,避免遮挡面板 */}
      <GestureDetector gesture={edgeGesture}>
        <View
          collapsable={false}
          pointerEvents={sidebarOpen ? 'none' : 'auto'}
          style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: sidebarOpen ? 0 : EDGE_W }}
        />
      </GestureDetector>

      {/* 打开态:整层可左滑收起;关闭时 pointerEvents 为 none,不拦截页面触摸 */}
      <GestureDetector gesture={swipeGesture}>
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
            backgroundColor: sidebar.background, paddingTop: insets.top + 16, paddingHorizontal: 14, paddingBottom: insets.bottom,
            // 面板边线随 sidebar.border;mondrian 对齐 web 的 3px 黑边
            borderRightWidth: palette.id === 'mondrian' ? 3 : 1,
            borderRightColor: sidebar.border,
            shadowColor: palette.mode === 'dark' ? '#000000' : '#0f172a',
            shadowOpacity: 0.12, shadowRadius: 24, shadowOffset: { width: 4, height: 0 }, elevation: 24,
          },
        ]}
      >
        {/* 内容常驻渲染:关闭瞬间卸载会导致面板变白色空板、动画结束后才消失;
            菜单为静态轻内容,pointerEvents 已在关闭时禁交互,常驻开销可忽略 */}
        <>
          {/* 主题装饰层(纹理/状态灯,内容之下) */}
          <SidebarDecor palette={palette} active={sidebarOpen} />
          {/* Logo 头(项目 logo 图 + Homibook) */}
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 6, paddingTop: 4, paddingBottom: 18 }}>
              <Image source={require('../../../assets/images/logo.png')} style={{ width: 40, height: 40, borderRadius: 12 }} />
              <Text style={{ fontSize: 20, fontWeight: '800', letterSpacing: -0.5, color: sidebar.primary }}>Homibook</Text>
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
                    closeSidebar();
                    // 下一帧再导航:让侧边栏关闭动画先启动,避免与目标页面首帧渲染同时抢占主线程造成卡顿
                    requestAnimationFrame(() => router.navigate(m.to as never));
                  }}
                  style={{
                    flexDirection: 'row', alignItems: 'center', gap: 12,
                    paddingVertical: 12, paddingHorizontal: 12, borderRadius: 12, marginBottom: 2,
                    backgroundColor: active ? alpha(sidebar.primary, 0.12) : 'transparent',
                  }}
                >
                  <Icon size={19} color={active ? sidebar.primary : sidebar.accentForeground} strokeWidth={active ? 2.3 : 1.9} />
                  <Text style={{ fontSize: 15, fontWeight: active ? '600' : '400', color: active ? sidebar.primary : sidebar.foreground }}>{m.label}</Text>
                </Pressable>
              );
            })}
          </ScrollView>

          {/* 底部用户卡(对齐网页 SidebarFooter;色取 sidebar.accent 保证深色面板可读) */}
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, padding: 10, borderRadius: 12, backgroundColor: sidebar.accent, marginTop: 8 }}>
            <View style={{ width: 36, height: 36, borderRadius: 10, backgroundColor: sidebar.primary, alignItems: 'center', justifyContent: 'center' }}>
              <Text style={{ fontSize: 15, fontWeight: '700', color: sidebar.primaryForeground }}>{avatarChar}</Text>
            </View>
            <View style={{ flex: 1 }}>
              <Text numberOfLines={1} style={{ fontSize: 14, fontWeight: '600', color: sidebar.foreground }}>{displayName}</Text>
              {!!user?.email && (
                <Text numberOfLines={1} style={{ fontSize: 11, marginTop: 1, color: sidebar.accentForeground }}>{user.email}</Text>
              )}
            </View>
          </View>
        </>
      </Animated.View>
        </View>
      </GestureDetector>
    </>
  );
}

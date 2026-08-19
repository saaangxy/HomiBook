import { useEffect } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useRouter } from 'expo-router';
import Animated, { interpolate, useAnimatedStyle, useSharedValue, withSpring } from 'react-native-reanimated';
import { useTheme } from '@/theme';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Text } from '@/components/ui/Text';
import { useUIShell } from './chrome';

type MenuItem = { icon: string; label: string; to: string };
type MenuSection = { title: string; items: MenuItem[] };

// 概览项与底部 tab 一致;管理项为其余子页面 —— 统一在顶栏 ☰ 全局菜单下
const MENU: MenuSection[] = [
  {
    title: '概览',
    items: [
      { icon: '🏠', label: '首页', to: '/' },
      { icon: '📅', label: '流水日历', to: '/calendar' },
      { icon: '📈', label: '统计分析', to: '/stats' },
      { icon: '⚙️', label: '系统设置', to: '/settings' },
    ],
  },
  {
    title: '管理',
    items: [
      { icon: '📋', label: '预算管理', to: '/budget' },
      { icon: '📊', label: '流水管理', to: '/records' },
      { icon: '💳', label: '账户管理', to: '/accounts' },
      { icon: '🔁', label: '固定收支', to: '/recurring' },
      { icon: '📚', label: '账本管理', to: '/books' },
      { icon: '👥', label: '用户管理', to: '/users' },
      { icon: '🤖', label: 'AI 审计', to: '/ai-audit' },
    ],
  },
];

// 左侧抽屉:顶栏 ☰ 打开;点遮罩收起(无关闭钮)
// 遮罩与面板由同一共享帧驱动 —— 同时出现/消失,弹性顺滑
export function Sidebar() {
  const { colors } = useTheme();
  const { sidebarOpen, closeSidebar } = useUIShell();
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const progress = useSharedValue(0);
  useEffect(() => {
    progress.value = withSpring(sidebarOpen ? 1 : 0, { damping: 26, stiffness: 210 });
  }, [sidebarOpen, progress]);

  const overlayStyle = useAnimatedStyle(() => ({
    backgroundColor: `rgba(0,0,0,${0.45 * progress.value})`,
  }));
  const panelStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: interpolate(progress.value, [0, 1], [-280, 0]) }],
  }));

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
            position: 'absolute', left: 0, top: 0, bottom: 0, width: 280,
            backgroundColor: colors.card, paddingTop: insets.top + 16, paddingHorizontal: 14, paddingBottom: insets.bottom,
            shadowColor: '#000', shadowOpacity: 0.12, shadowRadius: 24, shadowOffset: { width: 4, height: 0 }, elevation: 24,
          },
        ]}
      >
        <Text style={{ fontSize: 17, fontWeight: '700', marginBottom: 14, paddingHorizontal: 4 }}>菜单</Text>
        <ScrollView showsVerticalScrollIndicator={false}>
          {MENU.map((section) => (
            <View key={section.title} style={{ marginBottom: 6 }}>
              <Text style={{ fontSize: 11, color: colors.mutedForeground, letterSpacing: 1, marginHorizontal: 12, marginBottom: 4, marginTop: 8 }}>{section.title}</Text>
              {section.items.map((m) => (
                <Pressable
                  key={m.label}
                  onPress={() => {
                    router.navigate(m.to as never);
                    closeSidebar();
                  }}
                  style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 13, paddingHorizontal: 12, borderRadius: 14, marginBottom: 2 }}
                >
                  <Text style={{ fontSize: 18 }}>{m.icon}</Text>
                  <Text style={{ fontSize: 15, fontWeight: '500', color: colors.foreground }}>{m.label}</Text>
                </Pressable>
              ))}
            </View>
          ))}
        </ScrollView>
      </Animated.View>
    </View>
  );
}
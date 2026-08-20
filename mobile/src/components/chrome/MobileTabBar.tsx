import { useEffect } from 'react';
import { Pressable, View } from 'react-native';
import Animated, { interpolate, useAnimatedStyle, useSharedValue, withSpring } from 'react-native-reanimated';
import { LinearGradient } from 'expo-linear-gradient';
import { LayoutDashboard, CalendarDays, BarChart3, Settings, Plus, type LucideIcon } from 'lucide-react-native';
import { useTheme, motion, haptics } from '@/theme';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Text } from '@/components/ui/Text';
import { AnimatedPressable } from '@/components/AnimatedPressable';
import { useUIShell } from './chrome';

interface TabMeta {
  name: string;
  label: string;
  icon: LucideIcon;
}

const TABS: TabMeta[] = [
  { name: 'index', label: '首页', icon: LayoutDashboard },
  { name: 'calendar', label: '流水日历', icon: CalendarDays },
  { name: 'stats', label: '统计', icon: BarChart3 },
  { name: 'settings', label: '设置', icon: Settings },
];

/** 单个 tab:激活时图标放大 1.15 + 上浮 2px,标签着色 */
function TabItem({ meta, active, onPress }: { meta: TabMeta; active: boolean; onPress: () => void }) {
  const { colors } = useTheme();
  const progress = useSharedValue(active ? 1 : 0);

  useEffect(() => {
    progress.value = withSpring(active ? 1 : 0, motion.spring.snappy);
  }, [active, progress]);

  const iconStyle = useAnimatedStyle(() => ({
    transform: [
      { scale: interpolate(progress.value, [0, 1], [1, 1.15]) },
      { translateY: interpolate(progress.value, [0, 1], [0, -2]) },
    ],
  }));

  const Icon = meta.icon;
  return (
    <Pressable
      onPress={() => {
        haptics.tap();
        onPress();
      }}
      style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: 4 }}
    >
      <Animated.View style={iconStyle}>
        <Icon size={22} color={active ? colors.primary : colors.mutedForeground} strokeWidth={active ? 2.2 : 1.8} />
      </Animated.View>
      <Text style={{ fontSize: 10, color: active ? colors.primary : colors.mutedForeground, fontWeight: active ? '600' : '400' }}>
        {meta.label}
      </Text>
    </Pressable>
  );
}

// 自定义底部导航:4 Tab + 中央悬浮渐变 FAB(记一笔);圆角/阴影随主题
export function MobileTabBar({ state, navigation }: { state: { index: number; routes: { name: string }[] }; navigation: { navigate: (n: string) => void } }) {
  const { colors, palette } = useTheme();
  const { openRecord } = useUIShell();
  const insets = useSafeAreaInsets();

  const actives: Record<string, boolean> = {};
  state.routes.forEach((r, i) => {
    actives[r.name] = i === state.index;
  });

  const fabRadius = palette.radius.button === 999 ? 28 : 12;

  return (
    <View style={{ backgroundColor: colors.card, borderTopWidth: 1, borderTopColor: colors.border }}>
      <View style={{ flexDirection: 'row', height: 60 + insets.bottom, paddingBottom: insets.bottom }}>
        <TabItem meta={TABS[0]} active={!!actives[TABS[0].name]} onPress={() => navigation.navigate(TABS[0].name)} />
        <TabItem meta={TABS[1]} active={!!actives[TABS[1].name]} onPress={() => navigation.navigate(TABS[1].name)} />

        {/* 中央 + 记一笔 FAB */}
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'flex-start' }}>
          <AnimatedPressable
            onPress={() => {
              haptics.medium();
              openRecord();
            }}
            haptic={false}
            style={{
              width: 56,
              height: 56,
              borderRadius: fabRadius,
              marginTop: -22,
              backgroundColor: colors.primary,
              alignItems: 'center',
              justifyContent: 'center',
              overflow: 'hidden',
              borderWidth: 4,
              borderColor: colors.card,
              shadowColor: colors.primary,
              shadowOpacity: palette.cardStyle.shadow === 'none' ? 0 : 0.4,
              shadowRadius: 12,
              shadowOffset: { width: 0, height: 5 },
              elevation: 8,
            }}
          >
            <LinearGradient colors={palette.colors.gradient} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }} />
            <Plus size={26} color={colors.primaryForeground} strokeWidth={2.4} />
          </AnimatedPressable>
        </View>

        <TabItem meta={TABS[2]} active={!!actives[TABS[2].name]} onPress={() => navigation.navigate(TABS[2].name)} />
        <TabItem meta={TABS[3]} active={!!actives[TABS[3].name]} onPress={() => navigation.navigate(TABS[3].name)} />
      </View>
    </View>
  );
}

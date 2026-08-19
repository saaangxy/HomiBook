import { Pressable, View } from 'react-native';
import { LayoutDashboard, CalendarDays, BarChart3, Settings, Plus, type LucideIcon } from 'lucide-react-native';
import { useTheme } from '@/theme';
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

// 自定义底部导航:4 Tab + 中央悬浮橙圆钮(记一笔) —— 对齐原型
export function MobileTabBar({ state, navigation }: { state: { index: number; routes: { name: string }[] }; navigation: { navigate: (n: string) => void } }) {
  const { colors } = useTheme();
  const { openRecord } = useUIShell();
  const insets = useSafeAreaInsets();

  const actives: Record<string, boolean> = {};
  state.routes.forEach((r, i) => {
    actives[r.name] = i === state.index;
  });

  const renderItem = (meta: TabMeta) => {
    const active = actives[meta.name];
    const Icon = meta.icon;
    const go = () => navigation.navigate(meta.name);
    return (
      <Pressable key={meta.name} onPress={go} style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: 4 }}>
        <Icon size={22} color={active ? colors.primary : colors.mutedForeground} strokeWidth={active ? 2.2 : 1.8} />
        <Text style={{ fontSize: 10, color: active ? colors.primary : colors.mutedForeground }}>{meta.label}</Text>
      </Pressable>
    );
  };

  return (
    <View style={{ backgroundColor: colors.card, borderTopWidth: 1, borderTopColor: colors.border }}>
      <View style={{ flexDirection: 'row', height: 60 + insets.bottom, paddingBottom: insets.bottom }}>
        {renderItem(TABS[0])}
        {renderItem(TABS[1])}

        {/* 中央 + 记一笔 */}
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'flex-start' }}>
          <AnimatedPressable
            onPress={openRecord}
            style={{
              width: 56,
              height: 56,
              borderRadius: 28,
              marginTop: -22,
              backgroundColor: '#f97316',
              alignItems: 'center',
              justifyContent: 'center',
              borderWidth: 4,
              borderColor: colors.card,
              shadowColor: '#f97316',
              shadowOpacity: 0.4,
              shadowRadius: 12,
              shadowOffset: { width: 0, height: 5 },
              elevation: 8,
            }}
          >
            <Plus size={26} color="#fff" strokeWidth={2.4} />
          </AnimatedPressable>
        </View>

        {renderItem(TABS[2])}
        {renderItem(TABS[3])}
      </View>
    </View>
  );
}
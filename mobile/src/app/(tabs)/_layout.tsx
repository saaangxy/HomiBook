import { Tabs } from 'expo-router/js-tabs';
import { LayoutDashboard, ArrowLeftRight, BarChart3, Settings } from 'lucide-react-native';
import { useTheme } from '@/theme';

export default function TabLayout() {
  const { colors } = useTheme();

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.primary,
        tabBarInactiveTintColor: colors.mutedForeground,
        tabBarStyle: {
          backgroundColor: colors.card,
          borderTopColor: colors.border,
          height: 60,
          paddingBottom: 8,
          paddingTop: 6,
        },
        tabBarLabelStyle: { fontSize: 11, fontWeight: '600' },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{ title: '首页', tabBarIcon: ({ color, size }) => <LayoutDashboard size={size} color={color} /> }}
      />
      <Tabs.Screen
        name="records"
        options={{ title: '流水', tabBarIcon: ({ color, size }) => <ArrowLeftRight size={size} color={color} /> }}
      />
      <Tabs.Screen
        name="stats"
        options={{ title: '统计', tabBarIcon: ({ color, size }) => <BarChart3 size={size} color={color} /> }}
      />
      <Tabs.Screen
        name="settings"
        options={{ title: '设置', tabBarIcon: ({ color, size }) => <Settings size={size} color={color} /> }}
      />
    </Tabs>
  );
}
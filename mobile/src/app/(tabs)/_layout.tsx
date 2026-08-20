import { Tabs } from 'expo-router/js-tabs';
import { GlobalBar } from '@/components/chrome/GlobalBar';
import { MobileTabBar } from '@/components/chrome/MobileTabBar';

export default function TabLayout() {
  return (
    <Tabs
        screenOptions={{
          headerShown: true,
          header: () => <GlobalBar />,
        }}
        tabBar={(props) => (
          <MobileTabBar
            state={props.state}
            navigation={{
              navigate: (name: string) => props.navigation.navigate(name as never),
            }}
          />
        )}
      >
        <Tabs.Screen name="index" />
        <Tabs.Screen name="calendar" />
        <Tabs.Screen name="stats" />
        <Tabs.Screen name="settings" />

        {/* 管理页:置于顶部全局组件下,非底部可见 tab(经侧边栏进入) */}
        {[
          'records',
          'budget',
          'accounts',
          'recurring',
          'books',
          'users',
          'ai-audit',
          'theme',
        ].map((name) => (
          <Tabs.Screen key={name} name={name} options={{ href: null }} />
        ))}
      </Tabs>
  );
}
import { Pressable, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '@/theme';
import { Text } from '@/components/ui/Text';
import { useUIShell } from './chrome';

// 顶栏:☰ 菜单(开侧边栏) + 当前账本名(开账本弹窗)
// 顶部加 insets.top,避免内容延伸到状态栏后(覆盖通知栏)
export function GlobalBar() {
  const { sidebar } = useTheme();
  const insets = useSafeAreaInsets();
  const { currentLedger, openSidebar, openLedger } = useUIShell();

  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        paddingTop: insets.top,
        height: 56 + insets.top,
        paddingHorizontal: 12,
        gap: 10,
        backgroundColor: sidebar.background,
        borderBottomWidth: 1,
        borderBottomColor: sidebar.border,
      }}
    >
      <Pressable
        onPress={openSidebar}
        style={{ width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center', backgroundColor: sidebar.accent }}
      >
        <Text style={{ fontSize: 17, color: sidebar.accentForeground, lineHeight: 20 }}>☰</Text>
      </Pressable>

      <Pressable onPress={openLedger} style={{ flexDirection: 'row', alignItems: 'center', gap: 4, flex: 1 }}>
        {/* 显式着色:Text 默认色为内容区 foreground,深色 chrome 面板上不可读 */}
        <Text style={{ fontSize: 16, fontWeight: '600', color: sidebar.foreground }}>{currentLedger.name}</Text>
        <Text style={{ color: sidebar.accentForeground, fontSize: 11 }}>▾</Text>
      </Pressable>
    </View>
  );
}
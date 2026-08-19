import { Pressable, View } from 'react-native';
import { useTheme } from '@/theme';
import { Text } from '@/components/ui/Text';
import { useUIShell } from './chrome';

// 顶栏:☰ 菜单(开侧边栏) + 当前账本名(开账本弹窗)
export function GlobalBar() {
  const { colors } = useTheme();
  const { currentLedger, openSidebar, openLedger } = useUIShell();

  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        height: 56,
        paddingHorizontal: 12,
        gap: 10,
        backgroundColor: colors.card,
        borderBottomWidth: 1,
        borderBottomColor: colors.border,
      }}
    >
      <Pressable
        onPress={openSidebar}
        style={{ width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.muted }}
      >
        <Text style={{ fontSize: 17, color: colors.foreground, lineHeight: 20 }}>☰</Text>
      </Pressable>

      <Pressable onPress={openLedger} style={{ flexDirection: 'row', alignItems: 'center', gap: 4, flex: 1 }}>
        <Text style={{ fontSize: 16, fontWeight: '600' }}>{currentLedger.name}</Text>
        <Text style={{ color: colors.mutedForeground, fontSize: 11 }}>▾</Text>
      </Pressable>
    </View>
  );
}
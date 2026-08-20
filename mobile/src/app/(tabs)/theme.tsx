import { View } from 'react-native';
import { useRouter } from 'expo-router';
import { Check, ChevronLeft, MonitorSmartphone } from 'lucide-react-native';
import { useTheme, haptics, palettes, paletteOrder, type Palette } from '@/theme';
import { Screen } from '@/components/Screen';
import { Text } from '@/components/ui/Text';
import { FadeInView } from '@/components/FadeInView';
import { AnimatedPressable } from '@/components/AnimatedPressable';

/** 迷你账页预览:用目标主题自身配色/字体渲染,所见即所得 */
function ThemePreview({ palette }: { palette: Palette }) {
  const c = palette.colors;
  const pillRadius = palette.radius.button === 999 ? 9 : 3;
  return (
    <View style={{ height: 92, borderRadius: 12, overflow: 'hidden', backgroundColor: c.background, padding: 10 }}>
      <View
        style={{
          backgroundColor: c.card,
          borderRadius: Math.min(palette.radius.card, 10),
          padding: 8,
          borderWidth: palette.cardStyle.borderWidth > 1 ? 1 : 0,
          borderColor: c.border,
        }}
      >
        <View style={{ width: '45%', height: 5, borderRadius: 3, backgroundColor: c.mutedForeground, opacity: 0.4 }} />
        <Text
          numberOfLines={1}
          style={{ fontFamily: palette.fonts.numeric, color: c.foreground, fontSize: 17, fontWeight: '700', marginTop: 4 }}
        >
          ¥1,234.56
        </Text>
      </View>
      <View style={{ flexDirection: 'row', gap: 6, marginTop: 8, alignItems: 'center' }}>
        <View style={{ flex: 1, height: 16, borderRadius: pillRadius, backgroundColor: c.primary }} />
        <View style={{ width: 16, height: 16, borderRadius: 8, backgroundColor: c.income }} />
        <View style={{ width: 16, height: 16, borderRadius: 8, backgroundColor: c.expense }} />
      </View>
    </View>
  );
}

function ThemeCard({ palette, index }: { palette: Palette; index: number }) {
  const { themeId, setThemeId, colors } = useTheme();
  const active = themeId === palette.id;

  return (
    <FadeInView index={index} style={{ width: '48%' }}>
      <AnimatedPressable
        onPress={() => {
          setThemeId(palette.id);
          haptics.tap();
        }}
        style={{
          borderRadius: 16,
          borderWidth: 2,
          borderColor: active ? colors.primary : colors.border,
          backgroundColor: colors.card,
          padding: 8,
        }}
      >
        <ThemePreview palette={palette} />
        <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 8, paddingHorizontal: 2 }}>
          <View style={{ flex: 1 }}>
            <Text style={{ fontSize: 14, fontWeight: '600' }}>{palette.name}</Text>
            <Text variant="muted" style={{ fontSize: 11, marginTop: 1 }} numberOfLines={1}>
              {palette.description}
            </Text>
          </View>
          {active && (
            <View style={{ width: 20, height: 20, borderRadius: 10, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center' }}>
              <Check size={12} color={colors.primaryForeground} strokeWidth={3} />
            </View>
          )}
        </View>
      </AnimatedPressable>
    </FadeInView>
  );
}

export default function ThemeScreen() {
  const { colors, themeId, setThemeId } = useTheme();
  const router = useRouter();
  const systemActive = themeId === 'system';

  return (
    <Screen scroll>
      <View className="px-5 pt-4">
        {/* 返回 + 标题 */}
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 16 }}>
          <AnimatedPressable
            onPress={() => router.back()}
            style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: colors.muted, alignItems: 'center', justifyContent: 'center' }}
          >
            <ChevronLeft size={18} color={colors.foreground} />
          </AnimatedPressable>
          <Text variant="title">外观主题</Text>
        </View>

        {/* 跟随系统 */}
        <FadeInView>
          <AnimatedPressable
            onPress={() => {
              setThemeId('system');
              haptics.tap();
            }}
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              gap: 12,
              borderRadius: 16,
              borderWidth: 2,
              borderColor: systemActive ? colors.primary : colors.border,
              backgroundColor: colors.card,
              padding: 14,
              marginBottom: 16,
            }}
          >
            <View style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: colors.muted, alignItems: 'center', justifyContent: 'center' }}>
              <MonitorSmartphone size={18} color={colors.foreground} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={{ fontSize: 15, fontWeight: '600' }}>跟随系统</Text>
              <Text variant="muted" style={{ fontSize: 12, marginTop: 1 }}>自动切换浅色 / 深色</Text>
            </View>
            {systemActive && (
              <View style={{ width: 20, height: 20, borderRadius: 10, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center' }}>
                <Check size={12} color={colors.primaryForeground} strokeWidth={3} />
              </View>
            )}
          </AnimatedPressable>
        </FadeInView>

        {/* 主题网格 */}
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', rowGap: 14 }}>
          {paletteOrder.map((id, i) => (
            <ThemeCard key={id} palette={palettes[id]} index={i + 1} />
          ))}
        </View>

        <Text variant="muted" style={{ fontSize: 12, textAlign: 'center', marginTop: 20, lineHeight: 18 }}>
          主题偏好保存在本机;登录后同步到账号,与网页端共享
        </Text>
      </View>
    </Screen>
  );
}

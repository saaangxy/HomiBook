import { Modal, Pressable, StyleSheet, View } from 'react-native';
import Animated, { FadeIn, FadeInDown } from 'react-native-reanimated';
import { Check } from 'lucide-react-native';
import { useTheme, alpha, motion } from '@/theme';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Text } from '@/components/ui/Text';
import { AnimatedPressable } from '@/components/AnimatedPressable';
import { useUIShell } from './chrome';

// 账本切换弹窗(居中卡片,当前账本橙描边高亮)
export function LedgerModal() {
  const { colors } = useTheme();
  const { ledgerOpen, closeLedger, ledgers, currentLedger, switchLedger } = useUIShell();
  const insets = useSafeAreaInsets();

  return (
    <Modal visible={ledgerOpen} transparent animationType="none" onRequestClose={closeLedger}>
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
        <Animated.View entering={FadeIn.duration(180)} style={StyleSheet.absoluteFill}>
          <Pressable style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.5)' }} onPress={closeLedger} />
        </Animated.View>
        <Animated.View
          entering={FadeInDown.duration(motion.duration.base).easing(motion.easing)}
          style={{
            width: '82%',
            backgroundColor: colors.card,
            borderRadius: 24,
            padding: 20,
            paddingBottom: Math.max(insets.bottom, 20),
            shadowColor: '#0f172a',
            shadowOpacity: 0.12,
            shadowRadius: 24,
            shadowOffset: { width: 0, height: 12 },
            elevation: 12,
          }}
        >
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
            <Text style={{ fontSize: 18, fontWeight: '700' }}>切换账本</Text>
            <Pressable onPress={closeLedger} style={{ width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.muted }}>
              <Text style={{ color: colors.mutedForeground, fontSize: 15 }}>✕</Text>
            </Pressable>
          </View>

          {ledgers.map((l) => {
            const active = l.id === currentLedger.id;
            return (
              <AnimatedPressable
                key={l.id}
                onPress={() => switchLedger(l.id)}
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  paddingVertical: 14,
                  paddingHorizontal: 12,
                  borderRadius: 16,
                  marginBottom: 10,
                  backgroundColor: active ? alpha(colors.primary, 0.08) : colors.muted,
                  borderWidth: 2,
                  borderColor: active ? colors.primary : 'transparent',
                }}
              >
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                  <Text style={{ fontSize: 15, fontWeight: '600' }}>{l.name}</Text>
                </View>
                {active ? <Check size={18} color={colors.primary} /> : null}
              </AnimatedPressable>
            );
          })}
        </Animated.View>
      </View>
    </Modal>
  );
}
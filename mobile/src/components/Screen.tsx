import { type ReactNode } from 'react';
import { View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { KeyboardAvoidingView, Platform, ScrollView } from 'react-native';
import { useTheme } from '@/theme';

interface ScreenProps {
  children: ReactNode;
  /** 是否可滚动 */
  scroll?: boolean;
  /** 是否用键盘避让(表单页) */
  keyboard?: boolean;
}

// 主题背景 + 安全区 + 可选滚动/键盘避让
export function Screen({ children, scroll = false, keyboard = false }: ScreenProps) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      {keyboard ? (
        <KeyboardAvoidingView
          style={{ flex: 1 }}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        >
          {scroll ? (
            <ScrollView
              contentContainerStyle={{ paddingBottom: Math.max(insets.bottom, 24) }}
              keyboardShouldPersistTaps="handled"
              showsVerticalScrollIndicator={false}
            >
              {children}
            </ScrollView>
          ) : (
            children
          )}
        </KeyboardAvoidingView>
      ) : scroll ? (
        <ScrollView
          contentContainerStyle={{ paddingBottom: Math.max(insets.bottom, 24) }}
          showsVerticalScrollIndicator={false}
        >
          {children}
        </ScrollView>
      ) : (
        children
      )}
    </View>
  );
}
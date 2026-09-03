import { type ReactNode } from 'react';
import { View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { KeyboardAvoidingView, Platform, RefreshControl, ScrollView } from 'react-native';
import { useTheme, ThemeBackdrop } from '@/theme';

interface ScreenProps {
  children: ReactNode;
  /** 是否可滚动 */
  scroll?: boolean;
  /** 是否用键盘避让(表单页) */
  keyboard?: boolean;
  /** 下拉刷新中 */
  refreshing?: boolean;
  /** 下拉刷新回调(提供则启用 RefreshControl) */
  onRefresh?: () => void;
}

// 主题背景 + 安全区 + 可选滚动/键盘避让 + 可选下拉刷新
export function Screen({ children, scroll = false, keyboard = false, refreshing, onRefresh }: ScreenProps) {
  const { colors, palette } = useTheme();
  const insets = useSafeAreaInsets();
  const refreshControl =
    scroll && onRefresh ? (
      <RefreshControl refreshing={!!refreshing} onRefresh={onRefresh} tintColor={colors.primary} colors={[colors.primary]} />
    ) : undefined;

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      {/* 主题背景纹理(静态装饰,内容之下) */}
      <ThemeBackdrop palette={palette} />
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
              refreshControl={refreshControl}
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
          refreshControl={refreshControl}
        >
          {children}
        </ScrollView>
      ) : (
        children
      )}
    </View>
  );
}
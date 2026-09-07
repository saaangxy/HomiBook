import '@/global.css';
// 全局错误兜底(副作用模块):未处理 rejection / 致命异常的分级提示,须在应用代码前加载
import '@/lib/global-error';
import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider, initialWindowMetrics } from 'react-native-safe-area-context';
import { Stack } from 'expo-router/stack';
import { StatusBar } from 'expo-status-bar';
import { AlertTriangle, RefreshCw } from 'lucide-react-native';
import { Text } from '@/components/ui/Text';
import { useFonts } from 'expo-font';
import { CrimsonText_400Regular, CrimsonText_600SemiBold, CrimsonText_700Bold } from '@expo-google-fonts/crimson-text';
import { JetBrainsMono_400Regular, JetBrainsMono_500Medium, JetBrainsMono_700Bold } from '@expo-google-fonts/jetbrains-mono';
import { CormorantGaramond_400Regular, CormorantGaramond_500Medium, CormorantGaramond_600SemiBold } from '@expo-google-fonts/cormorant-garamond';
import { Fredoka_400Regular, Fredoka_500Medium, Fredoka_600SemiBold } from '@expo-google-fonts/fredoka';
import { BebasNeue_400Regular } from '@expo-google-fonts/bebas-neue';
import { DMSans_400Regular, DMSans_500Medium, DMSans_700Bold } from '@expo-google-fonts/dm-sans';
import { ThemeProvider, useTheme, getActivePalette, alpha } from '@/theme';
import { AuthProvider, useAuth } from '@/stores/auth';
import { LedgerProvider } from '@/stores/ledger';
import { RecordsProvider } from '@/stores/records';
import { UIShellProvider } from '@/components/chrome/chrome';
import { Sidebar } from '@/components/chrome/Sidebar';
import { LedgerModal } from '@/components/chrome/LedgerModal';
import { RecordModal } from '@/components/chrome/RecordModal';
import { AIAssistantModal } from '@/components/chrome/AIAssistantModal';
import { ToastHost } from '@/components/chrome/Toast';
import { Splash } from '@/components/Splash';

function RootNavigator() {
  const { isLoggedIn } = useAuth();
  const { isDark } = useTheme();

  return (
    <>
      <StatusBar style={isDark ? 'light' : 'dark'} />
      <Stack screenOptions={{ headerShown: false }}>
        <Stack.Protected guard={!isLoggedIn}>
          <Stack.Screen name="(auth)" />
        </Stack.Protected>
        <Stack.Protected guard={isLoggedIn}>
          <Stack.Screen name="(tabs)" />
        </Stack.Protected>
        <Stack.Screen name="server" options={{ presentation: 'modal' }} />
      </Stack>
    </>
  );
}

export default function RootLayout() {
  // Web 端:允许手动设置 colorScheme(darkMode 需为 'class',否则 react-native-css-interop 抛错)
  if (typeof globalThis.window !== 'undefined') {
    (StyleSheet as any).setFlag?.('darkMode', 'class');
  }
  // 主题拉丁字体全量预加载(中文走系统字体回退);加载完成前不渲染,避免闪字
  const [fontsLoaded] = useFonts({
    CrimsonText_400Regular, CrimsonText_600SemiBold, CrimsonText_700Bold,
    JetBrainsMono_400Regular, JetBrainsMono_500Medium, JetBrainsMono_700Bold,
    CormorantGaramond_400Regular, CormorantGaramond_500Medium, CormorantGaramond_600SemiBold,
    Fredoka_400Regular, Fredoka_500Medium, Fredoka_600SemiBold,
    BebasNeue_400Regular,
    DMSans_400Regular, DMSans_500Medium, DMSans_700Bold,
  });

  // 开屏展示控制:字体就绪后展示 logo,淡出完成后由 Splash 回调卸载
  const [showSplash, setShowSplash] = useState(true);

  if (!fontsLoaded) return null;

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      {/* SafeAreaProvider 需置于最外层,initialWindowMetrics 保证首帧即拿到正确 insets,避免内容覆盖状态栏/底部导航 */}
      <SafeAreaProvider initialMetrics={initialWindowMetrics}>
        <ThemeProvider>
          <AuthProvider>
            <LedgerProvider>
              <UIShellProvider>
              <RecordsProvider>
                <RootNavigator />
                {/* 全局覆盖层(置于 RecordsProvider 内,可同时访问 UIShell 与 Records) */}
                <Sidebar />
                <LedgerModal />
                <RecordModal />
                <AIAssistantModal />
                <ToastHost />
                {showSplash && <Splash onDone={() => setShowSplash(false)} />}
              </RecordsProvider>
              </UIShellProvider>
            </LedgerProvider>
          </AuthProvider>
        </ThemeProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

// ── 路由渲染异常兜底(expo-router 内置机制):页面崩溃时展示重试/重载,替代白屏 ──
// 不在 ThemeProvider 子树内(路由级渲染),色值经 getActivePalette 快照读取
export function ErrorBoundary({ error, retry }: { error: Error; retry: () => void }) {
  const c = getActivePalette().colors;
  return (
    <View style={[StyleSheet.absoluteFill, { backgroundColor: c.background, alignItems: 'center', paddingTop: 120 }]}>
      <View style={{ width: 64, height: 64, borderRadius: 32, backgroundColor: alpha(c.destructive, 0.12), alignItems: 'center', justifyContent: 'center', marginBottom: 16 }}>
        <AlertTriangle size={30} color={c.destructive} />
      </View>
      {/* eslint-disable-next-line react/no-unescaped-entities */}
      <Text style={{ fontSize: 17, fontWeight: '700', color: c.foreground }}>页面出现异常</Text>
      <Text numberOfLines={4} style={{ fontSize: 12, color: c.mutedForeground, textAlign: 'center', marginTop: 6, lineHeight: 18, paddingHorizontal: 8 }}>
        {error?.message || '未知错误'}
      </Text>
      <Pressable
        onPress={retry}
        style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 22, paddingHorizontal: 22, height: 44, borderRadius: 12, backgroundColor: c.foreground }}
      >
        <RefreshCw size={15} color={c.background} />
        <Text style={{ fontSize: 14, fontWeight: '600', color: c.background }}>重试</Text>
      </Pressable>
    </View>
  );
}

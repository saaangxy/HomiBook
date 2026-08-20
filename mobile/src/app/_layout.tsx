import '@/global.css';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { Stack } from 'expo-router/stack';
import { StatusBar } from 'expo-status-bar';
import { useFonts } from 'expo-font';
import { CrimsonText_400Regular, CrimsonText_600SemiBold, CrimsonText_700Bold } from '@expo-google-fonts/crimson-text';
import { JetBrainsMono_400Regular, JetBrainsMono_500Medium, JetBrainsMono_700Bold } from '@expo-google-fonts/jetbrains-mono';
import { CormorantGaramond_400Regular, CormorantGaramond_500Medium, CormorantGaramond_600SemiBold } from '@expo-google-fonts/cormorant-garamond';
import { Fredoka_400Regular, Fredoka_500Medium, Fredoka_600SemiBold } from '@expo-google-fonts/fredoka';
import { BebasNeue_400Regular } from '@expo-google-fonts/bebas-neue';
import { DMSans_400Regular, DMSans_500Medium, DMSans_700Bold } from '@expo-google-fonts/dm-sans';
import { ThemeProvider, useTheme } from '@/theme';
import { AuthProvider, useAuth } from '@/stores/auth';
import { RecordsProvider } from '@/stores/records';
import { UIShellProvider } from '@/components/chrome/chrome';

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
  // 主题拉丁字体全量预加载(中文走系统字体回退);加载完成前不渲染,避免闪字
  const [fontsLoaded] = useFonts({
    CrimsonText_400Regular, CrimsonText_600SemiBold, CrimsonText_700Bold,
    JetBrainsMono_400Regular, JetBrainsMono_500Medium, JetBrainsMono_700Bold,
    CormorantGaramond_400Regular, CormorantGaramond_500Medium, CormorantGaramond_600SemiBold,
    Fredoka_400Regular, Fredoka_500Medium, Fredoka_600SemiBold,
    BebasNeue_400Regular,
    DMSans_400Regular, DMSans_500Medium, DMSans_700Bold,
  });

  if (!fontsLoaded) return null;

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <ThemeProvider>
        <AuthProvider>
          <RecordsProvider>
            <UIShellProvider>
              <RootNavigator />
            </UIShellProvider>
          </RecordsProvider>
        </AuthProvider>
      </ThemeProvider>
    </GestureHandlerRootView>
  );
}

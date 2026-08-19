import '@/global.css';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { Stack } from 'expo-router/stack';
import { StatusBar } from 'expo-status-bar';
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
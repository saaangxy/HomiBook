import '@/global.css';
import { Stack } from 'expo-router/stack';
import { StatusBar } from 'expo-status-bar';
import { ThemeProvider, useTheme } from '@/theme';
import { AuthProvider, useAuth } from '@/stores/auth';

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
        <Stack.Screen name="add-record" options={{ presentation: 'modal' }} />
        <Stack.Screen name="server" options={{ presentation: 'modal' }} />
      </Stack>
    </>
  );
}

export default function RootLayout() {
  return (
    <ThemeProvider>
      <AuthProvider>
        <RootNavigator />
      </AuthProvider>
    </ThemeProvider>
  );
}
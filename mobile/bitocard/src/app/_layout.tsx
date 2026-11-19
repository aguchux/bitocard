import { Inter_400Regular, Inter_600SemiBold, Inter_700Bold, Inter_800ExtraBold, useFonts } from '@expo-google-fonts/inter';
import NetInfo from '@react-native-community/netinfo';
import { focusManager, onlineManager, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { DarkTheme, DefaultTheme, Stack, ThemeProvider } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { useEffect } from 'react';
import { AppState, Platform, useColorScheme } from 'react-native';

import { inter, useTheme } from '@/components/ui';
import { AccountProvider } from '@/lib/account';

SplashScreen.preventAutoHideAsync();

// React Query follows the phone: data is read again when the app comes back to the front, and anything that failed
// for want of a connection is retried once it returns.
onlineManager.setEventListener(setOnline => NetInfo.addEventListener(state => setOnline(Boolean(state.isConnected))));
if (Platform.OS !== 'web') {
  focusManager.setEventListener(setFocused => {
    const subscription = AppState.addEventListener('change', status => setFocused(status === 'active'));
    return () => subscription.remove();
  });
}

/** Server data is shown from the cache at once and refreshed in the background. */
const queryClient = new QueryClient({ defaultOptions: { queries: { staleTime: 30_000, gcTime: 5 * 60_000, retry: 1 } } });

export default function RootLayout() {
  const [fontsLoaded, fontError] = useFonts({ Inter_400Regular, Inter_600SemiBold, Inter_700Bold, Inter_800ExtraBold });
  const ready = fontsLoaded || Boolean(fontError);

  useEffect(() => {
    if (ready) SplashScreen.hideAsync();
  }, [ready]);

  if (!ready) return null;
  return (
    <QueryClientProvider client={queryClient}>
      <AccountProvider>
        <ThemedApp />
      </AccountProvider>
    </QueryClientProvider>
  );
}

/** Navigation in BitoCard's colours, then the screens. */
function ThemedApp() {
  const dark = useColorScheme() === 'dark';
  const base = dark ? DarkTheme : DefaultTheme;
  const theme = useTheme();
  return (
    <ThemeProvider value={{ ...base, colors: { ...base.colors, primary: theme.pinkText, background: theme.background, card: theme.card, text: theme.text, border: theme.line } }}>
      <Stack
        screenOptions={{
          headerTintColor: theme.text,
          headerTitleStyle: { fontFamily: inter.bold, color: theme.text },
          headerBackButtonDisplayMode: 'minimal',
          contentStyle: { backgroundColor: theme.background },
        }}>
        <Stack.Screen name="(tabs)" options={{ headerShown: false, title: 'BitoCard' }} />
        <Stack.Screen name="welcome" options={{ headerShown: false }} />
        <Stack.Screen name="signin" options={{ title: 'Sign in' }} />
        <Stack.Screen name="signup" options={{ title: 'Create your account' }} />
        <Stack.Screen name="verify" options={{ title: 'Confirm your email', gestureEnabled: false }} />
        <Stack.Screen name="account" options={{ title: 'Your account' }} />
        <Stack.Screen name="pay" options={{ title: 'Confirm payment', presentation: 'modal' }} />
        <Stack.Screen name="order/[id]" options={{ title: 'Order' }} />
        <Stack.Screen name="add-funds" options={{ title: 'Add funds' }} />
        <Stack.Screen name="move-money" options={{ title: 'Move money' }} />
        <Stack.Screen name="account-number" options={{ title: 'Your account number' }} />
        <Stack.Screen name="bank-deposit/index" options={{ title: 'Bank deposit' }} />
        <Stack.Screen name="bank-deposit/[id]" options={{ title: 'Bank deposit' }} />
      </Stack>
    </ThemeProvider>
  );
}

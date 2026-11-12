import { Inter_400Regular, Inter_600SemiBold, Inter_700Bold, Inter_800ExtraBold, useFonts } from '@expo-google-fonts/inter';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import * as Notifications from 'expo-notifications';
import { DarkTheme, DefaultTheme, Stack, ThemeProvider } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { useEffect } from 'react';
import { useColorScheme } from 'react-native';

import { UpdateGate } from '@/components/update-gate';
import { inter } from '@/components/themed-text';
import { useTheme } from '@/hooks/use-theme';
import { AccountProvider, useAccount } from '@/lib/account';
import { MarketProvider } from '@/lib/market';
import { openLink } from '@/lib/navigate';
import { noticeLink, registerPush } from '@/lib/push';

SplashScreen.preventAutoHideAsync();

/** Server data is shown from the cache at once and refreshed in the background, as on the consoles. */
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
        <MarketProvider>
          <ThemedApp />
        </MarketProvider>
      </AccountProvider>
    </QueryClientProvider>
  );
}

/** Navigation in Udozo's colours (the admins' published theme on light), then the update check, then the screens. */
function ThemedApp() {
  const dark = useColorScheme() === 'dark';
  const base = dark ? DarkTheme : DefaultTheme;
  const colors = useTheme();
  usePushWiring();
  return (
    <ThemeProvider
      value={{
        ...base,
        colors: { ...base.colors, primary: colors.primary, background: colors.background, card: colors.background, text: colors.text, border: colors.line },
      }}>
      <UpdateGate>
        <Stack
          screenOptions={{
            headerTintColor: colors.primary,
            headerTitleStyle: { fontFamily: inter.bold, color: colors.text },
            headerBackButtonDisplayMode: 'minimal',
            contentStyle: { backgroundColor: colors.background },
          }}>
          <Stack.Screen name="(tabs)" options={{ headerShown: false, title: 'Udozo' }} />
          <Stack.Screen name="signin" options={{ title: 'Sign in', presentation: 'modal' }} />
          <Stack.Screen name="signup" options={{ title: 'Create an account', presentation: 'modal' }} />
          <Stack.Screen name="verify" options={{ title: 'Finish your account', gestureEnabled: false }} />
          <Stack.Screen name="listing/[ref]" options={{ title: '' }} />
          <Stack.Screen name="chat/[id]" options={{ title: 'Chat' }} />
          <Stack.Screen name="saved" options={{ title: 'Saved' }} />
          <Stack.Screen name="notifications" options={{ title: 'Notifications' }} />
          <Stack.Screen name="settings" options={{ title: 'Settings' }} />
          <Stack.Screen name="delete-account" options={{ title: 'Delete your account' }} />
        </Stack>
      </UpdateGate>
    </ThemeProvider>
  );
}

/**
 * Push on this phone: registered again each time the app opens signed in (keeping the token fresh), and a tapped
 * notification opens what it is about (its `link`, a udozo.com path, through the app's own screens).
 */
function usePushWiring() {
  const { customer } = useAccount();
  const signedIn = Boolean(customer);
  useEffect(() => {
    if (signedIn) registerPush({ ask: false }).catch(() => undefined);
  }, [signedIn]);
  useEffect(() => {
    Notifications.getLastNotificationResponseAsync().then(response => {
      const link = response ? noticeLink(response) : null;
      if (link) openLink(link);
    });
    const subscription = Notifications.addNotificationResponseReceivedListener(response => {
      const link = noticeLink(response);
      if (link) openLink(link);
    });
    return () => subscription.remove();
  }, []);
}

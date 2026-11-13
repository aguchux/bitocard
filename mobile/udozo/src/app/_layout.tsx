import { Inter_400Regular, Inter_600SemiBold, Inter_700Bold, Inter_800ExtraBold, useFonts } from '@expo-google-fonts/inter';
import NetInfo from '@react-native-community/netinfo';
import { focusManager, onlineManager, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import * as Notifications from 'expo-notifications';
import { DarkTheme, DefaultTheme, Stack, ThemeProvider } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { useEffect } from 'react';
import { AppState, Platform, useColorScheme } from 'react-native';

import { UpdateGate } from '@/components/update-gate';
import { inter } from '@/components/themed-text';
import { useTheme } from '@/hooks/use-theme';
import { AccountProvider, useAccount } from '@/lib/account';
import { MarketProvider } from '@/lib/market';
import { openLink } from '@/lib/navigate';
import { noticeLink, registerPush } from '@/lib/push';

SplashScreen.preventAutoHideAsync();

// React Query follows the phone: data is read again when the app comes back to the front, polling (chats, WhatsApp
// sign-in) stops while it is in the background, and anything that failed for want of a connection is retried once it
// returns.
onlineManager.setEventListener(setOnline => NetInfo.addEventListener(state => setOnline(Boolean(state.isConnected))));
if (Platform.OS !== 'web') {
  focusManager.setEventListener(setFocused => {
    const subscription = AppState.addEventListener('change', status => setFocused(status === 'active'));
    return () => subscription.remove();
  });
}

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
          <Stack.Screen name="assistant" options={{ title: 'Ask Anjio' }} />
          <Stack.Screen name="saved" options={{ title: 'Saved' }} />
          <Stack.Screen name="notifications" options={{ title: 'Notifications' }} />
          <Stack.Screen name="settings" options={{ title: 'Settings' }} />
          <Stack.Screen name="delete-account" options={{ title: 'Delete your account' }} />
          <Stack.Screen name="post/[id]" options={{ title: 'Post an ad' }} />
          <Stack.Screen name="my-listings" options={{ title: 'My listings' }} />
          <Stack.Screen name="requests" options={{ title: 'Requests' }} />
          <Stack.Screen name="dashboard" options={{ title: 'Dashboard' }} />
          <Stack.Screen name="username" options={{ title: 'Username' }} />
          <Stack.Screen name="wallet" options={{ title: 'Wallet' }} />
          <Stack.Screen name="payouts" options={{ title: 'Payouts' }} />
          <Stack.Screen name="identity" options={{ title: 'Identity check' }} />
          <Stack.Screen name="orders" options={{ title: 'UdozoPay orders' }} />
          <Stack.Screen name="order/[id]" options={{ title: 'Order' }} />
          <Stack.Screen name="checkout/[id]" options={{ title: 'Buy with UdozoPay' }} />
          <Stack.Screen name="buy-orders" options={{ title: 'Buy orders' }} />
          <Stack.Screen name="buy-order/[id]" options={{ title: 'Buy order' }} />
          <Stack.Screen name="resellers" options={{ title: 'My Resellers' }} />
          <Stack.Screen name="reseller/[id]" options={{ title: 'Reseller' }} />
          <Stack.Screen name="pay/[token]" options={{ title: 'Pay the shop' }} />
          <Stack.Screen name="scan" options={{ title: 'Scan to pay', presentation: 'modal' }} />
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
    // The tap that opened the app can arrive both as the last response and through the listener: open it once.
    const opened = new Set<string>();
    const open = (response: Notifications.NotificationResponse | null) => {
      if (!response) return;
      const id = response.notification.request.identifier;
      if (opened.has(id)) return;
      opened.add(id);
      Notifications.clearLastNotificationResponse();
      const link = noticeLink(response);
      // After the first frame, so the stack it pushes onto is there.
      if (link) setTimeout(() => openLink(link), 0);
    };
    open(Notifications.getLastNotificationResponse());
    const subscription = Notifications.addNotificationResponseReceivedListener(open);
    return () => subscription.remove();
  }, []);
}

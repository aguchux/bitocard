import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { DarkTheme, DefaultTheme, ThemeProvider } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { useEffect } from 'react';
import { useColorScheme } from 'react-native';

import AppTabs from '@/components/app-tabs';
import { UpdateGate } from '@/components/update-gate';
import { useTheme } from '@/hooks/use-theme';

SplashScreen.preventAutoHideAsync();

/** Server data is shown from the cache at once and refreshed in the background, as on the consoles. */
const queryClient = new QueryClient({ defaultOptions: { queries: { staleTime: 30_000, gcTime: 5 * 60_000 } } });

export default function RootLayout() {
  useEffect(() => {
    SplashScreen.hideAsync();
  }, []);

  return (
    <QueryClientProvider client={queryClient}>
      <ThemedApp />
    </QueryClientProvider>
  );
}

/** Navigation in Udozo's colours (the admins' published theme on light), then the update check, then the tabs. */
function ThemedApp() {
  const dark = useColorScheme() === 'dark';
  const base = dark ? DarkTheme : DefaultTheme;
  const colors = useTheme();
  return (
    <ThemeProvider
      value={{
        ...base,
        colors: { ...base.colors, primary: colors.primary, background: colors.background, card: colors.background, text: colors.text, border: colors.line },
      }}>
      <UpdateGate>
        <AppTabs />
      </UpdateGate>
    </ThemeProvider>
  );
}

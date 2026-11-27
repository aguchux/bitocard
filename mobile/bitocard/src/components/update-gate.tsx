import { useQuery } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { Image, Linking, Platform, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Button, T, useTheme } from '@/components/ui';
import { api } from '@/lib/api';
import { appVersion } from '@/lib/config';
import type { AppConfig } from '@/lib/types';

const platform = Platform.OS === 'ios' ? 'ios' : 'android';

export const fetchAppConfig = () => api<AppConfig>(`/v1/app/config?platform=${platform}&version=${encodeURIComponent(appVersion)}`);

/**
 * Asks the API whether this version is still supported (`GET /v1/app/config`). Any update response blocks the app until
 * the store version is installed. Treating the old `available` response as mandatory also protects against API rollback.
 * The network failing never blocks the app.
 */
export function UpdateGate({ children }: { children: ReactNode }) {
  const theme = useTheme();
  const { data } = useQuery({ queryKey: ['app-config'], queryFn: fetchAppConfig, staleTime: 60_000, retry: 1, refetchOnWindowFocus: 'always' });
  const storeUrl = data?.store_url ?? null;
  const open = () => void (storeUrl && Linking.openURL(storeUrl));

  if (data?.update === 'required' || data?.update === 'available') {
    return (
      <SafeAreaView style={[styles.blocked, { backgroundColor: theme.background }]}>
        <Image source={require('@/assets/images/mark.png')} style={styles.mark} accessibilityIgnoresInvertColors />
        <T kind="title" style={styles.centre} accessibilityRole="header">
          Update BitoCard
        </T>
        <T muted style={styles.centre}>
          This version of the app is no longer supported. Update it to keep buying and selling.
        </T>
        {storeUrl ? <Button label="Update the app" onPress={open} /> : null}
      </SafeAreaView>
    );
  }

  return children;
}

const styles = StyleSheet.create({
  blocked: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24, gap: 16 },
  mark: { width: 72, height: 72, resizeMode: 'contain' },
  centre: { textAlign: 'center' },
});

import { useQuery } from '@tanstack/react-query';
import { useState, type ReactNode } from 'react';
import { Image, Linking, Platform, Pressable, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Button, T, useTheme } from '@/components/ui';
import { api } from '@/lib/api';
import { appVersion } from '@/lib/config';
import type { AppConfig } from '@/lib/types';

const platform = Platform.OS === 'ios' ? 'ios' : 'android';

export const fetchAppConfig = () => api<AppConfig>(`/v1/app/config?platform=${platform}&version=${encodeURIComponent(appVersion)}`);

/**
 * Asks the API whether this version is still supported (`GET /v1/app/config`). Below the minimum, nothing else is shown
 * until the app is updated; below the latest, a bar offers the update. The network failing never blocks the app.
 */
export function UpdateGate({ children }: { children: ReactNode }) {
  const theme = useTheme();
  const [dismissed, setDismissed] = useState(false);
  const { data } = useQuery({ queryKey: ['app-config'], queryFn: fetchAppConfig, staleTime: 60 * 60_000, retry: 1 });
  const storeUrl = data?.store_url ?? null;
  const open = () => void (storeUrl && Linking.openURL(storeUrl));

  if (data?.update === 'required') {
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

  return (
    <View style={styles.fill}>
      {children}
      {data?.update === 'available' && storeUrl && !dismissed ? (
        <SafeAreaView edges={['top']} style={[styles.bar, { backgroundColor: theme.navy }]}>
          <T kind="small" color="#ffffff" style={{ flex: 1 }}>
            A new version of BitoCard is ready.
          </T>
          <Pressable accessibilityRole="button" onPress={open} hitSlop={8}>
            <T kind="label" color="#ffffff">
              Update
            </T>
          </Pressable>
          <Pressable accessibilityRole="button" onPress={() => setDismissed(true)} hitSlop={8}>
            <T kind="small" color="#ffffff">
              Not now
            </T>
          </Pressable>
        </SafeAreaView>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  blocked: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24, gap: 16 },
  mark: { width: 72, height: 72, resizeMode: 'contain' },
  centre: { textAlign: 'center' },
  bar: { position: 'absolute', top: 0, left: 0, right: 0, flexDirection: 'row', alignItems: 'center', gap: 16, paddingHorizontal: 16, paddingBottom: 8 },
});

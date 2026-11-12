import { useQuery } from '@tanstack/react-query';
import { useState, type ReactNode } from 'react';
import { Linking, Pressable, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Image } from 'expo-image';

import { ThemedText } from '@/components/themed-text';
import { Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { fetchAppConfig } from '@/lib/app-config';

/**
 * Asks the API whether this version is still supported (`GET /v1/app/config`). Below the minimum, nothing else is
 * shown until the app is updated; below the latest, a bar offers the update. The network failing never blocks the
 * app: it simply carries on.
 */
export function UpdateGate({ children }: { children: ReactNode }) {
  const theme = useTheme();
  const [dismissed, setDismissed] = useState(false);
  const { data } = useQuery({ queryKey: ['app-config'], queryFn: fetchAppConfig, staleTime: 60 * 60_000, retry: 1 });
  const storeUrl = data?.store_url ?? null;
  const open = () => storeUrl && Linking.openURL(storeUrl);

  if (data?.update === 'required') {
    return (
      <SafeAreaView style={[styles.blocked, { backgroundColor: theme.background }]}>
        <Image source={require('@/assets/images/mark.png')} style={styles.mark} accessibilityIgnoresInvertColors />
        <ThemedText type="subtitle" style={styles.centre}>
          Update Udozo
        </ThemedText>
        <ThemedText style={[styles.centre, { color: theme.textSecondary }]}>
          This version of the app is no longer supported. Update it to keep buying and selling.
        </ThemedText>
        {storeUrl ? (
          <Pressable accessibilityRole="button" onPress={open} style={[styles.button, { backgroundColor: theme.primary }]}>
            <ThemedText style={{ color: theme.onPrimary, fontWeight: 700 }}>Update the app</ThemedText>
          </Pressable>
        ) : null}
      </SafeAreaView>
    );
  }

  return (
    <View style={styles.fill}>
      {children}
      {data?.update === 'available' && storeUrl && !dismissed ? (
        <SafeAreaView edges={['top']} style={[styles.bar, { backgroundColor: theme.primary }]}>
          <ThemedText style={[styles.barText, { color: theme.onPrimary }]}>A new version of Udozo is ready.</ThemedText>
          <Pressable accessibilityRole="button" onPress={open} hitSlop={8}>
            <ThemedText style={{ color: theme.onPrimary, fontWeight: 700 }}>Update</ThemedText>
          </Pressable>
          <Pressable accessibilityRole="button" accessibilityLabel="Not now" onPress={() => setDismissed(true)} hitSlop={8}>
            <ThemedText style={{ color: theme.onPrimary }}>Not now</ThemedText>
          </Pressable>
        </SafeAreaView>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  blocked: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: Spacing.four, gap: Spacing.three },
  mark: { width: 72, height: 72 },
  centre: { textAlign: 'center' },
  button: { marginTop: Spacing.two, paddingVertical: Spacing.three, paddingHorizontal: Spacing.five, borderRadius: Radius.medium },
  bar: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    paddingHorizontal: Spacing.three,
    paddingBottom: Spacing.two,
  },
  barText: { flex: 1, fontSize: 14 },
});

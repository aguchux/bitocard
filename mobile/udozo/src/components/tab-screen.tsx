import { Image } from 'expo-image';
import type { ReactNode } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { BottomTabInset, MaxContentWidth, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

/** A tab's page: its title, then its content, clear of the notch and the tab bar. */
export function TabScreen({ title, children }: { title: string; children?: ReactNode }) {
  const theme = useTheme();
  return (
    <SafeAreaView edges={['top']} style={[styles.fill, { backgroundColor: theme.background }]}>
      <ScrollView contentContainerStyle={styles.content} contentInsetAdjustmentBehavior="automatic">
        <View style={styles.header}>
          <ThemedText type="subtitle" accessibilityRole="header">
            {title}
          </ThemedText>
        </View>
        {children}
      </ScrollView>
    </SafeAreaView>
  );
}

/** What a tab will hold, until its phase is built (internal test builds only). */
export function ComingNext({ text }: { text: string }) {
  const theme = useTheme();
  return (
    <View style={[styles.card, { backgroundColor: theme.backgroundElement }]}>
      <Image
        source={require('@/assets/images/mark.png')}
        style={styles.mark}
        accessibilityLabel="Udozo"
        accessibilityIgnoresInvertColors
      />
      <ThemedText style={{ color: theme.textSecondary }}>{text}</ThemedText>
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  content: { padding: Spacing.three, paddingBottom: BottomTabInset + Spacing.four, gap: Spacing.three, maxWidth: MaxContentWidth, width: '100%', alignSelf: 'center' },
  header: { paddingVertical: Spacing.two },
  card: { borderRadius: 12, padding: Spacing.four, gap: Spacing.three, alignItems: 'flex-start' },
  mark: { width: 40, height: 40 },
});

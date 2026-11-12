import { ChevronRight, ExternalLink } from 'lucide-react-native';
import type { ReactNode } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

/** A row of a list of places (Me, Settings): its icon, words, an optional count, and where it goes. */
export function MenuRow({ icon, title, detail, count, onPress, external, danger }: { icon: ReactNode; title: string; detail?: string; count?: number; onPress: () => void; external?: boolean; danger?: boolean }) {
  const theme = useTheme();
  return (
    <Pressable
      accessibilityRole={external ? 'link' : 'button'}
      accessibilityLabel={[title, detail, count ? `${count} new` : null, external ? 'opens udozo.com' : null].filter(Boolean).join(', ')}
      onPress={onPress}
      style={({ pressed }) => [styles.row, { borderColor: theme.line, opacity: pressed ? 0.7 : 1 }]}>
      {icon}
      <View style={{ flex: 1 }}>
        <ThemedText style={danger ? { color: theme.danger } : undefined}>{title}</ThemedText>
        {detail ? <ThemedText type="caption">{detail}</ThemedText> : null}
      </View>
      {count ? (
        <View style={[styles.count, { backgroundColor: theme.primary }]}>
          <ThemedText type="caption" style={{ color: theme.onPrimary }}>
            {count}
          </ThemedText>
        </View>
      ) : null}
      {external ? <ExternalLink size={16} color={theme.textSecondary} /> : <ChevronRight size={18} color={theme.textSecondary} />}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: { minHeight: 56, flexDirection: 'row', alignItems: 'center', gap: Spacing.three, borderBottomWidth: StyleSheet.hairlineWidth, paddingVertical: Spacing.two },
  count: { minWidth: 22, height: 22, borderRadius: 11, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 6 },
});

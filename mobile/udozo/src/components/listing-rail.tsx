import type { HomeCard } from '@shared/home';
import { ArrowRight } from 'lucide-react-native';
import { FlatList, Pressable, StyleSheet, View } from 'react-native';

import { ListingCard } from '@/components/listing-card';
import { ThemedText } from '@/components/themed-text';
import { Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

/** How wide a card is on a rail. */
export const railCardWidth = 160;

/**
 * Listings sliding sideways, each card its fixed width and its own height: the row lines them up at the top, so a short
 * card never stretches to the tallest one, nor any card down the screen. A rail holds a fixed few; with `seeAll` its
 * last card opens the rest, where the heading's See all goes.
 */
export function ListingRail({ items, testID, seeAll }: { items: HomeCard[]; testID?: string; seeAll?: { label: string; onPress: () => void } }) {
  return (
    <FlatList
      horizontal
      testID={testID}
      data={items}
      keyExtractor={item => item.id}
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={styles.rail}
      renderItem={({ item }) => <ListingCard listing={item} width={railCardWidth} />}
      ListFooterComponent={seeAll ? <SeeAllCard label={seeAll.label} onPress={seeAll.onPress} testID={testID ? `${testID}-see-all` : undefined} /> : undefined}
    />
  );
}

/** The rail's last card: See all, the size of a listing's photo. */
function SeeAllCard({ label, onPress, testID }: { label: string; onPress: () => void; testID?: string }) {
  const theme = useTheme();
  return (
    <Pressable
      testID={testID}
      accessibilityRole="link"
      accessibilityLabel={`See all: ${label}`}
      onPress={onPress}
      style={({ pressed }) => [styles.card, { backgroundColor: theme.backgroundElement, borderColor: theme.line, opacity: pressed ? 0.85 : 1 }]}>
      <View style={[styles.circle, { backgroundColor: theme.primary }]}>
        <ArrowRight color={theme.onPrimary} size={22} />
      </View>
      <ThemedText type="smallBold">See all</ThemedText>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  rail: { paddingHorizontal: Spacing.three, gap: Spacing.three, alignItems: 'flex-start' },
  card: { width: railCardWidth, aspectRatio: 1, borderRadius: Radius.medium, borderWidth: 1, alignItems: 'center', justifyContent: 'center', gap: Spacing.two },
  circle: { width: 48, height: 48, borderRadius: 24, alignItems: 'center', justifyContent: 'center' },
});

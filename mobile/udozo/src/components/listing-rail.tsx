import type { HomeCard } from '@shared/home';
import { FlatList, StyleSheet } from 'react-native';

import { ListingCard } from '@/components/listing-card';
import { Spacing } from '@/constants/theme';

/** How wide a card is on a rail. */
export const railCardWidth = 160;

/**
 * Listings sliding sideways, each card its fixed width and its own height: the row lines them up at the top, so a short
 * card never stretches to the tallest one, nor any card down the screen.
 */
export function ListingRail({ items, testID }: { items: HomeCard[]; testID?: string }) {
  return (
    <FlatList
      horizontal
      testID={testID}
      data={items}
      keyExtractor={item => item.id}
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={styles.rail}
      renderItem={({ item }) => <ListingCard listing={item} width={railCardWidth} />}
    />
  );
}

const styles = StyleSheet.create({
  rail: { paddingHorizontal: Spacing.three, gap: Spacing.three, alignItems: 'flex-start' },
});

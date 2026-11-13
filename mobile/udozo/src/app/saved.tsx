import { shopMoney, type ShopFavourite, type ShopFavourites } from '@shared/classifieds';
import { FlatList, StyleSheet, View } from 'react-native';

import { ListingCard } from '@/components/listing-card';
import { pagedListProps, usePagedList } from '@/components/paged-list';
import { ThemedText } from '@/components/themed-text';
import { Empty, Failed, Loading } from '@/components/ui';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

/** Listings the customer saved, two to a row, each saying when its price fell or it sold; more load as they scroll. */
export default function SavedScreen() {
  const theme = useTheme();
  const paged = usePagedList<ShopFavourite, ShopFavourites>({ queryKey: ['favourites', 'list'], path: '/v1/classifieds/favourites', paging: 'offset', keyOf: item => item.listing_id });
  const saved = paged.list;
  const items = paged.items.filter(item => item.listing);
  return (
    <FlatList
      data={items}
      keyExtractor={item => item.listing_id}
      numColumns={2}
      columnWrapperStyle={{ gap: Spacing.three }}
      contentContainerStyle={styles.list}
      {...pagedListProps(paged, theme.primary)}
      renderItem={({ item }) => (
        <View style={{ flex: 1, gap: 4 }}>
          <ListingCard listing={item.listing!} />
          {item.state === 'sold' ? (
            <ThemedText type="caption" style={{ color: theme.danger }}>Sold</ThemedText>
          ) : item.price_drop && item.listing?.price ? (
            <ThemedText type="caption" style={{ color: theme.success }}>{`Down ${shopMoney(item.price_drop, item.listing.price.currency)}`}</ThemedText>
          ) : null}
        </View>
      )}
      ListEmptyComponent={saved.isPending ? <Loading /> : saved.isError ? <Failed error={saved.error} retry={() => void saved.refetch()} /> : <Empty title="Nothing saved yet" body="Tap the heart on a listing to keep it here." />}
    />
  );
}

const styles = StyleSheet.create({ list: { padding: Spacing.three, gap: Spacing.three } });

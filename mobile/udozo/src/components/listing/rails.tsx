import type { ShopListingPage, ShopSearch } from '@shared/classifieds';
import { useQuery } from '@tanstack/react-query';
import { router } from 'expo-router';
import { Pressable, StyleSheet, View } from 'react-native';

import { ListingRail } from '@/components/listing-rail';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { api } from '@/lib/api';
import { railSearches } from '@/lib/listing-page';
import { searchQuery, type SearchParams } from '@/lib/search-query';

/** More from this seller, then Similar listings near it: each a rail of up to 12, never this listing itself. */
export function ListingRails({ data, country }: { data: ShopListingPage; country: string }) {
  const searches = railSearches(data, country);
  const key = data.seller.username || data.seller.handle;
  return (
    <>
      {searches.seller ? (
        <Rail title="More from this seller" params={searches.seller} exclude={data.id} testID="rail-seller" onSeeAll={key ? () => router.push({ pathname: '/seller/[key]', params: { key } }) : undefined} />
      ) : null}
      <Rail
        title="Similar listings"
        params={searches.similar}
        exclude={data.id}
        testID="rail-similar"
        onSeeAll={() => router.push({ pathname: '/category/[slug]', params: { slug: data.category.slug, country } })}
      />
    </>
  );
}

function Rail({ title, params, exclude, testID, onSeeAll }: { title: string; params: SearchParams; exclude: string; testID: string; onSeeAll?: () => void }) {
  const results = useQuery({ queryKey: ['listings-rail', params], queryFn: () => api<ShopSearch>(`/v1/classifieds/listings?${searchQuery(params, 0)}`) });
  const items = (results.data?.data ?? []).filter(item => item.id !== exclude).slice(0, 12);
  if (!items.length) return null;
  return (
    <View style={styles.block}>
      <View style={styles.heading}>
        <ThemedText type="heading" accessibilityRole="header" style={{ flex: 1 }}>
          {title}
        </ThemedText>
        {onSeeAll ? (
          <Pressable accessibilityRole="link" accessibilityLabel={`See all: ${title}`} hitSlop={8} onPress={onSeeAll} style={styles.seeAll}>
            <ThemedText type="link">See all</ThemedText>
          </Pressable>
        ) : null}
      </View>
      <ListingRail items={items} testID={testID} />
    </View>
  );
}

const styles = StyleSheet.create({
  // Edge to edge: the rail pads its own sides.
  block: { gap: Spacing.two, marginHorizontal: -Spacing.three },
  heading: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: Spacing.three },
  seeAll: { minHeight: 44, justifyContent: 'center' },
});

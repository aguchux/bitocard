import type { ShopSearch } from '@shared/classifieds';
import { useInfiniteQuery } from '@tanstack/react-query';
import type { ReactElement } from 'react';
import { FlatList, RefreshControl, StyleSheet, View } from 'react-native';

import { ListingCard } from '@/components/listing-card';
import { Empty, Failed, Loading } from '@/components/ui';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { api } from '@/lib/api';
import { searchQuery, type SearchParams } from '@/lib/search-query';

export type { SearchParams } from '@/lib/search-query';

/** `GET /v1/classifieds/listings` a page at a time, as the list scrolls. */
export function useListings(params: SearchParams | null) {
  return useInfiniteQuery({
    queryKey: ['listings', params],
    enabled: Boolean(params?.country),
    initialPageParam: 0,
    queryFn: ({ pageParam }) => api<ShopSearch>(`/v1/classifieds/listings?${searchQuery(params!, pageParam)}`),
    getNextPageParam: last => (last.offset + last.data.length < last.total ? last.offset + last.data.length : undefined),
  });
}

/** Listings two to a row, loading more at the end; the header scrolls with them. */
export function ListingResults({ params, header, empty }: { params: SearchParams | null; header?: ReactElement; empty?: { title: string; body?: string } }) {
  const theme = useTheme();
  const results = useListings(params);
  const items = results.data?.pages.flatMap(page => page.data) ?? [];
  return (
    <FlatList
      data={items}
      keyExtractor={item => item.id}
      numColumns={2}
      columnWrapperStyle={styles.row}
      contentContainerStyle={styles.list}
      ListHeaderComponent={header}
      renderItem={({ item }) => <ListingCard listing={item} />}
      onEndReachedThreshold={0.6}
      onEndReached={() => results.hasNextPage && !results.isFetchingNextPage && results.fetchNextPage()}
      refreshControl={<RefreshControl refreshing={results.isRefetching && !results.isFetchingNextPage} onRefresh={() => void results.refetch()} tintColor={theme.primary} />}
      ListEmptyComponent={
        results.isPending && params ? (
          <Loading />
        ) : results.isError ? (
          <Failed error={results.error} retry={() => results.refetch()} />
        ) : (
          <Empty title={empty?.title ?? 'Nothing here yet'} body={empty?.body} />
        )
      }
      ListFooterComponent={results.isFetchingNextPage ? <Loading label="Loading more" /> : <View style={{ height: Spacing.six }} />}
    />
  );
}

const styles = StyleSheet.create({
  list: { paddingHorizontal: Spacing.three, gap: Spacing.three },
  row: { gap: Spacing.three },
});

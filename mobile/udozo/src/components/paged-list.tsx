import { useInfiniteQuery, type InfiniteData, type QueryKey } from '@tanstack/react-query';
import { RefreshControl, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Button, Loading } from '@/components/ui';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { api } from '@/lib/api';
import { nextPage, pagedItems, pagePath, type PageOf, type Paging } from '@/lib/paging';

type Options<T> = {
  queryKey: QueryKey;
  /** The list's address without its paging (it may carry its own query). */
  path: string;
  paging: Paging;
  limit?: number;
  enabled?: boolean;
  refetchInterval?: number;
  /** The item's key, for lists whose items have no `id` (saved listings). */
  keyOf?: (item: T) => string;
};

/**
 * A list from the API a page at a time (`lib/paging.ts` says how each pages): its items, the first page (for what
 * comes with it, such as unread counts), and what a FlatList needs to load the next page as it nears the end, with
 * pull to refresh.
 */
export function usePagedList<T, P extends PageOf<T> = PageOf<T>>({ queryKey, path, paging, limit = 30, enabled = true, refetchInterval, keyOf }: Options<T>) {
  const list = useInfiniteQuery<P, Error, InfiniteData<P>, QueryKey, number | string | null>({
    queryKey,
    enabled,
    refetchInterval,
    initialPageParam: null,
    queryFn: ({ pageParam }) => api<P>(pagePath(path, paging, limit, pageParam)),
    getNextPageParam: (last, pages) => nextPage(paging, limit, last, pages),
  });
  const items = pagedItems<T>(list.data?.pages, keyOf);
  const loadMore = () => {
    if (list.hasNextPage && !list.isFetchingNextPage && !list.isFetchNextPageError) void list.fetchNextPage();
  };
  return { list, items, first: list.data?.pages[0], loadMore };
}

/** What paging reads of a list (any infinite query, `useListings`' too). */
export type PagedList = { isRefetching: boolean; isFetchingNextPage: boolean; isFetchNextPageError: boolean; fetchNextPage: () => Promise<unknown>; refetch: () => Promise<unknown> };

/** The props a FlatList takes to page: load more near the end, and pull to refresh. */
export function pagedListProps(paged: { list: PagedList; loadMore: () => void }, tint: string) {
  return {
    onEndReachedThreshold: 0.6,
    onEndReached: paged.loadMore,
    refreshControl: <RefreshControl refreshing={paged.list.isRefetching && !paged.list.isFetchingNextPage} onRefresh={() => void paged.list.refetch()} tintColor={tint} />,
    ListFooterComponent: <ListFooter list={paged.list} />,
  };
}

/** Under a list: a spinner while the next page loads, Try again if it failed, else room to scroll past the end. */
export function ListFooter({ list }: { list: PagedList }) {
  const theme = useTheme();
  if (list.isFetchingNextPage) return <Loading label="Loading more" />;
  if (list.isFetchNextPageError) {
    return (
      <View style={styles.failed} accessibilityLiveRegion="polite" testID="list-more-failed">
        <ThemedText type="small" style={{ color: theme.textSecondary }}>
          More could not be loaded.
        </ThemedText>
        <Button title="Try again" tone="secondary" onPress={() => void list.fetchNextPage()} />
      </View>
    );
  }
  return <View style={{ height: Spacing.six }} />;
}

const styles = StyleSheet.create({
  failed: { alignItems: 'center', gap: Spacing.two, paddingVertical: Spacing.four },
});

import { useInfiniteQuery } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useState } from 'react';
import { FlatList, Pressable, RefreshControl, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Button, Notice, Segmented, T, useTheme } from '@/components/ui';
import { api } from '@/lib/api';
import { formatMoney } from '@/lib/money';
import { recipientOf, statusOf } from '@/lib/orders';
import type { Checkout, Page } from '@/lib/types';

type Show = 'all' | 'progress' | 'delivered' | 'refunded';

/** Every order, newest first, filtered on the server (so every page is full); more load as the list ends. */
export default function OrdersTab() {
  const theme = useTheme();
  const [show, setShow] = useState<Show>('all');
  const orders = useInfiniteQuery({
    queryKey: ['orders', 'list', show],
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) => {
      const query = new URLSearchParams({ limit: '20' });
      if (show !== 'all') query.set('show', show);
      if (pageParam) query.set('starting_after', pageParam);
      return api<Page<Checkout>>(`/v1/store/checkouts?${query}`);
    },
    getNextPageParam: last => (last.has_more ? (last.data.at(-1)?.id ?? null) : null),
  });
  const items = orders.data?.pages.flatMap(page => page.data) ?? [];

  return (
    <SafeAreaView edges={['top', 'left', 'right']} style={{ flex: 1, backgroundColor: theme.background }}>
      <FlatList
        data={items}
        keyExtractor={item => item.id}
        contentContainerStyle={styles.list}
        refreshControl={<RefreshControl refreshing={orders.isRefetching} onRefresh={() => void orders.refetch()} />}
        onEndReached={() => orders.hasNextPage && !orders.isFetchingNextPage && void orders.fetchNextPage()}
        ListHeaderComponent={
          <View style={{ gap: 16, marginBottom: 6 }}>
            <T kind="title" accessibilityRole="header">
              Orders
            </T>
            <Segmented
              label="Show"
              value={show}
              onChange={setShow}
              options={[
                { key: 'all', label: 'All' },
                { key: 'progress', label: 'On the way' },
                { key: 'delivered', label: 'Delivered' },
                { key: 'refunded', label: 'Refunded' },
              ]}
            />
            {orders.isError ? <Notice tone="bad">Your orders could not be read. Pull down to try again.</Notice> : null}
          </View>
        }
        ListEmptyComponent={
          orders.isPending ? (
            <T muted>Loading…</T>
          ) : orders.isError ? undefined : (
            <View style={{ gap: 12, paddingTop: 24, alignItems: 'center' }}>
              <T kind="heading">No orders yet</T>
              <T muted style={{ textAlign: 'center' }}>
                Airtime, data and gift cards you buy show up here.
              </T>
              <Button label="Buy airtime" onPress={() => router.push({ pathname: '/mobile', params: { kind: 'airtime' } })} />
            </View>
          )
        }
        renderItem={({ item }) => {
          const status = statusOf(item.status);
          const color = { good: theme.good, warn: theme.warn, bad: theme.bad, neutral: theme.textSecondary }[status.tone];
          const to = recipientOf(item);
          return (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`${item.product.name}, ${formatMoney(item.amount, item.currency)}, ${status.label}`}
              onPress={() => router.push({ pathname: '/order/[id]', params: { id: item.id } })}
              style={[styles.row, { backgroundColor: theme.card, borderColor: theme.line }]}>
              <View style={{ flex: 1, gap: 2 }}>
                <T style={{ fontFamily: 'Inter_600SemiBold' }}>{item.product.name}</T>
                <T kind="small" muted>
                  {[to, new Date(item.created_at).toLocaleDateString()].filter(Boolean).join(' · ')}
                </T>
              </View>
              <View style={{ alignItems: 'flex-end', gap: 2 }}>
                <T style={{ fontFamily: 'Inter_700Bold' }}>{formatMoney(item.amount, item.currency)}</T>
                <T kind="caption" color={color}>
                  {status.label}
                </T>
              </View>
            </Pressable>
          );
        }}
        ListFooterComponent={orders.isFetchingNextPage ? <T muted>Loading more…</T> : undefined}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  list: { padding: 20, gap: 10, paddingBottom: 40 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14, borderRadius: 16, borderWidth: 1 },
});

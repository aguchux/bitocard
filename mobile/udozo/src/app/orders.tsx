import { buyerOrderLabels, sellerOrderLabels, shopMoney, type ShopOrder, type ShopOrders } from '@shared/classifieds';
import { Image } from 'expo-image';
import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { FlatList, Pressable, StyleSheet, View } from 'react-native';

import { pagedListProps, usePagedList } from '@/components/paged-list';
import { ThemedText } from '@/components/themed-text';
import { Chip, Empty, Failed, Loading } from '@/components/ui';
import { Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { orderNext, orderOpen } from '@/lib/money';
import { pagedItems } from '@/lib/paging';

/**
 * UdozoPay orders (udozo.com's /account/orders): buying or selling, those still going first, each with what to do
 * next; more load as they scroll.
 */
export default function OrdersScreen() {
  const theme = useTheme();
  const params = useLocalSearchParams<{ role?: string }>();
  const [role, setRole] = useState<'buying' | 'selling'>(params.role === 'selling' ? 'selling' : 'buying');
  const paged = usePagedList<ShopOrder, ShopOrders>({ queryKey: ['orders', 'list', role], path: `/v1/classifieds/orders?role=${role}`, paging: 'offset' });
  const orders = paged.list;
  // Those still going first within each page, so a page loading later never moves rows already seen.
  const sorted = pagedItems(orders.data?.pages.map(page => ({ ...page, data: [...page.data].sort((a, b) => Number(orderOpen(b.status)) - Number(orderOpen(a.status))) })));
  return (
    <View style={{ flex: 1, backgroundColor: theme.background }}>
      <View style={styles.chips}>
        <Chip label="Buying" selected={role === 'buying'} onPress={() => setRole('buying')} />
        <Chip label="Selling" selected={role === 'selling'} onPress={() => setRole('selling')} />
      </View>
      {orders.isPending ? (
        <Loading />
      ) : orders.isLoadingError ? (
        <Failed error={orders.error} retry={() => void orders.refetch()} />
      ) : (
        <FlatList
          data={sorted}
          keyExtractor={item => item.id}
          contentContainerStyle={{ padding: Spacing.three, gap: Spacing.two }}
          {...pagedListProps(paged, theme.primary)}
          ListEmptyComponent={<Empty title={role === 'buying' ? 'No UdozoPay orders yet' : 'No UdozoPay sales yet'} body={role === 'buying' ? 'Buy with UdozoPay on a listing: Udozo holds your money until you have the item.' : 'When a buyer pays with UdozoPay for something you sell, it shows here.'} />}
          renderItem={({ item }) => {
            const total = item.role === 'buyer' ? (item.total ?? item.price) : (item.payout ?? item.price);
            return (
              <Pressable accessibilityRole="button" onPress={() => router.push({ pathname: '/order/[id]', params: { id: item.id } })} style={[styles.row, { borderColor: theme.line }]}>
                {item.listing.cover_url ? <Image source={{ uri: item.listing.cover_url }} style={styles.cover} /> : <View style={[styles.cover, { backgroundColor: theme.backgroundElement }]} />}
                <View style={{ flex: 1, gap: 2 }}>
                  <ThemedText type="smallBold" numberOfLines={1}>
                    {item.listing.title ?? item.number}
                  </ThemedText>
                  <ThemedText type="caption">{`${item.number} · ${(item.role === 'buyer' ? buyerOrderLabels : sellerOrderLabels)[item.status]} · ${shopMoney(total, item.currency)}`}</ThemedText>
                  <ThemedText type="small" themeColor="textSecondary" numberOfLines={2}>
                    {orderNext(item)}
                  </ThemedText>
                </View>
              </Pressable>
            );
          }}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  chips: { flexDirection: 'row', gap: Spacing.two, paddingHorizontal: Spacing.three, paddingTop: Spacing.three },
  row: { flexDirection: 'row', gap: Spacing.three, borderWidth: 1, borderRadius: Radius.medium, padding: Spacing.two, alignItems: 'center' },
  cover: { width: 56, height: 56, borderRadius: Radius.small },
});

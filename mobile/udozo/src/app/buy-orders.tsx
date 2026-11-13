import { buyOrderLabels, shopMoney, type ShopBuyOrders } from '@shared/classifieds';
import { useQuery } from '@tanstack/react-query';
import { Image } from 'expo-image';
import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { FlatList, Pressable, RefreshControl, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Chip, Empty, Failed, Loading } from '@/components/ui';
import { Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { api } from '@/lib/api';
import { buyOrderNext } from '@/lib/buy-orders';

/**
 * Buy orders (udozo.com's /account/buy-orders): what the reader asked to buy and what buyers asked of them, those waiting
 * on the reader first, each with what happens next. Payment is between buyer and seller when they meet.
 */
export default function BuyOrdersScreen() {
  const theme = useTheme();
  const params = useLocalSearchParams<{ role?: string }>();
  const [role, setRole] = useState<'buying' | 'selling'>(params.role === 'selling' ? 'selling' : 'buying');
  const orders = useQuery({ queryKey: ['buy-orders', role], queryFn: () => api<ShopBuyOrders>(`/v1/classifieds/me/buy-orders?role=${role}&limit=50`) });
  const waiting = (actions: string[]) => actions.length > 0;
  const sorted = [...(orders.data?.data ?? [])].sort((a, b) => Number(waiting(b.actions)) - Number(waiting(a.actions)));
  return (
    <View style={{ flex: 1, backgroundColor: theme.background }}>
      <View style={styles.chips}>
        <Chip label="Buying" selected={role === 'buying'} onPress={() => setRole('buying')} />
        <Chip label="Selling" selected={role === 'selling'} onPress={() => setRole('selling')} />
      </View>
      {orders.data?.waiting ? <ThemedText type="smallBold" style={styles.waiting}>{`${orders.data.waiting} waiting for you`}</ThemedText> : null}
      {orders.isPending ? (
        <Loading />
      ) : orders.isError ? (
        <Failed error={orders.error} retry={() => void orders.refetch()} />
      ) : (
        <FlatList
          data={sorted}
          keyExtractor={item => item.id}
          contentContainerStyle={{ padding: Spacing.three, gap: Spacing.two }}
          refreshControl={<RefreshControl refreshing={orders.isRefetching} onRefresh={() => void orders.refetch()} tintColor={theme.primary} />}
          ListEmptyComponent={
            <Empty
              title={role === 'buying' ? 'No buy orders yet' : 'No buy orders for your listings yet'}
              body={role === 'buying' ? 'Tap Buy this on a listing to ask the seller to sell it to you. You meet, inspect it and pay in person.' : 'When a buyer asks to buy one of your listings, it shows here for you to answer.'}
            />
          }
          renderItem={({ item }) => (
            <Pressable accessibilityRole="button" onPress={() => router.push({ pathname: '/buy-order/[id]', params: { id: item.id } })} style={[styles.row, { borderColor: item.actions.length ? theme.primary : theme.line }]}>
              {item.listing.cover_url ? <Image source={{ uri: item.listing.cover_url }} style={styles.cover} /> : <View style={[styles.cover, { backgroundColor: theme.backgroundElement }]} />}
              <View style={{ flex: 1, gap: 2 }}>
                <ThemedText type="smallBold" numberOfLines={1}>
                  {item.listing.title ?? item.number}
                </ThemedText>
                <ThemedText type="caption">{`${item.number} · ${buyOrderLabels[item.role][item.status]} · ${shopMoney(item.counter ?? item.price, item.currency)}`}</ThemedText>
                <ThemedText type="small" themeColor="textSecondary" numberOfLines={2}>
                  {buyOrderNext(item)}
                </ThemedText>
              </View>
            </Pressable>
          )}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  chips: { flexDirection: 'row', gap: Spacing.two, paddingHorizontal: Spacing.three, paddingTop: Spacing.three },
  waiting: { paddingHorizontal: Spacing.three, paddingTop: Spacing.two },
  row: { flexDirection: 'row', gap: Spacing.three, borderWidth: 1, borderRadius: Radius.medium, padding: Spacing.two, alignItems: 'center' },
  cover: { width: 56, height: 56, borderRadius: Radius.small },
});

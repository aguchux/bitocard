import { shopMoney, shopPriceText, type ShopBuyOrder, type ShopListingStatus, type ShopMyListing, type ShopMyListings } from '@shared/classifieds';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Image } from 'expo-image';
import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Alert, FlatList, Pressable, RefreshControl, ScrollView, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Button, Chip, Empty, Failed, Field, FormError, Loading, Sheet } from '@/components/ui';
import { Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { api } from '@/lib/api';
import { buyOrderPath } from '@/lib/buy-orders';
import { listingActions, listingGroups } from '@/lib/listing-form';
import { openLink } from '@/lib/navigate';
import { photoUrl } from '@/lib/photo';

const statusWords: Record<ShopListingStatus, string> = {
  draft: 'Draft',
  pending_review: 'In review',
  active: 'Live',
  sold: 'Sold',
  expired: 'Expired',
  rejected: 'Needs changes',
  removed: 'Removed',
};

const dateText = (iso: string | null | undefined) => (iso ? new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }) : null);

/**
 * The seller's listings by state (Live, In review, Drafts, Needs changes, Expired, Sold), each with what can be done to
 * it now: edit, see it, mark it sold, restock, renew or delete. Restocking an ad Anjio took off renews it too.
 */
export default function MyListingsScreen() {
  const theme = useTheme();
  const queries = useQueryClient();
  const params = useLocalSearchParams<{ status?: string }>();
  const [status, setStatus] = useState<ShopListingStatus>((listingGroups.find(group => group.status === params.status)?.status as ShopListingStatus) ?? 'active');
  const [restocking, setRestocking] = useState<ShopMyListing | null>(null);
  const [units, setUnits] = useState('1');
  /** Mark sold on a listing with accepted buy orders: who bought it. */
  const [soldTo, setSoldTo] = useState<{ listing: ShopMyListing; orders: ShopBuyOrder[] } | null>(null);
  const list = useQuery({ queryKey: ['my-listings', status], queryFn: () => api<ShopMyListings>(`/v1/classifieds/me/listings?status=${status}&limit=100`) });

  const done = () => {
    queries.invalidateQueries({ queryKey: ['my-listings'] });
    queries.invalidateQueries({ queryKey: ['dashboard'] });
  };
  const act = useMutation({
    mutationFn: async ({ listing, action }: { listing: ShopMyListing; action: 'renew' | 'sold' | 'delete' }) => {
      if (action === 'delete') return api(`/v1/classifieds/listings/${listing.id}`, { method: 'DELETE' });
      return api(`/v1/classifieds/listings/${listing.id}/${action}`, { body: {} });
    },
    onSuccess: done,
    onError: error => Alert.alert('That did not work', (error as Error).message),
  });
  const restock = useMutation({
    mutationFn: async ({ listing, stock }: { listing: ShopMyListing; stock: number }) => {
      const changed = await api<ShopMyListing>(`/v1/classifieds/listings/${listing.id}`, { method: 'PATCH', body: { stock } });
      // An ad Anjio took off for being out of stock comes back once it has stock.
      return changed.status === 'expired' ? api<ShopMyListing>(`/v1/classifieds/listings/${listing.id}/renew`, { body: {} }) : changed;
    },
    onSuccess: () => {
      setRestocking(null);
      done();
    },
  });

  const sellTo = useMutation({
    mutationFn: ({ listing, order }: { listing: ShopMyListing; order: ShopBuyOrder | null }) => (order ? api(buyOrderPath(order.id, 'complete'), { body: {} }) : api(`/v1/classifieds/listings/${listing.id}/sold`, { body: {} })),
    onSuccess: () => {
      setSoldTo(null);
      queries.invalidateQueries({ queryKey: ['buy-orders'] });
      done();
    },
  });
  /** Sold to a buyer whose buy order was accepted? Marked sold to them, so the sale is recorded with them. */
  const markSold = async (listing: ShopMyListing) => {
    const accepted = await api<{ data: ShopBuyOrder[] }>(`/v1/classifieds/me/listings/${listing.id}/buy-orders`).catch(() => ({ data: [] as ShopBuyOrder[] }));
    if (accepted.data.length) {
      sellTo.reset();
      setSoldTo({ listing, orders: accepted.data });
    } else confirm(listing, 'sold');
  };

  const confirm = (listing: ShopMyListing, action: 'sold' | 'delete') =>
    Alert.alert(
      action === 'sold' ? 'Mark it sold?' : 'Delete this ad?',
      action === 'sold' ? 'It comes off Udozo, and buyers who saved it are told it sold.' : 'It comes off Udozo for good. This cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: action === 'sold' ? 'Mark sold' : 'Delete', style: action === 'delete' ? 'destructive' : 'default', onPress: () => act.mutate({ listing, action }) },
      ],
    );

  const items = list.data?.data ?? [];
  return (
    <View style={{ flex: 1, backgroundColor: theme.background }}>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.tabs} style={{ flexGrow: 0 }}>
        {listingGroups.map(group => (
          <Chip key={group.status} label={group.label} selected={status === group.status} onPress={() => setStatus(group.status)} />
        ))}
      </ScrollView>
      <FlatList
        data={items}
        keyExtractor={item => item.id}
        contentContainerStyle={styles.list}
        refreshControl={<RefreshControl refreshing={list.isRefetching} onRefresh={() => void list.refetch()} tintColor={theme.primary} />}
        renderItem={({ item }) => {
          const actions = listingActions(item);
          const cover = photoUrl(item.photos.find(photo => photo.status === 'ready')?.url, 480);
          const out = item.status === 'active' && item.stock === 0;
          return (
            <View style={[styles.card, { borderColor: theme.line }]}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`${item.title ?? 'Untitled ad'}, ${statusWords[item.status]}. Edit`}
                disabled={!actions.includes('edit')}
                onPress={() => router.push({ pathname: '/post/[id]', params: { id: item.id } })}
                style={styles.row}>
                <View style={[styles.thumb, { backgroundColor: theme.backgroundElement }]}>{cover ? <Image source={{ uri: cover }} style={StyleSheet.absoluteFill} contentFit="cover" /> : null}</View>
                <View style={{ flex: 1, gap: 2 }}>
                  <ThemedText type="smallBold" numberOfLines={2}>
                    {item.title ?? 'Untitled ad'}
                  </ThemedText>
                  <ThemedText type="small">{shopPriceText(item.price)}</ThemedText>
                  <ThemedText type="caption">
                    {[statusWords[item.status], out ? 'Out of stock' : item.status === 'active' ? `${item.stock} in stock` : null, item.status === 'active' ? `${item.views} views · ${item.leads} leads` : null, item.expires_at && item.status === 'active' ? `until ${dateText(item.expires_at)}` : null]
                      .filter(Boolean)
                      .join(' · ')}
                  </ThemedText>
                  {item.status === 'rejected' && item.review_reason ? (
                    <ThemedText type="caption" style={{ color: theme.danger }}>
                      {item.review_reason}
                    </ThemedText>
                  ) : null}
                  {out && item.delist_at ? <ThemedText type="caption" style={{ color: theme.danger }}>{`Restock by ${dateText(item.delist_at)}, or it comes off Udozo.`}</ThemedText> : null}
                </View>
              </Pressable>
              <View style={styles.actions}>
                {actions.includes('edit') ? <Button title={item.status === 'draft' ? 'Carry on' : 'Edit'} tone="secondary" onPress={() => router.push({ pathname: '/post/[id]', params: { id: item.id } })} /> : null}
                {actions.includes('view') && item.url ? <Button title="See it" tone="ghost" onPress={() => openLink(item.url!)} /> : null}
                {actions.includes('sold') ? <Button title="Mark sold" tone="ghost" onPress={() => void markSold(item)} /> : null}
                {actions.includes('restock') ? (
                  <Button
                    title="Restock"
                    tone="ghost"
                    onPress={() => {
                      setUnits(String(Math.max(1, item.stock)));
                      setRestocking(item);
                    }}
                  />
                ) : null}
                {actions.includes('renew') ? <Button title="Renew" tone="ghost" onPress={() => act.mutate({ listing: item, action: 'renew' })} /> : null}
                {actions.includes('delete') ? <Button title="Delete" tone="ghost" onPress={() => confirm(item, 'delete')} /> : null}
              </View>
            </View>
          );
        }}
        ListEmptyComponent={
          list.isPending ? (
            <Loading />
          ) : list.isError ? (
            <Failed error={list.error} retry={() => void list.refetch()} />
          ) : (
            <Empty
              title={`No ${listingGroups.find(group => group.status === status)?.label.toLowerCase()} ads`}
              body={status === 'active' ? 'Post an ad and it shows here once it is live.' : undefined}
              action={status === 'active' ? <Button title="Post an ad" onPress={() => router.push({ pathname: '/post/[id]', params: { id: 'new' } })} /> : undefined}
            />
          )
        }
      />
      <Sheet visible={Boolean(soldTo)} onClose={() => setSoldTo(null)} title="Who bought it?">
        <ThemedText type="small">Mark it sold to the buyer, only once they have paid you and have it. The sale is recorded with them.</ThemedText>
        {soldTo?.orders.map(order => (
          <Button key={order.id} title={`Sold to ${order.with.name} · ${shopMoney(order.price, order.currency)}`} tone="money" loading={sellTo.isPending && sellTo.variables?.order?.id === order.id} onPress={() => sellTo.mutate({ listing: soldTo.listing, order })} />
        ))}
        <Button title="Sold to someone else" tone="secondary" disabled={sellTo.isPending} onPress={() => soldTo && sellTo.mutate({ listing: soldTo.listing, order: null })} />
        <FormError error={sellTo.error} />
      </Sheet>
      <Sheet visible={Boolean(restocking)} onClose={() => setRestocking(null)} title="How many do you have now?">
        <Field label="In stock" value={units} onChangeText={setUnits} keyboardType="number-pad" />
        <FormError error={restock.error} />
        <Button
          title="Save"
          loading={restock.isPending}
          onPress={() => {
            const stock = Number(units);
            if (restocking && Number.isInteger(stock) && stock >= 0 && stock <= 100000) restock.mutate({ listing: restocking, stock });
            else Alert.alert('Give a whole number', 'Such as 1, or 0 when none are left.');
          }}
        />
      </Sheet>
    </View>
  );
}

const styles = StyleSheet.create({
  tabs: { gap: Spacing.two, padding: Spacing.three },
  list: { padding: Spacing.three, paddingTop: 0, gap: Spacing.three },
  card: { borderWidth: 1, borderRadius: Radius.medium, padding: Spacing.three, gap: Spacing.two },
  row: { flexDirection: 'row', gap: Spacing.three },
  thumb: { width: 72, height: 72, borderRadius: Radius.small, overflow: 'hidden' },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.one },
});

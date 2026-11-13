import { shopMoney, type ShopReseller } from '@shared/classifieds';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { router } from 'expo-router';
import { Store } from 'lucide-react-native';
import { FlatList, Pressable, RefreshControl, StyleSheet, Switch, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Card, Empty, Failed, FormError, Loading } from '@/components/ui';
import { Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { api } from '@/lib/api';

/**
 * My Resellers (udozo.com's /account/resellers): the resellers carrying the seller's listings, each with their stores,
 * what they sold and what waits (notes to approve, unread messages), and Accept resale orders automatically.
 */
export default function ResellersScreen() {
  const theme = useTheme();
  const queries = useQueryClient();
  const list = useQuery({ queryKey: ['resellers'], queryFn: () => api<{ data: ShopReseller[] }>('/v1/classifieds/me/resellers') });
  const auto = useQuery({ queryKey: ['resale-auto-accept'], queryFn: () => api<{ enabled: boolean }>('/v1/classifieds/me/resale/auto-accept') });
  const toggle = useMutation({
    mutationFn: (enabled: boolean) => api<{ enabled: boolean }>('/v1/classifieds/me/resale/auto-accept', { method: 'PUT', body: { enabled } }),
    onSuccess: answer => queries.setQueryData(['resale-auto-accept'], answer),
  });

  if (list.isPending) return <Loading />;
  if (list.isError) return <Failed error={list.error} retry={() => void list.refetch()} />;
  return (
    <FlatList
      style={{ backgroundColor: theme.background }}
      data={list.data.data}
      keyExtractor={item => item.id}
      contentContainerStyle={{ padding: Spacing.three, gap: Spacing.two }}
      refreshControl={<RefreshControl refreshing={list.isRefetching} onRefresh={() => void list.refetch()} tintColor={theme.primary} />}
      ListHeaderComponent={
        <Card style={{ marginBottom: Spacing.two }}>
          <View style={styles.inline}>
            <View style={{ flex: 1 }}>
              <ThemedText type="smallBold">Accept resale orders automatically</ThemedText>
              <ThemedText type="caption">New orders from resellers’ stores are accepted while the listing has stock. You still hand over or ship each one.</ThemedText>
            </View>
            <Switch
              accessibilityLabel="Accept resale orders automatically"
              value={toggle.isPending ? Boolean(toggle.variables) : Boolean(auto.data?.enabled)}
              disabled={!auto.data || toggle.isPending}
              onValueChange={value => toggle.mutate(value)}
            />
          </View>
          <FormError error={toggle.error} />
        </Card>
      }
      ListEmptyComponent={<Empty title="No resellers yet" body="When resellers add your listings to their stores, they show here." />}
      renderItem={({ item }) => (
        <Pressable accessibilityRole="button" accessibilityLabel={`${item.reseller.name}. Open`} onPress={() => router.push({ pathname: '/reseller/[id]', params: { id: item.id } })} style={[styles.row, { borderColor: item.notes_pending || item.unread ? theme.primary : theme.line }]}>
          <Store size={22} color={theme.primary} />
          <View style={{ flex: 1, gap: 2 }}>
            <ThemedText type="smallBold">{`${item.reseller.name}${item.stopped ? ' (stopped)' : ''}`}</ThemedText>
            <ThemedText type="caption">{item.stores.map(store => store.name).join(', ') || 'No stores'}</ThemedText>
            <ThemedText type="small" themeColor="textSecondary">
              {[
                `${item.listings_carried} of your listings`,
                `${item.sales.completed} sold`,
                item.sales.paid_to_you ? `${shopMoney(item.sales.paid_to_you.amount, item.sales.paid_to_you.currency)} paid to you` : null,
                item.notes_pending ? `${item.notes_pending} ${item.notes_pending === 1 ? 'note' : 'notes'} to approve` : null,
                item.unread ? `${item.unread} unread` : null,
              ]
                .filter(Boolean)
                .join(' · ')}
            </ThemedText>
          </View>
        </Pressable>
      )}
    />
  );
}

const styles = StyleSheet.create({
  inline: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three, borderWidth: 1, borderRadius: Radius.medium, padding: Spacing.three },
});

import { useQuery } from '@tanstack/react-query';
import { router } from 'expo-router';
import { Pressable, View } from 'react-native';

import { Button, Card, inter, Notice, Page, T, useTheme } from '@/components/ui';
import { api, ApiError } from '@/lib/api';
import { saleStatusOf } from '@/lib/gift-cards';
import { formatMoney } from '@/lib/money';
import type { GiftCardSale } from '@/lib/types';

/** Every gift card the customer sold (the latest 50, as on bitocard.com), with where each stands and what was paid. */
export default function SoldScreen() {
  const theme = useTheme();
  const sales = useQuery({ queryKey: ['gift-card-sales'], queryFn: () => api<{ data: GiftCardSale[] }>('/v1/store/gift-card-sales') });
  return (
    <Page>
      {sales.isError ? <Notice tone="bad">{sales.error instanceof ApiError ? sales.error.message : 'Your sales could not be read.'}</Notice> : null}
      {sales.isPending ? <T muted>Loading…</T> : null}
      {sales.data && sales.data.data.length === 0 ? (
        <>
          <T muted>You have not sold a gift card yet.</T>
          <Button label="Sell a gift card" onPress={() => router.push({ pathname: '/gift-cards', params: { mode: 'sell' } })} />
        </>
      ) : null}
      {sales.data?.data.map(sale => {
        const status = saleStatusOf(sale.status);
        return (
          <Pressable key={sale.id} accessibilityRole="button" accessibilityLabel={`${sale.card.name}, ${status.label}`} onPress={() => router.push({ pathname: '/sale/[id]', params: { id: sale.id } })}>
            <Card>
              <View style={{ flexDirection: 'row', gap: 8 }}>
                <T style={{ flex: 1, fontFamily: inter.semibold }}>{sale.card.name}</T>
                <T style={{ fontFamily: inter.bold }}>{formatMoney(sale.paid ?? sale.quoted, sale.currency)}</T>
              </View>
              <T kind="small" color={{ good: theme.good, warn: theme.warn, bad: theme.bad }[status.tone]}>
                {status.label}
              </T>
              <T kind="small" muted>
                {sale.number} · {new Date(sale.created_at).toLocaleDateString()}
              </T>
            </Card>
          </Pressable>
        );
      })}
    </Page>
  );
}

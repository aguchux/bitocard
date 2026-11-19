import { useQuery } from '@tanstack/react-query';
import { router } from 'expo-router';
import { Pressable, StyleSheet, View } from 'react-native';

import { PoolBoard } from '@/components/airtime';
import { Button, Card, Notice, Page, T, useTheme } from '@/components/ui';
import { useAccount } from '@/lib/account';
import { purchaseStatusOf, saleStatusOf } from '@/lib/airtime';
import { api, ApiError } from '@/lib/api';
import { formatMoney } from '@/lib/money';
import type { AirtimePool, AirtimePurchase, AirtimeSale, Page as List } from '@/lib/types';

type Trade = { kind: 'sale'; item: AirtimeSale } | { kind: 'purchase'; item: AirtimePurchase };

/**
 * The airtime exchange: the live pool everyone sees (asked again every 20 seconds), selling and buying, and the
 * customer's own trades, newest first.
 */
export default function AirtimeExchange() {
  const theme = useTheme();
  const { customer } = useAccount();
  const country = customer?.country ?? 'NG';
  const pool = useQuery({ queryKey: ['airtime-pool', country], queryFn: () => api<AirtimePool>(`/v1/store/airtime/pool?country=${country}`), refetchInterval: 20_000 });
  const trades = useQuery({
    queryKey: ['airtime-trades'],
    queryFn: async (): Promise<Trade[]> => {
      const [sales, purchases] = await Promise.all([api<List<AirtimeSale>>('/v1/store/airtime/sales'), api<List<AirtimePurchase>>('/v1/store/airtime/purchases')]);
      const all: Trade[] = [...sales.data.map(item => ({ kind: 'sale' as const, item })), ...purchases.data.map(item => ({ kind: 'purchase' as const, item }))];
      return all.sort((a, b) => b.item.created_at.localeCompare(a.item.created_at)).slice(0, 10);
    },
  });

  return (
    <Page>
      <T kind="title" accessibilityRole="header">
        Airtime exchange
      </T>
      <T muted>Sell airtime you will not use for money in your wallet, or buy it from the pool for less.</T>
      <View style={styles.row}>
        <View style={{ flex: 1 }}>
          <Button label="Sell airtime" onPress={() => router.push('/airtime/sell')} />
        </View>
        <View style={{ flex: 1 }}>
          <Button kind="accent" label="Buy airtime" onPress={() => router.push('/airtime/buy')} />
        </View>
      </View>
      <Button kind="secondary" label="Your mobile numbers" onPress={() => router.push('/phones')} />

      <T kind="heading" accessibilityRole="header">
        Your trades
      </T>
      {trades.isError ? <Notice tone="bad">{trades.error instanceof ApiError ? trades.error.message : 'Your trades could not be read.'}</Notice> : null}
      {trades.data?.length === 0 ? <T muted>No trades yet.</T> : null}
      {trades.data?.map(({ kind, item }) => {
        const status = kind === 'sale' ? saleStatusOf((item as AirtimeSale).status) : purchaseStatusOf((item as AirtimePurchase).status);
        return (
          <Pressable
            key={item.id}
            accessibilityRole="button"
            onPress={() => router.push(kind === 'sale' ? { pathname: '/airtime/sale/[id]', params: { id: item.id } } : { pathname: '/airtime/purchase/[id]', params: { id: item.id } })}>
            <Card>
              <View style={styles.row}>
                <T kind="label" style={{ flex: 1 }}>
                  {kind === 'sale' ? 'Sold' : 'Bought'} {item.network.toUpperCase()} · {formatMoney(item.amount, item.currency, { cents: false })}
                </T>
                <T kind="small" color={{ good: theme.good, warn: theme.warn, bad: theme.bad }[status.tone]}>
                  {status.label}
                </T>
              </View>
              <T kind="small" muted>
                {item.number} · {new Date(item.created_at).toLocaleDateString()}
              </T>
            </Card>
          </Pressable>
        );
      })}

      <T kind="heading" accessibilityRole="header">
        The pool
      </T>
      {pool.isPending ? <T muted>Loading…</T> : null}
      {pool.isError ? <Notice tone="bad">{pool.error instanceof ApiError ? pool.error.message : 'The pool could not be read.'}</Notice> : null}
      {pool.data ? <PoolBoard pool={pool.data} /> : null}
    </Page>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 8 },
});

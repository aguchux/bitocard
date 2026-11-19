import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Stack, useLocalSearchParams } from 'expo-router';
import { useEffect } from 'react';

import { Button, Card, Line, Notice, Page, T, useTheme } from '@/components/ui';
import { localNumber, purchaseMoving, purchaseStatusOf } from '@/lib/airtime';
import { api, ApiError } from '@/lib/api';
import { formatMoney } from '@/lib/money';
import type { AirtimePurchase } from '@/lib/types';

/** One airtime purchase: waiting to be sent and being sent (asked again every 10 seconds), sent, or refunded and why. */
export default function AirtimePurchaseScreen() {
  const theme = useTheme();
  const queries = useQueryClient();
  const { id } = useLocalSearchParams<{ id: string }>();
  const purchase = useQuery({
    queryKey: ['airtime-purchases', id],
    queryFn: () => api<AirtimePurchase>(`/v1/store/airtime/purchases/${id}`),
    refetchInterval: query => (query.state.data && purchaseMoving(query.state.data.status) ? 10_000 : false),
  });
  const simulate = useMutation({
    mutationFn: (outcome: 'delivered' | 'refunded') => api<AirtimePurchase>(`/v1/store/airtime/purchases/${id}/simulate`, { body: { outcome } }),
    onSuccess: () => void purchase.refetch(),
  });
  const settled = purchase.data ? !purchaseMoving(purchase.data.status) : false;
  useEffect(() => {
    if (settled) {
      void queries.invalidateQueries({ queryKey: ['wallet'] });
      void queries.invalidateQueries({ queryKey: ['airtime-trades'] });
    }
  }, [settled, queries]);

  const data = purchase.data;
  if (!data) return <Page>{purchase.isError ? <Notice tone="bad">{purchase.error instanceof ApiError ? purchase.error.message : 'This purchase could not be read.'}</Notice> : <T muted>Loading…</T>}</Page>;
  const status = purchaseStatusOf(data.status);
  return (
    <Page>
      <Stack.Screen options={{ title: data.number }} />
      <T kind="heading">{data.network.toUpperCase()} airtime</T>
      <T kind="amount">{formatMoney(data.amount, data.currency, { cents: false })}</T>
      <T kind="label" color={{ good: theme.good, warn: theme.warn, bad: theme.bad }[status.tone]} accessibilityLiveRegion="polite">
        {status.label}
      </T>
      <Card>
        <Line label="To" value={localNumber(data.phone)} />
        <Line label="You paid" value={formatMoney(data.price, data.currency)} strong />
        <Line label="Bought" value={new Date(data.created_at).toLocaleString()} />
        {data.delivered_at ? <Line label="Sent" value={new Date(data.delivered_at).toLocaleString()} /> : null}
      </Card>
      {purchaseMoving(data.status) ? <Notice>Our team sends it by {new Date(data.expires_at).toLocaleTimeString()}, or the money goes back to your wallet. This page updates by itself.</Notice> : null}
      {data.status === 'refunded' ? <Notice tone="bad">{formatMoney(data.price, data.currency)} is back in your wallet.{data.note ? ` ${data.note}` : ''}</Notice> : null}
      {data.mode === 'test' && purchaseMoving(data.status) ? (
        <Card>
          <T kind="small" muted>
            Sandbox purchase: choose how it ends.
          </T>
          <Button kind="secondary" label="Simulate sent" onPress={() => simulate.mutate('delivered')} busy={simulate.isPending} />
          <Button kind="secondary" label="Simulate refunded" onPress={() => simulate.mutate('refunded')} />
        </Card>
      ) : null}
    </Page>
  );
}

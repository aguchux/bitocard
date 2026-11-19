import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Stack, useLocalSearchParams } from 'expo-router';
import { useEffect } from 'react';

import { Button, Card, Line, Notice, Page, T, useTheme } from '@/components/ui';
import { api, ApiError } from '@/lib/api';
import { saleStatusOf } from '@/lib/gift-cards';
import { formatMoney } from '@/lib/money';
import type { GiftCardSale } from '@/lib/types';

/** One gift card sale: being checked (asked again every 10 seconds), accepted and paid, or declined and why. */
export default function SaleScreen() {
  const theme = useTheme();
  const queries = useQueryClient();
  const { id } = useLocalSearchParams<{ id: string }>();
  const sale = useQuery({
    queryKey: ['gift-card-sales', id],
    queryFn: () => api<GiftCardSale>(`/v1/store/gift-card-sales/${id}`),
    refetchInterval: query => (query.state.data?.status === 'pending' ? 10_000 : false),
  });
  const simulate = useMutation({
    mutationFn: (outcome: 'approved' | 'rejected') => api<GiftCardSale>(`/v1/store/gift-card-sales/${id}/simulate`, { body: { outcome } }),
    onSuccess: () => void sale.refetch(),
  });
  const done = sale.data?.status === 'completed';
  useEffect(() => {
    if (done) void queries.invalidateQueries({ queryKey: ['wallet'] });
  }, [done, queries]);

  const data = sale.data;
  if (!data) return <Page>{sale.isError ? <Notice tone="bad">{sale.error instanceof ApiError ? sale.error.message : 'This sale could not be read.'}</Notice> : <T muted>Loading…</T>}</Page>;
  const status = saleStatusOf(data.status);
  return (
    <Page>
      <Stack.Screen options={{ title: data.number }} />
      <T kind="heading">{data.card.name}</T>
      <T kind="amount" color={done ? theme.good : theme.text}>
        {formatMoney(data.paid ?? data.quoted, data.currency)}
      </T>
      <T kind="label" color={{ good: theme.good, warn: theme.warn, bad: theme.bad }[status.tone]} accessibilityLiveRegion="polite">
        {status.label}
      </T>
      <Card>
        <Line label="Card value" value={String(data.amount)} />
        <Line label="Sent as" value={data.form === 'ecode' ? `E-code${data.code_hint ? ` ending ${data.code_hint}` : ''}` : 'Photos of the card'} />
        <Line label="Sent" value={new Date(data.created_at).toLocaleString()} />
      </Card>
      {data.status === 'pending' ? <Notice>Our team is checking the card, usually within 30 minutes. This page updates by itself.</Notice> : null}
      {done ? <Notice tone="good">{formatMoney(data.paid ?? data.quoted, data.currency)} is in your wallet.</Notice> : null}
      {data.reason ? <Notice tone="bad">{data.reason}</Notice> : null}
      {data.mode === 'test' && data.status === 'pending' ? (
        <Card>
          <T kind="small" muted>
            Sandbox sale: choose how it ends.
          </T>
          <Button kind="secondary" label="Simulate accepted" onPress={() => simulate.mutate('approved')} busy={simulate.isPending} />
          <Button kind="secondary" label="Simulate declined" onPress={() => simulate.mutate('rejected')} />
        </Card>
      ) : null}
    </Page>
  );
}

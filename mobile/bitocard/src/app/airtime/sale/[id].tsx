import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import * as Clipboard from 'expo-clipboard';
import { Stack, useLocalSearchParams } from 'expo-router';
import { useEffect } from 'react';
import { Alert, Linking, View } from 'react-native';

import { Button, Card, Line, Notice, Page, T, useTheme } from '@/components/ui';
import { dialUrl, isDialCode, localNumber, saleMoving, saleStatusOf, timeLeft } from '@/lib/airtime';
import { api, ApiError } from '@/lib/api';
import { formatMoney } from '@/lib/money';
import type { AirtimeSale } from '@/lib/types';

/**
 * One airtime sale. While it waits: BitoCard's number to send to, the network's transfer code (dialled from here),
 * the time left, then "I've sent it" or Cancel. Then it is checked (asked again every 10 seconds) and paid after the
 * hold, or not received and why.
 */
export default function AirtimeSaleScreen() {
  const theme = useTheme();
  const queries = useQueryClient();
  const { id } = useLocalSearchParams<{ id: string }>();
  const sale = useQuery({
    queryKey: ['airtime-sales', id],
    queryFn: () => api<AirtimeSale>(`/v1/store/airtime/sales/${id}`),
    refetchInterval: query => (query.state.data && saleMoving(query.state.data.status) ? 10_000 : false),
  });
  const step = useMutation({
    mutationFn: (what: 'sent' | 'cancel') => api<AirtimeSale>(`/v1/store/airtime/sales/${id}/${what}`, { body: {} }),
    onSuccess: next => {
      queries.setQueryData(['airtime-sales', id], next);
      void queries.invalidateQueries({ queryKey: ['airtime-trades'] });
    },
  });
  const simulate = useMutation({
    mutationFn: (outcome: 'received' | 'not_received') => api<AirtimeSale>(`/v1/store/airtime/sales/${id}/simulate`, { body: { outcome } }),
    onSuccess: () => void sale.refetch(),
  });
  const credited = sale.data?.status === 'credited';
  useEffect(() => {
    if (credited) void queries.invalidateQueries({ queryKey: ['wallet'] });
  }, [credited, queries]);

  const data = sale.data;
  if (!data) return <Page>{sale.isError ? <Notice tone="bad">{sale.error instanceof ApiError ? sale.error.message : 'This sale could not be read.'}</Notice> : <T muted>Loading…</T>}</Page>;
  const status = saleStatusOf(data.status);
  const waiting = data.status === 'awaiting_transfer';
  const left = timeLeft(data.expires_at);
  const copy = (value: string) => void Clipboard.setStringAsync(value);
  const confirmSent = () =>
    Alert.alert('Have you sent it?', `Say so only once ${formatMoney(data.amount, data.currency, { cents: false })} has left ${localNumber(data.from_phone)}. A sale said sent that never arrives counts against you.`, [
      { text: 'Not yet', style: 'cancel' },
      { text: "I've sent it", onPress: () => step.mutate('sent') },
    ]);

  return (
    <Page>
      <Stack.Screen options={{ title: data.number }} />
      <T kind="heading">{data.network.toUpperCase()} airtime</T>
      <T kind="amount" color={credited ? theme.good : theme.text}>
        {formatMoney(data.payout, data.currency)}
      </T>
      <T kind="label" color={{ good: theme.good, warn: theme.warn, bad: theme.bad }[status.tone]} accessibilityLiveRegion="polite">
        {status.label}
      </T>
      <Card>
        <Line label="You send" value={formatMoney(data.amount, data.currency, { cents: false })} />
        <Line label="From" value={localNumber(data.from_phone)} />
        {data.collector_number ? <Line label="To" value={localNumber(data.collector_number)} strong /> : null}
        <Line label="Started" value={new Date(data.created_at).toLocaleString()} />
      </Card>

      {waiting ? (
        <>
          {data.collector_number ? <Button kind="secondary" label="Copy the number" onPress={() => copy(data.collector_number!)} /> : null}
          {data.transfer_steps ? (
            <Card>
              <T kind="label">How to send it</T>
              <T selectable>{data.transfer_steps}</T>
              <T kind="small" muted>
                PIN is your own transfer PIN: never share it with anyone, us included.
              </T>
              {isDialCode(data.transfer_steps) ? (
                <View style={{ flexDirection: 'row', gap: 8 }}>
                  <View style={{ flex: 1 }}>
                    <Button label="Dial it" onPress={() => void Linking.openURL(dialUrl(data.transfer_steps!))} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Button kind="secondary" label="Copy code" onPress={() => copy(data.transfer_steps!)} />
                  </View>
                </View>
              ) : null}
            </Card>
          ) : null}
          <Notice tone="bad">Send it only from {localNumber(data.from_phone)}. Airtime from any other number is lost and cannot be claimed.</Notice>
          {left ? <T muted>Send it within {left}.</T> : <Notice tone="bad">The time to send it has run out.</Notice>}
          {step.isError ? <Notice tone="bad">{step.error instanceof ApiError ? step.error.message : 'Something went wrong.'}</Notice> : null}
          <Button label="I've sent it" onPress={confirmSent} busy={step.isPending} disabled={!left} />
          <Button kind="secondary" label="Cancel this sale" onPress={() => step.mutate('cancel')} />
        </>
      ) : null}
      {data.status === 'sent' ? <Notice>Our team is checking that it arrived, usually within the hour. This page updates by itself.</Notice> : null}
      {data.status === 'received' && data.credit_at ? <Notice tone="good">It arrived. {formatMoney(data.payout, data.currency)} is paid to your wallet on {new Date(data.credit_at).toLocaleString()}.</Notice> : null}
      {credited ? <Notice tone="good">{formatMoney(data.payout, data.currency)} is in your wallet.</Notice> : null}
      {data.note ? <Notice tone="bad">{data.note}</Notice> : null}

      {data.mode === 'test' && saleMoving(data.status) ? (
        <Card>
          <T kind="small" muted>
            Sandbox sale: choose how it ends.
          </T>
          <Button kind="secondary" label="Simulate received" onPress={() => simulate.mutate('received')} busy={simulate.isPending} />
          <Button kind="secondary" label="Simulate not received" onPress={() => simulate.mutate('not_received')} />
        </Card>
      ) : null}
    </Page>
  );
}

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { router, useLocalSearchParams } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import { useEffect, useState } from 'react';
import { View } from 'react-native';

import { Button, Card, Chip, Field, Notice, Page, T } from '@/components/ui';
import { api, ApiError } from '@/lib/api';
import { useMoneyKey } from '@/lib/biometrics';
import { siteUrl } from '@/lib/config';
import { formatMoney, toMinor } from '@/lib/money';
import type { TopUp, Wallet } from '@/lib/types';

/**
 * Add funds: an amount and one of the market's ways to pay; the payment provider's own page opens in an in-app browser,
 * and once it closes the app asks the top-up's status until the provider confirms it (the wallet is credited then).
 */
export default function AddFunds() {
  const queries = useQueryClient();
  const params = useLocalSearchParams<{ currency?: string }>();
  const wallet = useQuery({ queryKey: ['wallet', params.currency ?? 'primary'], queryFn: () => api<Wallet>(`/v1/store/wallet${params.currency ? `?currency=${params.currency}` : ''}`) });
  const [amount, setAmount] = useState('');
  const [method, setMethod] = useState<string | null>(null);
  const [topUpId, setTopUpId] = useState<string | null>(null);
  const key = useMoneyKey();
  const currency = wallet.data?.currency ?? params.currency ?? 'NGN';
  const chosen = method ?? wallet.data?.top_up_methods[0]?.id ?? null;

  const start = useMutation({
    mutationFn: async () => {
      const minor = toMinor(amount, currency);
      if (!minor || minor < 100) throw new Error('Enter an amount to add.');
      const topUp = await api<TopUp>('/v1/store/wallet/top-ups', {
        body: { amount: minor, method: chosen ?? undefined, currency, return_url: `${siteUrl}/account/wallet` },
        idempotencyKey: key.current(),
      });
      if (topUp.checkout_url) await WebBrowser.openBrowserAsync(topUp.checkout_url).catch(() => undefined);
      return topUp;
    },
    onSuccess: topUp => {
      key.settle();
      setTopUpId(topUp.id);
    },
    onError: error => key.settle(error),
  });

  const status = useQuery({
    queryKey: ['top-up', topUpId],
    enabled: Boolean(topUpId),
    queryFn: () => api<TopUp>(`/v1/store/wallet/top-ups/${topUpId}`),
    refetchInterval: query => (query.state.data?.status === 'pending' ? 4000 : false),
  });
  const topUp = status.data;
  const settled = topUp && topUp.status !== 'pending' ? topUp.status : null;
  useEffect(() => {
    if (settled) void queries.invalidateQueries({ queryKey: ['wallet'] });
  }, [settled, queries]);

  const simulate = useMutation({
    mutationFn: (outcome: 'succeeded' | 'failed') => api<TopUp>(`/v1/store/wallet/top-ups/${topUpId}/simulate`, { body: { outcome } }),
    onSuccess: () => void status.refetch(),
  });

  if (topUpId) {
    return (
      <Page>
        <T kind="title" accessibilityRole="header">
          {topUp?.status === 'succeeded' ? 'Funds added' : topUp?.status === 'failed' ? 'Not added' : 'Waiting for the payment'}
        </T>
        {topUp ? <T kind="amount">{formatMoney(topUp.amount, topUp.currency)}</T> : null}
        {topUp?.status === 'pending' ? <Notice>Finish paying on the payment page. This updates by itself once the provider confirms it.</Notice> : null}
        {topUp?.status === 'succeeded' ? <Notice tone="good">It is in your {topUp.currency} wallet.</Notice> : null}
        {topUp?.status === 'failed' ? <Notice tone="bad">{topUp.failure_reason ?? 'The payment did not go through. Nothing was added.'}</Notice> : null}
        {topUp?.status === 'pending' && topUp.checkout_url ? <Button kind="secondary" label="Open the payment page again" onPress={() => void WebBrowser.openBrowserAsync(topUp.checkout_url!)} /> : null}
        {topUp?.mode === 'test' && topUp.status === 'pending' ? (
          <Card>
            <T kind="small" muted>
              Sandbox top-up: choose how it ends.
            </T>
            <Button kind="secondary" label="Simulate paid" onPress={() => simulate.mutate('succeeded')} busy={simulate.isPending} />
            <Button kind="secondary" label="Simulate failed" onPress={() => simulate.mutate('failed')} />
          </Card>
        ) : null}
        <Button label="Done" onPress={() => router.back()} />
      </Page>
    );
  }

  return (
    <Page>
      <T kind="title" accessibilityRole="header">
        Add funds
      </T>
      <Field label={`Amount (${currency})`} value={amount} onChangeText={setAmount} keyboardType="decimal-pad" placeholder="5,000" />
      {wallet.data ? (
        wallet.data.top_up_methods.length ? (
          <View style={{ gap: 8 }} accessibilityRole="radiogroup" accessibilityLabel="How you'll pay">
            <T kind="label">How you&apos;ll pay</T>
            {wallet.data.top_up_methods.map(item => (
              <Chip key={item.id} ring selected={item.id === chosen} label={item.label} onPress={() => setMethod(item.id)} />
            ))}
            {wallet.data.top_up_methods.find(item => item.id === chosen)?.description ? <T kind="small" muted>{wallet.data.top_up_methods.find(item => item.id === chosen)!.description}</T> : null}
          </View>
        ) : (
          <Notice>No card or mobile money payments here right now. Use your account number or a bank deposit instead.</Notice>
        )
      ) : wallet.isError ? (
        <Notice tone="bad">The ways to pay could not be loaded. Check your connection.</Notice>
      ) : (
        <T muted>Loading…</T>
      )}
      {start.isError ? <Notice tone="bad">{start.error instanceof ApiError || start.error instanceof Error ? start.error.message : 'Something went wrong.'}</Notice> : null}
      <Button kind="accent" label="Continue to pay" onPress={() => start.mutate()} busy={start.isPending} disabled={!chosen} />
      <T kind="small" muted>
        You pay on the payment provider&apos;s own page. Your wallet is credited once they confirm it.
      </T>
      <Button kind="secondary" label="Pay by bank deposit instead" onPress={() => router.replace({ pathname: '/bank-deposit', params: { currency } })} />
    </Page>
  );
}

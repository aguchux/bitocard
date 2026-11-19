import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';

import { Button, Card, Chip, Line, Notice, Page, T } from '@/components/ui';
import { api, ApiError } from '@/lib/api';
import { confirmOnPhone, useMoneyKey } from '@/lib/biometrics';
import { siteUrl } from '@/lib/config';
import { formatMoney } from '@/lib/money';
import type { Checkout, CheckoutPreview } from '@/lib/types';

/**
 * Confirm payment: the API quotes the price first (`preview`, nothing paid) and the customer sees it with what each of
 * their wallets would pay; Pay asks Face ID, the fingerprint or the PIN, then pays exactly that quote from the chosen
 * wallet, keeping its Idempotency-Key until the API answers, so a retried tap never pays twice.
 */
export default function Pay() {
  const queries = useQueryClient();
  const params = useLocalSearchParams<{ product: string; face: string; phone?: string; email?: string; name?: string; quantity?: string }>();
  const [walletCurrency, setWalletCurrency] = useState<string | null>(null);
  const key = useMoneyKey();
  const order = {
    product_id: params.product,
    face_value: Number(params.face),
    quantity: params.quantity ? Number(params.quantity) : undefined,
    recipient: params.phone ? { phone: params.phone } : params.email ? { email: params.email } : undefined,
    method: 'wallet',
    return_url: `${siteUrl}/checkout/return`,
  };
  const preview = useQuery({
    queryKey: ['checkout-preview', params.product, params.face, params.phone, params.email, params.quantity],
    queryFn: () => api<CheckoutPreview>('/v1/store/checkouts', { body: { ...order, preview: true } }),
    staleTime: 0,
    gcTime: 0,
    retry: false,
  });
  const quote = preview.data;
  const chosen = quote ? (quote.wallet_options.find(option => option.currency === walletCurrency) ?? quote.wallet_options.find(option => option.enough) ?? quote.wallet_options[0]) : undefined;

  const pay = useMutation({
    mutationFn: async () => {
      if (!quote || !chosen) throw new Error('No price to pay yet.');
      if (!(await confirmOnPhone(`Pay ${formatMoney(chosen.amount, chosen.currency)}`))) return null;
      return api<Checkout>('/v1/store/checkouts', { body: { ...order, quote_id: quote.quote_id, wallet_currency: chosen.currency }, idempotencyKey: key.current() });
    },
    onSuccess: checkout => {
      if (!checkout) return;
      key.settle();
      queries.invalidateQueries({ queryKey: ['wallet'] });
      queries.invalidateQueries({ queryKey: ['orders'] });
      router.replace({ pathname: '/order/[id]', params: { id: checkout.id } });
    },
    onError: error => key.settle(error),
  });

  const expired = pay.error instanceof ApiError && pay.error.code === 'quote_expired';

  return (
    <Page>
      <T kind="title" accessibilityRole="header">
        Confirm payment
      </T>
      {preview.isPending ? <T muted>Getting the price…</T> : null}
      {preview.isError ? (
        <>
          <Notice tone="bad">{preview.error instanceof ApiError ? preview.error.message : 'The price could not be worked out. Check your connection.'}</Notice>
          {preview.error instanceof ApiError && preview.error.code === 'customer_verification_required' ? (
            <Button label="Check my identity" onPress={() => router.push('/identity')} />
          ) : (
            <Button kind="secondary" label="Try again" onPress={() => void preview.refetch()} />
          )}
        </>
      ) : null}
      {quote && chosen ? (
        <>
          <T kind="amount" accessibilityLabel={`To pay ${formatMoney(chosen.amount, chosen.currency)}`} style={{ textAlign: 'center' }}>
            {formatMoney(chosen.amount, chosen.currency)}
          </T>
          <Card>
            <Line label="For" value={params.name ?? 'Your order'} />
            {params.phone ? <Line label="To" value={params.phone} /> : null}
            {params.email ? <Line label="Codes sent to" value={params.email} /> : null}
            {quote.tax ? <Line label={`Includes ${quote.tax.name}`} value={formatMoney(quote.tax.amount, quote.currency)} /> : null}
            <Line label="From" value={`${chosen.currency} wallet · ${formatMoney(chosen.balance, chosen.currency)}`} />
          </Card>
          {quote.wallet_options.length > 1 ? (
            <View style={{ gap: 8 }} accessibilityRole="radiogroup" accessibilityLabel="Pay from">
              <T kind="label">Pay from</T>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                {quote.wallet_options.map(option => (
                  <Chip key={option.currency} ring selected={option.currency === chosen.currency} label={`${option.currency} · ${formatMoney(option.amount, option.currency)}`} onPress={() => setWalletCurrency(option.currency)} />
                ))}
              </View>
            </View>
          ) : null}
          {chosen.enough ? (
            <Button label={`Pay ${formatMoney(chosen.amount, chosen.currency)}`} onPress={() => pay.mutate()} busy={pay.isPending} />
          ) : (
            <>
              <Notice>Not enough in your {chosen.currency} wallet. Add {formatMoney(chosen.amount - chosen.balance, chosen.currency)} to continue.</Notice>
              <Button kind="accent" label="Add funds" onPress={() => router.push({ pathname: '/add-funds', params: { currency: chosen.currency } })} />
            </>
          )}
          {pay.isError ? <Notice tone="bad">{pay.error instanceof ApiError ? pay.error.message : 'No answer from BitoCard. Tap Pay again: you will not be charged twice.'}</Notice> : null}
          {expired ? <Button kind="secondary" label="Get a new price" onPress={() => void preview.refetch()} /> : null}
          <T kind="small" muted style={{ textAlign: 'center' }}>
            Price held until {new Date(quote.expires_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}.
          </T>
        </>
      ) : null}
    </Page>
  );
}

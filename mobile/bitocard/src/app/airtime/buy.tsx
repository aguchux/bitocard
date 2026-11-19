import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useState } from 'react';

import { NetworkChips, NumberChips } from '@/components/airtime';
import { Button, Card, Field, Line, Notice, Page, T } from '@/components/ui';
import { useAccount } from '@/lib/account';
import { localNumber, rateText, tradeAmount } from '@/lib/airtime';
import { api, ApiError } from '@/lib/api';
import { confirmOnPhone, useMoneyKey } from '@/lib/biometrics';
import { formatMoney } from '@/lib/money';
import type { AirtimePool, AirtimePurchase, AirtimePurchaseQuote, CustomerPhones } from '@/lib/types';

/**
 * Buy unused airtime from the pool: a network with airtime in it, the confirmed number it goes to, the amount, then the
 * price (the API's), then Face ID or PIN and the price paid from the wallet with a kept Idempotency-Key.
 */
export default function BuyAirtime() {
  const queries = useQueryClient();
  const { customer } = useAccount();
  const country = customer?.country ?? 'NG';
  const pool = useQuery({ queryKey: ['airtime-pool', country], queryFn: () => api<AirtimePool>(`/v1/store/airtime/pool?country=${country}`), refetchInterval: 20_000 });
  const phones = useQuery({ queryKey: ['phones'], queryFn: () => api<CustomerPhones>('/v1/store/account/phones') });
  const key = useMoneyKey();
  const [network, setNetwork] = useState<string | null>(null);
  const [chosenPhone, setPhone] = useState<string | null>(null);
  const [amount, setAmount] = useState('');
  const [quote, setQuote] = useState<AirtimePurchaseQuote | null>(null);
  const [problem, setProblem] = useState<{ text: string; code?: string } | null>(null);

  const currency = pool.data?.currency ?? customer?.currency ?? 'NGN';
  const open = (pool.data?.networks ?? []).filter(item => item.open && item.available > 0);
  const chosen = open.find(item => item.network === network);
  const phone = chosenPhone ?? phones.data?.default ?? phones.data?.data[0]?.phone ?? null;

  const order = () => {
    if (!chosen) throw new Error('Choose the network.');
    if (!phone) throw new Error('Choose the number it goes to.');
    const checked = tradeAmount(amount, chosen, currency);
    if ('problem' in checked) throw new Error(checked.problem);
    return { network: chosen.network, amount: checked.amount, phone };
  };
  const failed = (error: Error) => setProblem({ text: error.message, code: error instanceof ApiError ? error.code : undefined });
  const forget = () => setQuote(null);

  const preview = useMutation({
    mutationFn: () => api<AirtimePurchaseQuote>('/v1/store/airtime/purchases', { body: { ...order(), preview: true } }),
    onMutate: () => setProblem(null),
    onSuccess: setQuote,
    onError: failed,
  });
  const pay = useMutation({
    mutationFn: async () => {
      if (!quote) return null;
      if (!(await confirmOnPhone(`Pay ${formatMoney(quote.price, quote.currency)}`))) return null;
      return api<AirtimePurchase>('/v1/store/airtime/purchases', { body: { ...order(), expected_price: quote.price }, idempotencyKey: key.current() });
    },
    onMutate: () => setProblem(null),
    onSuccess: purchase => {
      if (!purchase) return;
      key.settle();
      void queries.invalidateQueries({ queryKey: ['wallet'] });
      void queries.invalidateQueries({ queryKey: ['airtime-trades'] });
      router.replace({ pathname: '/airtime/purchase/[id]', params: { id: purchase.id } });
    },
    onError: error => {
      key.settle(error);
      failed(error);
      if (error instanceof ApiError && ['price_changed', 'pool_short'].includes(error.code)) forget();
    },
  });

  if (pool.isPending) return <Page><T muted>Loading…</T></Page>;
  if (pool.isError) return <Page><Notice tone="bad">{pool.error instanceof ApiError ? pool.error.message : 'The exchange could not be read.'}</Notice></Page>;

  return (
    <Page>
      <T kind="title" accessibilityRole="header">
        Buy unused airtime
      </T>
      {open.length === 0 ? <Notice>There is no airtime in the pool right now. Try again later.</Notice> : null}
      <NetworkChips
        networks={open}
        value={network}
        onChange={next => {
          setNetwork(next);
          forget();
        }}
      />
      {chosen ? <T kind="small" muted>You pay {rateText(chosen.buy_rate_bps)} of its value · {formatMoney(chosen.available, currency, { cents: false })} available</T> : null}
      <NumberChips
        label="Send it to"
        phones={phones.data}
        value={phone}
        onChange={next => {
          setPhone(next);
          forget();
        }}
      />
      <Field
        label={`Airtime (${currency})`}
        value={amount}
        onChangeText={value => {
          setAmount(value);
          forget();
        }}
        keyboardType="number-pad"
        hint={chosen ? `${formatMoney(chosen.min_amount, currency, { cents: false })} to ${formatMoney(Math.min(chosen.max_amount, chosen.available), currency, { cents: false })}` : undefined}
      />
      {problem ? <Notice tone="bad">{problem.text}</Notice> : null}
      {problem?.code === 'wallet_balance_low' ? <Button kind="secondary" label="Add funds" onPress={() => router.push({ pathname: '/add-funds', params: { currency } })} /> : null}
      {quote ? (
        <>
          <Card>
            <Line label="Airtime" value={formatMoney(quote.amount, quote.currency, { cents: false })} />
            <Line label="To" value={localNumber(quote.phone)} />
            <Line label="You pay" value={formatMoney(quote.price, quote.currency)} strong />
          </Card>
          <T kind="small" muted>
            Our team sends it within the hour, or the money goes back to your wallet.
          </T>
          <Button label={`Pay ${formatMoney(quote.price, quote.currency)}`} onPress={() => pay.mutate()} busy={pay.isPending} />
        </>
      ) : (
        <Button label="See the price" onPress={() => preview.mutate()} busy={preview.isPending} disabled={!phone} />
      )}
    </Page>
  );
}

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useState } from 'react';

import { NetworkChips, NumberChips } from '@/components/airtime';
import { Button, Card, Field, Line, Notice, Page, T } from '@/components/ui';
import { useAccount } from '@/lib/account';
import { localNumber, rateText, tradeAmount } from '@/lib/airtime';
import { api, ApiError } from '@/lib/api';
import { useMoneyKey } from '@/lib/biometrics';
import { formatMoney } from '@/lib/money';
import type { AirtimePool, AirtimeSale, AirtimeSaleQuote, AirtimeSeller, CustomerPhones } from '@/lib/types';

/**
 * Sell unused airtime: the network, the confirmed number it comes from, the amount, then what you get (the API's own
 * figure), then the sale starts and its page says where to send it. Airtime from any other number is lost.
 */
export default function SellAirtime() {
  const queries = useQueryClient();
  const { customer } = useAccount();
  const country = customer?.country ?? 'NG';
  const pool = useQuery({ queryKey: ['airtime-pool', country], queryFn: () => api<AirtimePool>(`/v1/store/airtime/pool?country=${country}`) });
  const seller = useQuery({ queryKey: ['airtime-seller'], queryFn: () => api<AirtimeSeller>('/v1/store/airtime/seller') });
  const phones = useQuery({ queryKey: ['phones'], queryFn: () => api<CustomerPhones>('/v1/store/account/phones') });
  const key = useMoneyKey();
  const [network, setNetwork] = useState<string | null>(null);
  const [chosenPhone, setPhone] = useState<string | null>(null);
  const [amount, setAmount] = useState('');
  const [quote, setQuote] = useState<AirtimeSaleQuote | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

  const currency = pool.data?.currency ?? customer?.currency ?? 'NGN';
  const open = (pool.data?.networks ?? []).filter(item => item.open);
  const chosen = open.find(item => item.network === network);
  const phone = chosenPhone ?? phones.data?.default ?? phones.data?.data[0]?.phone ?? null;
  const limit = seller.data?.networks.find(item => item.network === network);

  const order = (preview: boolean) => {
    if (!chosen) throw new Error('Choose the network.');
    if (!phone) throw new Error('Choose the number you are sending from.');
    const checked = tradeAmount(amount, chosen, currency);
    if ('problem' in checked) throw new Error(checked.problem);
    return { network: chosen.network, amount: checked.amount, from_phone: phone, ...(preview ? { preview: true } : {}) };
  };
  const forget = () => setQuote(null);

  const preview = useMutation({
    mutationFn: () => api<AirtimeSaleQuote>('/v1/store/airtime/sales', { body: order(true) }),
    onMutate: () => setProblem(null),
    onSuccess: setQuote,
    onError: error => setProblem(error.message),
  });
  const start = useMutation({
    mutationFn: () => api<AirtimeSale>('/v1/store/airtime/sales', { body: order(false), idempotencyKey: key.current() }),
    onMutate: () => setProblem(null),
    onSuccess: sale => {
      key.settle();
      void queries.invalidateQueries({ queryKey: ['airtime-trades'] });
      router.replace({ pathname: '/airtime/sale/[id]', params: { id: sale.id } });
    },
    onError: error => {
      key.settle(error);
      setProblem(error.message);
      if (error instanceof ApiError && error.param === 'amount') forget();
    },
  });

  if (pool.isPending) return <Page><T muted>Loading…</T></Page>;
  if (pool.isError) return <Page><Notice tone="bad">{pool.error instanceof ApiError ? pool.error.message : 'The exchange could not be read.'}</Notice></Page>;

  return (
    <Page>
      <T kind="title" accessibilityRole="header">
        Sell unused airtime
      </T>
      {seller.data?.paused ? <Notice tone="bad">Selling airtime is paused on your account: {seller.data.strikes} of your sales were not received or were reversed.</Notice> : null}
      {open.length === 0 ? <Notice>No network is taking airtime right now. Try again later.</Notice> : null}
      <NetworkChips
        networks={open}
        value={network}
        onChange={next => {
          setNetwork(next);
          forget();
        }}
      />
      {chosen ? <T kind="small" muted>You get {rateText(chosen.sell_rate_bps)} of what you send{limit ? `, up to ${formatMoney(limit.daily_limit, currency, { cents: false })} a day${limit.new_seller ? ' while you are new' : ''}` : ''}.</T> : null}
      <NumberChips
        label="Sending from"
        phones={phones.data}
        value={phone}
        onChange={next => {
          setPhone(next);
          forget();
        }}
      />
      <Field
        label={`Amount (${currency})`}
        value={amount}
        onChangeText={value => {
          setAmount(value);
          forget();
        }}
        keyboardType="number-pad"
        hint={chosen ? `${formatMoney(chosen.min_amount, currency, { cents: false })} to ${formatMoney(chosen.max_amount, currency, { cents: false })}` : undefined}
      />
      {problem ? <Notice tone="bad">{problem}</Notice> : null}
      {quote ? (
        <>
          <Card>
            <Line label="You send" value={formatMoney(quote.amount, quote.currency, { cents: false })} />
            <Line label="You get in your wallet" value={formatMoney(quote.payout, quote.currency)} strong />
            <Line label="From" value={localNumber(quote.from_phone)} />
          </Card>
          <Notice tone="bad">Send it only from {localNumber(quote.from_phone)}. Airtime sent from any other number cannot be matched to you: it is lost and is not refunded.</Notice>
          <Button label="Start the sale" onPress={() => start.mutate()} busy={start.isPending} />
        </>
      ) : (
        <Button label="See what you get" onPress={() => preview.mutate()} busy={preview.isPending} disabled={!phone || Boolean(seller.data?.paused)} />
      )}
    </Page>
  );
}

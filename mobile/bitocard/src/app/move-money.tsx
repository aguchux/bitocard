import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';

import { Button, Card, Chip, Field, Line, Notice, Page, T } from '@/components/ui';
import { api, ApiError } from '@/lib/api';
import { confirmOnPhone, useMoneyKey } from '@/lib/biometrics';
import { formatMoney, toMinor } from '@/lib/money';
import type { Conversion, Wallet } from '@/lib/types';

/**
 * Move money between the customer's wallets at BitoCard's rate: the API quotes what arrives first (`preview`), then
 * the move is confirmed on the phone and sent with that amount, so a worse rate meanwhile is refused (`rate_changed`).
 */
export default function MoveMoney() {
  const queries = useQueryClient();
  const params = useLocalSearchParams<{ from?: string }>();
  const wallet = useQuery({ queryKey: ['wallet', 'primary'], queryFn: () => api<Wallet>('/v1/store/wallet') });
  const currencies = wallet.data?.wallets.map(item => item.currency) ?? [];
  const [from, setFrom] = useState(params.from ?? null);
  const [to, setTo] = useState<string | null>(null);
  const [amount, setAmount] = useState('');
  const [quote, setQuote] = useState<Conversion | null>(null);
  const key = useMoneyKey();
  const source = from ?? currencies[0] ?? null;
  const target = to && to !== source ? to : (currencies.find(code => code !== source) ?? null);
  const balance = wallet.data?.wallets.find(item => item.currency === source)?.balance;

  const preview = useMutation({
    mutationFn: () => {
      const minor = source ? toMinor(amount, source) : null;
      if (!source || !target || !minor) throw new Error('Enter an amount to move.');
      return api<Conversion>('/v1/store/wallet/conversions', { body: { from: source, to: target, amount: minor, preview: true } });
    },
    onSuccess: setQuote,
  });
  const move = useMutation({
    mutationFn: async () => {
      if (!quote) throw new Error('See what arrives first.');
      if (!(await confirmOnPhone(`Move ${formatMoney(quote.from.amount, quote.from.currency)}`))) return null;
      return api<Conversion>('/v1/store/wallet/conversions', {
        body: { from: quote.from.currency, to: quote.to.currency, amount: quote.from.amount, expected_amount: quote.to.amount },
        idempotencyKey: key.current(),
        transaction: true,
      });
    },
    onSuccess: done => {
      if (!done) return;
      key.settle();
      void queries.invalidateQueries({ queryKey: ['wallet'] });
      router.back();
    },
    onError: error => {
      key.settle(error);
      if (error instanceof ApiError && error.code === 'rate_changed') setQuote(null);
    },
  });

  const pick = (setter: (code: string) => void) => (code: string) => {
    setter(code);
    setQuote(null);
  };
  const failure = preview.error ?? move.error;

  return (
    <Page>
      <T kind="title" accessibilityRole="header">
        Move money
      </T>
      {wallet.data && currencies.length < 2 ? <Notice>You have one wallet. Add another currency on bitocard.com to move money between them.</Notice> : null}
      <View style={{ gap: 8 }} accessibilityRole="radiogroup" accessibilityLabel="From">
        <T kind="label">From</T>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
          {currencies.map(code => (
            <Chip key={code} label={code} selected={code === source} onPress={() => pick(setFrom)(code)} />
          ))}
        </View>
      </View>
      <View style={{ gap: 8 }} accessibilityRole="radiogroup" accessibilityLabel="To">
        <T kind="label">To</T>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
          {currencies
            .filter(code => code !== source)
            .map(code => (
              <Chip key={code} label={code} selected={code === target} onPress={() => pick(setTo)(code)} />
            ))}
        </View>
      </View>
      <Field
        label={`Amount (${source ?? ''})`}
        value={amount}
        onChangeText={value => {
          setAmount(value);
          setQuote(null);
        }}
        keyboardType="decimal-pad"
        hint={balance !== undefined && source ? `You have ${formatMoney(balance, source)}` : undefined}
      />
      {quote ? (
        <Card>
          <Line label="You move" value={formatMoney(quote.from.amount, quote.from.currency)} />
          <Line label="Arrives" value={formatMoney(quote.to.amount, quote.to.currency)} strong />
          <T kind="small" muted>
            Rate 1 {quote.from.currency} = {quote.rate} {quote.to.currency}, BitoCard&apos;s margin included.
          </T>
        </Card>
      ) : null}
      {failure ? <Notice tone="bad">{failure instanceof Error ? failure.message : 'Something went wrong.'}</Notice> : null}
      {quote ? (
        <Button label={`Move ${formatMoney(quote.from.amount, quote.from.currency)}`} onPress={() => move.mutate()} busy={move.isPending} />
      ) : (
        <Button label="See what arrives" onPress={() => preview.mutate()} busy={preview.isPending} disabled={currencies.length < 2} />
      )}
    </Page>
  );
}

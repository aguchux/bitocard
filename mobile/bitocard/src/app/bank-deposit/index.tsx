import { useMutation, useQuery } from '@tanstack/react-query';
import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Pressable, View } from 'react-native';

import { Button, Card, Chip, Field, Notice, Page, T, useTheme } from '@/components/ui';
import { api, ApiError } from '@/lib/api';
import { formatMoney, toMinor } from '@/lib/money';
import type { BankDeposit, BankDepositOptions, Page as List } from '@/lib/types';

/**
 * Bank deposit: pay BitoCard's bank account at a bank or by transfer with a reference; BitoCard's team credits what
 * arrives once they see it in the bank. The customer's open deposits are listed first.
 */
export default function BankDepositStart() {
  const theme = useTheme();
  const params = useLocalSearchParams<{ currency?: string }>();
  const options = useQuery({ queryKey: ['bank-deposit-options', params.currency ?? ''], queryFn: () => api<BankDepositOptions>(`/v1/store/wallet/bank-deposits/options${params.currency ? `?currency=${params.currency}` : ''}`) });
  const open = useQuery({ queryKey: ['bank-deposits', 'open'], queryFn: () => api<List<BankDeposit>>('/v1/store/wallet/bank-deposits?show=open&limit=10') });
  const [amount, setAmount] = useState('');
  const [accountId, setAccountId] = useState<string | null>(null);
  const currency = options.data?.currency ?? params.currency ?? 'NGN';
  const chosen = accountId ?? options.data?.accounts[0]?.id ?? null;

  const create = useMutation({
    mutationFn: () => {
      const minor = toMinor(amount, currency);
      if (!minor) throw new Error('Enter the amount you will pay.');
      return api<BankDeposit>('/v1/store/wallet/bank-deposits', { body: { amount: minor, currency, account_id: chosen ?? undefined }, transaction: true });
    },
    onSuccess: deposit => router.replace({ pathname: '/bank-deposit/[id]', params: { id: deposit.id } }),
  });

  return (
    <Page>
      <T kind="title" accessibilityRole="header">
        Bank deposit
      </T>
      <Button kind="secondary" label="All your deposits" onPress={() => router.push('/bank-deposit/all')} />
      {open.data?.data.length ? (
        <View style={{ gap: 8 }}>
          <T kind="label">Your open deposits</T>
          {open.data.data.map(deposit => (
            <Pressable key={deposit.id} accessibilityRole="button" onPress={() => router.push({ pathname: '/bank-deposit/[id]', params: { id: deposit.id } })}>
              <Card style={{ flexDirection: 'row', alignItems: 'center' }}>
                <T style={{ flex: 1 }}>
                  {deposit.number} · {formatMoney(deposit.amount, deposit.currency)}
                </T>
                <T kind="small" color={theme.pinkText}>
                  {deposit.status === 'sent' ? 'Being checked' : 'Waiting for you'}
                </T>
              </Card>
            </Pressable>
          ))}
        </View>
      ) : null}
      {options.isError ? <Notice tone="bad">{options.error instanceof ApiError ? options.error.message : 'Bank deposits could not be loaded.'}</Notice> : null}
      {options.data && !options.data.available ? <Notice>Bank deposits are not open for {currency} right now. Use Add funds instead.</Notice> : null}
      {options.data?.available ? (
        <>
          <T muted>Pay at a bank or by transfer with the reference we give you, within {options.data.window_hours} hours. Our team credits what arrives after checking the bank.</T>
          <Field label={`Amount you'll pay (${currency})`} value={amount} onChangeText={setAmount} keyboardType="decimal-pad" hint={`At least ${formatMoney(options.data.min_amount, currency, { cents: false })}`} />
          {options.data.accounts.length > 1 ? (
            <View style={{ gap: 8 }} accessibilityRole="radiogroup" accessibilityLabel="Bank">
              <T kind="label">Bank</T>
              {options.data.accounts.map(account => (
                <Chip key={account.id} ring selected={account.id === chosen} label={account.bank_name} onPress={() => setAccountId(account.id)} />
              ))}
            </View>
          ) : null}
          {create.isError ? <Notice tone="bad">{create.error instanceof Error ? create.error.message : 'Something went wrong.'}</Notice> : null}
          <Button label="Get deposit details" onPress={() => create.mutate()} busy={create.isPending} />
        </>
      ) : null}
    </Page>
  );
}

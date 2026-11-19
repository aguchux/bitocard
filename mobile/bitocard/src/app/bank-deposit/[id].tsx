import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import * as Clipboard from 'expo-clipboard';
import { Stack, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';

import { Button, Card, Chip, Field, Line, Notice, Page, T } from '@/components/ui';
import { api, ApiError } from '@/lib/api';
import { formatMoney } from '@/lib/money';
import type { BankDeposit } from '@/lib/types';

const statusWords: Record<BankDeposit['status'], string> = {
  awaiting_payment: 'Waiting for your payment',
  sent: 'Being checked by our team',
  credited: 'Added to your wallet',
  rejected: 'Not credited',
  cancelled: 'Cancelled',
  expired: 'Expired',
};

/** One bank deposit: where to pay with its reference, then "I've paid it" (how, and the name on the payment). */
export default function BankDepositScreen() {
  const queries = useQueryClient();
  const { id } = useLocalSearchParams<{ id: string }>();
  const deposit = useQuery({ queryKey: ['bank-deposits', id], queryFn: () => api<BankDeposit>(`/v1/store/wallet/bank-deposits/${id}`) });
  const [method, setMethod] = useState<'transfer' | 'cash'>('transfer');
  const [sender, setSender] = useState('');
  const step = useMutation({
    mutationFn: (what: 'sent' | 'cancel') =>
      what === 'sent'
        ? sender.trim().length < 2
          ? Promise.reject(new Error('Enter the name on the payment.'))
          : api<BankDeposit>(`/v1/store/wallet/bank-deposits/${id}/sent`, { body: { method, sender_name: sender.trim() } })
        : api<BankDeposit>(`/v1/store/wallet/bank-deposits/${id}/cancel`, { body: {} }),
    onSuccess: () => {
      void deposit.refetch();
      void queries.invalidateQueries({ queryKey: ['bank-deposits', 'open'] });
    },
  });

  const data = deposit.data;
  if (!data) {
    return (
      <Page>
        {deposit.isError ? <Notice tone="bad">{deposit.error instanceof ApiError ? deposit.error.message : 'This deposit could not be read.'}</Notice> : <T muted>Loading…</T>}
      </Page>
    );
  }
  const copy = (value: string) => void Clipboard.setStringAsync(value);

  return (
    <Page>
      <Stack.Screen options={{ title: data.number }} />
      <T kind="amount">{formatMoney(data.amount, data.currency)}</T>
      <T kind="label">{statusWords[data.status]}</T>
      <Card>
        <Line label="Bank" value={data.account.bank_name} />
        <Line label="Account name" value={data.account.account_name} />
        <Line label="Account number" value={data.account.account_number} strong />
        <Line label="Reference" value={data.reference} strong />
        {data.account.details ? <T kind="small" muted>{data.account.details}</T> : null}
        <View style={{ flexDirection: 'row', gap: 8 }}>
          <View style={{ flex: 1 }}>
            <Button kind="secondary" label="Copy number" onPress={() => copy(data.account.account_number)} />
          </View>
          <View style={{ flex: 1 }}>
            <Button kind="secondary" label="Copy reference" onPress={() => copy(data.reference)} />
          </View>
        </View>
      </Card>
      {data.status === 'awaiting_payment' ? (
        <>
          <Notice>Write the reference {data.reference} on the slip or in the transfer note. Pay by {new Date(data.expires_at).toLocaleString()}.</Notice>
          <View style={{ gap: 8 }} accessibilityRole="radiogroup" accessibilityLabel="How you paid">
            <T kind="label">How you paid</T>
            <View style={{ flexDirection: 'row', gap: 8 }}>
              <Chip label="Transfer" selected={method === 'transfer'} onPress={() => setMethod('transfer')} />
              <Chip label="Cash at a bank" selected={method === 'cash'} onPress={() => setMethod('cash')} />
            </View>
          </View>
          <Field label="Name on the payment" value={sender} onChangeText={setSender} autoComplete="name" />
          {step.isError ? <Notice tone="bad">{step.error instanceof Error ? step.error.message : 'Something went wrong.'}</Notice> : null}
          <Button label="I've paid it" onPress={() => step.mutate('sent')} busy={step.isPending} />
          <Button kind="secondary" label="Cancel this deposit" onPress={() => step.mutate('cancel')} />
        </>
      ) : null}
      {data.status === 'sent' ? <Notice>Our team checks the bank and credits what arrived. You will be told once it is in your wallet.</Notice> : null}
      {data.status === 'credited' && data.credited_amount !== null ? <Notice tone="good">{formatMoney(data.credited_amount, data.currency)} was added to your wallet.</Notice> : null}
      {data.status === 'rejected' && data.decision_note ? <Notice tone="bad">{data.decision_note}</Notice> : null}
    </Page>
  );
}

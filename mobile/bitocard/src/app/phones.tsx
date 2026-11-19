import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Alert, View } from 'react-native';

import { Button, Card, Field, Notice, Page, T } from '@/components/ui';
import { api, ApiError } from '@/lib/api';
import { localNumber } from '@/lib/airtime';
import type { CustomerPhones } from '@/lib/types';

const message = (error: unknown) => (error instanceof ApiError ? error.message : 'Something went wrong. Try again.');

/**
 * Your mobile numbers: up to five confirmed ones, the default first. Airtime is sold from and bought to these only, so
 * a new number joins once its texted code is entered. The default can be changed, and any other removed.
 */
export default function PhonesScreen() {
  const queries = useQueryClient();
  const phones = useQuery({ queryKey: ['phones'], queryFn: () => api<CustomerPhones>('/v1/store/account/phones') });
  const [number, setNumber] = useState('');
  const [code, setCode] = useState('');
  const [sentTo, setSentTo] = useState<string | null>(null);
  const saved = (list: CustomerPhones) => queries.setQueryData(['phones'], list);

  const send = useMutation({
    mutationFn: () => api<{ phone: string }>('/v1/store/account/phones', { body: { phone: number.trim() } }),
    onSuccess: reply => setSentTo(reply.phone),
  });
  const verify = useMutation({
    mutationFn: () => api<CustomerPhones>('/v1/store/account/phones/verify', { body: { code: code.trim() } }),
    onSuccess: list => {
      saved(list);
      setSentTo(null);
      setNumber('');
      setCode('');
    },
  });
  const change = useMutation({
    mutationFn: ({ phone, remove }: { phone: string; remove?: boolean }) =>
      remove ? api<CustomerPhones>(`/v1/store/account/phones/${encodeURIComponent(phone)}`, { method: 'DELETE' }) : api<CustomerPhones>('/v1/store/account/phones/default', { body: { phone } }),
    onSuccess: saved,
  });

  const list = phones.data;
  const full = list ? list.data.length >= list.limit : false;
  const askRemove = (phone: string) =>
    Alert.alert('Remove this number?', `${localNumber(phone)} will no longer be used for airtime.`, [
      { text: 'Keep it', style: 'cancel' },
      { text: 'Remove', style: 'destructive', onPress: () => change.mutate({ phone, remove: true }) },
    ]);

  return (
    <Page>
      <T muted>Airtime is sold only from, and sent only to, your confirmed numbers.</T>
      {phones.isPending ? <T muted>Loading…</T> : null}
      {phones.isError ? <Notice tone="bad">{message(phones.error)}</Notice> : null}
      {list && list.data.length === 0 ? <Notice>You have no confirmed number yet. Add one below.</Notice> : null}
      {list?.data.map(item => (
        <Card key={item.phone}>
          <T kind="heading">{localNumber(item.phone)}</T>
          <T kind="small" muted>
            {item.default ? 'Your default number' : 'Confirmed'}
          </T>
          {item.default ? null : (
            <View style={{ flexDirection: 'row', gap: 8 }}>
              <View style={{ flex: 1 }}>
                <Button kind="secondary" label="Make default" onPress={() => change.mutate({ phone: item.phone })} />
              </View>
              <View style={{ flex: 1 }}>
                <Button kind="secondary" label="Remove" onPress={() => askRemove(item.phone)} />
              </View>
            </View>
          )}
        </Card>
      ))}
      {change.isError ? <Notice tone="bad">{message(change.error)}</Notice> : null}

      {full ? (
        <Notice>You have the most numbers allowed ({list?.limit}). Remove one to add another.</Notice>
      ) : sentTo ? (
        <Card>
          <T kind="heading">Enter the code</T>
          <T muted>We texted a 6-digit code to {localNumber(sentTo)}.</T>
          <Field label="Code" value={code} onChangeText={value => setCode(value.replace(/\D/g, '').slice(0, 6))} keyboardType="number-pad" autoComplete="sms-otp" textContentType="oneTimeCode" />
          {verify.isError ? <Notice tone="bad">{message(verify.error)}</Notice> : null}
          <Button label="Confirm number" onPress={() => verify.mutate()} busy={verify.isPending} disabled={code.length !== 6} />
          <Button kind="secondary" label="Send the code again" onPress={() => send.mutate()} busy={send.isPending} />
          {send.isError ? <Notice tone="bad">{message(send.error)}</Notice> : null}
          <Button kind="secondary" label="Use another number" onPress={() => setSentTo(null)} />
        </Card>
      ) : (
        <Card>
          <T kind="heading">Add a number</T>
          <Field label="Mobile number" value={number} onChangeText={setNumber} keyboardType="phone-pad" autoComplete="tel" textContentType="telephoneNumber" placeholder="0806 000 0000" />
          {send.isError ? <Notice tone="bad">{message(send.error)}</Notice> : null}
          <Button label="Text me a code" onPress={() => send.mutate()} busy={send.isPending} disabled={number.replace(/\D/g, '').length < 7} />
        </Card>
      )}
    </Page>
  );
}

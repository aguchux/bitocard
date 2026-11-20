import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { Button, Card, Chip, Field, Line, Notice, Page, T } from '@/components/ui';
import { useAccount } from '@/lib/account';
import { api, ApiError } from '@/lib/api';
import type { Customer, Market } from '@/lib/types';

/**
 * Profile: the customer's name (changeable), the email they sign in with, and their country, fixed once chosen. An
 * older account without one chooses it here, once.
 */
export default function ProfileScreen() {
  const queries = useQueryClient();
  const { customer } = useAccount();
  const [name, setName] = useState(customer?.name ?? '');
  const [country, setCountry] = useState<string | null>(null);
  const markets = useQuery({ queryKey: ['markets'], enabled: Boolean(customer && !customer.country), queryFn: () => api<{ data: Market[] }>('/v1/countries'), staleTime: 60 * 60_000 });
  const save = useMutation({
    mutationFn: (body: { name?: string; country?: string }) => api<Customer>('/v1/store/account/profile', { body }),
    onSuccess: next => queries.setQueryData(['account'], next),
  });
  if (!customer) return null;
  const market = markets.data?.data.find(item => item.code === country);
  return (
    <Page>
      <Card>
        <Field label="Your name" value={name} onChangeText={setName} autoComplete="name" textContentType="name" maxLength={100} />
        <Button label="Save name" busy={save.isPending && save.variables?.name !== undefined} disabled={name.trim().length < 2 || name.trim() === customer.name} onPress={() => save.mutate({ name: name.trim() })} />
      </Card>
      <Card>
        <Line label="Email" value={customer.email} />
        <T kind="small" muted>
          The email you sign in with. It can&apos;t be changed in the app.
        </T>
      </Card>
      <Card>
        <T kind="heading">Country</T>
        {customer.country ? (
          <>
            <Line label="Country" value={customer.country} />
            <Line label="Currency" value={customer.currency ?? ''} />
            <T kind="small" muted>
              Fixed for good: your wallet and prices are in its currency.
            </T>
          </>
        ) : (
          <>
            <T muted>Choose your country to use your wallet. It can&apos;t be changed later.</T>
            {markets.isError ? <Notice tone="bad">The countries could not be loaded. Check your connection.</Notice> : null}
            <View style={styles.wrap} accessibilityRole="radiogroup" accessibilityLabel="Country">
              {(markets.data?.data ?? []).map(item => (
                <Chip key={item.code} label={item.name} ring selected={item.code === country} onPress={() => setCountry(item.code)} />
              ))}
            </View>
            {market ? <T kind="small" muted>Your wallet will be in {market.currency}.</T> : null}
            <Button label="Save country" disabled={!country} busy={save.isPending && save.variables?.country !== undefined} onPress={() => country && save.mutate({ country })} />
          </>
        )}
      </Card>
      {save.isSuccess ? <Notice tone="good">Saved.</Notice> : null}
      {save.isError ? <Notice tone="bad">{save.error instanceof ApiError ? save.error.message : 'Not saved. Check your connection and try again.'}</Notice> : null}
    </Page>
  );
}

const styles = StyleSheet.create({ wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 } });

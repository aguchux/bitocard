import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { router } from 'expo-router';
import { View } from 'react-native';

import { Button, Card, Notice, Page, T } from '@/components/ui';
import { api, ApiError } from '@/lib/api';
import { formatMoney } from '@/lib/money';
import type { Wallet, WalletCurrencyOption } from '@/lib/types';

/**
 * Your wallets: add one in the currency of another market BitoCard opened for it (topped up with that market's
 * methods), or remove one you added, only while it is empty. US dollars and your own country's always stay.
 */
export default function WalletsScreen() {
  const queries = useQueryClient();
  const wallet = useQuery({ queryKey: ['wallet', 'primary'], queryFn: () => api<Wallet>('/v1/store/wallet') });
  const addable = useQuery({ queryKey: ['wallet', 'currencies'], queryFn: () => api<{ data: WalletCurrencyOption[] }>('/v1/store/wallet/currencies') });
  const done = () => void queries.invalidateQueries({ queryKey: ['wallet'] });
  const add = useMutation({ mutationFn: (currency: string) => api<Wallet>('/v1/store/wallet/wallets', { body: { currency } }), onSuccess: done });
  const remove = useMutation({ mutationFn: (currency: string) => api<Wallet>(`/v1/store/wallet/wallets/${currency}`, { method: 'DELETE' }), onSuccess: done });
  const failure = add.error ?? remove.error;
  const removable = wallet.data?.wallets.filter(item => item.removable) ?? [];
  const options = addable.data?.data ?? [];

  return (
    <Page>
      <T muted>Hold money in another currency: top it up with that country&apos;s payment methods, move money into it, and pay from it anywhere. Like every wallet, it is spent only on BitoCard and never withdrawn.</T>
      {failure ? <Notice tone="bad">{failure instanceof ApiError ? failure.message : 'No answer. Try again.'}</Notice> : null}
      {add.isSuccess ? <Notice tone="good">Wallet added.</Notice> : null}

      <T kind="heading" accessibilityRole="header">
        Add a wallet
      </T>
      {addable.isError ? <Notice tone="bad">{addable.error instanceof ApiError ? addable.error.message : 'The currencies could not be loaded.'}</Notice> : null}
      {addable.data && options.length === 0 ? <T muted>No other currencies are open for you yet.</T> : null}
      {options.map(option => (
        <Card key={option.currency} style={{ flexDirection: 'row', alignItems: 'center' }}>
          <View style={{ flex: 1 }}>
            <T kind="label">{option.currency}</T>
            <T kind="small" muted>
              {option.country_name ?? ''}
              {option.available ? '' : ' · paused just now'}
            </T>
          </View>
          <View style={{ width: 110 }}>
            <Button kind="secondary" label="Add" disabled={!option.available} busy={add.isPending && add.variables === option.currency} onPress={() => add.mutate(option.currency)} />
          </View>
        </Card>
      ))}

      {removable.length ? (
        <>
          <T kind="heading" accessibilityRole="header">
            Wallets you added
          </T>
          {removable.map(item => (
            <Card key={item.currency} style={{ flexDirection: 'row', alignItems: 'center' }}>
              <View style={{ flex: 1 }}>
                <T kind="label">{item.currency}</T>
                <T kind="small" muted>
                  {formatMoney(item.balance, item.currency)}
                  {item.balance ? ' · empty it before removing' : ''}
                </T>
              </View>
              <View style={{ width: 110 }}>
                <Button kind="secondary" label="Remove" disabled={item.balance !== 0} busy={remove.isPending && remove.variables === item.currency} onPress={() => remove.mutate(item.currency)} />
              </View>
            </Card>
          ))}
        </>
      ) : null}
      <Button kind="secondary" label="Back to your wallet" onPress={() => router.back()} />
    </Page>
  );
}

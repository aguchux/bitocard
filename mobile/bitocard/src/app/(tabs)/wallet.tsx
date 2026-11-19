import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import * as Clipboard from 'expo-clipboard';
import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { Button, Card, inter, Notice, Page, Segmented, T, useTheme } from '@/components/ui';
import { api } from '@/lib/api';
import { formatMoney } from '@/lib/money';
import type { Page as List, Wallet, WalletTransaction } from '@/lib/types';

/**
 * The wallet: a tab per wallet (the country's currency, US dollars, any added), its balance, Add funds, Move money
 * and Bank deposit, the customer's own account number where the market offers one, and what moved.
 */
export default function WalletTab() {
  const theme = useTheme();
  const [currency, setCurrency] = useState<string | null>(null);
  const wallet = useQuery({ queryKey: ['wallet', currency ?? 'primary'], queryFn: () => api<Wallet>(`/v1/store/wallet${currency ? `?currency=${currency}` : ''}`) });
  const moved = useInfiniteQuery({
    queryKey: ['wallet', 'transactions'],
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) => api<List<WalletTransaction>>(`/v1/store/wallet/transactions?limit=20${pageParam ? `&starting_after=${pageParam}` : ''}`),
    getNextPageParam: last => (last.has_more ? (last.data.at(-1)?.id ?? null) : null),
  });
  const data = wallet.data;
  const account = data?.reserved_accounts[0];
  const rows = (moved.data?.pages.flatMap(page => page.data) ?? []).filter(row => !data || row.currency === data.currency);

  return (
    <Page header={false}>
      <T kind="title" accessibilityRole="header">
        Wallet
      </T>
      {data && data.wallets.length > 1 ? (
        <Segmented label="Wallets" value={data.currency} onChange={setCurrency} options={data.wallets.map(item => ({ key: item.currency, label: item.currency }))} />
      ) : null}
      {wallet.isError ? (
        <>
          <Notice tone="bad">Your wallet could not be read. Check your connection.</Notice>
          <Button kind="secondary" label="Try again" onPress={() => void wallet.refetch()} />
        </>
      ) : null}
      {data ? (
        <>
          <View style={[styles.balance, { backgroundColor: theme.navy }]} accessible accessibilityLabel={`${data.currency} wallet, ${formatMoney(data.balance, data.currency)}`}>
            <T kind="label" color={theme.onNavySecondary}>
              {data.currency} wallet{data.mode === 'test' ? ' · sandbox' : ''}
            </T>
            <T kind="amount" color="#ffffff">
              {formatMoney(data.balance, data.currency)}
            </T>
            <T kind="small" color={theme.onNavySecondary}>
              Spend it on BitoCard. Sales you make are paid in here.
            </T>
          </View>
          <View style={styles.actions}>
            <Action label="Add funds" onPress={() => router.push({ pathname: '/add-funds', params: { currency: data.currency } })} />
            {data.wallets.length > 1 ? <Action label="Move money" onPress={() => router.push({ pathname: '/move-money', params: { from: data.currency } })} /> : null}
            <Action label="Bank deposit" onPress={() => router.push({ pathname: '/bank-deposit', params: { currency: data.currency } })} />
          </View>
          {account ? (
            <Card>
              <T kind="small" muted>
                Your account number · {account.bank_name}
              </T>
              <T style={{ fontFamily: inter.extrabold, fontSize: 22, letterSpacing: 1 }} selectable>
                {account.account_number}
              </T>
              <T kind="small" muted>
                {account.account_name}. Transfers to it land in this wallet.
              </T>
              <Button kind="secondary" label="Copy account number" onPress={() => void Clipboard.setStringAsync(account.account_number)} />
            </Card>
          ) : data.reserved_accounts_available ? (
            <Card>
              <T kind="heading">Get your own account number</T>
              <T muted>Transfer to it from any bank app and the money lands in this wallet.</T>
              <Button kind="secondary" label="Get my account number" onPress={() => router.push('/account-number')} />
            </Card>
          ) : null}
        </>
      ) : wallet.isPending ? (
        <T muted>Loading…</T>
      ) : null}

      <T kind="heading" accessibilityRole="header">
        Transactions
      </T>
      {moved.isError ? <Notice tone="bad">Your transactions could not be read.</Notice> : null}
      {moved.data && rows.length === 0 ? <T muted>Nothing has moved in this wallet yet.</T> : null}
      {rows.length ? (
        <Card style={{ gap: 0, paddingVertical: 4 }}>
          {rows.map(row => (
            <Pressable
              key={row.id}
              accessibilityRole={row.checkout_id ? 'button' : undefined}
              disabled={!row.checkout_id}
              onPress={() => row.checkout_id && router.push({ pathname: '/order/[id]', params: { id: row.checkout_id } })}
              style={[styles.row, { borderBottomColor: theme.line }]}>
              <View style={{ flex: 1, gap: 2 }}>
                <T style={{ fontFamily: inter.semibold }}>{row.description}</T>
                <T kind="small" muted>
                  {new Date(row.created_at).toLocaleString()}
                </T>
              </View>
              <T style={{ fontFamily: inter.bold }} color={row.amount > 0 ? theme.good : theme.text}>
                {row.amount > 0 ? '+' : ''}
                {formatMoney(row.amount, row.currency)}
              </T>
            </Pressable>
          ))}
        </Card>
      ) : null}
      {moved.hasNextPage ? <Button kind="secondary" label="Show older" onPress={() => void moved.fetchNextPage()} busy={moved.isFetchingNextPage} /> : null}
    </Page>
  );
}

function Action({ label, onPress }: { label: string; onPress: () => void }) {
  const theme = useTheme();
  return (
    <Pressable accessibilityRole="button" onPress={onPress} style={[styles.action, { backgroundColor: theme.card, borderColor: theme.line }]}>
      <T kind="label" style={{ textAlign: 'center' }}>
        {label}
      </T>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  balance: { borderRadius: 22, padding: 20, gap: 6 },
  actions: { flexDirection: 'row', gap: 10 },
  action: { flex: 1, minHeight: 64, borderRadius: 16, borderWidth: 1, alignItems: 'center', justifyContent: 'center', padding: 8 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12, borderBottomWidth: StyleSheet.hairlineWidth },
});

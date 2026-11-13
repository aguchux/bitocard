import { postedAgo, shopMoney } from '@shared/classifieds';
import type { StoreWallet, StoreWalletTopUp, StoreWalletTransaction } from '@shared/storefront';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import * as Clipboard from 'expo-clipboard';
import { router, useLocalSearchParams } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import { Banknote, Copy, Landmark } from 'lucide-react-native';
import { useState } from 'react';
import { FlatList, RefreshControl, StyleSheet, View } from 'react-native';

import { AccountPending } from '@/components/account-pending';
import { ListFooter, usePagedList } from '@/components/paged-list';
import { SignedOut } from '@/components/signed-out';
import { useToast } from '@/components/feedback';
import { inter, ThemedText } from '@/components/themed-text';
import { Button, Card, Chip, Empty, Failed, Field, FormError, Loading, Page, Sheet, fieldError } from '@/components/ui';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useAccount } from '@/lib/account';
import { api } from '@/lib/api';
import { useMoneyKey } from '@/lib/biometrics';
import { toMinor } from '@/lib/listing-form';

/** Where a payment page sends the customer back to (udozo.com's wallet, an address the app also opens). */
const returnUrl = (currency: string) => `https://udozo.com/account/wallet?wallet=${currency}`;

/**
 * The Udozo wallet (udozo.com's /account/wallet): both wallets (the country's currency and US dollars), Add funds by
 * card, bank app or mobile money on the gateway's own page in an in-app browser, the customer's own account number
 * to transfer into (with the BVN in Nigeria, passed to the bank and never kept), and what moved. Sandbox builds
 * finish top-ups and transfers with Simulate. The balance is spent on Udozo and never withdrawn: sales are paid out
 * from Payouts. What moved loads more as the customer scrolls.
 */
export default function WalletScreen() {
  const theme = useTheme();
  const queries = useQueryClient();
  const { customer } = useAccount();
  const params = useLocalSearchParams<{ wallet?: string; add?: string }>();
  const [currency, setCurrency] = useState<string | undefined>(params.wallet?.toUpperCase());
  const [adding, setAdding] = useState(params.add === '1');
  const [opening, setOpening] = useState(false);
  const [topUpId, setTopUpId] = useState<string | null>(null);
  const wallet = useQuery({ queryKey: ['wallet', currency ?? 'primary'], enabled: Boolean(customer), queryFn: () => api<StoreWallet>(`/v1/store/wallet${currency ? `?currency=${currency}` : ''}`) });
  const paged = usePagedList<StoreWalletTransaction, { data: StoreWalletTransaction[]; has_more: boolean }>({ queryKey: ['wallet', 'transactions'], enabled: Boolean(customer), path: '/v1/store/wallet/transactions', paging: 'cursor', limit: 25 });
  const history = paged.list;
  const refresh = () => {
    queries.invalidateQueries({ queryKey: ['wallet'] });
  };

  if (customer === undefined) return <AccountPending />;
  if (!customer) {
    return (
      <Page>
        <SignedOut title="Your wallet" body="Sign in to add funds and pay with UdozoPay." />
      </Page>
    );
  }
  if (wallet.isPending) return <Loading />;
  if (wallet.isError) return <Failed error={wallet.error} retry={() => void wallet.refetch()} />;
  const data = wallet.data;
  const account = data.reserved_accounts[0];
  return (
    <>
      <FlatList
        style={{ backgroundColor: theme.background }}
        contentContainerStyle={styles.page}
        data={paged.items}
        keyExtractor={item => item.id}
        onEndReachedThreshold={0.6}
        onEndReached={paged.loadMore}
        refreshControl={<RefreshControl refreshing={wallet.isRefetching || (history.isRefetching && !history.isFetchingNextPage)} onRefresh={refresh} tintColor={theme.primary} />}
        ListHeaderComponent={
          <View style={styles.header}>
            {data.mode === 'test' ? <ThemedText type="caption">Sandbox: no real money moves.</ThemedText> : null}
            {data.wallets.length > 1 ? (
              <View style={styles.chips}>
                {data.wallets.map(item => (
                  <Chip key={item.currency} label={item.currency} selected={item.currency === data.currency} onPress={() => setCurrency(item.currency)} />
                ))}
              </View>
            ) : null}
            <Card style={{ backgroundColor: theme.backgroundElement }}>
              <ThemedText type="caption">{`Your ${data.currency} wallet`}</ThemedText>
              <ThemedText style={{ fontFamily: inter.extrabold, fontSize: 32, lineHeight: 40 }} accessibilityLabel={`Balance ${shopMoney(data.balance, data.currency)}`}>
                {shopMoney(data.balance, data.currency)}
              </ThemedText>
              <ThemedText type="small" themeColor="textSecondary">
                Spent on Udozo: UdozoPay orders and paying shops. Money from your own sales is in Payouts.
              </ThemedText>
              <Button title="Add funds" tone="money" disabled={!data.top_up_methods.length} onPress={() => setAdding(true)} />
              {!data.top_up_methods.length ? <ThemedText type="caption">Adding funds by card is not open in your country yet.</ThemedText> : null}
            </Card>

            {topUpId ? <TopUpStatus id={topUpId} onDone={() => { setTopUpId(null); refresh(); }} /> : null}

            {data.reserved_accounts_available ? <AccountNumber account={account} needsBvn={data.reserved_account_needs_bvn} sandbox={data.mode === 'test'} opening={opening} setOpening={setOpening} onChange={refresh} /> : null}

            <Button tone="secondary" title="Payouts: money from my sales" icon={<Banknote size={18} color={theme.text} />} onPress={() => router.push('/payouts')} />

            <ThemedText type="heading" accessibilityRole="header">
              What moved
            </ThemedText>
            {history.isError && !paged.items.length ? <Failed error={history.error} retry={() => void history.refetch()} /> : null}
          </View>
        }
        ListEmptyComponent={history.isSuccess ? <Empty title="Nothing yet" body="Funds you add and what you pay show here." /> : undefined}
        renderItem={({ item }) => (
          <View style={[styles.row, { borderColor: theme.line }]}>
            <View style={{ flex: 1 }}>
              <ThemedText>{item.description}</ThemedText>
              <ThemedText type="caption">{postedAgo(item.created_at)}</ThemedText>
            </View>
            <ThemedText style={{ fontFamily: inter.bold, color: item.amount > 0 ? theme.success : theme.text }}>{`${item.amount > 0 ? '+' : '−'}${shopMoney(Math.abs(item.amount), item.currency)}`}</ThemedText>
          </View>
        )}
        ListFooterComponent={<ListFooter list={history} />}
      />

      <AddFunds visible={adding} wallet={data} onClose={() => setAdding(false)} onStarted={id => { setAdding(false); setTopUpId(id); }} />
    </>
  );
}

/** Add funds: the amount and the way to pay, then the gateway's page in an in-app browser (the sandbox has none). */
function AddFunds({ visible, wallet, onClose, onStarted }: { visible: boolean; wallet: StoreWallet; onClose: () => void; onStarted: (id: string) => void }) {
  const [amount, setAmount] = useState('');
  const [method, setMethod] = useState<string | null>(null);
  const key = useMoneyKey();
  const chosen = method ?? wallet.top_up_methods[0]?.id ?? null;
  const start = useMutation({
    mutationFn: async () => {
      const minor = toMinor(amount);
      if (!minor || minor < 100) throw Object.assign(new Error('Enter an amount of at least 1.'), { param: 'amount' });
      const topUp = await api<StoreWalletTopUp>('/v1/store/wallet/top-ups', {
        body: { amount: minor, method: chosen ?? undefined, return_url: returnUrl(wallet.currency), currency: wallet.currency },
        idempotencyKey: key.current(),
      });
      if (topUp.mode === 'live' && topUp.checkout_url) await WebBrowser.openBrowserAsync(topUp.checkout_url).catch(() => undefined);
      return topUp;
    },
    onSuccess: topUp => {
      key.settle();
      setAmount('');
      onStarted(topUp.id);
    },
    onError: error => key.settle(error),
  });
  const amountError = (start.error as { param?: string } | null)?.param === 'amount' ? (start.error as Error).message : null;
  return (
    <Sheet visible={visible} onClose={onClose} title="Add funds">
      <Field label={`Amount (${wallet.currency})`} value={amount} onChangeText={setAmount} keyboardType="decimal-pad" error={amountError} placeholder="5,000" />
      {wallet.top_up_methods.length > 1 ? (
        <View style={styles.chips}>
          {wallet.top_up_methods.map(item => (
            <Chip key={item.id} label={item.label} selected={item.id === chosen} onPress={() => setMethod(item.id)} />
          ))}
        </View>
      ) : null}
      {wallet.top_up_methods.find(item => item.id === chosen)?.description ? <ThemedText type="caption">{wallet.top_up_methods.find(item => item.id === chosen)!.description}</ThemedText> : null}
      <FormError error={amountError ? null : start.error} />
      <Button title="Continue to pay" tone="money" loading={start.isPending} onPress={() => start.mutate()} />
      <ThemedText type="caption">You pay on the payment provider’s own page. Your wallet is credited once they confirm it.</ThemedText>
    </Sheet>
  );
}

/** A top-up just started: waiting for the gateway, then added or not. Cancel closes its payment page. */
function TopUpStatus({ id, onDone }: { id: string; onDone: () => void }) {
  const theme = useTheme();
  const topUp = useQuery({
    queryKey: ['wallet', 'top-up', id],
    queryFn: () => api<StoreWalletTopUp>(`/v1/store/wallet/top-ups/${id}`),
    refetchInterval: query => (query.state.data?.status === 'pending' ? 4000 : false),
  });
  const step = useMutation({
    mutationFn: (what: 'cancel' | 'succeeded' | 'failed') =>
      what === 'cancel' ? api<StoreWalletTopUp>(`/v1/store/wallet/top-ups/${id}/cancel`, { body: {} }) : api<StoreWalletTopUp>(`/v1/store/wallet/top-ups/${id}/simulate`, { body: { outcome: what } }),
    onSuccess: () => void topUp.refetch(),
  });
  const data = topUp.data;
  if (!data) return topUp.isError ? <Failed error={topUp.error} retry={() => void topUp.refetch()} /> : <Loading />;
  if (data.status === 'succeeded') {
    return (
      <Card style={{ borderColor: theme.success }}>
        <ThemedText type="smallBold" style={{ color: theme.success }}>{`${shopMoney(data.amount, data.currency)} added to your wallet.`}</ThemedText>
        <Button title="Done" tone="secondary" onPress={onDone} />
      </Card>
    );
  }
  if (data.status === 'failed') {
    return (
      <Card>
        <ThemedText type="smallBold">{`Not added: ${data.failure_reason ?? 'the payment did not go through'}.`}</ThemedText>
        <Button title="Close" tone="secondary" onPress={onDone} />
      </Card>
    );
  }
  return (
    <Card>
      <ThemedText type="smallBold">{`Waiting for ${data.method.label} to confirm ${shopMoney(data.amount, data.currency)}.`}</ThemedText>
      <FormError error={step.error} />
      {data.mode === 'test' ? (
        <View style={styles.chips}>
          <Button title="Simulate paid" tone="money" onPress={() => step.mutate('succeeded')} />
          <Button title="Simulate failed" tone="secondary" onPress={() => step.mutate('failed')} />
        </View>
      ) : data.checkout_url ? (
        <Button title="Open the payment page" tone="secondary" onPress={() => WebBrowser.openBrowserAsync(data.checkout_url!).then(() => topUp.refetch()).catch(() => undefined)} />
      ) : null}
      <Button title="Cancel this payment" tone="ghost" loading={step.isPending && step.variables === 'cancel'} onPress={() => step.mutate('cancel')} />
    </Card>
  );
}

/** The customer's own bank account number: transfers into it top the wallet up. Opened once, with the BVN in Nigeria. */
function AccountNumber({ account, needsBvn, sandbox, opening, setOpening, onChange }: {
  account: StoreWallet['reserved_accounts'][number] | undefined;
  needsBvn: boolean;
  sandbox: boolean;
  opening: boolean;
  setOpening: (value: boolean) => void;
  onChange: () => void;
}) {
  const theme = useTheme();
  const [bvn, setBvn] = useState('');
  const [copied, setCopied] = useState(false);
  const toast = useToast();
  const open = useMutation({
    mutationFn: () => api('/v1/store/wallet/reserved-accounts', { body: needsBvn ? { bvn: bvn.trim() } : {} }),
    onSuccess: () => {
      setOpening(false);
      onChange();
    },
  });
  const deposit = useMutation({ mutationFn: () => api(`/v1/store/wallet/reserved-accounts/${account!.id}/simulate-deposit`, { body: { amount: 500_000 } }), onSuccess: onChange });
  if (!account) {
    return (
      <Card>
        <View style={styles.inline}>
          <Landmark size={20} color={theme.primary} />
          <ThemedText type="heading">Your own account number</ThemedText>
        </View>
        <ThemedText type="small">Get a free bank account number: whatever you transfer into it tops your wallet up.</ThemedText>
        <Button title="Get my account number" tone="secondary" onPress={() => setOpening(true)} />
        <Sheet visible={opening} onClose={() => setOpening(false)} title="Your own account number">
          {needsBvn ? (
            <Field
              label="Your BVN"
              value={bvn}
              onChangeText={value => setBvn(value.replace(/\D/g, '').slice(0, 11))}
              keyboardType="number-pad"
              error={fieldError(open.error, 'bvn')}
              hint="The bank needs it to open the account. Udozo passes it on and never keeps it."
            />
          ) : null}
          <FormError error={fieldError(open.error, 'bvn') ? null : open.error} />
          <Button title="Open my account number" loading={open.isPending} disabled={needsBvn && bvn.length !== 11} onPress={() => open.mutate()} />
        </Sheet>
      </Card>
    );
  }
  return (
    <Card>
      <View style={styles.inline}>
        <Landmark size={20} color={theme.primary} />
        <ThemedText type="heading">Transfer to add funds</ThemedText>
      </View>
      <ThemedText type="small" themeColor="textSecondary">
        {account.bank_name}
      </ThemedText>
      <ThemedText style={{ fontFamily: inter.extrabold, fontSize: 24, letterSpacing: 1 }} selectable>
        {account.account_number}
      </ThemedText>
      <ThemedText type="small">{account.account_name}</ThemedText>
      <Button
        title={copied ? 'Copied' : 'Copy the account number'}
        tone="secondary"
        icon={<Copy size={16} color={theme.text} />}
        onPress={async () => {
          await Clipboard.setStringAsync(account.account_number);
          setCopied(true);
          toast({ message: 'Account number copied', tone: 'success' });
        }}
      />
      {sandbox ? <Button title={`Simulate a transfer of ${shopMoney(500_000, account.currency)}`} tone="ghost" loading={deposit.isPending} onPress={() => deposit.mutate()} /> : null}
    </Card>
  );
}

const styles = StyleSheet.create({
  page: { padding: Spacing.three, paddingBottom: Spacing.six },
  header: { gap: Spacing.three, paddingBottom: Spacing.two },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two },
  inline: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two, borderBottomWidth: StyleSheet.hairlineWidth, paddingVertical: Spacing.two },
});

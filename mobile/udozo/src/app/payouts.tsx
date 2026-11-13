import { postedAgo, shopMoney } from '@shared/classifieds';
import type { StoreCustomerBankAccount, StoreCustomerPayout } from '@shared/storefront';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { router } from 'expo-router';
import { Landmark, Trash2 } from 'lucide-react-native';
import { useMemo, useState } from 'react';
import { FlatList, Pressable, RefreshControl, ScrollView, StyleSheet, View } from 'react-native';

import { AccountPending } from '@/components/account-pending';
import { useDialog, useToast } from '@/components/feedback';
import { ConfirmSheet } from '@/components/money';
import { SignedOut } from '@/components/signed-out';
import { inter, ThemedText } from '@/components/themed-text';
import { Button, Card, Chip, Empty, Failed, Field, FormError, Loading, Page, Sheet, fieldError } from '@/components/ui';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useAccount } from '@/lib/account';
import { api, ApiError } from '@/lib/api';
import { useMoneyKey } from '@/lib/biometrics';
import { toMinor } from '@/lib/listing-form';

type Cash = { object: 'p2p_cash'; mode: 'live' | 'test'; currency: string; balance: number; held: number; available: number; hold_days: number; minimum: number };
type Bank = { code: string; name: string };

const payoutWords: Record<StoreCustomerPayout['status'], string> = { pending: 'On its way', processing: 'On its way', paid: 'Paid', failed: 'Failed: back in your balance' };

/**
 * Payouts (udozo.com's /account/payouts): the money from the customer's UdozoPay sales, what is ready and what the
 * payout hold still holds, their bank accounts (in the name on their ID check, or on their account where the check is
 * optional; usable 24 hours after adding), and Pay to my bank behind a sheet naming the amount and Face ID or the
 * fingerprint. A refusal for the identity check opens it.
 */
export default function PayoutsScreen() {
  const theme = useTheme();
  const queries = useQueryClient();
  const ask = useDialog();
  const toast = useToast();
  const { customer } = useAccount();
  const [adding, setAdding] = useState(false);
  const [paying, setPaying] = useState(false);
  const cash = useQuery({ queryKey: ['cash'], enabled: Boolean(customer), queryFn: () => api<Cash>('/v1/store/cash'), retry: false });
  const accounts = useQuery({ queryKey: ['cash', 'accounts'], enabled: Boolean(customer), queryFn: () => api<{ data: StoreCustomerBankAccount[] }>('/v1/store/cash/bank-accounts') });
  const payouts = useQuery({ queryKey: ['cash', 'payouts'], enabled: Boolean(customer), queryFn: () => api<{ data: StoreCustomerPayout[] }>('/v1/store/cash/payouts') });
  const refresh = () => queries.invalidateQueries({ queryKey: ['cash'] });
  const remove = useMutation({
    mutationFn: (id: string) => api(`/v1/store/cash/bank-accounts/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      refresh();
      toast({ message: 'Account removed', tone: 'success' });
    },
    onError: error => toast({ message: (error as Error).message, tone: 'error' }),
  });
  const removeAccount = async (account: StoreCustomerBankAccount) => {
    const answer = await ask({ title: 'Remove this account?', body: `${account.bank_name} ending ${account.account_number_last4}`, dismiss: 'Keep it', actions: [{ key: 'remove', label: 'Remove', tone: 'danger' }] });
    if (answer === 'remove') remove.mutate(account.id);
  };
  const simulate = useMutation({ mutationFn: ({ id, outcome }: { id: string; outcome: 'paid' | 'failed' }) => api(`/v1/store/cash/payouts/${id}/simulate`, { body: { outcome } }), onSuccess: refresh });

  if (customer === undefined) return <AccountPending />;
  if (!customer) {
    return (
      <Page>
        <SignedOut title="Payouts" body="Sign in to be paid for what you sell with UdozoPay." />
      </Page>
    );
  }
  if (cash.isPending) return <Loading />;
  if (cash.isError) {
    const code = cash.error instanceof ApiError ? cash.error.code : null;
    if (code === 'customer_verification_required') {
      return (
        <Page edges={[]}>
          <Empty title="Check your identity first" body="Udozo pays your sales into an account in the name on your ID. The check takes a few minutes." action={<Button title="Check my identity" onPress={() => router.push('/identity')} />} />
        </Page>
      );
    }
    return <Failed error={cash.error} retry={() => void cash.refetch()} />;
  }
  const data = cash.data;
  const ready = accounts.data?.data.filter(item => item.ready) ?? [];
  return (
    <ScrollView style={{ backgroundColor: theme.background }} contentContainerStyle={styles.page} refreshControl={<RefreshControl refreshing={cash.isRefetching} onRefresh={refresh} tintColor={theme.primary} />}>
      {data.mode === 'test' ? <ThemedText type="caption">Sandbox: no real money moves.</ThemedText> : null}
      <Card style={{ backgroundColor: theme.backgroundElement }}>
        <ThemedText type="caption">Ready to pay out</ThemedText>
        <ThemedText style={{ fontFamily: inter.extrabold, fontSize: 32, lineHeight: 40 }}>{shopMoney(data.available, data.currency)}</ThemedText>
        {data.held ? <ThemedText type="small">{`${shopMoney(data.held, data.currency)} more is held for ${data.hold_days} days after each sale, then joins it.`}</ThemedText> : null}
        <ThemedText type="caption">{`The least you can pay out is ${shopMoney(data.minimum, data.currency)}.`}</ThemedText>
        <Button title="Pay to my bank" tone="money" disabled={!ready.length || data.available < Math.max(1, data.minimum)} onPress={() => setPaying(true)} />
        {!ready.length ? <ThemedText type="caption">{accounts.data?.data.length ? 'Your account can be paid into 24 hours after you added it.' : 'Add a bank account first.'}</ThemedText> : null}
      </Card>

      <View style={styles.inline}>
        <ThemedText type="heading" accessibilityRole="header" style={{ flex: 1 }}>
          Bank accounts
        </ThemedText>
        <Button title="Add" tone="ghost" onPress={() => setAdding(true)} />
      </View>
      {accounts.isError ? <Failed error={accounts.error} retry={() => void accounts.refetch()} /> : null}
      {accounts.data && !accounts.data.data.length ? <ThemedText type="small" themeColor="textSecondary">None yet. It must be in your own name.</ThemedText> : null}
      {accounts.data?.data.map(account => (
        <View key={account.id} style={[styles.row, { borderColor: theme.line }]}>
          <Landmark size={20} color={theme.primary} />
          <View style={{ flex: 1 }}>
            <ThemedText>{`${account.bank_name} ····${account.account_number_last4}`}</ThemedText>
            <ThemedText type="caption">{account.ready ? account.account_name : `${account.account_name} · usable from ${new Date(account.payouts_available_from).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}`}</ThemedText>
          </View>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Remove ${account.bank_name} ending ${account.account_number_last4}`}
            hitSlop={10}
            onPress={() => void removeAccount(account)}>
            <Trash2 size={20} color={theme.danger} />
          </Pressable>
        </View>
      ))}

      <ThemedText type="heading" accessibilityRole="header">
        Payouts
      </ThemedText>
      {payouts.data && !payouts.data.data.length ? <ThemedText type="small" themeColor="textSecondary">Nothing paid out yet.</ThemedText> : null}
      {payouts.data?.data.map(payout => (
        <View key={payout.id} style={[styles.row, { borderColor: theme.line }]}>
          <View style={{ flex: 1 }}>
            <ThemedText>{`${shopMoney(payout.amount, payout.currency)}${payout.bank_account ? ` to ${payout.bank_account.bank_name} ····${payout.bank_account.account_number_last4}` : ''}`}</ThemedText>
            <ThemedText type="caption">{`${payoutWords[payout.status]} · ${postedAgo(payout.created_at)}${payout.failure_reason ? ` · ${payout.failure_reason}` : ''}`}</ThemedText>
          </View>
          {payout.mode === 'test' && (payout.status === 'pending' || payout.status === 'processing') ? (
            <View style={{ gap: Spacing.one }}>
              <Button title="Paid" tone="ghost" onPress={() => simulate.mutate({ id: payout.id, outcome: 'paid' })} />
              <Button title="Failed" tone="ghost" onPress={() => simulate.mutate({ id: payout.id, outcome: 'failed' })} />
            </View>
          ) : null}
        </View>
      ))}

      <AddAccount visible={adding} onClose={() => setAdding(false)} onAdded={refresh} />
      <PayOut visible={paying} cash={data} accounts={ready} onClose={() => setPaying(false)} onPaid={refresh} />
    </ScrollView>
  );
}

/** A bank account to be paid into: the bank from the country's list, then the number; the bank names its holder. */
function AddAccount({ visible, onClose, onAdded }: { visible: boolean; onClose: () => void; onAdded: () => void }) {
  const theme = useTheme();
  const toast = useToast();
  const [search, setSearch] = useState('');
  const [bank, setBank] = useState<Bank | null>(null);
  const [number, setNumber] = useState('');
  const banks = useQuery({ queryKey: ['cash', 'banks'], enabled: visible, staleTime: 60 * 60_000, queryFn: () => api<{ data: Bank[] }>('/v1/store/cash/banks') });
  const shown = useMemo(() => {
    const words = search.trim().toLowerCase();
    return (banks.data?.data ?? []).filter(item => !words || item.name.toLowerCase().includes(words)).slice(0, 40);
  }, [banks.data, search]);
  const add = useMutation({
    mutationFn: () => api<StoreCustomerBankAccount>('/v1/store/cash/bank-accounts', { body: { bank_code: bank!.code, account_number: number } }),
    onSuccess: added => {
      toast({ message: `Account added: ${added.bank_name} ending ${added.account_number_last4}, ${added.account_name}.${added.ready ? '' : ' You can be paid into it in 24 hours.'}`, tone: 'success' });
      setBank(null);
      setNumber('');
      onAdded();
      onClose();
    },
  });
  return (
    <Sheet visible={visible} onClose={onClose} title="Add a bank account">
      {bank ? (
        <>
          <View style={styles.inline}>
            <ThemedText style={{ flex: 1 }}>{bank.name}</ThemedText>
            <Button title="Change" tone="ghost" onPress={() => setBank(null)} />
          </View>
          <Field label="Account number" value={number} onChangeText={value => setNumber(value.replace(/\D/g, '').slice(0, 20))} keyboardType="number-pad" error={fieldError(add.error, 'account_number')} />
          <FormError error={fieldError(add.error, 'account_number') ? null : add.error} />
          <Button title="Add account" loading={add.isPending} disabled={number.length < 6} onPress={() => add.mutate()} />
          <ThemedText type="caption">It must be in your own name: the bank tells Udozo whose it is.</ThemedText>
        </>
      ) : (
        <>
          <Field label="Your bank" value={search} onChangeText={setSearch} placeholder="Search banks" autoCorrect={false} />
          {banks.isPending ? <Loading /> : banks.isError ? <Failed error={banks.error} retry={() => void banks.refetch()} /> : null}
          <FlatList
            style={{ maxHeight: 280 }}
            keyboardShouldPersistTaps="handled"
            data={shown}
            keyExtractor={item => item.code}
            renderItem={({ item }) => (
              <Pressable accessibilityRole="button" onPress={() => setBank(item)} style={[styles.row, { borderColor: theme.line }]}>
                <ThemedText>{item.name}</ThemedText>
              </Pressable>
            )}
          />
        </>
      )}
    </Sheet>
  );
}

/** Pay to my bank: the amount (all of it by default) and the account, then the confirm sheet with Face ID. */
function PayOut({ visible, cash, accounts, onClose, onPaid }: { visible: boolean; cash: Cash; accounts: StoreCustomerBankAccount[]; onClose: () => void; onPaid: () => void }) {
  const [amount, setAmount] = useState('');
  const [chosen, setChosen] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const toast = useToast();
  const key = useMoneyKey();
  const account = accounts.find(item => item.id === chosen) ?? accounts[0];
  const minor = toMinor(amount) ?? cash.available;
  const pay = useMutation({
    mutationFn: () => api<StoreCustomerPayout>('/v1/store/cash/payouts', { body: { amount: minor, bank_account_id: account!.id }, idempotencyKey: key.current() }),
    onSuccess: payout => {
      key.settle();
      setConfirming(false);
      onClose();
      onPaid();
      if (payout.status === 'failed') toast({ message: `The bank refused it: ${payout.failure_reason ?? 'try another account'}. The money is back in your balance.`, tone: 'error' });
      else toast({ message: `On its way: ${shopMoney(payout.amount, payout.currency)} to your bank.`, tone: 'success' });
    },
    onError: error => key.settle(error),
  });
  if (!account) return null;
  const tooSmall = minor < cash.minimum || minor > cash.available;
  return (
    <>
      <Sheet visible={visible && !confirming} onClose={onClose} title="Pay to my bank">
        <Field label={`Amount (${cash.currency})`} value={amount} onChangeText={setAmount} keyboardType="decimal-pad" placeholder={(cash.available / 100).toFixed(2)} hint={`Up to ${shopMoney(cash.available, cash.currency)}`} error={fieldError(pay.error, 'amount')} />
        {accounts.length > 1 ? (
          <View style={styles.chips}>
            {accounts.map(item => (
              <Chip key={item.id} label={`${item.bank_name} ····${item.account_number_last4}`} selected={item.id === account.id} onPress={() => setChosen(item.id)} />
            ))}
          </View>
        ) : (
          <ThemedText type="small">{`Into ${account.bank_name} ····${account.account_number_last4}, ${account.account_name}`}</ThemedText>
        )}
        <Button title="Continue" tone="money" disabled={tooSmall} onPress={() => setConfirming(true)} />
      </Sheet>
      <ConfirmSheet
        visible={visible && confirming}
        onClose={() => setConfirming(false)}
        title={`Pay ${shopMoney(minor, cash.currency)} to your bank?`}
        body={`Into ${account.bank_name} ····${account.account_number_last4} (${account.account_name}). It usually arrives within minutes.`}
        action={`Pay out ${shopMoney(minor, cash.currency)}`}
        reason={`Pay out ${shopMoney(minor, cash.currency)}`}
        busy={pay.isPending}
        error={pay.error}
        onConfirm={() => pay.mutate()}
      />
    </>
  );
}

const styles = StyleSheet.create({
  page: { padding: Spacing.three, gap: Spacing.three, paddingBottom: Spacing.six },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two },
  inline: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three, borderBottomWidth: StyleSheet.hairlineWidth, paddingVertical: Spacing.two, minHeight: 48 },
});

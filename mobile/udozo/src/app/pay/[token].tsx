import { shopMoney } from '@shared/classifieds';
import type { StoreWallet } from '@shared/storefront';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { router, useLocalSearchParams } from 'expo-router';
import { Store } from 'lucide-react-native';
import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { AccountPending } from '@/components/account-pending';
import { ConfirmSheet } from '@/components/money';
import { SignedOut } from '@/components/signed-out';
import { inter, ThemedText } from '@/components/themed-text';
import { Button, Card, Empty, Failed, FormError, Loading, Page } from '@/components/ui';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useAccount } from '@/lib/account';
import { api } from '@/lib/api';
import { useMoneyKey } from '@/lib/biometrics';
import { clock, payToken, posPayOutcome, secondsLeft, walletShort, type PosWalletPayment } from '@/lib/money';

/**
 * Paying a shop's Udozo POS till (udozo.com/pay/<token>, from the till's QR code, the in-app scanner or the shop's
 * notice): the shop, what is in the basket, the amount and the time left, then Pay from the wallet with Face ID or the
 * fingerprint (exactly the amount shown, or nothing), or Not my basket. Nothing is taken without the buyer.
 */
export default function PayShopScreen() {
  const theme = useTheme();
  const queries = useQueryClient();
  const { customer } = useAccount();
  const { token } = useLocalSearchParams<{ token: string }>();
  const valid = payToken.test(token ?? '');
  const payment = useQuery({
    queryKey: ['pos-pay', token],
    enabled: Boolean(customer && valid),
    retry: false,
    queryFn: () => api<PosWalletPayment>(`/v1/store/account/pos-payments/${token}`),
    refetchInterval: query => (query.state.data?.status === 'waiting' ? 5000 : false),
  });
  const currency = payment.data?.currency;
  const wallet = useQuery({ queryKey: ['wallet', currency], enabled: Boolean(currency), queryFn: () => api<StoreWallet>(`/v1/store/wallet?currency=${currency}`) });
  const [now, setNow] = useState(() => Date.now());
  const [confirming, setConfirming] = useState(false);
  const key = useMoneyKey();
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  const done = (next: PosWalletPayment) => {
    queries.setQueryData(['pos-pay', token], next);
    queries.invalidateQueries({ queryKey: ['wallet'] });
  };
  const pay = useMutation({
    mutationFn: () => api<PosWalletPayment>(`/v1/store/account/pos-payments/${token}/pay`, { body: { expected_amount: payment.data!.amount }, idempotencyKey: key.current() }),
    onSuccess: next => {
      key.settle();
      setConfirming(false);
      done(next);
    },
    onError: error => key.settle(error),
  });
  const decline = useMutation({ mutationFn: () => api<PosWalletPayment>(`/v1/store/account/pos-payments/${token}/decline`, { body: {} }), onSuccess: done });

  if (customer === undefined) return <AccountPending />;
  if (!customer) {
    return (
      <Page>
        <SignedOut title="Pay the shop" body="Sign in to pay this shop from your Udozo wallet." />
      </Page>
    );
  }
  if (!valid) return <Page edges={[]}><Empty title="This is not a Udozo payment" body="Ask the shop for a new code." /></Page>;
  if (payment.isPending) return <Loading />;
  if (payment.isError) return <Failed error={payment.error} retry={() => void payment.refetch()} />;
  const data = payment.data;
  const outcome = posPayOutcome(data);
  const left = secondsLeft(data.expires_at, now);
  const balance = wallet.data?.balance ?? null;
  const short = walletShort(balance, data.amount);
  return (
    <Page edges={[]}>
      <View style={styles.inline}>
        <Store size={24} color={theme.primary} />
        <View style={{ flex: 1 }}>
          <ThemedText type="heading">{data.shop.name}</ThemedText>
          <ThemedText type="caption">{data.number}</ThemedText>
        </View>
      </View>
      <Card>
        {data.items.map(item => (
          <ThemedText key={`${item.title}-${item.quantity}`} type="small">{`${item.quantity} × ${item.title}`}</ThemedText>
        ))}
        <ThemedText type="caption">{data.amount === data.total ? 'The whole sale' : `Part of a sale of ${shopMoney(data.total, data.currency)}; the rest was paid at the counter.`}</ThemedText>
        <ThemedText style={{ fontFamily: inter.extrabold, fontSize: 32, lineHeight: 40 }}>{shopMoney(data.amount, data.currency)}</ThemedText>
      </Card>
      {outcome ? (
        <Card style={{ borderColor: data.status === 'paid' ? theme.success : theme.line }}>
          <ThemedText type="smallBold" style={data.status === 'paid' ? { color: theme.success } : undefined} accessibilityLiveRegion="polite">
            {outcome}
          </ThemedText>
          <Button title="Done" tone="secondary" onPress={() => (router.canGoBack() ? router.back() : router.replace('/'))} />
        </Card>
      ) : data.own_shop ? (
        <ThemedText>This is your own shop: you cannot pay it from your wallet.</ThemedText>
      ) : (
        <>
          <ThemedText type="small" themeColor="textSecondary" accessibilityLabel={`${Math.ceil(left / 60)} minutes left`}>{`Time left ${clock(left)}`}</ThemedText>
          <ThemedText type="small">{balance === null ? 'Your wallet balance could not be read just now.' : `Wallet ${shopMoney(balance, data.currency)}${short ? `: add ${shopMoney(short, data.currency)} first.` : ''}`}</ThemedText>
          {short ? <Button title="Add funds" tone="secondary" onPress={() => router.push({ pathname: '/wallet', params: { wallet: data.currency, add: '1' } })} /> : null}
          <FormError error={decline.error} />
          <Button title={`Pay ${shopMoney(data.amount, data.currency)}`} tone="money" disabled={short > 0 || left === 0} onPress={() => setConfirming(true)} />
          <Button title="Not my basket" tone="secondary" loading={decline.isPending} onPress={() => decline.mutate()} />
        </>
      )}
      <ConfirmSheet
        visible={confirming}
        onClose={() => setConfirming(false)}
        title={`Pay ${data.shop.name} ${shopMoney(data.amount, data.currency)}?`}
        body="From your Udozo wallet. The shop sees it paid at once."
        action={`Pay ${shopMoney(data.amount, data.currency)}`}
        reason={`Pay ${data.shop.name} ${shopMoney(data.amount, data.currency)}`}
        busy={pay.isPending}
        error={pay.error}
        onConfirm={() => pay.mutate()}
      />
    </Page>
  );
}

const styles = StyleSheet.create({
  inline: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three },
});

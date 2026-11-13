import { connectName, payName, shopMoney, type ShopSafePayQuote } from '@shared/classifieds';
import type { StoreWallet } from '@shared/storefront';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { router, useLocalSearchParams } from 'expo-router';
import { MapPin, Wallet } from 'lucide-react-native';
import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { AccountPending } from '@/components/account-pending';
import { HeldNote, MoneyLines, TermsSheet, type Line } from '@/components/money';
import { SignedOut } from '@/components/signed-out';
import { ThemedText } from '@/components/themed-text';
import { Button, Card, Chip, Empty, Field, FormError, Loading, Page } from '@/components/ui';
import { Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useAccount } from '@/lib/account';
import { api, ApiError } from '@/lib/api';
import { useMoneyKey } from '@/lib/biometrics';
import { checkoutBody, checkoutCharges, checkoutProblem, checkoutUnavailable, freeTime, walletShort, type CheckoutChoice } from '@/lib/money';

const steps = ['You ask; the seller accepts.', 'You pay from your Udozo wallet. Udozo holds the money.', 'You check the item, then release the money.', 'Not as described? Open a dispute and Udozo decides.'];
const ways = { meet_up: 'Meet the seller', delivery: 'Delivered to you', connect: 'Collect at a Connect Centre' } as const;

/**
 * Buy with UdozoPay (udozo.com's /<cc>/l/<number>/buy): how it protects the buyer, how it is handed over (meet-up,
 * delivery with its charge, or a Udozo Connect Centre: the state, then the centre, with its shipping and Connect fee),
 * every charge and the wallet, then the request to the seller. Once asked, the order screen takes over (pay from the
 * wallet once the seller accepts). An accepted offer (`offer`) buys at its price.
 */
export default function CheckoutScreen() {
  const theme = useTheme();
  const queries = useQueryClient();
  const { customer, pending } = useAccount();
  const { id, offer, title } = useLocalSearchParams<{ id: string; offer?: string; title?: string }>();
  const quote = useQuery({
    queryKey: ['safe-pay', id, offer ?? null],
    enabled: Boolean(customer && !pending && id),
    retry: false,
    queryFn: () => api<ShopSafePayQuote>(`/v1/classifieds/listings/${id}/safe-pay${offer ? `?offer_id=${offer}` : ''}`),
  });
  const currency = quote.data?.currency;
  const wallet = useQuery({ queryKey: ['wallet', currency], enabled: Boolean(currency), queryFn: () => api<StoreWallet>(`/v1/store/wallet?currency=${currency}`) });
  const [choice, setChoice] = useState<CheckoutChoice | null>(null);
  const [terms, setTerms] = useState(false);
  const key = useMoneyKey();
  const ask = useMutation({
    mutationFn: (body: Record<string, string>) => api<{ id: string }>('/v1/classifieds/orders', { body, idempotencyKey: key.current() }),
    onSuccess: order => {
      key.settle();
      queries.invalidateQueries({ queryKey: ['orders'] });
      queries.invalidateQueries({ queryKey: ['viewer'] });
      router.replace({ pathname: '/order/[id]', params: { id: order.id } });
    },
    onError: error => {
      key.settle(error);
      if (error instanceof ApiError && error.code === 'terms_not_accepted') setTerms(true);
    },
  });

  if (customer === undefined) return <AccountPending />;
  if (!customer) {
    return (
      <Page>
        <SignedOut title={`Buy with ${payName}`} body="Sign in to buy with UdozoPay: Udozo holds your money until you have the item." />
      </Page>
    );
  }
  if (pending) {
    return (
      <Page edges={[]}>
        <ThemedText>Finish your account first, then you can buy.</ThemedText>
        <Button title="Finish my account" onPress={() => router.push('/verify')} />
      </Page>
    );
  }
  if (quote.isPending) return <Loading />;
  if (quote.isError) {
    const code = quote.error instanceof ApiError ? quote.error.code : '';
    return (
      <Page edges={[]}>
        <Empty title="UdozoPay is not open for this" body={checkoutUnavailable[code] ?? (quote.error as Error).message} action={<Button title="Back to the listing" tone="secondary" onPress={() => router.back()} />} />
      </Page>
    );
  }
  const data = quote.data;
  const picked: CheckoutChoice = choice ?? { fulfilment: data.fulfilment[0] ?? 'meet_up', zone: 'state', connectStateId: data.connect?.states[0]?.id, centreId: data.connect?.states[0]?.centres[0]?.id };
  const set = (next: Partial<CheckoutChoice>) => setChoice({ ...picked, ...next });
  const charges = checkoutCharges(data, picked);
  const problem = checkoutProblem(data, picked);
  const connectState = data.connect?.states.find(state => state.id === picked.connectStateId);
  const lines: Line[] = [{ label: 'Item price', amount: data.price }];
  if (picked.fulfilment === 'delivery') lines.push({ label: 'Delivery', amount: charges.delivery });
  if (picked.fulfilment === 'connect') lines.push({ label: 'Shipping to the centre', amount: charges.delivery }, { label: `${connectName} fee`, amount: charges.connectFee });
  lines.push({ label: `${payName} fee`, amount: data.buyer_fee }, { label: 'Total', amount: charges.total, strong: true });
  const balance = wallet.data?.balance ?? null;
  const short = walletShort(balance, charges.total);

  return (
    <Page edges={[]}>
      {title ? <ThemedText type="heading">{title}</ThemedText> : null}
      <Card style={{ backgroundColor: theme.backgroundElement }}>
        <ThemedText type="smallBold">{`How ${payName} protects you`}</ThemedText>
        {steps.map((text, index) => (
          <ThemedText key={text} type="small">{`${index + 1}. ${text}`}</ThemedText>
        ))}
      </Card>
      {data.reserved ? (
        <Card>
          <ThemedText>{checkoutUnavailable.listing_reserved}</ThemedText>
        </Card>
      ) : (
        <>
          <ThemedText type="heading" accessibilityRole="header">
            How do you get it?
          </ThemedText>
          <View style={styles.chips}>
            {data.fulfilment.filter(way => way !== 'connect' || data.connect).map(way => (
              <Chip key={way} label={ways[way]} selected={picked.fulfilment === way} onPress={() => set({ fulfilment: way })} />
            ))}
          </View>
          {picked.fulfilment === 'meet_up' ? <ThemedText type="small">Meet in a public place. Check the item, then give the seller your release code: that pays them.</ThemedText> : null}
          {picked.fulfilment === 'delivery' && data.delivery ? (
            <>
              {data.delivery.nationwide !== null ? (
                <View style={styles.chips}>
                  <Chip label={`In the seller’s state: ${data.delivery.within_state ? shopMoney(data.delivery.within_state, data.currency) : 'free'}`} selected={picked.zone !== 'elsewhere'} onPress={() => set({ zone: 'state' })} />
                  <Chip label={`Elsewhere: ${data.delivery.nationwide ? shopMoney(data.delivery.nationwide, data.currency) : 'free'}`} selected={picked.zone === 'elsewhere'} onPress={() => set({ zone: 'elsewhere' })} />
                </View>
              ) : (
                <ThemedText type="small">The seller delivers within their own state.</ThemedText>
              )}
              <Field label="Delivery address" value={picked.address ?? ''} onChangeText={address => set({ address })} multiline maxLength={500} style={{ minHeight: 80, textAlignVertical: 'top', paddingTop: Spacing.two }} autoComplete="street-address" />
              <ThemedText type="caption">The delivery charge goes to the seller once you have it; it is refunded if it never arrives.</ThemedText>
            </>
          ) : null}
          {picked.fulfilment === 'connect' && data.connect ? (
            <>
              <View style={styles.chips}>
                {data.connect.states.map(state => (
                  <Chip key={state.id} label={state.name} selected={state.id === picked.connectStateId} onPress={() => set({ connectStateId: state.id, centreId: state.centres[0]?.id })} />
                ))}
              </View>
              {connectState?.centres.map(centre => (
                <Pressable
                  key={centre.id}
                  accessibilityRole="radio"
                  accessibilityState={{ checked: centre.id === picked.centreId }}
                  onPress={() => set({ centreId: centre.id })}
                  style={[styles.centre, { borderColor: centre.id === picked.centreId ? theme.primary : theme.line, backgroundColor: centre.id === picked.centreId ? theme.backgroundSelected : theme.background }]}>
                  <MapPin size={18} color={theme.primary} />
                  <View style={{ flex: 1, gap: 2 }}>
                    <ThemedText type="smallBold">{centre.name}</ThemedText>
                    <ThemedText type="small">{`${centre.address}, ${centre.area.name}`}</ThemedText>
                    {centre.landmark ? <ThemedText type="caption">{`Near ${centre.landmark}`}</ThemedText> : null}
                    <ThemedText type="caption">{centre.hours}</ThemedText>
                  </View>
                </Pressable>
              ))}
              <ThemedText type="caption">{`Collect it free within ${freeTime(data.connect.free_hours)} of it being ready; storage is charged daily after that. Refused at the centre, you get everything back.`}</ThemedText>
            </>
          ) : null}

          <Card>
            <MoneyLines lines={lines} currency={data.currency} note="The UdozoPay fee comes back to you if the item does not change hands." />
          </Card>
          <Card>
            <View style={styles.inline}>
              <Wallet size={20} color={theme.text} />
              <View style={{ flex: 1 }}>
                <ThemedText type="smallBold">Paid from your Udozo wallet once the seller accepts</ThemedText>
                <ThemedText type="small" themeColor="textSecondary">
                  {balance === null ? 'Your balance could not be read just now.' : `Balance ${shopMoney(balance, data.currency)}${short ? ` · add ${shopMoney(short, data.currency)} before paying` : ''}`}
                </ThemedText>
              </View>
              <Button title="Add funds" tone="ghost" onPress={() => router.push({ pathname: '/wallet', params: { wallet: data.currency, add: '1' } })} />
            </View>
          </Card>
          <FormError error={problem ? null : ask.error instanceof ApiError && ask.error.code === 'terms_not_accepted' ? null : ask.error} />
          {problem ? <ThemedText type="small" themeColor="textSecondary">{problem}</ThemedText> : null}
          <Button title="Send request to seller" tone="money" disabled={Boolean(problem)} loading={ask.isPending} onPress={() => ask.mutate(checkoutBody(data, picked))} />
          <ThemedText type="caption">{`The seller has ${data.accept_hours} hours to accept. Nothing is taken until you pay.`}</ThemedText>
        </>
      )}
      <HeldNote />
      <TermsSheet visible={terms} onClose={() => setTerms(false)} retry={() => ask.mutate(checkoutBody(data, picked))} />
    </Page>
  );
}

const styles = StyleSheet.create({
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two },
  inline: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  centre: { flexDirection: 'row', gap: Spacing.two, padding: Spacing.three, borderWidth: 1, borderRadius: Radius.medium },
});

import { shopMoney, type ShopListingAuction } from '@shared/classifieds';
import { useQueryClient } from '@tanstack/react-query';
import { router } from 'expo-router';
import { Gavel } from 'lucide-react-native';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { ConfirmSheet } from '@/components/money';
import { inter, ThemedText } from '@/components/themed-text';
import { Button, Card, Field } from '@/components/ui';
import { Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useAccount } from '@/lib/account';
import { api, ApiError } from '@/lib/api';
import { auctionNote, auctionState, bidProblem, bidRefusal } from '@/lib/auctions';
import { useMoneyKey } from '@/lib/biometrics';
import { fromMinor, toMinor } from '@/lib/listing-form';

/**
 * A listing sold by auction, on its page (udozo.com's `AuctionPanel`): the price to beat, how many bids and when it
 * ends, the reserve's state, the latest bids, and bidding (signed in with a confirmed mobile, at least the next step,
 * its amount confirmed with Face ID or the fingerprint: a bid cannot be taken back). A seller's winner pays the UdozoPay
 * order the win made; a lot of Udozo's is paid here from the wallet and collected at Udozo's warehouse with a code.
 */
export function AuctionPanel({ listingId, auction, currency }: { listingId: string; auction: ShopListingAuction; currency: string }) {
  const theme = useTheme();
  const queries = useQueryClient();
  const { customer } = useAccount();
  const key = useMoneyKey();
  const [amount, setAmount] = useState(fromMinor(auction.next_bid));
  const [asking, setAsking] = useState<'bid' | 'pay' | null>(null);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [code, setCode] = useState<string | null>(null);
  const viewer = auction.viewer;
  const note = auctionNote(auction, currency);
  const minor = toMinor(amount);
  const udozos = auction.kind === 'abandoned';

  const refresh = () => Promise.all([queries.invalidateQueries({ queryKey: ['viewer', listingId] }), queries.invalidateQueries({ queryKey: ['listing'] })]);
  const ask = () => {
    const wrong = bidProblem(minor, auction.next_bid, currency);
    setProblem(wrong);
    if (!wrong) setAsking('bid');
  };
  const bid = async () => {
    if (minor === null) return;
    setBusy(true);
    try {
      const placed = await api<ShopListingAuction>(`/v1/classifieds/listings/${listingId}/bids`, { body: { amount: minor }, idempotencyKey: key.current() });
      key.settle();
      setAsking(null);
      setProblem(null);
      setAmount(fromMinor(placed.next_bid));
      await refresh();
    } catch (caught) {
      key.settle(caught);
      setAsking(null);
      setProblem(caught instanceof ApiError ? bidRefusal(caught.code, caught.message) : 'Your bid could not be sent. Try again.');
    } finally {
      setBusy(false);
    }
  };
  const pay = async () => {
    setBusy(true);
    try {
      await api(`/v1/classifieds/auctions/${auction.ref}/pay`, { body: {}, idempotencyKey: key.current() });
      key.settle();
      setAsking(null);
      await refresh();
    } catch (caught) {
      key.settle(caught);
      setAsking(null);
      setProblem(caught instanceof ApiError ? caught.message : 'It could not be paid. Try again.');
    } finally {
      setBusy(false);
    }
  };
  const showCode = async () => {
    setBusy(true);
    try {
      const answer = await api<{ code: string | null; collected_at: string | null }>(`/v1/classifieds/auctions/${auction.ref}/collection-code`);
      setCode(answer.collected_at ? 'collected' : answer.code);
    } catch (caught) {
      setProblem(caught instanceof ApiError ? caught.message : 'Your code could not be shown. Try again.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card style={{ borderColor: theme.primary, borderWidth: 2 }}>
      <View style={styles.inline}>
        <Gavel size={18} color={theme.primary} />
        <ThemedText type="heading" accessibilityRole="header">{`Auction ${auction.number}`}</ThemedText>
      </View>
      <View>
        <ThemedText type="caption">{auction.current_price === null ? 'Starting price' : 'Highest bid'}</ThemedText>
        <ThemedText style={{ fontFamily: inter.extrabold, fontSize: 24 }}>{shopMoney(auction.current_price ?? auction.start_price, currency)}</ThemedText>
        <ThemedText type="small">{`${auction.bids} ${auction.bids === 1 ? 'bid' : 'bids'} · ${auctionState(auction)}`}</ThemedText>
        {auction.reserve_met !== null ? <ThemedText type="smallBold">{auction.reserve_met ? 'Reserve met' : 'Reserve not met'}</ThemedText> : null}
      </View>
      {note ? (
        <ThemedText type="smallBold" accessibilityLiveRegion="polite" style={[styles.note, { backgroundColor: theme.backgroundElement }]}>
          {note}
        </ThemedText>
      ) : null}

      {!udozos && viewer?.to_pay?.order_id ? (
        <Button title="Pay for your winning bid" tone="money" onPress={() => router.push({ pathname: '/order/[id]', params: { id: viewer.to_pay!.order_id! } })} />
      ) : null}
      {udozos && viewer?.to_pay && auction.status === 'awaiting_payment' ? (
        <Button title={`Pay ${shopMoney(viewer.to_pay.amount, currency)} from your wallet`} tone="money" onPress={() => setAsking('pay')} />
      ) : null}
      {udozos && viewer?.won ? (
        code === 'collected' ? (
          <ThemedText type="smallBold">You have collected it.</ThemedText>
        ) : code ? (
          <View style={[styles.code, { borderColor: theme.line }]} accessible accessibilityLabel={`Your collection code ${code.split('').join(' ')}`}>
            <ThemedText type="caption">Your collection code</ThemedText>
            <ThemedText style={{ fontFamily: inter.extrabold, fontSize: 26, letterSpacing: 4 }}>{code}</ThemedText>
          </View>
        ) : (
          <Button title="Show my collection code" tone="secondary" loading={busy} onPress={() => void showCode()} />
        )
      ) : null}
      {udozos && auction.warehouse ? (
        <ThemedText type="small" themeColor="textSecondary">
          {`Sold by Udozo as seen, from a shipment nobody collected: Udozo has not tested it. Collected at ${auction.warehouse.name}, ${auction.warehouse.address}, ${auction.warehouse.state}${auction.warehouse.hours ? ` (${auction.warehouse.hours})` : ''}.`}
        </ThemedText>
      ) : null}

      {auction.status === 'live' && !viewer?.seller ? (
        !customer ? (
          <Button title="Sign in to bid" onPress={() => router.push('/signin')} />
        ) : !customer.phone_verified ? (
          <Button title="Confirm your mobile number to bid" tone="secondary" onPress={() => router.push('/verify')} />
        ) : (
          <>
            <Field
              label={`Your bid (${currency})`}
              value={amount}
              onChangeText={text => {
                setAmount(text);
                setProblem(null);
              }}
              keyboardType="decimal-pad"
              hint={auction.next_bid !== null ? `At least ${shopMoney(auction.next_bid, currency)}.` : undefined}
            />
            <Button title="Place bid" onPress={ask} />
          </>
        )
      ) : null}
      {problem ? (
        <ThemedText type="small" accessibilityRole="alert" style={{ color: theme.danger }}>
          {problem}
        </ThemedText>
      ) : null}
      {problem === 'Confirm your mobile number to bid.' ? <Button title="Confirm my mobile" tone="ghost" onPress={() => router.push('/verify')} /> : null}

      <ThemedText type="caption">
        {`Each bid is at least ${auction.rules.step_pct}% above the last, and at least ${shopMoney(auction.rules.step_min, currency)} more; a bid in the last ${auction.rules.extend_minutes} minutes moves the end to ${auction.rules.extend_minutes} minutes after it.`}
      </ThemedText>
      {auction.recent_bids.length ? (
        <View style={{ gap: 2 }}>
          <ThemedText type="smallBold">Latest bids</ThemedText>
          {auction.recent_bids.map(entry => (
            <View key={`${entry.at}-${entry.amount}`} style={styles.inline}>
              <ThemedText type="small" style={{ flex: 1 }}>
                {entry.name}
              </ThemedText>
              <ThemedText type="smallBold">{shopMoney(entry.amount, currency)}</ThemedText>
            </View>
          ))}
        </View>
      ) : null}

      <ConfirmSheet
        visible={asking === 'bid'}
        onClose={() => setAsking(null)}
        title={minor ? `Bid ${shopMoney(minor, currency)}?` : 'Your bid'}
        body={`If you win, you pay this ${udozos ? 'from your Udozo wallet' : 'with UdozoPay'} within ${auction.rules.pay_hours} hours. A bid cannot be taken back.`}
        action="Place my bid"
        reason={minor ? `Bid ${shopMoney(minor, currency)}` : 'Place your bid'}
        busy={busy}
        onConfirm={() => void bid()}
      />
      <ConfirmSheet
        visible={asking === 'pay'}
        onClose={() => setAsking(null)}
        title={viewer?.to_pay ? `Pay ${shopMoney(viewer.to_pay.amount, currency)}?` : 'Pay'}
        body="It is taken from your Udozo wallet. You then collect the item at Udozo's warehouse with your code."
        action="Pay from my wallet"
        reason={viewer?.to_pay ? `Pay ${shopMoney(viewer.to_pay.amount, currency)} from your wallet` : 'Pay from your wallet'}
        busy={busy}
        onConfirm={() => void pay()}
      />
    </Card>
  );
}

const styles = StyleSheet.create({
  inline: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  note: { borderRadius: Radius.medium, padding: Spacing.two, overflow: 'hidden' },
  code: { borderWidth: 1, borderRadius: Radius.medium, padding: Spacing.three, alignItems: 'center' },
});

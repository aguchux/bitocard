import { postedAgo, shopMoney, storeReportReasonLabels, type ShopConnectAuction, type ShopConnectReturn, type ShopOrder, type ShopOrderMessage, type ShopReturnShipOption, type ShopStoreReport, type ShopStoreReportReason } from '@shared/classifieds';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Flag, Mail, MapPin, Phone } from 'lucide-react-native';
import { useState } from 'react';
import { Linking, Pressable, StyleSheet, View } from 'react-native';

import { ConfirmSheet } from '@/components/money';
import { inter, ThemedText } from '@/components/themed-text';
import { Button, Card, Chip, Field, FormError, Sheet } from '@/components/ui';
import { Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { api } from '@/lib/api';
import { useMoneyKey } from '@/lib/biometrics';
import { canClaim, canShip, claimWords, placeWords, returnReasons, returnTitle, transferWords, when } from '@/lib/order-extras';

/**
 * A Connect item going back to its seller (udozo.com's `ConnectReturnPanel`): why, and for the seller Accept the return
 * (or it is accepted by itself when nobody answers), then their return code to show at the centre, or having it sent
 * on to a centre near them (paying the shipping) and cancelling that while it waits. The buyer reads where it stands.
 */
export function ConnectReturn({ order, item, onChange }: { order: ShopOrder; item: ShopConnectReturn; onChange: () => void }) {
  const theme = useTheme();
  const seller = order.role === 'seller';
  const centre = order.connect?.centre.name ?? 'the centre';
  const [asking, setAsking] = useState<'accept' | 'cancel_ship' | null>(null);
  const [shipping, setShipping] = useState(false);
  const [code, setCode] = useState<string | null>(null);
  const step = useMutation({
    mutationFn: (name: 'accept' | 'cancel_ship') => api(`/v1/classifieds/orders/${order.id}/${name === 'accept' ? 'return/accept' : 'return/ship/cancel'}`, { body: {} }),
    onSuccess: () => {
      setAsking(null);
      onChange();
    },
  });
  const showCode = useMutation({
    mutationFn: () => api<{ code: string; tries_left: number }>(`/v1/classifieds/orders/${order.id}/return-code`),
    onSuccess: answer => setCode(answer.code),
  });
  return (
    <Card style={{ backgroundColor: theme.backgroundElement }}>
      <ThemedText type="heading">{returnTitle(item)}</ThemedText>
      <ThemedText type="small">{`${centre} is returning it to the seller because ${returnReasons[item.reason]}.`}</ThemedText>
      {item.abandoned_at && item.status !== 'collected' ? <ThemedText type="smallBold">{placeWords(item, centre)}</ThemedText> : null}
      {seller && item.status === 'requested' ? (
        <>
          <ThemedText type="small">{`Accept it, or it is accepted by itself on ${when(item.answer_by)}.`}</ThemedText>
          <Button title="Accept the return" onPress={() => setAsking('accept')} />
        </>
      ) : null}
      {seller && item.transfer && item.transfer.status !== 'collected' ? (
        <>
          <ThemedText type="smallBold">{`${item.transfer.number}: ${transferWords(item.transfer, centre)}`}</ThemedText>
          {item.transfer.status === 'paid' ? <Button title="Cancel sending it" tone="secondary" onPress={() => setAsking('cancel_ship')} /> : null}
        </>
      ) : null}
      {seller && item.status === 'accepted' ? (
        <>
          {item.collect_by && !item.abandoned_at ? <ThemedText type="small">{`Collect it by ${when(item.collect_by)}: after that, storage is charged daily.`}</ThemedText> : null}
          {canShip(item) ? <Button title="Send it to a centre near me" tone="secondary" onPress={() => setShipping(true)} /> : null}
          {code ? (
            <View accessible accessibilityLabel={`Return code ${code.split('').join(' ')}`} style={[styles.code, { borderColor: theme.line }]}>
              <ThemedText type="caption">Your return code</ThemedText>
              <ThemedText style={{ fontFamily: inter.extrabold, fontSize: 28, letterSpacing: 6 }}>{code}</ThemedText>
            </View>
          ) : (
            <Button title="Show my return code" loading={showCode.isPending} onPress={() => showCode.mutate()} />
          )}
          <ThemedText type="caption">Give it to the centre’s staff only when you collect the item.</ThemedText>
        </>
      ) : null}
      <FormError error={showCode.error} />
      <ConfirmSheet
        visible={asking === 'accept'}
        onClose={() => setAsking(null)}
        title="Accept the return?"
        body={`You collect it from ${centre} with your return code, paying the centre’s Connect fee as the return fee.`}
        action="Accept the return"
        tone="primary"
        busy={step.isPending}
        error={step.error}
        onConfirm={() => step.mutate('accept')}
      />
      <ConfirmSheet
        visible={asking === 'cancel_ship'}
        onClose={() => setAsking(null)}
        title="Keep it where it is?"
        body={item.transfer ? `The ${shopMoney(item.transfer.shipping, order.currency)} shipping goes back to you, and you collect it at ${centre}.` : undefined}
        action="Cancel sending it"
        tone="danger"
        busy={step.isPending}
        error={step.error}
        onConfirm={() => step.mutate('cancel_ship')}
      />
      <SendItOn order={order} visible={shipping} onClose={() => setShipping(false)} onDone={onChange} />
    </Card>
  );
}

/** Choosing a Connect Centre near them to have their return sent to, with its shipping, then paying for it. */
function SendItOn({ order, visible, onClose, onDone }: { order: ShopOrder; visible: boolean; onClose: () => void; onDone: () => void }) {
  const key = useMoneyKey();
  const [chosen, setChosen] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const holding = order.connect?.centre.name ?? 'The centre';
  const options = useQuery({
    queryKey: ['return-ship-options', order.id],
    enabled: visible,
    queryFn: () => api<{ currency: string; collect_by: string; data: ShopReturnShipOption[] }>(`/v1/classifieds/orders/${order.id}/return/ship-options`),
  });
  const choice = options.data?.data.find(option => option.centre.id === chosen);
  const currency = options.data?.currency ?? order.currency;
  const ship = useMutation({
    mutationFn: () => api(`/v1/classifieds/orders/${order.id}/return/ship`, { body: { centre_id: choice!.centre.id, expected_shipping: choice!.shipping }, idempotencyKey: key.current() }),
    onSuccess: () => {
      key.settle();
      setConfirming(false);
      onClose();
      onDone();
    },
    onError: error => key.settle(error),
  });
  return (
    <>
      <Sheet visible={visible && !confirming} onClose={onClose} title="Send it to a centre near me">
        <FormError error={options.error} />
        {options.data && !options.data.data.length ? <ThemedText>{`No other Connect Centre can take it yet: collect it at ${holding}.`}</ThemedText> : null}
        {options.data?.data.map(option => (
          <Chip key={option.centre.id} label={`${option.centre.state}: ${option.centre.name}, ${option.centre.area} (${shopMoney(option.shipping, currency)})`} selected={chosen === option.centre.id} onPress={() => setChosen(option.centre.id)} />
        ))}
        {choice ? <ThemedText type="small">{`${choice.centre.address}${choice.centre.landmark ? `, ${choice.centre.landmark}` : ''} · ${choice.centre.hours}`}</ThemedText> : null}
        <Button title={choice ? `Pay ${shopMoney(choice.shipping, currency)} and send it` : 'Pay and send it'} tone="money" disabled={!choice} onPress={() => setConfirming(true)} />
      </Sheet>
      <ConfirmSheet
        visible={visible && confirming}
        onClose={() => setConfirming(false)}
        title={choice ? `Send it to ${choice.centre.name}?` : 'Send it on?'}
        body={choice ? `You pay ${shopMoney(choice.shipping, currency)} for the shipping now, from your Udozo money or wallet. ${holding} sends it there; you collect it with your return code and pay that centre’s return fee.` : undefined}
        action="Pay and send it"
        reason={choice ? `Pay ${shopMoney(choice.shipping, currency)} shipping` : 'Pay the shipping'}
        busy={ship.isPending}
        error={ship.error}
        onConfirm={() => ship.mutate()}
      />
    </>
  );
}

/** The seller's view of their abandoned item's auction: what it raised, and claiming what was left over. */
export function AuctionClaim({ order, auction, onChange }: { order: ShopOrder; auction: ShopConnectAuction; onChange: () => void }) {
  const theme = useTheme();
  const [note, setNote] = useState('');
  const [asking, setAsking] = useState(false);
  const claim = useMutation({
    mutationFn: () => api(`/v1/classifieds/orders/${order.id}/auction-claim`, { body: { note: note.trim() || null } }),
    onSuccess: () => {
      setAsking(false);
      onChange();
    },
  });
  return (
    <Card style={{ backgroundColor: theme.backgroundElement }}>
      <ThemedText type="heading">{`Sold at Udozo auction ${auction.number}${auction.sale !== null ? ` for ${shopMoney(auction.sale, order.currency)}` : ''}`}</ThemedText>
      <ThemedText type="small">{claimWords(auction, order.currency)}</ThemedText>
      {canClaim(auction) ? (
        <>
          <Field label="Anything Udozo should know (optional)" value={note} onChangeText={setNote} multiline maxLength={500} />
          <Button title="Claim what is left over" tone="money" onPress={() => setAsking(true)} />
        </>
      ) : null}
      <ConfirmSheet
        visible={asking}
        onClose={() => setAsking(false)}
        title={`Claim ${shopMoney(auction.left_over ?? 0, order.currency)}?`}
        body="Udozo checks your claim, then pays it into your Udozo money to pay out to your bank."
        action="Claim it"
        busy={claim.isPending}
        error={claim.error}
        onConfirm={() => claim.mutate()}
      />
    </Card>
  );
}

/** A resale order's buyer, for its supplier once accepted: their name, phone, email and address (each view is logged). */
export function BuyerDetails({ details }: { details: NonNullable<ShopOrder['buyer_details']> }) {
  const theme = useTheme();
  return (
    <Card>
      <ThemedText type="heading">The buyer</ThemedText>
      <ThemedText type="smallBold">{details.name}</ThemedText>
      {details.phone ? (
        <Pressable accessibilityRole="link" accessibilityLabel={`Call ${details.phone}`} onPress={() => Linking.openURL(`tel:${details.phone}`)} style={styles.inline}>
          <Phone size={16} color={theme.link} />
          <ThemedText type="small" style={{ color: theme.link }}>{details.phone}</ThemedText>
        </Pressable>
      ) : null}
      <Pressable accessibilityRole="link" accessibilityLabel={`Email ${details.email}`} onPress={() => Linking.openURL(`mailto:${details.email}`)} style={styles.inline}>
        <Mail size={16} color={theme.link} />
        <ThemedText type="small" style={{ color: theme.link }}>{details.email}</ThemedText>
      </Pressable>
      {details.address ? (
        <View style={styles.inline}>
          <MapPin size={16} color={theme.textSecondary} />
          <ThemedText type="small" style={{ flex: 1 }}>{details.address}</ThemedText>
        </View>
      ) : null}
      <ThemedText type="caption">Use them only for this order. Udozo keeps a record of each time they are seen.</ThemedText>
    </Card>
  );
}

type Thread = 'order' | 'trade';

/**
 * A resale order's conversation (udozo.com's `OrderThread`). The supplier reads two threads: the order chat with the
 * buyer (who sees everything from the store's side as the store's) and the trade thread with the reseller. The buyer
 * reads the order chat only. Read again every 5 seconds while open.
 */
export function OrderThread({ order }: { order: ShopOrder }) {
  const theme = useTheme();
  const queries = useQueryClient();
  const buyer = order.role === 'buyer';
  const store = order.store?.name ?? 'the store';
  const [thread, setThread] = useState<Thread>('order');
  const [text, setText] = useState('');
  const path = buyer ? `/v1/store/resale/orders/${order.id}/messages` : `/v1/classifieds/orders/${order.id}/messages`;
  const key = ['order-messages', order.id, buyer ? 'order' : thread];
  const messages = useQuery({ queryKey: key, refetchInterval: 5000, queryFn: () => api<{ data: ShopOrderMessage[] }>(buyer ? path : `${path}?thread=${thread}`) });
  const send = useMutation({
    mutationFn: () => api<ShopOrderMessage>(path, { body: buyer ? { body: text.trim().slice(0, 2000) } : { thread, body: text.trim().slice(0, 2000) } }),
    onSuccess: () => {
      setText('');
      queries.invalidateQueries({ queryKey: key });
    },
  });
  return (
    <Card>
      <ThemedText type="heading">{buyer ? `Messages with ${store}` : 'Messages'}</ThemedText>
      {!buyer ? (
        <View style={styles.chips}>
          <Chip label="With the buyer" selected={thread === 'order'} onPress={() => setThread('order')} />
          <Chip label={`With ${store}`} selected={thread === 'trade'} onPress={() => setThread('trade')} />
        </View>
      ) : null}
      <ThemedText type="caption">
        {buyer
          ? 'Your order is paid through Udozo. Never pay anyone directly, and never share codes or passwords.'
          : thread === 'order'
            ? `The buyer sees your messages as from ${store}. Keep to this order; never ask for payment outside Udozo.`
            : `Only you and ${store} see this thread.`}
      </ThemedText>
      {messages.data?.data.map(message => (
        <View key={message.id} style={[styles.message, { alignSelf: message.from === 'me' ? 'flex-end' : 'flex-start', backgroundColor: message.from === 'me' ? theme.backgroundSelected : theme.backgroundElement }]}>
          <ThemedText type="caption">{`${message.from === 'me' ? 'You' : message.name} · ${postedAgo(message.created_at)}`}</ThemedText>
          <ThemedText type="small">{message.body}</ThemedText>
        </View>
      ))}
      <Field label="Write a message" value={text} onChangeText={setText} multiline maxLength={2000} />
      <FormError error={send.error ?? messages.error} />
      <Button title="Send" tone="secondary" disabled={!text.trim()} loading={send.isPending} onPress={() => send.mutate()} />
    </Card>
  );
}

const reportReasons = Object.keys(storeReportReasonLabels) as ShopStoreReportReason[];

/**
 * Reporting a Resale shop to Udozo (udozo.com's `ReportStore`): a buyer from their resale order, a supplier from My
 * Resellers (choosing which of the reseller's stores). Udozo reviews it; one open report per store.
 */
export function ReportStore({ target }: { target: { kind: 'order'; orderId: string; storeName: string } | { kind: 'reseller'; relationshipId: string; stores: { id: string; name: string }[] } }) {
  const theme = useTheme();
  const [open, setOpen] = useState(false);
  const [storeId, setStoreId] = useState(target.kind === 'reseller' ? (target.stores[0]?.id ?? '') : '');
  const [reason, setReason] = useState<ShopStoreReportReason>('claims_ownership');
  const [details, setDetails] = useState('');
  const send = useMutation({
    mutationFn: () =>
      target.kind === 'order'
        ? api<ShopStoreReport>('/v1/store/resale/reports', { body: { reason, details: details.trim().slice(0, 2000), order_id: target.orderId } })
        : api<ShopStoreReport>(`/v1/classifieds/me/resellers/${target.relationshipId}/report`, { body: { store_id: storeId, reason, details: details.trim().slice(0, 2000) } }),
    onSuccess: () => setOpen(false),
  });
  const name = target.kind === 'order' ? target.storeName : 'one of their stores';
  if (send.data) return <ThemedText type="small">{`Thank you. Your report ${send.data.number} is with Udozo, and we will tell you what we decide.`}</ThemedText>;
  return (
    <>
      <Button tone="ghost" title={`Report ${name}`} icon={<Flag size={16} color={theme.link} />} onPress={() => setOpen(true)} />
      <Sheet visible={open} onClose={() => setOpen(false)} title={`Report ${target.kind === 'order' ? target.storeName : 'a store'} to Udozo`}>
        <ThemedText type="small">For a store that says it owns or makes the items, says what the supplier did not, asks for payment outside Udozo or misuses a buyer’s details. Problems with the item itself go in a dispute.</ThemedText>
        {target.kind === 'reseller' && target.stores.length > 1 ? (
          <View style={styles.chips}>
            {target.stores.map(item => (
              <Chip key={item.id} label={item.name} selected={storeId === item.id} onPress={() => setStoreId(item.id)} />
            ))}
          </View>
        ) : null}
        <View style={styles.chips}>
          {reportReasons.map(item => (
            <Chip key={item} label={storeReportReasonLabels[item].replace('BitoCard', 'Udozo')} selected={reason === item} onPress={() => setReason(item)} />
          ))}
        </View>
        <Field label="What happened" value={details} onChangeText={setDetails} multiline maxLength={2000} placeholder="Where you saw it and what it said." hint="At least 10 characters." />
        <FormError error={send.error} />
        <Button title="Send report" disabled={details.trim().length < 10} loading={send.isPending} onPress={() => send.mutate()} />
      </Sheet>
    </>
  );
}

const styles = StyleSheet.create({
  inline: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two },
  code: { borderWidth: 1, borderRadius: Radius.medium, padding: Spacing.three, alignItems: 'center' },
  message: { padding: Spacing.two, borderRadius: Radius.medium, gap: 2, maxWidth: '85%' },
});

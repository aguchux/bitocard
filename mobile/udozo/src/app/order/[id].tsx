import {
  buyerOrderLabels,
  connectName,
  disputeReasonLabels,
  payName,
  postedAgo,
  sellerOrderLabels,
  shipmentLabels,
  shopMoney,
  type ShopCourier,
  type ShopDispute,
  type ShopDisputeReason,
  type ShopOrder,
  type ShopReadiness,
  type ShopReleaseCode,
} from '@shared/classifieds';
import type { StoreWallet } from '@shared/storefront';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Image } from 'expo-image';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { usePreventScreenCapture } from 'expo-screen-capture';
import * as WebBrowser from 'expo-web-browser';
import { Camera, MapPin } from 'lucide-react-native';
import { useState } from 'react';
import { Pressable, RefreshControl, ScrollView, StyleSheet, View } from 'react-native';

import { ConfirmSheet, HeldNote, MoneyLines, TermsSheet, type Line } from '@/components/money';
import { AuctionClaim, BuyerDetails, ConnectReturn, OrderThread, ReportStore } from '@/components/order-extras';
import { inter, ThemedText } from '@/components/themed-text';
import { Button, Card, Chip, Failed, Field, FormError, Loading, Sheet, fieldError } from '@/components/ui';
import { Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { api, ApiError, apiUpload } from '@/lib/api';
import { confirmOnPhone, useMoneyKey } from '@/lib/biometrics';
import { orderActions, orderNext, orderOpen, walletShort, type OrderAction } from '@/lib/money';
import { sellerLines } from '@/lib/order-extras';
import { pickPhotos, preparePhoto } from '@/lib/picture';

type Confirming = 'pay' | 'accept' | 'decline' | 'cancel' | 'received' | 'delivered' | 'pay_storage' | null;

/**
 * A UdozoPay order as its buyer or seller sees it (udozo.com's /account/orders/<id>): its state and what to do next,
 * the money (the buyer their fee and total, the seller their fee and payout), the Connect Centre, and the steps:
 * the seller accepts or declines, enters the buyer's code at a meet-up, photographs and ships it, marks it delivered;
 * the buyer pays from the wallet, shows their release code, pays any storage, confirms a delivery, opens a dispute;
 * either cancels before the hand-over. Money steps are confirmed with Face ID or the fingerprint.
 */
export default function OrderScreen() {
  const theme = useTheme();
  const queries = useQueryClient();
  const { id } = useLocalSearchParams<{ id: string }>();
  const order = useQuery({
    queryKey: ['order', id],
    queryFn: () => api<ShopOrder>(`/v1/classifieds/orders/${id}`),
    refetchInterval: query => (query.state.data && orderOpen(query.state.data.status) ? 15_000 : false),
  });
  const [confirming, setConfirming] = useState<Confirming>(null);
  const [reason, setReason] = useState('');
  const [terms, setTerms] = useState<Confirming>(null);
  const key = useMoneyKey();
  const refresh = () => {
    queries.invalidateQueries({ queryKey: ['order', id] });
    queries.invalidateQueries({ queryKey: ['orders'] });
    queries.invalidateQueries({ queryKey: ['wallet'] });
  };
  const step = useMutation({
    mutationFn: (name: Exclude<Confirming, null>) => {
      const path = {
        pay: 'pay',
        accept: 'accept',
        decline: 'decline',
        cancel: 'cancel',
        received: 'received',
        delivered: 'shipment',
        pay_storage: 'storage/pay',
      }[name];
      const body = name === 'delivered' ? { status: 'delivered' } : name === 'decline' || name === 'cancel' ? (reason.trim() ? { reason: reason.trim().slice(0, 300) } : {}) : {};
      return api<ShopOrder>(`/v1/classifieds/orders/${id}/${path}`, { body, idempotencyKey: name === 'pay' || name === 'pay_storage' ? key.current() : undefined });
    },
    onSuccess: (_, name) => {
      if (name === 'pay' || name === 'pay_storage') key.settle();
      setConfirming(null);
      setReason('');
      refresh();
    },
    onError: (error, name) => {
      if (name === 'pay' || name === 'pay_storage') key.settle(error);
      if (error instanceof ApiError && error.code === 'terms_not_accepted') {
        setConfirming(null);
        setTerms(name);
      }
    },
  });

  if (order.isPending) return <Loading />;
  if (order.isError) return <Failed error={order.error} retry={() => void order.refetch()} />;
  const data = order.data;
  const buyer = data.role === 'buyer';
  const actions = orderActions(data);
  const has = (action: OrderAction) => actions.includes(action);
  const total = data.total ?? data.price;
  const connectFee = data.connect?.connect_fee ?? 0;
  let lines: Line[] = [{ label: data.quantity > 1 ? `Item × ${data.quantity}` : 'Item price', amount: data.price }];
  if (buyer) {
    if (data.delivery_fee) lines.push({ label: data.fulfilment === 'connect' ? 'Shipping to the centre' : 'Delivery', amount: data.delivery_fee });
    if (connectFee) lines.push({ label: `${connectName} fee`, amount: connectFee });
    lines.push({ label: `${payName} fee`, amount: data.buyer_fee ?? 0 }, { label: 'Total', amount: total, strong: true });
  } else {
    lines = sellerLines(data, `${payName} fee`);
  }
  const resale = data.kind === 'resale';
  const sheet = (name: Exclude<Confirming, null>) => () => {
    step.reset();
    setConfirming(name);
  };
  return (
    <>
      <Stack.Screen options={{ title: data.number }} />
      <ScrollView style={{ backgroundColor: theme.background }} contentContainerStyle={styles.page} refreshControl={<RefreshControl refreshing={order.isRefetching} onRefresh={refresh} tintColor={theme.primary} />}>
        <Pressable accessibilityRole="button" accessibilityLabel={`${data.listing.title ?? 'The listing'}. Open it`} onPress={() => router.push({ pathname: '/listing/[ref]', params: { ref: String(data.listing.ref) } })} style={[styles.listing, { borderColor: theme.line }]}>
          {data.listing.cover_url ? <Image source={{ uri: data.listing.cover_url }} style={styles.cover} /> : <View style={[styles.cover, { backgroundColor: theme.backgroundElement }]} />}
          <View style={{ flex: 1 }}>
            <ThemedText type="smallBold" numberOfLines={2}>
              {data.listing.title ?? 'Your order'}
            </ThemedText>
            <ThemedText type="caption">{`${buyer ? 'From' : 'To'} ${data.with.name}${data.quantity > 1 ? ` · ${data.quantity} of them` : ''}`}</ThemedText>
            {resale && !buyer && data.store ? <ThemedText type="caption">{`Resale through ${data.store.name}`}</ThemedText> : null}
          </View>
        </Pressable>

        <View accessibilityLiveRegion="polite" style={{ gap: Spacing.one }}>
          <ThemedText type="heading">{(buyer ? buyerOrderLabels : sellerOrderLabels)[data.status]}</ThemedText>
          <ThemedText type="small" themeColor="textSecondary">
            {orderNext(data)}
          </ThemedText>
          {data.end_reason ? <ThemedText type="caption">{data.end_reason}</ThemedText> : null}
        </View>

        {resale && buyer && data.supplier ? <ThemedText type="small">{`Sold by ${data.with.name}; supplied by ${data.supplier.name}, who hands it over or ships it.`}</ThemedText> : null}
        {!buyer && data.buyer_details ? <BuyerDetails details={data.buyer_details} /> : null}
        {data.connect ? <CentreCard order={data} /> : null}
        {data.connect?.return ? <ConnectReturn order={data} item={data.connect.return} onChange={refresh} /> : null}
        {!buyer && data.connect?.auction ? <AuctionClaim order={data} auction={data.connect.auction} onChange={refresh} /> : null}
        {data.fulfilment === 'delivery' && data.delivery_address ? (
          <Card>
            <ThemedText type="smallBold">Delivering to</ThemedText>
            <ThemedText type="small">{data.delivery_address}</ThemedText>
          </Card>
        ) : null}
        {data.shipment ? <ShipmentCard shipment={data.shipment} /> : null}

        <Card>
          <MoneyLines lines={lines} currency={data.currency} note={data.refund ? `${shopMoney(data.refund, data.currency)} was refunded to the buyer’s wallet.` : undefined} />
        </Card>

        {has('accept') ? <Answer order={data} onAccept={sheet('accept')} onDecline={sheet('decline')} /> : null}
        {has('pay') ? <PayPanel order={data} total={total} onPay={sheet('pay')} /> : null}
        {has('pay_storage') ? (
          <Card>
            <ThemedText type="smallBold">{`Storage owed: ${shopMoney(data.connect!.storage_owed!, data.currency)}`}</ThemedText>
            <ThemedText type="small">It is past its free time at the centre. Pay it before the centre takes your release code.</ThemedText>
            <Button title={`Pay ${shopMoney(data.connect!.storage_owed!, data.currency)} storage`} tone="money" onPress={sheet('pay_storage')} />
          </Card>
        ) : null}
        {has('release_code') ? <ReleaseCode order={data} /> : null}
        {has('enter_code') ? <EnterCode order={data} onDone={refresh} /> : null}
        {has('sent') ? <MarkSent order={data} onDone={refresh} /> : null}
        {has('delivered') ? <Button title="Mark it delivered" tone="secondary" onPress={sheet('delivered')} /> : null}
        {has('received') ? <Button title="It arrived: release the payment" tone="money" onPress={sheet('received')} /> : null}
        {has('dispute') || data.dispute ? <DisputePanel order={data} canOpen={has('dispute') && !data.dispute} onChange={refresh} /> : null}
        {has('cancel') ? <Button title={data.status === 'requested' && buyer ? 'Cancel the request' : 'Cancel the order'} tone="ghost" onPress={sheet('cancel')} /> : null}
        {resale ? <OrderThread order={data} /> : null}
        {resale && buyer && data.store ? <ReportStore target={{ kind: 'order', orderId: data.id, storeName: data.store.name }} /> : null}
        <HeldNote />
      </ScrollView>

      <ConfirmSheet
        visible={confirming === 'pay'}
        onClose={() => setConfirming(null)}
        title={`Pay ${shopMoney(total, data.currency)} from your wallet?`}
        body={`Udozo holds it with ${payName} until you have the item and release it to ${data.with.name}.`}
        action={`Pay ${shopMoney(total, data.currency)}`}
        reason={`Pay ${shopMoney(total, data.currency)} from your Udozo wallet`}
        busy={step.isPending}
        error={step.error}
        onConfirm={() => step.mutate('pay')}
      />
      <ConfirmSheet
        visible={confirming === 'pay_storage'}
        onClose={() => setConfirming(null)}
        title="Pay the storage from your wallet?"
        action={data.connect?.storage_owed ? `Pay ${shopMoney(data.connect.storage_owed, data.currency)}` : 'Pay'}
        reason="Pay the storage from your Udozo wallet"
        busy={step.isPending}
        error={step.error}
        onConfirm={() => step.mutate('pay_storage')}
      />
      <ConfirmSheet
        visible={confirming === 'received'}
        onClose={() => setConfirming(null)}
        title="Release the payment?"
        body={`Only if it arrived as described: ${data.with.name} is paid at once, and it cannot be undone.`}
        action="Release the payment"
        reason={`Release ${shopMoney(data.price, data.currency)} to ${data.with.name}`}
        busy={step.isPending}
        error={step.error}
        onConfirm={() => step.mutate('received')}
      />
      <ConfirmSheet
        visible={confirming === 'accept'}
        onClose={() => setConfirming(null)}
        title={data.kind === 'resale' ? 'Accept this order?' : 'Accept this request?'}
        body={data.kind === 'resale' ? 'The buyer’s money moves into UdozoPay and the hand-over time starts.' : `${data.with.name} can then pay with UdozoPay. Accept only if you can hand it over in time.`}
        action="Accept"
        busy={step.isPending}
        error={step.error}
        onConfirm={() => step.mutate('accept')}
      />
      <ConfirmSheet
        visible={confirming === 'delivered'}
        onClose={() => setConfirming(null)}
        title="Mark it delivered?"
        body="Only once the courier has handed it to the buyer: their time to confirm it arrived starts now."
        action="Mark delivered"
        tone="primary"
        busy={step.isPending}
        error={step.error}
        onConfirm={() => step.mutate('delivered')}
      />
      <ConfirmSheet
        visible={confirming === 'decline' || confirming === 'cancel'}
        onClose={() => setConfirming(null)}
        title={confirming === 'decline' ? 'Decline this request?' : data.status === 'requested' ? 'Cancel this request?' : 'Cancel the order?'}
        body={data.status === 'paid' && buyer ? 'You get everything back in your wallet.' : data.status === 'paid' ? 'The buyer gets everything back. Cancelling paid orders counts against you.' : `${data.with.name} is told.`}
        action={confirming === 'decline' ? 'Decline' : 'Cancel it'}
        tone="danger"
        busy={step.isPending}
        error={step.error}
        onConfirm={() => step.mutate(confirming === 'decline' ? 'decline' : 'cancel')}>
        <Field label="Tell them why (optional)" value={reason} onChangeText={setReason} maxLength={300} />
      </ConfirmSheet>
      <TermsSheet visible={Boolean(terms)} onClose={() => setTerms(null)} retry={() => terms && step.mutate(terms)} />
    </>
  );
}

function CentreCard({ order }: { order: ShopOrder }) {
  const theme = useTheme();
  const centre = order.connect!.centre;
  return (
    <Card>
      <View style={styles.inline}>
        <MapPin size={18} color={theme.primary} />
        <ThemedText type="smallBold" style={{ flex: 1 }}>{`${connectName} Centre: ${centre.name}`}</ThemedText>
      </View>
      <ThemedText type="small">{`${centre.address}, ${centre.area}, ${centre.state}`}</ThemedText>
      {centre.landmark ? <ThemedText type="caption">{`Near ${centre.landmark}`}</ThemedText> : null}
      <ThemedText type="caption">{`${centre.hours} · ${centre.phone}`}</ThemedText>
      {order.connect!.collect_by ? <ThemedText type="small">{`Free to collect until ${new Date(order.connect!.collect_by).toLocaleString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}`}</ThemedText> : null}
    </Card>
  );
}

function ShipmentCard({ shipment }: { shipment: NonNullable<ShopOrder['shipment']> }) {
  return (
    <Card>
      <ThemedText type="smallBold">Where it is</ThemedText>
      {shipment.courier ? <ThemedText type="small">{`${shipment.courier}${shipment.tracking_number ? ` · ${shipment.tracking_number}` : ''}`}</ThemedText> : null}
      {shipment.tracking_url ? <Button tone="ghost" title="Track it" onPress={() => WebBrowser.openBrowserAsync(shipment.tracking_url!).catch(() => undefined)} /> : null}
      {shipment.events.slice(-5).reverse().map(event => (
        <ThemedText key={`${event.status}-${event.at}`} type="caption">{`${shipmentLabels[event.status]}${event.note ? `: ${event.note}` : ''} · ${postedAgo(event.at)}`}</ThemedText>
      ))}
    </Card>
  );
}

/** The seller answers a request, once they are ready to take UdozoPay orders (identity check and payout account). */
function Answer({ order, onAccept, onDecline }: { order: ShopOrder; onAccept: () => void; onDecline: () => void }) {
  const readiness = useQuery({ queryKey: ['safe-pay', 'readiness'], queryFn: () => api<ShopReadiness>('/v1/classifieds/me/safe-pay') });
  const ready = readiness.data?.ready ?? true;
  const data = readiness.data;
  return (
    <Card>
      <ThemedText type="heading">{order.kind === 'resale' ? `New order through ${order.store?.name ?? 'a reseller’s store'}` : 'Answer the request'}</ThemedText>
      {data && !data.ready ? (
        data.limited ? (
          <ThemedText type="small">{`You cannot take UdozoPay orders right now (${data.strikes} of ${data.strike_limit} strikes in 90 days). You can still chat and sell directly.`}</ThemedText>
        ) : (
          <>
            <ThemedText type="small">Before your first UdozoPay sale:</ThemedText>
            {data.identity_required !== false && !data.identity_checked ? <Button tone="secondary" title="Pass the identity check" onPress={() => router.push('/identity')} /> : null}
            {!data.payout_account ? <Button tone="secondary" title="Add a payout account" onPress={() => router.push('/payouts')} /> : null}
          </>
        )
      ) : null}
      <View style={styles.row2}>
        <Button title="Decline" tone="secondary" onPress={onDecline} style={{ flex: 1 }} />
        <Button title="Accept" tone="money" disabled={!ready} onPress={onAccept} style={{ flex: 1 }} />
      </View>
    </Card>
  );
}

function PayPanel({ order, total, onPay }: { order: ShopOrder; total: number; onPay: () => void }) {
  const wallet = useQuery({ queryKey: ['wallet', order.currency], queryFn: () => api<StoreWallet>(`/v1/store/wallet?currency=${order.currency}`) });
  const balance = wallet.data?.balance ?? null;
  const short = walletShort(balance, total);
  return (
    <Card>
      <ThemedText type="heading">Pay from your wallet</ThemedText>
      <ThemedText type="small">{balance === null ? 'Your wallet balance could not be read just now.' : `Balance ${shopMoney(balance, order.currency)}${short ? `: add ${shopMoney(short, order.currency)} first.` : '.'}`}</ThemedText>
      {short ? <Button title="Add funds" tone="secondary" onPress={() => router.push({ pathname: '/wallet', params: { wallet: order.currency, add: '1' } })} /> : null}
      <Button title={`Pay ${shopMoney(total, order.currency)}`} tone="money" disabled={short > 0} onPress={onPay} />
    </Card>
  );
}

/** The buyer's release code: shown only after Face ID, never in a screenshot (Android), and only to the buyer. */
function ReleaseCode({ order }: { order: ShopOrder }) {
  const theme = useTheme();
  const [error, setError] = useState<unknown>(null);
  const [code, setCode] = useState<ShopReleaseCode | null>(null);
  const [busy, setBusy] = useState(false);
  const show = async () => {
    setError(null);
    if (!(await confirmOnPhone('Show your release code'))) return;
    setBusy(true);
    try {
      setCode(await api<ShopReleaseCode>(`/v1/classifieds/orders/${order.id}/release-code`));
    } catch (failure) {
      setError(failure);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Card>
      <ThemedText type="heading">Your release code</ThemedText>
      <ThemedText type="small">
        {order.fulfilment === 'connect'
          ? 'Inspect the item at the counter. Give the centre this code only if it is as described: that pays the seller.'
          : `Check the item first. Give ${order.with.name} this code only if it is as described: that pays them.`}
      </ThemedText>
      {code ? <ShownCode code={code} color={theme.text} onHide={() => setCode(null)} /> : <Button title="Show my release code" onPress={show} loading={busy} />}
      <FormError error={error} />
    </Card>
  );
}

function ShownCode({ code, color, onHide }: { code: ShopReleaseCode; color: string; onHide: () => void }) {
  usePreventScreenCapture();
  return (
    <>
      <ThemedText accessibilityLabel={`Release code ${code.code.split('').join(' ')}`} style={{ fontFamily: inter.extrabold, fontSize: 40, lineHeight: 48, letterSpacing: 8, textAlign: 'center', color }}>
        {code.code}
      </ThemedText>
      <Button title="Hide it" tone="secondary" onPress={onHide} />
    </>
  );
}

/** The seller types the buyer's code at the meet-up: the money is paid to them at once (5 tries). */
function EnterCode({ order, onDone }: { order: ShopOrder; onDone: () => void }) {
  const [code, setCode] = useState('');
  const release = useMutation({ mutationFn: () => api<ShopOrder>(`/v1/classifieds/orders/${order.id}/release`, { body: { code } }), onSuccess: onDone });
  return (
    <Card>
      <ThemedText type="heading">The buyer’s release code</ThemedText>
      <ThemedText type="small">{`Hand it over, then type the 6 digits ${order.with.name} shows you. You are paid at once.${order.release_tries_left !== null && order.release_tries_left !== undefined ? ` ${order.release_tries_left} tries left.` : ''}`}</ThemedText>
      <Field label="Release code" value={code} onChangeText={value => setCode(value.replace(/\D/g, '').slice(0, 6))} keyboardType="number-pad" error={fieldError(release.error, 'code')} />
      <FormError error={fieldError(release.error, 'code') ? null : release.error} />
      <Button title="Release the payment" tone="money" disabled={code.length !== 6} loading={release.isPending} onPress={() => release.mutate()} />
    </Card>
  );
}

/**
 * The seller ships it: at least two photos of the item and the sealed parcel, then the courier and tracking number
 * (a Connect order may be dropped off at the centre by hand).
 */
function MarkSent({ order, onDone }: { order: ShopOrder; onDone: () => void }) {
  const theme = useTheme();
  const connect = order.fulfilment === 'connect';
  const [dropOff, setDropOff] = useState(connect);
  const [courier, setCourier] = useState('');
  const [tracking, setTracking] = useState('');
  const [open, setOpen] = useState(false);
  const couriers = useQuery({ queryKey: ['couriers'], enabled: open, staleTime: 60 * 60_000, queryFn: () => api<{ data: ShopCourier[] }>('/v1/classifieds/safe-pay/couriers') });
  const photos = order.shipment?.dispatch_photos.length ?? 0;
  const upload = useMutation({
    mutationFn: async (from: 'camera' | 'library') => {
      const picked = await pickPhotos(from, Math.max(1, 8 - photos));
      for (const photo of picked.photos) {
        const form = new FormData();
        form.append('file', { uri: await preparePhoto(photo), name: 'dispatch.jpg', type: 'image/jpeg' } as unknown as Blob);
        await apiUpload(`/v1/classifieds/orders/${order.id}/dispatch-photos`, form);
      }
      if (picked.refused) throw new Error('Allow Udozo to use the camera or your photos in the phone’s settings.');
    },
    onSettled: onDone,
  });
  const send = useMutation({
    mutationFn: () => api<ShopOrder>(`/v1/classifieds/orders/${order.id}/sent`, { body: dropOff ? {} : { courier: courier.trim(), tracking_number: tracking.trim() } }),
    onSuccess: () => {
      setOpen(false);
      onDone();
    },
  });
  return (
    <Card>
      <ThemedText type="heading">{connect ? `Get it to the ${connectName} Centre` : 'Ship it'}</ThemedText>
      <ThemedText type="small">{`Photograph the item and the sealed parcel (${photos} of at least 2).`}</ThemedText>
      <View style={styles.row2}>
        <Button title="Take photos" tone="secondary" icon={<Camera size={16} color={theme.text} />} loading={upload.isPending} onPress={() => upload.mutate('camera')} style={{ flex: 1 }} />
        <Button title="From photos" tone="secondary" disabled={upload.isPending} onPress={() => upload.mutate('library')} style={{ flex: 1 }} />
      </View>
      <FormError error={upload.error} />
      <Button title={connect ? 'Mark it sent' : 'Mark it shipped'} disabled={photos < 2} onPress={() => setOpen(true)} />
      <Sheet visible={open} onClose={() => setOpen(false)} title={connect ? 'How does it get there?' : 'Which courier?'}>
        {connect ? (
          <View style={styles.chips}>
            <Chip label="I drop it off" selected={dropOff} onPress={() => setDropOff(true)} />
            <Chip label="A courier takes it" selected={!dropOff} onPress={() => setDropOff(false)} />
          </View>
        ) : null}
        {!dropOff ? (
          <>
            <View style={styles.chips}>
              {couriers.data?.data.map(item => (
                <Chip key={item.name} label={item.name} selected={courier === item.name} onPress={() => setCourier(item.name)} />
              ))}
            </View>
            <Field label="Courier" value={courier} onChangeText={setCourier} maxLength={60} error={fieldError(send.error, 'courier')} />
            <Field label="Tracking number" value={tracking} onChangeText={setTracking} maxLength={60} autoCapitalize="characters" error={fieldError(send.error, 'tracking_number')} />
          </>
        ) : null}
        <FormError error={fieldError(send.error, 'courier') || fieldError(send.error, 'tracking_number') ? null : send.error} />
        <Button title="Mark it sent" loading={send.isPending} disabled={!dropOff && (!courier.trim() || !tracking.trim())} onPress={() => send.mutate()} />
      </Sheet>
    </Card>
  );
}

const disputeReasons = Object.keys(disputeReasonLabels) as ShopDisputeReason[];

/** Reporting a problem: why and what happened; then the dispute's messages with Udozo and the other side. */
function DisputePanel({ order, canOpen, onChange }: { order: ShopOrder; canOpen: boolean; onChange: () => void }) {
  const theme = useTheme();
  const [opening, setOpening] = useState(false);
  const [why, setWhy] = useState<ShopDisputeReason>('not_as_described');
  const [details, setDetails] = useState('');
  const [reply, setReply] = useState('');
  const thread = useQuery({ queryKey: ['dispute', order.id], enabled: Boolean(order.dispute), queryFn: () => api<ShopDispute>(`/v1/classifieds/orders/${order.id}/dispute`), refetchInterval: 20_000 });
  const open = useMutation({
    mutationFn: () => api(`/v1/classifieds/orders/${order.id}/dispute`, { body: { reason: why, details: details.trim() } }),
    onSuccess: () => {
      setOpening(false);
      onChange();
    },
  });
  const send = useMutation({
    mutationFn: () => {
      const form = new FormData();
      form.append('body', reply.trim());
      return apiUpload(`/v1/classifieds/orders/${order.id}/dispute/messages`, form);
    },
    onSuccess: () => {
      setReply('');
      void thread.refetch();
    },
  });
  if (!order.dispute) {
    if (!canOpen) return null;
    return (
      <>
        <Button title="Report a problem" tone="secondary" onPress={() => setOpening(true)} />
        <Sheet visible={opening} onClose={() => setOpening(false)} title="Report a problem">
          <View style={styles.chips}>
            {disputeReasons.map(item => (
              <Chip key={item} label={disputeReasonLabels[item]} selected={why === item} onPress={() => setWhy(item)} />
            ))}
          </View>
          <Field label="What happened" value={details} onChangeText={setDetails} multiline maxLength={2000} style={{ minHeight: 96, textAlignVertical: 'top', paddingTop: Spacing.two }} />
          <ThemedText type="caption">Udozo holds the money while it looks at both sides, then decides.</ThemedText>
          <FormError error={open.error} />
          <Button title="Open a dispute" loading={open.isPending} disabled={details.trim().length < 10} onPress={() => open.mutate()} />
        </Sheet>
      </>
    );
  }
  const dispute = thread.data;
  return (
    <Card>
      <ThemedText type="heading">The dispute</ThemedText>
      <ThemedText type="small">
        {order.dispute.status === 'open' ? 'Udozo is looking at both sides. Add anything that helps.' : `Decided${dispute?.note ? `: ${dispute.note}` : '.'}`}
      </ThemedText>
      {dispute?.messages.map(message => (
        <View key={message.id} style={[styles.message, { backgroundColor: message.from === 'me' ? theme.backgroundSelected : theme.backgroundElement }]}>
          <ThemedText type="caption">{`${message.from === 'me' ? 'You' : message.from === 'bitocard' ? 'Udozo' : (message.name ?? order.with.name)} · ${postedAgo(message.created_at)}`}</ThemedText>
          <ThemedText type="small">{message.body}</ThemedText>
        </View>
      ))}
      {order.dispute.status === 'open' ? (
        <>
          <Field label="Your message" value={reply} onChangeText={setReply} multiline maxLength={2000} />
          <FormError error={send.error} />
          <Button title="Send" tone="secondary" disabled={!reply.trim()} loading={send.isPending} onPress={() => send.mutate()} />
        </>
      ) : null}
    </Card>
  );
}

const styles = StyleSheet.create({
  page: { padding: Spacing.three, gap: Spacing.three, paddingBottom: Spacing.six },
  listing: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three, borderWidth: 1, borderRadius: Radius.medium, padding: Spacing.two },
  cover: { width: 64, height: 64, borderRadius: Radius.small },
  inline: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  row2: { flexDirection: 'row', gap: Spacing.two },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two },
  message: { padding: Spacing.two, borderRadius: Radius.medium, gap: 2 },
});

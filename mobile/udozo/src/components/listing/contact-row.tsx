import type { ShopContactRequest, ShopListingPage, ShopViewer } from '@shared/classifieds';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { router } from 'expo-router';
import { Check, Contact, Mail, MessageCircle, Pencil, Phone, PhoneCall, PhoneIncoming, ShieldCheck, Store } from 'lucide-react-native';
import { useState, type ReactNode } from 'react';
import { Linking, Pressable, StyleSheet, View } from 'react-native';

import { CallSellerButton } from '@/components/calls/call-button';
import { useCalls } from '@/components/calls/call-provider';
import { ThemedText } from '@/components/themed-text';
import { Button, Card, Field, FormError, Sheet } from '@/components/ui';
import { Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useAccount } from '@/lib/account';
import { api, ApiError, newIdempotencyKey } from '@/lib/api';
import { listingCallButton } from '@/lib/calls';
import { contactOptions, requestState } from '@/lib/listing-page';

type Kind = 'callback' | 'contact';

/**
 * The ways to get in touch, in clear buttons under the summary (udozo.com's `ListingActions`): Chat (or Open chat),
 * Call (greyed with why while the seller is away), Request call back, Request contact (the seller's phone and email,
 * shown here once they accept) and the seller's page. Only what the listing and viewer allow; signed out, each asks to
 * sign in first. The seller's own listing says so, with Edit.
 */
export function ContactRow({ data, viewer, onChat }: { data: ShopListingPage; viewer: ShopViewer | null; onChat: () => void }) {
  const theme = useTheme();
  const { customer } = useAccount();
  const [asking, setAsking] = useState<Kind | null>(null);
  const [sent, setSent] = useState<Partial<Record<Kind, ShopContactRequest>>>({});
  const calls = useCalls();
  const signedIn = Boolean(customer);
  const signIn = () => router.push('/signin');
  const key = data.seller.username || data.seller.handle;
  const sellerPage = key ? () => router.push({ pathname: '/seller/[key]', params: { key } }) : null;

  if (viewer?.own) {
    return (
      <Card style={{ backgroundColor: theme.backgroundElement }}>
        <ThemedText type="small">This is your listing. Buyers see the ways to contact you here.</ThemedText>
        <Button title="Edit listing" tone="secondary" icon={<Pencil size={18} color={theme.text} />} onPress={() => router.push({ pathname: '/post/[id]', params: { id: data.id } })} />
      </Card>
    );
  }

  const offers = contactOptions(data, viewer, signedIn);
  const callback = sent.callback?.status === 'pending' ? 'pending' : requestState(viewer?.callback?.request);
  const contact = sent.contact?.status === 'pending' ? 'pending' : requestState(viewer?.contact?.request);
  const chatOpen = viewer?.conversation_id;
  const cells: ReactNode[] = [];
  if (offers.allowed && offers.chat) {
    cells.push(<Action key="chat" label={chatOpen ? 'Open chat' : 'Chat'} icon={<MessageCircle size={18} color={theme.onPrimary} />} primary onPress={signedIn ? onChat : signIn} />);
  }
  if (offers.allowed && offers.call && (!signedIn || (calls && listingCallButton(viewer, calls.busy).show))) {
    cells.push(signedIn ? <CallSellerButton key="call" listingId={data.id} viewer={viewer} wide /> : <Action key="call" label="Call" icon={<PhoneCall size={18} color={theme.text} />} onPress={signIn} />);
  }
  if (offers.allowed && offers.callback) {
    cells.push(
      <Action
        key="callback"
        label={callback === 'pending' ? 'Call back asked' : 'Request call back'}
        icon={callback === 'pending' ? <Check size={18} color={theme.success} /> : <PhoneIncoming size={18} color={theme.text} />}
        onPress={signedIn ? () => setAsking('callback') : signIn}
        disabled={signedIn && callback === 'pending'}
      />,
    );
  }
  if (offers.allowed && offers.contact) {
    cells.push(
      <Action
        key="contact"
        label={contact === 'pending' ? 'Contact requested' : contact === 'declined' ? 'Request declined' : 'Request contact'}
        icon={contact === 'none' ? <Contact size={18} color={theme.text} /> : <Check size={18} color={theme.textSecondary} />}
        onPress={signedIn ? () => setAsking('contact') : signIn}
        disabled={signedIn && contact !== 'none'}
      />,
    );
  }
  if (sellerPage) cells.push(<Action key="seller" label="Seller page" icon={<Store size={18} color={theme.text} />} onPress={sellerPage} />);

  const callbackId = pendingId(sent.callback, viewer?.callback?.request);
  return (
    <View style={{ gap: Spacing.two }} accessibilityLabel="Contact the seller">
      {offers.shared ? <SharedContact shared={offers.shared} /> : null}
      {!offers.allowed ? <ThemedText type="small" themeColor="textSecondary">You can contact sellers in your own country&apos;s market.</ThemedText> : null}
      <View style={styles.grid}>
        {cells.map((cell, index) => (
          <View key={index} style={styles.cell}>
            {cell}
          </View>
        ))}
      </View>
      {signedIn && callback === 'pending' && callbackId ? <CancelCallback id={callbackId} listingId={data.id} onCancelled={() => setSent(current => ({ ...current, callback: undefined }))} /> : null}
      {signedIn && viewer && offers.call ? (
        <ThemedText type="caption">
          {viewer.seller_online ? 'The seller is on Udozo now: call them privately, no numbers shared.' : 'The seller is not on Udozo right now: ask them to call you back, or chat.'}
        </ThemedText>
      ) : null}
      {asking ? <RequestSheet kind={asking} listingId={data.id} onClose={() => setAsking(null)} onSent={request => setSent(current => ({ ...current, [asking]: request }))} /> : null}
    </View>
  );
}

/** The open call back's id: the one just sent, else the viewer's pending one. */
const pendingId = (sent: ShopContactRequest | undefined, request: { id: string; status: string } | null | undefined) =>
  sent?.status === 'pending' ? sent.id : request?.status === 'pending' ? request.id : null;

function Action({ label, icon, onPress, primary, disabled }: { label: string; icon: ReactNode; onPress: () => void; primary?: boolean; disabled?: boolean }) {
  return <Button title={label} icon={icon} tone={primary ? 'primary' : 'secondary'} disabled={disabled} onPress={onPress} style={{ flex: 1 }} />;
}

/** The seller's phone and email, once they shared them with this buyer: tap to call or write. */
function SharedContact({ shared }: { shared: { phone: string | null; email: string } }) {
  const theme = useTheme();
  return (
    <Card style={{ borderColor: theme.success }}>
      <View style={styles.inline}>
        <ShieldCheck size={18} color={theme.success} />
        <ThemedText type="smallBold" style={{ color: theme.success, flex: 1 }}>The seller shared their contact with you</ThemedText>
      </View>
      {shared.phone ? (
        <Pressable accessibilityRole="link" accessibilityLabel={`Call ${shared.phone}`} onPress={() => Linking.openURL(`tel:${shared.phone}`).catch(() => undefined)} style={styles.link}>
          <Phone size={16} color={theme.link} />
          <ThemedText type="link">{shared.phone}</ThemedText>
        </Pressable>
      ) : null}
      <Pressable accessibilityRole="link" accessibilityLabel={`Email ${shared.email}`} onPress={() => Linking.openURL(`mailto:${shared.email}`).catch(() => undefined)} style={styles.link}>
        <Mail size={16} color={theme.link} />
        <ThemedText type="link" style={{ flexShrink: 1 }}>{shared.email}</ThemedText>
      </Pressable>
      <ThemedText type="caption">Only you see these. Never pay before you have seen the item, and never share codes sent to your phone.</ThemedText>
    </Card>
  );
}

/** Asking for a call back or the seller's contact: what is shared, an optional note, then sent once (its own key). */
function RequestSheet({ kind, listingId, onClose, onSent }: { kind: Kind; listingId: string; onClose: () => void; onSent: (request: ShopContactRequest) => void }) {
  const queries = useQueryClient();
  const [note, setNote] = useState('');
  const [key, setKey] = useState(newIdempotencyKey);
  const callback = kind === 'callback';
  const send = useMutation({
    mutationFn: () =>
      api<ShopContactRequest>(`/v1/classifieds/listings/${listingId}/${callback ? 'callbacks' : 'contact-requests'}`, {
        body: note.trim() ? { note: note.trim().slice(0, 300) } : {},
        idempotencyKey: key,
      }),
    onSuccess: request => {
      onSent(request);
      queries.invalidateQueries({ queryKey: ['viewer', listingId] });
    },
    onError: () => setKey(newIdempotencyKey()),
  });
  const needsMobile = send.error instanceof ApiError && send.error.code === 'phone_required';
  return (
    <Sheet visible onClose={onClose} title={callback ? 'Ask for a call back' : "Ask for the seller's contact"}>
      {send.isSuccess ? (
        <>
          <ThemedText>{callback ? 'Sent. The seller has your number and can call you.' : 'Sent. If the seller accepts, their phone and email will show here.'}</ThemedText>
          <Button title="Done" onPress={onClose} />
        </>
      ) : (
        <>
          <ThemedText type="small">
            {callback
              ? 'We send your name, your mobile number and your email to the seller with this listing, so they can call you. Nothing is shown on the page.'
              : 'If the seller accepts, you will see their phone number and email here, on every listing of theirs. They see only your first name and initial.'}
          </ThemedText>
          <Field label={callback ? 'When is a good time? (optional)' : 'A note for the seller (optional)'} value={note} onChangeText={setNote} multiline maxLength={300} />
          {needsMobile ? (
            <>
              <ThemedText type="small">Confirm your mobile number first, so the seller can call you.</ThemedText>
              <Button title="Confirm my mobile" tone="secondary" onPress={() => (onClose(), router.push('/verify'))} />
            </>
          ) : (
            <FormError error={send.error} />
          )}
          <Button title={callback ? 'Ask them to call me' : 'Send request'} loading={send.isPending} onPress={() => send.mutate()} />
        </>
      )}
    </Sheet>
  );
}

/** The buyer takes back a call back still waiting. */
function CancelCallback({ id, listingId, onCancelled }: { id: string; listingId: string; onCancelled: () => void }) {
  const queries = useQueryClient();
  const cancel = useMutation({
    mutationFn: () => api(`/v1/classifieds/contact-requests/${id}/cancel`, { method: 'POST', body: {} }),
    onSuccess: () => {
      onCancelled();
      queries.invalidateQueries({ queryKey: ['viewer', listingId] });
    },
  });
  return (
    <View>
      <FormError error={cancel.error} />
      <Button tone="ghost" title="Cancel my call back request" loading={cancel.isPending} onPress={() => cancel.mutate()} />
    </View>
  );
}

const styles = StyleSheet.create({
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two },
  // Each a row of its own, half the width: a button's flex then grows sideways, never down.
  cell: { flexDirection: 'row', flexBasis: '48%', flexGrow: 1 },
  inline: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  link: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two, minHeight: 44, borderRadius: Radius.small },
});

import { shopPriceText, type ShopListingCard, type ShopSellerProfile, type ShopViewer } from '@shared/classifieds';
import { useQueryClient } from '@tanstack/react-query';
import { Image } from 'expo-image';
import { router } from 'expo-router';
import { ImageIcon } from 'lucide-react-native';
import { useState, type ReactNode } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { whyNot } from '@/components/calls/call-button';
import { useCalls } from '@/components/calls/call-provider';
import { infoDialog, useDialog, useToast } from '@/components/feedback';
import { MessageSheet } from '@/components/listing/message-sheet';
import { ThemedText } from '@/components/themed-text';
import { Sheet } from '@/components/ui';
import { Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useAccount } from '@/lib/account';
import { api } from '@/lib/api';
import { listingCallButton } from '@/lib/calls';
import { photoUrl } from '@/lib/photo';

export type ContactListing = ShopSellerProfile['contact_listings'][number];
type Kind = 'chat' | 'call';

/** The seller's listings each way takes: chats where the seller takes them, calls where they take calls. */
export function contactChoices(data: Pick<ShopSellerProfile, 'contact' | 'contact_listings'>) {
  return {
    chat: data.contact.chat ? data.contact_listings.filter(item => item.chat) : [],
    call: data.contact.phone ? data.contact_listings.filter(item => item.phone) : [],
  };
}

/** Whether the page is the signed-in customer's own (their handle, or their username). */
export function ownPage(customer: { seller_handle?: string | null; username?: string | null } | null | undefined, data: Pick<ShopSellerProfile, 'handle' | 'username'>) {
  if (!customer) return false;
  return customer.seller_handle === data.handle || Boolean(customer.username && customer.username === data.username);
}

/**
 * Chat and Call from a seller's page. A chat or a call is always about a listing, as udozo.com's Contact panel asks
 * ("About which listing?"): with one that takes it, straight on; with several, a sheet to choose (its photo and price
 * from the seller's listings already loaded below, `cards`). Then the listing's viewer decides: its open chat, else the
 * message box; the call, else Udozo's dialog saying why (with Chat with seller where the listing takes chats). Signed
 * out, either asks to sign in first.
 */
export function useSellerContact(data: ShopSellerProfile | undefined, cards: ShopListingCard[]) {
  const theme = useTheme();
  const queries = useQueryClient();
  const { customer } = useAccount();
  const calls = useCalls();
  const ask = useDialog();
  const toast = useToast();
  const [choosing, setChoosing] = useState<Kind | null>(null);
  const [asking, setAsking] = useState<ContactListing | null>(null);
  const [body, setBody] = useState('');
  const choices = data ? contactChoices(data) : { chat: [], call: [] };
  const own = ownPage(customer, data ?? { handle: '', username: null });

  const viewerOf = (id: string) => queries.fetchQuery({ queryKey: ['viewer', id], queryFn: () => api<ShopViewer>(`/v1/classifieds/listings/${id}/viewer`) });

  const chatAbout = async (item: ContactListing) => {
    try {
      const viewer = await viewerOf(item.id);
      if (viewer.conversation_id) return router.push({ pathname: '/chat/[id]', params: { id: viewer.conversation_id } });
      setBody(`Hello, is “${item.title}” still available?`);
      setAsking(item);
    } catch (error) {
      toast({ message: (error as Error).message, tone: 'error' });
    }
  };

  const callAbout = async (item: ContactListing) => {
    if (!calls) return void ask(infoDialog('Call seller', 'Calls are not available on this phone yet. Chat with the seller instead.'));
    try {
      const viewer = await viewerOf(item.id);
      const state = listingCallButton(viewer, calls.busy);
      if (!state.show) return void ask(infoDialog('Call seller', 'This listing does not take calls right now.'));
      if (state.ready) return calls.start({ listing_id: item.id });
      await whyNot(ask, 'Call seller', state, calls.busy || !item.chat ? {} : { chat: () => void chatAbout(item) });
    } catch (error) {
      toast({ message: (error as Error).message, tone: 'error' });
    }
  };

  const go = (kind: Kind, item: ContactListing) => (kind === 'chat' ? chatAbout(item) : callAbout(item));
  const open = (kind: Kind) => {
    if (!customer) return router.push('/signin');
    const listings = choices[kind];
    if (listings.length === 1) return void go(kind, listings[0]);
    setChoosing(kind);
  };

  const ui: ReactNode = (
    <>
      <Sheet visible={choosing !== null} onClose={() => setChoosing(null)} title="About which listing?">
        <ThemedText type="small" themeColor="textSecondary">
          {choosing === 'call' ? 'Calls are about one of their listings.' : 'Chats are about one of their listings.'}
        </ThemedText>
        <View style={{ gap: Spacing.two }}>
          {(choosing ? choices[choosing] : []).map(item => {
            const card = cards.find(entry => entry.id === item.id);
            const price = card ? shopPriceText(card.price) : null;
            return (
              <Pressable
                key={item.id}
                accessibilityRole="button"
                accessibilityLabel={[item.title, price].filter(Boolean).join(', ')}
                onPress={() => {
                  const kind = choosing!;
                  setChoosing(null);
                  void go(kind, item);
                }}
                style={[styles.choice, { borderColor: theme.line }]}>
                {card?.cover ? (
                  <Image source={{ uri: photoUrl(card.cover.url) ?? undefined }} style={styles.thumb} contentFit="cover" accessibilityIgnoresInvertColors />
                ) : (
                  <View style={[styles.thumb, styles.blank, { backgroundColor: theme.backgroundElement }]}>
                    <ImageIcon size={20} color={theme.textSecondary} />
                  </View>
                )}
                <View style={{ flex: 1 }}>
                  <ThemedText type="smallBold" numberOfLines={2}>{item.title}</ThemedText>
                  {price ? <ThemedText type="price" numberOfLines={1}>{price}</ThemedText> : null}
                </View>
              </Pressable>
            );
          })}
        </View>
      </Sheet>
      {asking ? <MessageSheet listingId={asking.id} visible onClose={() => setAsking(null)} body={body} setBody={setBody} /> : null}
    </>
  );

  return {
    own,
    /** Shown where the seller takes chats on a listing (signed out too: it asks to sign in). */
    chat: !own && choices.chat.length ? () => open('chat') : null,
    /** Shown where the seller takes calls on a listing and this phone can make them (signed out, it asks to sign in). */
    call: !own && choices.call.length && (!customer || calls) ? () => open('call') : null,
    ui,
  };
}

const styles = StyleSheet.create({
  choice: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three, borderWidth: 1, borderRadius: Radius.medium, padding: Spacing.two, minHeight: 64 },
  thumb: { width: 56, height: 56, borderRadius: Radius.small },
  blank: { alignItems: 'center', justifyContent: 'center' },
});

import type { ShopListingPage, ShopViewer } from '@shared/classifieds';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { router } from 'expo-router';
import { Heart, MessageCircle, ShieldCheck } from 'lucide-react-native';
import { useState } from 'react';
import { Pressable, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { CallSellerButton } from '@/components/calls/call-button';
import { useToast } from '@/components/feedback';
import { ThemedText } from '@/components/themed-text';
import { Button, Field, FormError, Sheet } from '@/components/ui';
import { Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useAccount } from '@/lib/account';
import { api } from '@/lib/api';
import { useAssistantDraft } from '@/lib/assistant-draft';
import { buyAction } from '@/lib/money';
import { useMarket } from '@/lib/market';

/**
 * Buy with UdozoPay, Save, Call and Chat with seller, always in reach at the bottom; the seller's own listing says so
 * instead. `asking` opens Message the seller (also from the contact row's Chat).
 */
export function ActionBar({ data, viewer, country, asking, setAsking }: { data: ShopListingPage; viewer: ShopViewer | null; country: string; asking: boolean; setAsking: (open: boolean) => void }) {
  const theme = useTheme();
  const queries = useQueryClient();
  const toast = useToast();
  const { customer } = useAccount();
  const market = useMarket();
  const [body, setBody] = useState(`Hello, is “${data.title}” still available?`);
  const save = useMutation({
    mutationFn: () => (viewer?.favourite ? api(`/v1/classifieds/favourites/${data.id}`, { method: 'DELETE' }) : api('/v1/classifieds/favourites', { body: { listing_id: data.id } })),
    onSuccess: () => {
      queries.invalidateQueries({ queryKey: ['viewer', data.id] });
      queries.invalidateQueries({ queryKey: ['favourites'] });
      toast(viewer?.favourite ? { message: 'Removed from saved', tone: 'info' } : { message: 'Saved', tone: 'success', action: { label: 'See saved', onPress: () => router.push('/saved') } });
    },
    onError: error => toast({ message: (error as Error).message, tone: 'error' }),
  });
  const start = useMutation({
    mutationFn: () => api<{ id: string }>('/v1/classifieds/conversations', { body: { listing_id: data.id, body: body.trim() } }),
    onSuccess: chat => {
      setAsking(false);
      queries.invalidateQueries({ queryKey: ['viewer', data.id] });
      router.push({ pathname: '/chat/[id]', params: { id: chat.id } });
    },
  });
  const signIn = () => router.push('/signin');
  // A first message Anjio drafted from this listing: into the open chat, else into Message the seller.
  useAssistantDraft('listing', data.id, text => {
    if (viewer?.conversation_id) router.push({ pathname: '/chat/[id]', params: { id: viewer.conversation_id, draft: text } });
    else {
      setBody(text);
      setAsking(true);
    }
  });

  if (viewer?.own) {
    return (
      <SafeAreaView edges={['bottom']} style={[styles.bar, { borderColor: theme.line, backgroundColor: theme.background }]}>
        <ThemedText type="small" themeColor="textSecondary">This is your listing.</ThemedText>
      </SafeAreaView>
    );
  }
  const chatOpen = viewer?.conversation_id;
  const canChat = data.contact.chat && data.status === 'active';
  const buy = buyAction(data, viewer, Boolean(market.markets.find(item => item.country === country)?.safe_pay));
  const openChat = () => (!customer ? signIn() : chatOpen ? router.push({ pathname: '/chat/[id]', params: { id: chatOpen } }) : setAsking(true));
  const onBuy = () => {
    if (!customer || !buy) return signIn();
    if (buy.kind === 'order') router.push({ pathname: '/order/[id]', params: { id: buy.id } });
    else router.push({ pathname: '/checkout/[id]', params: { id: data.id, title: data.title } });
  };
  return (
    <SafeAreaView edges={['bottom']} style={[styles.bar, { borderColor: theme.line, backgroundColor: theme.background }]}>
      {buy ? <Button style={{ flex: 1 }} tone="money" title={buy.label} icon={<ShieldCheck size={18} color={theme.onPrimary} />} onPress={onBuy} /> : null}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={viewer?.favourite ? 'Saved. Remove from saved' : 'Save'}
        accessibilityState={{ selected: Boolean(viewer?.favourite) }}
        onPress={() => (customer ? save.mutate() : signIn())}
        style={[styles.save, { borderColor: theme.line }]}>
        <Heart size={22} color={viewer?.favourite ? theme.danger : theme.text} fill={viewer?.favourite ? theme.danger : 'none'} />
      </Pressable>
      {canChat || chatOpen ? <CallSellerButton listingId={data.id} viewer={viewer} onChat={openChat} /> : null}
      {canChat || chatOpen ? (
        <Button
          style={{ flex: 1 }}
          title={chatOpen ? 'Open chat' : 'Chat with seller'}
          icon={<MessageCircle size={18} color={theme.onPrimary} />}
          onPress={openChat}
        />
      ) : data.status !== 'sold' && viewer?.calls ? (
        <CallSellerButton listingId={data.id} viewer={viewer} wide />
      ) : (
        <ThemedText type="small" themeColor="textSecondary" style={{ flex: 1 }}>
          {data.status === 'sold' ? 'This item has been sold.' : 'The seller takes calls only. Ask them to call you back on udozo.com.'}
        </ThemedText>
      )}
      <Sheet visible={asking} onClose={() => setAsking(false)} title="Message the seller">
        <FormError error={start.error} />
        <Field label="Your message" value={body} onChangeText={setBody} multiline maxLength={1000} style={{ minHeight: 96, textAlignVertical: 'top', paddingTop: Spacing.two }} />
        <ThemedText type="caption">Keep chats on Udozo. Never share codes or pay before you see the item.</ThemedText>
        <Button title="Send" loading={start.isPending} disabled={!body.trim()} onPress={() => start.mutate()} />
      </Sheet>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  bar: { position: 'absolute', left: 0, right: 0, bottom: 0, flexDirection: 'row', alignItems: 'center', gap: Spacing.three, paddingHorizontal: Spacing.three, paddingTop: Spacing.two, paddingBottom: Spacing.two, borderTopWidth: StyleSheet.hairlineWidth },
  save: { width: 48, height: 48, borderRadius: Radius.medium, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
});

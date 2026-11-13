import { shopMoney, shopPriceText, type ShopChat, type ShopChatReportReason, type ShopMessage, type ShopOffer } from '@shared/classifieds';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import * as SecureStore from 'expo-secure-store';
import { Camera, EllipsisVertical, Send } from 'lucide-react-native';
import { useState } from 'react';
import { FlatList, KeyboardAvoidingView, Platform, Pressable, StyleSheet, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ChatCallButton } from '@/components/calls/call-button';
import { inter, ThemedText } from '@/components/themed-text';
import { Button, Chip, Failed, Field, FormError, Loading, Sheet } from '@/components/ui';
import { Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { api, apiUpload, privateImage } from '@/lib/api';
import { useShopAssistant } from '@/lib/assistant';
import { useAssistantDraft } from '@/lib/assistant-draft';
import { preparePhoto } from '@/lib/picture';
import { openSeller, photoUrl } from '@/lib/navigate';
import { registerPush } from '@/lib/push';
import { useSession } from '@/lib/session';
import { reportReasons } from '@/lib/words';

const chatReasons: Record<ShopChatReportReason, string> = { ...reportReasons, review_pressure: 'They pressured me over a review' };
const pushAskedKey = 'udozo.push_asked';

/**
 * A chat about a listing: the listing at the top, messages newest at the bottom (read again every 4 seconds while
 * open), offers with their buttons, photos, and the menu to make an offer, report or block. After the customer's
 * first message the app asks, once, to turn notifications on, so replies reach them.
 */
export default function ChatScreen() {
  const theme = useTheme();
  const queries = useQueryClient();
  const { id, draft } = useLocalSearchParams<{ id: string; draft?: string }>();
  const session = useSession();
  // A first message Anjio drafted is put in the box for the buyer to read and send themselves.
  const [text, setText] = useState(draft ?? '');
  const [menu, setMenu] = useState<'none' | 'menu' | 'offer' | 'report'>('none');
  const chat = useQuery({ queryKey: ['chat', id], enabled: Boolean(id), queryFn: () => api<ShopChat>(`/v1/classifieds/conversations/${id}?limit=60`), refetchInterval: 4000 });
  const refresh = () => {
    queries.invalidateQueries({ queryKey: ['chat', id] });
    queries.invalidateQueries({ queryKey: ['chats'] });
  };
  const askForPush = async () => {
    if (await SecureStore.getItemAsync(pushAskedKey).catch(() => '1')) return;
    await SecureStore.setItemAsync(pushAskedKey, '1').catch(() => undefined);
    registerPush({ ask: true }).catch(() => undefined);
  };
  const send = useMutation({
    mutationFn: (body: string) => api(`/v1/classifieds/conversations/${id}/messages`, { body: { body } }),
    onSuccess: () => {
      setText('');
      refresh();
      askForPush();
    },
  });
  const photo = useMutation({
    mutationFn: async () => {
      const picked = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 1 });
      if (picked.canceled || !picked.assets[0]) return null;
      const asset = picked.assets[0];
      // Scaled to 1600 px and saved as JPEG first: the API takes JPEG or PNG up to 4 MB, and phones save HEIC and 50 MP.
      const uri = await preparePhoto({ uri: asset.uri, width: asset.width, height: asset.height });
      const form = new FormData();
      form.append('file', { uri, name: 'photo.jpg', type: 'image/jpeg' } as unknown as Blob);
      return apiUpload(`/v1/classifieds/conversations/${id}/photos`, form);
    },
    onSuccess: refresh,
  });

  useAssistantDraft('chat', chat.data?.listing.id, setText);

  if (chat.isPending) return <Loading />;
  if (chat.isError) return <Failed error={chat.error} retry={() => void chat.refetch()} />;
  const data = chat.data;
  const blocked = data.blocked.by_me || data.blocked.by_them;
  const messages = [...data.messages].reverse();
  return (
    <>
      <Stack.Screen
        options={{
          title: data.with.name,
          // Their name opens their seller page, where they have one.
          headerTitle:
            data.with.username || data.with.handle
              ? () => (
                  <Pressable accessibilityRole="link" accessibilityLabel={`${data.with.name}. Open their seller page`} hitSlop={8} onPress={() => openSeller(data.with)}>
                    <ThemedText type="heading" numberOfLines={1}>
                      {data.with.name}
                    </ThemedText>
                  </Pressable>
                )
              : undefined,
          headerRight: () => (
            <View style={styles.header}>
              <ChatCallButton chat={data} />
              <Pressable accessibilityRole="button" accessibilityLabel="More" hitSlop={10} onPress={() => setMenu('menu')}>
                <EllipsisVertical size={22} color={theme.primary} />
              </Pressable>
            </View>
          ),
        }}
      />
      <KeyboardAvoidingView style={{ flex: 1, backgroundColor: theme.background }} behavior={Platform.OS === 'ios' ? 'padding' : undefined} keyboardVerticalOffset={90}>
        <Pressable
          accessibilityRole="link"
          accessibilityLabel={`About ${data.listing.title}. Open the listing`}
          onPress={() => router.push({ pathname: '/listing/[ref]', params: { ref: String(data.listing.ref), country: data.listing.country } })}
          style={[styles.strip, { borderColor: theme.line }]}>
          <View style={[styles.thumb, { backgroundColor: theme.backgroundElement }]}>
            {data.listing.cover_url ? <Image source={{ uri: photoUrl(data.listing.cover_url, 480)! }} style={StyleSheet.absoluteFill} accessibilityIgnoresInvertColors /> : null}
          </View>
          <View style={{ flex: 1 }}>
            <ThemedText type="smallBold" numberOfLines={1}>
              {data.listing.title}
            </ThemedText>
            <ThemedText type="small">{shopPriceText(data.listing.price)}</ThemedText>
          </View>
        </Pressable>
        <FlatList
          inverted
          data={messages}
          keyExtractor={message => message.id}
          contentContainerStyle={styles.messages}
          renderItem={({ item }) => <Bubble message={item} session={session} chatId={data.id} buyer={data.role === 'buyer' ? { listingId: data.listing.id, title: data.listing.title } : null} onChange={refresh} />}
        />
        {blocked ? (
          <ThemedText type="small" themeColor="textSecondary" style={styles.blocked}>
            {data.blocked.by_me ? 'You blocked this chat. Unblock it from the menu to write again.' : 'You can no longer write in this chat.'}
          </ThemedText>
        ) : (
          <SafeAreaView edges={['bottom']} style={[styles.composer, { borderColor: theme.line }]}>
            <Pressable accessibilityRole="button" accessibilityLabel="Send a photo" onPress={() => photo.mutate()} style={styles.icon} disabled={photo.isPending}>
              <Camera size={22} color={theme.primary} />
            </Pressable>
            <TextInput
              value={text}
              onChangeText={setText}
              placeholder="Write a message"
              placeholderTextColor={theme.textSecondary}
              accessibilityLabel="Message"
              multiline
              maxLength={1000}
              style={[styles.input, { color: theme.text, borderColor: theme.line }]}
            />
            <Pressable accessibilityRole="button" accessibilityLabel="Send" onPress={() => text.trim() && send.mutate(text.trim())} disabled={!text.trim() || send.isPending} style={styles.icon}>
              <Send size={22} color={text.trim() ? theme.primary : theme.textSecondary} />
            </Pressable>
          </SafeAreaView>
        )}
        {send.error || photo.error ? (
          <View style={{ paddingHorizontal: Spacing.three }}>
            <FormError error={send.error ?? photo.error} />
          </View>
        ) : null}
      </KeyboardAvoidingView>
      <ChatMenu chat={data} menu={menu} setMenu={setMenu} onChange={refresh} />
    </>
  );
}

function Bubble({ message, session, chatId, buyer, onChange }: { message: ShopMessage; session: string | null; chatId: string; buyer: { listingId: string; title: string | null } | null; onChange: () => void }) {
  const theme = useTheme();
  if (message.from === 'bitocard' || message.kind === 'system') {
    return (
      <ThemedText type="caption" style={styles.system}>
        {message.body}
      </ThemedText>
    );
  }
  const mine = message.from === 'me';
  const time = new Date(message.created_at).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
  return (
    <View style={[styles.bubble, mine ? [styles.mine, { backgroundColor: theme.primary }] : [styles.theirs, { backgroundColor: theme.backgroundElement }]]}>
      {message.photo ? (
        <Image
          source={privateImage(message.photo.url, session)}
          style={[styles.photo, { aspectRatio: message.photo.width && message.photo.height ? message.photo.width / message.photo.height : 1 }]}
          contentFit="cover"
          accessibilityLabel="Photo"
        />
      ) : null}
      {message.offer ? <OfferCard offer={message.offer} chatId={chatId} buyer={buyer} onChange={onChange} mine={mine} /> : null}
      {message.body && message.kind !== 'offer' ? <ThemedText style={{ color: mine ? theme.onPrimary : theme.text }}>{message.body}</ThemedText> : null}
      <ThemedText type="caption" style={{ color: mine ? theme.onPrimary : theme.textSecondary, alignSelf: 'flex-end' }}>
        {time}
      </ThemedText>
    </View>
  );
}

/** An offer in the chat; once the seller accepts the buyer's, the buyer buys at its price with UdozoPay. */
function OfferCard({ offer, mine, buyer, onChange }: { offer: ShopOffer; chatId: string; mine: boolean; buyer: { listingId: string; title: string | null } | null; onChange: () => void }) {
  const theme = useTheme();
  const act = useMutation({ mutationFn: (step: 'accept' | 'decline' | 'withdraw') => api(`/v1/classifieds/offers/${offer.id}/${step}`, { body: {} }), onSuccess: onChange });
  const ink = mine ? theme.onPrimary : theme.text;
  const status = { open: 'Waiting for an answer', accepted: 'Accepted', declined: 'Declined', withdrawn: 'Withdrawn', expired: 'Expired' }[offer.status];
  return (
    <View style={{ gap: Spacing.one }}>
      <ThemedText type="caption" style={{ color: ink }}>
        {offer.made_by === 'me' ? 'Your offer' : 'Their offer'}
      </ThemedText>
      <ThemedText style={{ color: ink, fontFamily: inter.extrabold, fontSize: 20 }}>{shopMoney(offer.price.amount, offer.price.currency)}</ThemedText>
      <ThemedText type="small" style={{ color: ink }}>
        {status}
      </ThemedText>
      {offer.status === 'open' && offer.made_by === 'them' ? (
        <View style={{ flexDirection: 'row', gap: Spacing.two }}>
          <Button title="Accept" onPress={() => act.mutate('accept')} loading={act.isPending && act.variables === 'accept'} style={{ flex: 1 }} />
          <Button title="Decline" tone="secondary" onPress={() => act.mutate('decline')} loading={act.isPending && act.variables === 'decline'} style={{ flex: 1 }} />
        </View>
      ) : null}
      {offer.status === 'open' && offer.made_by === 'me' ? <Button title="Withdraw" tone="secondary" onPress={() => act.mutate('withdraw')} loading={act.isPending} /> : null}
      {offer.status === 'accepted' && buyer ? (
        <Button title="Buy at this price with UdozoPay" tone="money" onPress={() => router.push({ pathname: '/checkout/[id]', params: { id: buyer.listingId, offer: offer.id, title: buyer.title ?? '' } })} />
      ) : null}
      <FormError error={act.error} />
    </View>
  );
}

function ChatMenu({ chat, menu, setMenu, onChange }: { chat: ShopChat; menu: 'none' | 'menu' | 'offer' | 'report'; setMenu: (value: 'none' | 'menu' | 'offer' | 'report') => void; onChange: () => void }) {
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState<ShopChatReportReason | null>(null);
  const [details, setDetails] = useState('');
  const close = () => setMenu('none');
  const block = useMutation({ mutationFn: () => api(`/v1/classifieds/conversations/${chat.id}/${chat.blocked.by_me ? 'unblock' : 'block'}`, { body: {} }), onSuccess: () => (onChange(), close()) });
  const offer = useMutation({
    mutationFn: () => api(`/v1/classifieds/conversations/${chat.id}/offers`, { body: { price: Math.round(Number(amount.replace(/[^\d.]/g, '')) * 100) } }),
    onSuccess: () => (onChange(), setAmount(''), close()),
  });
  const report = useMutation({ mutationFn: () => api(`/v1/classifieds/conversations/${chat.id}/report`, { body: { reason, details: details.trim() || undefined } }) });
  const assistant = useShopAssistant(chat.listing.country);
  const canOffer = chat.role === 'buyer' && !chat.open_offer && chat.listing.status === 'active' && chat.listing.price.kind !== 'on_request' && !chat.blocked.by_them && !chat.blocked.by_me;
  return (
    <>
      <Sheet visible={menu === 'menu'} onClose={close} title="This chat">
        {canOffer ? <Button tone="secondary" title="Make an offer" onPress={() => setMenu('offer')} /> : null}
        {assistant?.assistant ? (
          <Button
            tone="secondary"
            title={`Ask ${assistant.assistant.name}`}
            onPress={() => {
              close();
              router.push({ pathname: '/assistant', params: { country: chat.listing.country, listing: chat.listing.id, conversation: chat.id, title: chat.listing.title } });
            }}
          />
        ) : null}
        <Button tone="secondary" title="Report this chat" onPress={() => setMenu('report')} />
        <Button tone={chat.blocked.by_me ? 'secondary' : 'danger'} title={chat.blocked.by_me ? 'Unblock' : 'Block'} loading={block.isPending} onPress={() => block.mutate()} />
        <FormError error={block.error} />
      </Sheet>
      <Sheet visible={menu === 'offer'} onClose={close} title="Make an offer">
        <ThemedText type="small" themeColor="textSecondary">{`Asking ${shopPriceText(chat.listing.price)}. The seller has 48 hours to answer.`}</ThemedText>
        <Field label={`Your offer (${chat.listing.price.currency})`} value={amount} onChangeText={setAmount} keyboardType="decimal-pad" />
        <FormError error={offer.error} />
        <Button title="Send offer" disabled={!Number(amount.replace(/[^\d.]/g, ''))} loading={offer.isPending} onPress={() => offer.mutate()} />
      </Sheet>
      <Sheet visible={menu === 'report'} onClose={close} title="Report this chat">
        {report.isSuccess ? (
          <>
            <ThemedText>Thank you. Udozo&apos;s team will read this chat.</ThemedText>
            <Button title="Done" onPress={close} />
          </>
        ) : (
          <>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two }}>
              {(Object.keys(chatReasons) as ShopChatReportReason[]).map(item => (
                <Chip key={item} label={chatReasons[item]} selected={reason === item} onPress={() => setReason(item)} />
              ))}
            </View>
            <Field label="What happened (optional)" value={details} onChangeText={setDetails} multiline maxLength={1000} />
            <FormError error={report.error} />
            <Button title="Send report" disabled={!reason} loading={report.isPending} onPress={() => report.mutate()} />
          </>
        )}
      </Sheet>
    </>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', gap: Spacing.four },
  strip: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three, padding: Spacing.three, borderBottomWidth: StyleSheet.hairlineWidth },
  thumb: { width: 44, height: 44, borderRadius: Radius.small, overflow: 'hidden' },
  messages: { padding: Spacing.three, gap: Spacing.two },
  bubble: { maxWidth: '82%', borderRadius: Radius.medium, padding: Spacing.three, gap: 4 },
  mine: { alignSelf: 'flex-end', borderBottomRightRadius: 4 },
  theirs: { alignSelf: 'flex-start', borderBottomLeftRadius: 4 },
  system: { textAlign: 'center', paddingVertical: Spacing.two },
  photo: { width: 220, borderRadius: Radius.small },
  composer: { flexDirection: 'row', alignItems: 'flex-end', gap: Spacing.two, paddingHorizontal: Spacing.two, paddingTop: Spacing.two, borderTopWidth: StyleSheet.hairlineWidth },
  input: { flex: 1, minHeight: 44, maxHeight: 120, borderWidth: 1, borderRadius: Radius.medium, paddingHorizontal: Spacing.three, paddingVertical: Spacing.two, fontFamily: inter.regular, fontSize: 16 },
  icon: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  blocked: { padding: Spacing.three, textAlign: 'center' },
});

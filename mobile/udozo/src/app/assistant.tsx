import { assistantToolLabels, shopMoney, shopPriceText, type ShopAssistantCard, type ShopAssistantMessage, type ShopAssistantThread, type ShopListingCard } from '@shared/classifieds';
import { useMutation, useQuery } from '@tanstack/react-query';
import * as Clipboard from 'expo-clipboard';
import { Image } from 'expo-image';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { Check, Flag, Send, ThumbsDown, ThumbsUp } from 'lucide-react-native';
import { useEffect, useRef, useState } from 'react';
import { FlatList, KeyboardAvoidingView, Platform, Pressable, StyleSheet, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { AnswerText } from '@/components/answer-text';
import { useToast } from '@/components/feedback';
import { ThemedText } from '@/components/themed-text';
import { Avatar, Button, Card, Chip, Empty, Field, Loading } from '@/components/ui';
import { MaxContentWidth, Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useAccount } from '@/lib/account';
import { ApiError } from '@/lib/api';
import { askAssistant, assistantProfile, rateAnswer, reportAnswer, saveLanguage, savedLanguage, startThread, talkToPerson } from '@/lib/assistant';
import { putDraft } from '@/lib/assistant-draft';
import { useMarket } from '@/lib/market';
import { openLink, photoUrl } from '@/lib/navigate';

type Entry = { kind: 'user'; key: string; body: string } | { kind: 'answer'; key: string; message: ShopAssistantMessage };

const unavailable = (name: string) => `${name} can’t answer right now. Search still works.`;

/**
 * Ask Anjio (or the market's own assistant), udozo.com's panel as a screen: the greeting and suggested questions, the
 * language where the market's assistants speak several, each answer as text with the cards its tools returned (listings
 * that open in the app, the UdozoPay total, the checks, a drafted first message), thumbs, Report this answer and Talk to
 * a person (signed in). Opened from Home and Search, or about a listing or a chat (`listing`, `conversation`), where a
 * drafted message can be used in that listing's chat. Answers stream in as they are written.
 */
export default function AssistantScreen() {
  const theme = useTheme();
  const params = useLocalSearchParams<{ country?: string; listing?: string; title?: string; conversation?: string; question?: string }>();
  const market = useMarket();
  const { customer } = useAccount();
  const country = (params.country ?? market.country ?? '').toUpperCase();
  const [language, setLanguage] = useState<string | null>(null);
  const [thread, setThread] = useState<ShopAssistantThread | null>(null);
  const [entries, setEntries] = useState<Entry[]>([]);
  const [pending, setPending] = useState<{ tool: string | null; cards: ShopAssistantCard[] } | null>(null);
  const [question, setQuestion] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [person, setPerson] = useState<string | null>(null);
  const asked = useRef(false);

  useEffect(() => {
    savedLanguage().then(saved => saved && setLanguage(current => current ?? saved), () => undefined);
  }, []);
  const profile = useQuery({ queryKey: ['assistant', 'browse', country, language, Boolean(customer)], enabled: Boolean(country), queryFn: () => assistantProfile(country, language) });
  const assistant = profile.data?.assistant ?? null;

  const ask = async (text: string) => {
    const words = text.trim();
    if (!words || pending || !assistant) return;
    setError(null);
    setQuestion('');
    setEntries(items => [...items, { kind: 'user', key: `u${items.length}`, body: words }]);
    setPending({ tool: null, cards: [] });
    try {
      let current = thread;
      if (!current) {
        current = await startThread({ country, language: assistant.language, surface: 'browse', listing_id: params.listing, conversation_id: params.conversation });
        setThread(current);
      }
      await askAssistant(current.id, words, event => {
        if (event.event === 'status') setPending(state => ({ tool: event.data.tool, cards: state?.cards ?? [] }));
        else if (event.event === 'cards') setPending(state => ({ tool: state?.tool ?? null, cards: [...(state?.cards ?? []), ...event.data.cards] }));
        else if (event.event === 'message') setEntries(items => [...items, { kind: 'answer', key: event.data.id, message: event.data }]);
        else if (event.event === 'error') setError(event.data.message);
      });
    } catch (caught) {
      setError(caught instanceof ApiError && caught.code !== 'network_error' ? caught.message : unavailable(assistant.name));
    }
    setPending(null);
  };

  // A question carried in from the search box is asked at once.
  useEffect(() => {
    if (!assistant || asked.current || !params.question) return;
    asked.current = true;
    void ask(params.question);
    // Only once the assistant is known.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [assistant]);

  const handOver = useMutation({
    mutationFn: () => talkToPerson(thread!.id),
    onSuccess: () => setPerson('A person at Udozo will answer in your messages, with this conversation.'),
    onError: caught => setPerson(caught instanceof ApiError ? caught.message : 'It could not be passed on. Try again.'),
  });
  const onPerson = () => (customer ? (thread ? handOver.mutate() : undefined) : router.push('/signin'));
  const opener = params.conversation ? 'chat' : params.listing ? 'listing' : null;
  const sendDraft = (listingId: string, text: string) => {
    if (!opener || listingId !== params.listing) return;
    putDraft(opener, listingId, text);
    router.back();
  };

  if (!country || profile.isPending) return <Loading />;
  if (!assistant) {
    return (
      <>
        <Stack.Screen options={{ title: 'Ask Anjio' }} />
        <Empty title="The assistant isn’t answering here" body="Search still works." action={<Button title="Search Udozo" onPress={() => router.replace('/search')} />} />
      </>
    );
  }
  const list = [...entries].reverse();
  return (
    <>
      <Stack.Screen options={{ title: assistant.name }} />
      <KeyboardAvoidingView style={{ flex: 1, backgroundColor: theme.background }} behavior={Platform.OS === 'ios' ? 'padding' : undefined} keyboardVerticalOffset={90}>
        <FlatList
          inverted
          data={list}
          keyExtractor={entry => entry.key}
          contentContainerStyle={styles.list}
          keyboardShouldPersistTaps="handled"
          ListHeaderComponent={
            <View style={{ gap: Spacing.two }}>
              {pending ? (
                <View style={{ gap: Spacing.two }} accessibilityLiveRegion="polite">
                  <ThemedText type="small" themeColor="textSecondary">
                    {pending.tool ? `${assistantToolLabels[pending.tool] ?? 'Working'}…` : `${assistant.name} is thinking…`}
                  </ThemedText>
                  {pending.cards.map((card, index) => (
                    <CardView key={index} card={card} signedIn={Boolean(customer)} draftable={Boolean(opener)} openerListing={params.listing ?? null} onDraft={sendDraft} onPerson={onPerson} />
                  ))}
                </View>
              ) : null}
              {error ? (
                <View style={[styles.notice, { backgroundColor: theme.backgroundElement }]} accessibilityRole="alert">
                  <ThemedText type="small">{error}</ThemedText>
                  <Button title="Search instead" tone="ghost" onPress={() => router.push('/search')} />
                </View>
              ) : null}
              {person ? (
                <ThemedText type="small" accessibilityLiveRegion="polite" style={[styles.notice, { backgroundColor: theme.backgroundElement }]}>
                  {person}
                </ThemedText>
              ) : null}
            </View>
          }
          ListFooterComponent={
            <View style={{ gap: Spacing.two }}>
              <View style={styles.inline}>
                <Avatar name={assistant.name} url={assistant.avatar_url} size={36} />
                <View style={{ flex: 1 }}>
                  <ThemedText type="smallBold">{assistant.name}</ThemedText>
                  <ThemedText type="caption">{assistant.label}</ThemedText>
                </View>
              </View>
              {profile.data!.languages.length > 1 ? (
                <View style={styles.wrap} accessibilityLabel="Language">
                  {profile.data!.languages.map(item => (
                    <Chip
                      key={item.code}
                      label={item.name}
                      selected={item.code === assistant.language}
                      onPress={() => {
                        void saveLanguage(item.code);
                        setLanguage(item.code);
                        setThread(null);
                        setEntries([]);
                      }}
                    />
                  ))}
                </View>
              ) : null}
              {assistant.greeting ? <ThemedText style={[styles.bubble, { backgroundColor: theme.backgroundElement }]}>{assistant.greeting}</ThemedText> : null}
              {params.title ? <ThemedText type="caption">{`Asking about ${params.title}.`}</ThemedText> : null}
              {!entries.length && assistant.suggestions.length ? (
                <View style={styles.wrap}>
                  {assistant.suggestions.map(item => (
                    <Chip key={item} label={item} onPress={() => void ask(item)} />
                  ))}
                </View>
              ) : null}
            </View>
          }
          renderItem={({ item }) =>
            item.kind === 'user' ? (
              <ThemedText style={[styles.mine, { backgroundColor: theme.primary, color: theme.onPrimary }]}>{item.body}</ThemedText>
            ) : (
              <Answer message={item.message} signedIn={Boolean(customer)} draftable={Boolean(opener)} openerListing={params.listing ?? null} onDraft={sendDraft} onPerson={onPerson} />
            )
          }
        />
        <SafeAreaView edges={['bottom']} style={[styles.composer, { borderColor: theme.line }]}>
          <View style={styles.inline}>
            <TextInput
              value={question}
              onChangeText={setQuestion}
              placeholder="Describe what you want"
              placeholderTextColor={theme.textSecondary}
              accessibilityLabel={`Ask ${assistant.name}`}
              multiline
              maxLength={1000}
              style={[styles.input, { color: theme.text, borderColor: theme.line }]}
            />
            <Pressable accessibilityRole="button" accessibilityLabel="Send" disabled={!question.trim() || Boolean(pending)} onPress={() => void ask(question)} style={styles.send}>
              <Send size={22} color={question.trim() && !pending ? theme.primary : theme.textSecondary} />
            </Pressable>
          </View>
          <ThemedText type="caption" style={{ textAlign: 'center' }}>
            {`${assistant.name} is Udozo’s AI and can make mistakes. Never share codes or bank details.`}
          </ThemedText>
          {thread && customer ? <Button title="Talk to a person" tone="ghost" loading={handOver.isPending} onPress={() => handOver.mutate()} /> : null}
        </SafeAreaView>
      </KeyboardAvoidingView>
    </>
  );
}

type CardProps = { signedIn: boolean; draftable: boolean; openerListing: string | null; onDraft: (listingId: string, text: string) => void; onPerson: () => void };

/** An answer: its words, its cards, thumbs up and down, and Report this answer. */
function Answer({ message, ...props }: { message: ShopAssistantMessage } & CardProps) {
  const theme = useTheme();
  const [rating, setRating] = useState(message.rating);
  const [reported, setReported] = useState(message.reported);
  const [reporting, setReporting] = useState(false);
  const [reason, setReason] = useState('');
  const rate = useMutation({ mutationFn: (value: 'up' | 'down') => rateAnswer(message.id, value), onSuccess: answer => setRating(answer.rating) });
  const report = useMutation({
    mutationFn: () => reportAnswer(message.id, reason),
    onSuccess: () => {
      setReported(true);
      setReporting(false);
    },
  });
  return (
    <View style={{ gap: Spacing.two }}>
      {message.body ? (
        <View style={[styles.bubble, { backgroundColor: theme.backgroundElement }]}>
          <AnswerText html={message.body} />
        </View>
      ) : null}
      {message.cards.map((card, index) => (
        <CardView key={index} card={card} {...props} />
      ))}
      <View style={styles.inline}>
        <Pressable accessibilityRole="button" accessibilityLabel="Helpful" accessibilityState={{ selected: rating === 1 }} hitSlop={8} onPress={() => rate.mutate('up')} style={styles.thumb}>
          <ThumbsUp size={18} color={rating === 1 ? theme.success : theme.textSecondary} />
        </Pressable>
        <Pressable accessibilityRole="button" accessibilityLabel="Not helpful" accessibilityState={{ selected: rating === -1 }} hitSlop={8} onPress={() => rate.mutate('down')} style={styles.thumb}>
          <ThumbsDown size={18} color={rating === -1 ? theme.danger : theme.textSecondary} />
        </Pressable>
        {reported ? (
          <ThemedText type="caption">Reported. Thank you.</ThemedText>
        ) : (
          <Button title="Report this answer" tone="ghost" icon={<Flag size={14} color={theme.link} />} onPress={() => setReporting(open => !open)} />
        )}
      </View>
      {reporting && !reported ? (
        <View style={{ gap: Spacing.two }}>
          <Field label="What was wrong?" value={reason} onChangeText={setReason} maxLength={500} />
          <Button title="Send report" tone="secondary" disabled={reason.trim().length < 3} loading={report.isPending} onPress={() => report.mutate()} />
        </View>
      ) : null}
    </View>
  );
}

/** What the assistant shows beside its words, drawn from its tools' results as udozo.com draws them. */
function CardView({ card, signedIn, draftable, openerListing, onDraft, onPerson }: { card: ShopAssistantCard } & CardProps) {
  const theme = useTheme();
  switch (card.type) {
    case 'listings':
    case 'compare':
      return (
        <View style={{ gap: Spacing.two }}>
          {card.items.map(item => (
            <ListingRow key={item.id} item={item} />
          ))}
        </View>
      );
    case 'safe_pay':
      return (
        <Card>
          <ThemedText type="smallBold">UdozoPay</ThemedText>
          <Line label="Price" value={shopMoney(card.price, card.currency)} />
          <Line label="UdozoPay fee" value={shopMoney(card.fee, card.currency)} />
          <Line label="You pay" value={shopMoney(card.total, card.currency)} bold />
          <ThemedText type="caption">Held by Udozo until you have the item.</ThemedText>
        </Card>
      );
    case 'price_range':
      return (
        <Card>
          <ThemedText type="smallBold">{`${card.category}: usually ${shopMoney(card.low, card.currency)} to ${shopMoney(card.high, card.currency)}`}</ThemedText>
          <ThemedText type="caption">{`From ${card.count} similar listings in the last 90 days. A range, not a valuation.`}</ThemedText>
        </Card>
      );
    case 'checklist':
      return (
        <Card>
          <ThemedText type="smallBold">{card.category ? `Checks for ${card.category}` : 'Safe trade checks'}</ThemedText>
          {card.items.map(item => (
            <View key={item} style={[styles.inline, { alignItems: 'flex-start' }]}>
              <Check size={16} color={theme.success} />
              <ThemedText type="small" style={{ flex: 1 }}>{item}</ThemedText>
            </View>
          ))}
          <Button title="The Safe Trade Guide" tone="ghost" onPress={() => openLink('/safe-trade')} />
        </Card>
      );
    case 'message_draft':
      return <DraftCard card={card} usable={draftable && card.listing_id === openerListing} onDraft={onDraft} />;
    case 'person':
      return (
        <Card>
          <ThemedText type="small">Talk to a person at Udozo about this.</ThemedText>
          <Button title={signedIn ? 'Talk to a person' : 'Sign in to talk to a person'} tone="secondary" onPress={onPerson} />
        </Card>
      );
    case 'orders':
      return (
        <Card>
          {card.items.map(item => (
            <Pressable key={item.order_id} accessibilityRole="link" onPress={() => router.push({ pathname: '/order/[id]', params: { id: item.order_id } })}>
              <ThemedText type="small">{`${item.number} ${item.listing ?? ''} · ${item.price}`}</ThemedText>
              {item.next ? <ThemedText type="caption">{item.next}</ThemedText> : null}
            </Pressable>
          ))}
        </Card>
      );
    case 'my_listings':
      return (
        <Card>
          {card.items.map(item => (
            <Line key={item.listing_id} label={item.title} value={`${item.status} · ${item.views} views`} />
          ))}
        </Card>
      );
    default:
      return null;
  }
}

function ListingRow({ item }: { item: ShopListingCard }) {
  const theme = useTheme();
  return (
    <Pressable
      accessibilityRole="link"
      accessibilityLabel={`${item.title}, ${shopPriceText(item.price)}, ${item.area.name}`}
      onPress={() => router.push({ pathname: '/listing/[ref]', params: { ref: String(item.ref), country: item.country } })}
      style={[styles.row, { borderColor: theme.line }]}>
      <View style={[styles.cover, { backgroundColor: theme.backgroundElement }]}>
        {item.cover ? <Image source={{ uri: photoUrl(item.cover.url, 480)! }} style={StyleSheet.absoluteFill} contentFit="cover" accessibilityIgnoresInvertColors /> : null}
      </View>
      <View style={{ flex: 1 }}>
        <ThemedText type="smallBold">{shopPriceText(item.price)}</ThemedText>
        <ThemedText type="small" numberOfLines={1}>{item.title}</ThemedText>
        <ThemedText type="caption" numberOfLines={1}>{[item.area.name, ...item.highlights].join(' · ')}</ThemedText>
      </View>
    </Pressable>
  );
}

/** A first message to the seller: the buyer edits and sends it themselves, in the chat they came from, or copies it. */
function DraftCard({ card, usable, onDraft }: { card: Extract<ShopAssistantCard, { type: 'message_draft' }>; usable: boolean; onDraft: (listingId: string, text: string) => void }) {
  const [copied, setCopied] = useState(false);
  const toast = useToast();
  return (
    <Card>
      <ThemedText type="caption">{`A first message to the seller of ${card.title}. Edit it and send it yourself.`}</ThemedText>
      <ThemedText>{card.text}</ThemedText>
      <View style={styles.inline}>
        {usable ? <Button title="Use in the chat" onPress={() => onDraft(card.listing_id, card.text)} style={{ flex: 1 }} /> : null}
        <Button
          title={copied ? 'Copied' : 'Copy'}
          tone="secondary"
          onPress={() =>
            void Clipboard.setStringAsync(card.text).then(() => {
              setCopied(true);
              toast({ message: 'Message copied', tone: 'success' });
            })
          }
          style={{ flex: 1 }}
        />
      </View>
    </Card>
  );
}

function Line({ label, value, bold }: { label: string; value: string; bold?: boolean }) {
  return (
    <View style={styles.inline}>
      <ThemedText type={bold ? 'smallBold' : 'small'} themeColor={bold ? undefined : 'textSecondary'} style={{ flex: 1 }} numberOfLines={1}>
        {label}
      </ThemedText>
      <ThemedText type="smallBold">{value}</ThemedText>
    </View>
  );
}

const styles = StyleSheet.create({
  list: { padding: Spacing.three, gap: Spacing.three, width: '100%', maxWidth: MaxContentWidth, alignSelf: 'center' },
  inline: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two },
  bubble: { borderRadius: Radius.medium, padding: Spacing.three, overflow: 'hidden', alignSelf: 'flex-start', maxWidth: '92%' },
  mine: { borderRadius: Radius.medium, paddingHorizontal: Spacing.three, paddingVertical: Spacing.two, overflow: 'hidden', alignSelf: 'flex-end', maxWidth: '85%' },
  notice: { borderRadius: Radius.medium, padding: Spacing.three, overflow: 'hidden', gap: Spacing.one },
  row: { flexDirection: 'row', gap: Spacing.three, borderWidth: 1, borderRadius: Radius.medium, padding: Spacing.two, alignItems: 'center' },
  cover: { width: 64, height: 64, borderRadius: Radius.small, overflow: 'hidden' },
  thumb: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
  composer: { borderTopWidth: StyleSheet.hairlineWidth, paddingHorizontal: Spacing.three, paddingTop: Spacing.two, gap: Spacing.one },
  input: { flex: 1, maxHeight: 120, minHeight: 44, borderWidth: 1, borderRadius: Radius.medium, paddingHorizontal: Spacing.three, paddingTop: 10, fontSize: 16 },
  send: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
});

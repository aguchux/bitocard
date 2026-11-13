import { shopPriceText } from '@shared/classifieds';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { router, useLocalSearchParams } from 'expo-router';
import { LayoutList } from 'lucide-react-native';
import { RefreshControl, ScrollView, StyleSheet, View } from 'react-native';

import { useDialog, useToast } from '@/components/feedback';
import { ListingCard } from '@/components/listing-card';
import { MenuRow } from '@/components/menu-row';
import { ThemedText } from '@/components/themed-text';
import { Button, Card, Failed, FormError, Loading } from '@/components/ui';
import { MaxContentWidth, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { api } from '@/lib/api';
import { wantedWhen, type WantedForSeller, type WantedMine, type WantedRequest, type WantedView } from '@/lib/wanted';

/**
 * A wanted request (udozo.com's /account/wanted/<id>). Its buyer sees what they asked, the sellers' answers (each a
 * listing, with the chat it opened) and listings that may fit, then I found it or Close request while it is open. A
 * seller it was sent to sees the request and answers with one of their listings, which opens the chat with the buyer.
 */
export default function WantedRequestScreen() {
  const theme = useTheme();
  const queries = useQueryClient();
  const dialog = useDialog();
  const toast = useToast();
  const { id } = useLocalSearchParams<{ id: string }>();
  const request = useQuery({ queryKey: ['wanted', 'one', id], queryFn: () => api<WantedView>(`/v1/classifieds/wanted/${id}`) });
  const close = useMutation({
    mutationFn: (fulfilled: boolean) => api<WantedRequest>(`/v1/classifieds/wanted/${id}/close`, { body: { fulfilled } }),
    onSuccess: (_, fulfilled) => {
      void request.refetch();
      queries.invalidateQueries({ queryKey: ['wanted'] });
      toast({ message: fulfilled ? 'Glad you found it. Your request is closed.' : 'Request closed', tone: 'success' });
    },
  });
  const respond = useMutation({
    mutationFn: (listingId: string) => api<{ conversation_id: string }>(`/v1/classifieds/wanted/${id}/respond`, { body: { listing_id: listingId } }),
    onSuccess: answer => {
      queries.invalidateQueries({ queryKey: ['wanted'] });
      router.push({ pathname: '/chat/[id]', params: { id: answer.conversation_id } });
    },
  });

  if (request.isPending) return <Loading />;
  if (request.isError) return <Failed error={request.error} retry={() => void request.refetch()} />;
  const data = request.data;
  const facts = [data.category.name, data.place ?? 'Anywhere', data.budget.text ? `Up to ${data.budget.text}` : null, data.condition_text].filter(Boolean).join(' · ');

  const ask = async (fulfilled: boolean) => {
    const answer = await dialog({
      title: fulfilled ? 'Did you find it?' : 'Close this request?',
      body: fulfilled ? 'Your request closes and sellers stop being told about it.' : 'Sellers stop being told about it. You can post another any time.',
      actions: [{ key: 'close', label: fulfilled ? 'I found it' : 'Close request', tone: fulfilled ? 'primary' : 'danger' }],
    });
    if (answer === 'close') close.mutate(fulfilled);
  };

  return (
    <ScrollView
      style={{ backgroundColor: theme.background }}
      contentContainerStyle={styles.page}
      refreshControl={<RefreshControl refreshing={request.isRefetching} onRefresh={() => void request.refetch()} tintColor={theme.primary} />}>
      <View style={{ gap: Spacing.one }}>
        <ThemedText type="caption">{`${data.number} · ${wantedWhen(data)}`}</ThemedText>
        <ThemedText type="subtitle" accessibilityRole="header">
          {data.words}
        </ThemedText>
        <ThemedText themeColor="textSecondary">{facts}</ThemedText>
        {data.details ? <ThemedText>{data.details}</ThemedText> : null}
        {!data.mine ? <ThemedText type="small" themeColor="textSecondary">{`Asked by ${data.buyer}`}</ThemedText> : null}
      </View>
      {data.mine ? <BuyerView data={data} /> : <SellerView data={data} answering={respond.isPending ? respond.variables : null} onAnswer={listingId => respond.mutate(listingId)} />}
      {respond.error ? <FormError error={respond.error} /> : null}
      {data.mine && data.status === 'open' ? (
        <View style={{ gap: Spacing.two }}>
          {close.error ? <FormError error={close.error} /> : null}
          <Button tone="money" title="I found it" loading={close.isPending && close.variables === true} onPress={() => void ask(true)} />
          <Button tone="secondary" title="Close request" loading={close.isPending && close.variables === false} onPress={() => void ask(false)} />
        </View>
      ) : null}
    </ScrollView>
  );
}

function BuyerView({ data }: { data: WantedMine }) {
  const theme = useTheme();
  return (
    <>
      <View style={{ gap: Spacing.two }}>
        <ThemedText type="heading" accessibilityRole="header">
          Answers from sellers
        </ThemedText>
        {data.responses.length ? (
          data.responses.map(answer => (
            <Card key={answer.id} style={{ gap: Spacing.two }}>
              <ThemedText type="smallBold">{answer.seller}</ThemedText>
              {answer.note ? <ThemedText>{answer.note}</ThemedText> : null}
              {answer.listing ? <ListingCard listing={answer.listing} width={180} /> : null}
              {answer.conversation_id ? <Button tone="secondary" title="Open the chat" onPress={() => router.push({ pathname: '/chat/[id]', params: { id: answer.conversation_id! } })} /> : null}
            </Card>
          ))
        ) : (
          <ThemedText themeColor="textSecondary">{data.status === 'open' ? `No answers yet. ${data.sellers_told ? `${data.sellers_told} seller${data.sellers_told === 1 ? '' : 's'} told so far.` : 'Sellers are told as they post.'}` : 'No sellers answered.'}</ThemedText>
        )}
      </View>
      {data.matches.length ? (
        <View style={{ gap: Spacing.two }}>
          <ThemedText type="heading" accessibilityRole="header">
            Already on Udozo, and may fit
          </ThemedText>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: Spacing.two }} style={{ marginHorizontal: -Spacing.one }}>
            {data.matches.map(card => (
              <ListingCard key={card.id} listing={card} width={160} />
            ))}
          </ScrollView>
        </View>
      ) : null}
      <View style={{ height: 1, backgroundColor: theme.line }} />
    </>
  );
}

function SellerView({ data, answering, onAnswer }: { data: WantedForSeller; answering: string | null | undefined; onAnswer: (listingId: string) => void }) {
  const theme = useTheme();
  if (data.answered) return <ThemedText themeColor="textSecondary">You answered this request. The buyer sees your listing in their chats.</ThemedText>;
  if (data.status !== 'open') return <ThemedText themeColor="textSecondary">This request has ended.</ThemedText>;
  return (
    <View style={{ gap: Spacing.two }}>
      <ThemedText type="heading" accessibilityRole="header">
        Answer with one of your listings
      </ThemedText>
      {data.your_listings.length ? (
        data.your_listings.map(listing => (
          <MenuRow
            key={listing.id}
            icon={<LayoutList size={20} color={theme.primary} />}
            title={listing.title ?? `Listing ${listing.ref}`}
            detail={answering === listing.id ? 'Sending…' : `${shopPriceText(listing.price)} · Tap to answer`}
            onPress={() => onAnswer(listing.id)}
          />
        ))
      ) : (
        <ThemedText themeColor="textSecondary">You have no live listing in this category to answer with.</ThemedText>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  page: { padding: Spacing.three, gap: Spacing.four, width: '100%', maxWidth: MaxContentWidth, alignSelf: 'center' },
});

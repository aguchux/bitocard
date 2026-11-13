import {
  badgeLabels,
  conditionLabels,
  descriptionBlocks,
  featureValueText,
  postedAgo,
  shopPriceText,
  type ShopListingPage,
  type ShopReportReason,
  type ShopViewer,
} from '@shared/classifieds';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Image } from 'expo-image';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { BadgeCheck, Flag, Heart, MapPin, MessageCircle, Share2, ShieldCheck } from 'lucide-react-native';
import { useState } from 'react';
import { FlatList, Pressable, ScrollView, Share, StyleSheet, useWindowDimensions, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { AuctionPanel } from '@/components/auction-panel';
import { inter, ThemedText } from '@/components/themed-text';
import { Avatar, Button, Card, Chip, Failed, Field, FormError, Loading, Sheet } from '@/components/ui';
import { MaxContentWidth, Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useAccount } from '@/lib/account';
import { api } from '@/lib/api';
import { listingUrl } from '@/lib/links';
import { buyAction } from '@/lib/money';
import { photoUrl } from '@/lib/navigate';
import { useMarket } from '@/lib/market';
import { reportReasons } from '@/lib/words';

/**
 * A listing: its photos, price, title, place and condition, what the seller wrote, its features, the seller, the checks
 * to make before paying, then Save, Chat with seller and Buy with UdozoPay (or carry on the buyer's order) in a bar that
 * stays. Signed out, each asks to sign in first. Calls join this bar in phase 4.
 */
export default function ListingScreen() {
  const theme = useTheme();
  const { ref, country: given } = useLocalSearchParams<{ ref: string; country?: string }>();
  const market = useMarket();
  const country = (given ?? market.country ?? '').toUpperCase();
  const { customer } = useAccount();
  const listing = useQuery({ queryKey: ['listing', country, ref], enabled: Boolean(country && ref), queryFn: () => api<ShopListingPage>(`/v1/classifieds/listings/${ref}?country=${country}`) });
  const id = listing.data?.id;
  const viewer = useQuery({ queryKey: ['viewer', id], enabled: Boolean(id && customer), queryFn: () => api<ShopViewer>(`/v1/classifieds/listings/${id}/viewer`) });

  if (listing.isPending) return <Loading />;
  if (listing.isError) return <Failed error={listing.error} retry={() => void listing.refetch()} />;
  const data = listing.data;
  return (
    <>
      <Stack.Screen
        options={{
          title: '',
          headerRight: () => (
            <Pressable accessibilityRole="button" accessibilityLabel="Share" hitSlop={10} onPress={() => Share.share({ message: `${data.title} ${listingUrl(country, data.ref, data.slug)}` })}>
              <Share2 size={22} color={theme.primary} />
            </Pressable>
          ),
        }}
      />
      <View style={{ flex: 1, backgroundColor: theme.background }}>
        <ScrollView contentContainerStyle={{ paddingBottom: 120 }}>
          <Gallery photos={data.photos} title={data.title} />
          <View style={styles.column}>
            <Summary data={data} />
            {data.sale_method === 'auction' && (viewer.data?.auction ?? data.auction) ? (
              <AuctionPanel listingId={data.id} auction={(viewer.data?.auction ?? data.auction)!} currency={data.price.currency} />
            ) : null}
            {data.features.length ? (
              <Card>
                <ThemedText type="heading">Details</ThemedText>
                {data.features.map(feature => (
                  <View key={feature.key} style={styles.feature}>
                    <ThemedText type="small" themeColor="textSecondary" style={{ flex: 1 }}>
                      {feature.name}
                    </ThemedText>
                    <ThemedText type="smallBold" style={{ flex: 1, textAlign: 'right' }}>
                      {featureValueText(feature)}
                    </ThemedText>
                  </View>
                ))}
                {data.brand ? (
                  <Button tone="ghost" title={`More from ${data.brand.name}`} onPress={() => router.push({ pathname: '/brand/[slug]', params: { slug: data.brand!.slug, country } })} />
                ) : null}
              </Card>
            ) : null}
            {data.description ? (
              <Card>
                <ThemedText type="heading">Description</ThemedText>
                <Description text={data.description} />
              </Card>
            ) : null}
            <SellerCard data={data} />
            {data.category.safety_checklist.length ? (
              <Card style={{ backgroundColor: theme.backgroundElement }}>
                <View style={styles.inline}>
                  <ShieldCheck size={18} color={theme.success} />
                  <ThemedText type="heading">Before you pay</ThemedText>
                </View>
                {data.category.safety_checklist.map(item => (
                  <ThemedText key={item} type="small">{`• ${item}`}</ThemedText>
                ))}
                <ThemedText type="small" themeColor="textSecondary">
                  Meet in a public place, check the item, and never pay before you have seen it. Keep chats and payments on Udozo.
                </ThemedText>
              </Card>
            ) : null}
            {customer && !viewer.data?.own ? <ReportListing listingId={data.id} /> : null}
          </View>
        </ScrollView>
        <ActionBar data={data} viewer={viewer.data ?? null} country={country} />
      </View>
    </>
  );
}

function Gallery({ photos, title }: { photos: ShopListingPage['photos']; title: string }) {
  const theme = useTheme();
  const { width } = useWindowDimensions();
  const [index, setIndex] = useState(0);
  const size = Math.min(width, MaxContentWidth);
  if (!photos.length) return <View style={{ width: size, height: size * 0.75, backgroundColor: theme.backgroundElement, alignSelf: 'center' }} />;
  return (
    <View style={{ alignSelf: 'center' }}>
      <FlatList
        horizontal
        pagingEnabled
        data={photos}
        keyExtractor={(photo, position) => `${photo.url}-${position}`}
        showsHorizontalScrollIndicator={false}
        onMomentumScrollEnd={event => setIndex(Math.round(event.nativeEvent.contentOffset.x / size))}
        style={{ width: size }}
        renderItem={({ item, index: position }) => (
          <Image
            source={{ uri: photoUrl(item.url, 960)! }}
            style={{ width: size, height: size, backgroundColor: theme.backgroundElement }}
            contentFit="contain"
            accessibilityLabel={`${title}, photo ${position + 1} of ${photos.length}`}
          />
        )}
      />
      <View style={styles.counter} accessibilityElementsHidden>
        <ThemedText type="caption" style={{ color: '#fff' }}>{`${index + 1} / ${photos.length}`}</ThemedText>
      </View>
    </View>
  );
}

function Summary({ data }: { data: ShopListingPage }) {
  const theme = useTheme();
  const sold = data.status === 'sold';
  const out = data.in_stock === false;
  return (
    <View style={{ gap: Spacing.one }}>
      <ThemedText style={{ fontFamily: inter.extrabold, fontSize: 24 }}>{shopPriceText(data.price)}</ThemedText>
      {data.price.kind === 'negotiable' ? <ThemedText type="small" themeColor="textSecondary">Negotiable</ThemedText> : null}
      <ThemedText type="heading" accessibilityRole="header">
        {data.title}
      </ThemedText>
      <View style={styles.inline}>
        <MapPin size={14} color={theme.textSecondary} />
        <ThemedText type="small" themeColor="textSecondary">
          {[`${data.area.name}, ${data.area.state.name}`, data.condition ? conditionLabels[data.condition] : null, postedAgo(data.published_at)].filter(Boolean).join(' · ')}
        </ThemedText>
      </View>
      {sold || out ? (
        <ThemedText type="smallBold" style={{ color: theme.danger }}>
          {sold ? 'Sold' : 'Out of stock'}
        </ThemedText>
      ) : null}
      {data.sku ? <ThemedText type="caption">{`Ad ${data.sku}`}</ThemedText> : null}
    </View>
  );
}

function Description({ text }: { text: string }) {
  return (
    <View style={{ gap: Spacing.two }}>
      {descriptionBlocks(text).map((block, index) =>
        block.kind === 'p' ? (
          <ThemedText key={index}>
            {block.spans.map((span, at) => (
              <ThemedText key={at} style={[span.bold && { fontFamily: inter.bold }, span.italic && { fontStyle: 'italic' }]}>
                {span.text}
              </ThemedText>
            ))}
          </ThemedText>
        ) : (
          <View key={index} style={{ gap: 2 }}>
            {block.items.map((item, at) => (
              <ThemedText key={at}>
                {block.kind === 'ul' ? '• ' : `${at + 1}. `}
                {item.map(span => span.text).join('')}
              </ThemedText>
            ))}
          </View>
        ),
      )}
    </View>
  );
}

function SellerCard({ data }: { data: ShopListingPage }) {
  const theme = useTheme();
  const seller = data.seller;
  const key = seller.username || seller.handle;
  const since = new Date(seller.member_since).toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });
  return (
    <Pressable
      accessibilityRole="link"
      accessibilityLabel={`Seller ${seller.name}. See their page`}
      disabled={!key}
      onPress={() => key && router.push({ pathname: '/seller/[key]', params: { key } })}>
      <Card>
        <View style={styles.inline}>
          <Avatar name={seller.name} url={seller.avatar_url} size={48} />
          <View style={{ flex: 1 }}>
            <ThemedText type="heading">{seller.name}</ThemedText>
            <ThemedText type="caption">{`On Udozo since ${since} · ${seller.active_listings} for sale`}</ThemedText>
          </View>
        </View>
        {seller.badges.length ? (
          <View style={[styles.inline, { flexWrap: 'wrap' }]}>
            {seller.badges.map(badge => (
              <View key={badge} style={styles.inline}>
                <BadgeCheck size={14} color={theme.success} />
                <ThemedText type="caption">{badgeLabels[badge]}</ThemedText>
              </View>
            ))}
          </View>
        ) : null}
        {seller.response_rate !== null ? <ThemedText type="small">{`Replies to ${seller.response_rate}% of chats`}</ThemedText> : null}
        {seller.reviews && seller.reviews.positive_pct !== null ? <ThemedText type="small">{`${seller.reviews.positive_pct}% positive reviews (${seller.reviews.counted})`}</ThemedText> : null}
      </Card>
    </Pressable>
  );
}

/** Save and Chat with seller, always in reach; the seller's own listing says so instead. */
function ActionBar({ data, viewer, country }: { data: ShopListingPage; viewer: ShopViewer | null; country: string }) {
  const theme = useTheme();
  const queries = useQueryClient();
  const { customer } = useAccount();
  const market = useMarket();
  const [asking, setAsking] = useState(false);
  const [body, setBody] = useState(`Hello, is “${data.title}” still available?`);
  const save = useMutation({
    mutationFn: () => (viewer?.favourite ? api(`/v1/classifieds/favourites/${data.id}`, { method: 'DELETE' }) : api('/v1/classifieds/favourites', { body: { listing_id: data.id } })),
    onSuccess: () => {
      queries.invalidateQueries({ queryKey: ['viewer', data.id] });
      queries.invalidateQueries({ queryKey: ['favourites'] });
    },
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
      {canChat || chatOpen ? (
        <Button
          style={{ flex: 1 }}
          title={chatOpen ? 'Open chat' : 'Chat with seller'}
          icon={<MessageCircle size={18} color={theme.onPrimary} />}
          onPress={() => (!customer ? signIn() : chatOpen ? router.push({ pathname: '/chat/[id]', params: { id: chatOpen } }) : setAsking(true))}
        />
      ) : (
        <ThemedText type="small" themeColor="textSecondary" style={{ flex: 1 }}>
          {data.status === 'sold' ? 'This item has been sold.' : 'The seller takes calls only. Calls in the app are coming.'}
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

function ReportListing({ listingId }: { listingId: string }) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState<ShopReportReason | null>(null);
  const [details, setDetails] = useState('');
  const report = useMutation({
    mutationFn: () => api('/v1/classifieds/reports', { body: { listing_id: listingId, reason, details: details.trim() || undefined } }),
  });
  const theme = useTheme();
  return (
    <>
      <Button tone="ghost" title="Report this listing" icon={<Flag size={16} color={theme.link} />} onPress={() => setOpen(true)} />
      <Sheet visible={open} onClose={() => setOpen(false)} title="Report this listing">
        {report.isSuccess ? (
          <>
            <ThemedText>Thank you. Udozo&apos;s team will look at it.</ThemedText>
            <Button title="Done" onPress={() => setOpen(false)} />
          </>
        ) : (
          <>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two }}>
              {(Object.keys(reportReasons) as ShopReportReason[]).map(item => (
                <Chip key={item} label={reportReasons[item]} selected={reason === item} onPress={() => setReason(item)} />
              ))}
            </View>
            <Field label="What is wrong (optional)" value={details} onChangeText={setDetails} multiline maxLength={1000} />
            <FormError error={report.error} />
            <Button title="Send report" disabled={!reason} loading={report.isPending} onPress={() => report.mutate()} />
          </>
        )}
      </Sheet>
    </>
  );
}

const styles = StyleSheet.create({
  column: { padding: Spacing.three, gap: Spacing.three, width: '100%', maxWidth: MaxContentWidth, alignSelf: 'center' },
  inline: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  feature: { flexDirection: 'row', gap: Spacing.three, paddingVertical: 4 },
  counter: { position: 'absolute', right: Spacing.three, bottom: Spacing.three, backgroundColor: 'rgba(16,33,46,0.7)', borderRadius: Radius.round, paddingHorizontal: Spacing.two, paddingVertical: 2 },
  bar: { position: 'absolute', left: 0, right: 0, bottom: 0, flexDirection: 'row', alignItems: 'center', gap: Spacing.three, paddingHorizontal: Spacing.three, paddingTop: Spacing.two, paddingBottom: Spacing.two, borderTopWidth: StyleSheet.hairlineWidth },
  save: { width: 48, height: 48, borderRadius: Radius.medium, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
});

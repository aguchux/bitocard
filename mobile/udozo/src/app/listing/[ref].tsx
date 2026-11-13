import type { ShopListingPage, ShopViewer } from '@shared/classifieds';
import { useQuery } from '@tanstack/react-query';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { Flag, Share2, Sparkles } from 'lucide-react-native';
import { useState } from 'react';
import { Pressable, ScrollView, Share, StyleSheet, View } from 'react-native';

import { AuctionPanel } from '@/components/auction-panel';
import { BuyOrderPanel } from '@/components/buy-order-panel';
import { ActionBar } from '@/components/listing/action-bar';
import { ContactRow } from '@/components/listing/contact-row';
import { BeforeYouPay, Delivery, Description, KeyDetails, UdozoPayNote } from '@/components/listing/details';
import { Gallery } from '@/components/listing/gallery';
import { ListingRails } from '@/components/listing/rails';
import { ReportListing } from '@/components/listing/report';
import { ProductReviews, SellerCard } from '@/components/listing/seller';
import { ListingSummary } from '@/components/listing/summary';
import { Button, Failed, Loading } from '@/components/ui';
import { MaxContentWidth, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useAccount } from '@/lib/account';
import { api } from '@/lib/api';
import { useShopAssistant } from '@/lib/assistant';
import { listingUrl } from '@/lib/links';
import { useMarket } from '@/lib/market';

/**
 * A listing in full, as udozo.com's listing page: above the fold the photos (never more than 60% of the screen), the
 * price, title, stock line, chips to the condition, place, category and brand, and the ways to contact the seller; then
 * the auction or buy order, its key details, description, delivery, UdozoPay's promise, the seller, reviews of the item,
 * the checks before paying, more from the seller and similar listings, and Report. Buy, Save, Call and Chat stay in a
 * bar at the bottom. Everything draws from the listing alone: the buyer's own state (`viewer`) fills in once it comes,
 * and signed out, each action asks to sign in first.
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
  const [asking, setAsking] = useState(false);

  if (listing.isPending) return <Loading />;
  if (listing.isError) return <Failed error={listing.error} retry={() => void listing.refetch()} />;
  const data = listing.data;
  const seen = viewer.data ?? null;
  const own = Boolean(seen?.own);
  const marketInfo = market.markets.find(item => item.country === country);
  const safePay = Boolean(marketInfo?.safe_pay);
  const auction = seen?.auction ?? data.auction;
  const chat = () => (seen?.conversation_id ? router.push({ pathname: '/chat/[id]', params: { id: seen.conversation_id } }) : setAsking(true));
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
        <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingBottom: 120 }}>
          <Gallery photos={data.photos} video={data.video} title={data.title} />
          <View style={styles.column}>
            <ListingSummary data={data} country={country} />
            <ContactRow data={data} viewer={seen} onChat={chat} />
            {data.sale_method === 'auction' && auction ? <AuctionPanel listingId={data.id} auction={auction} currency={data.price.currency} /> : null}
            {data.sale_method !== 'auction' ? <BuyOrderPanel data={data} viewer={seen} offered={customer ? Boolean(seen?.buy_orders) : Boolean(marketInfo?.buy_orders)} /> : null}
            <AskAbout data={data} country={country} />
            <KeyDetails data={data} />
            {data.description ? <Description text={data.description} /> : null}
            <Delivery data={data} quoteFor={Boolean(customer) && safePay && !own && data.status === 'active'} />
            {safePay ? <UdozoPayNote /> : null}
            <SellerCard data={data} online={Boolean(seen?.seller_online)} />
            {data.product_reviews?.length ? <ProductReviews reviews={data.product_reviews} /> : null}
            {data.category.safety_checklist.length ? <BeforeYouPay checks={data.category.safety_checklist} /> : null}
            <ListingRails data={data} country={country} />
            {own ? null : customer ? <ReportListing listingId={data.id} /> : <Button tone="ghost" title="Report this listing" icon={<Flag size={16} color={theme.link} />} onPress={() => router.push('/signin')} />}
          </View>
        </ScrollView>
        <ActionBar data={data} viewer={seen} country={country} asking={asking} setAsking={setAsking} />
      </View>
    </>
  );
}

/** Ask Anjio about this listing, where the market's assistant answers. */
function AskAbout({ data, country }: { data: ShopListingPage; country: string }) {
  const theme = useTheme();
  const assistant = useShopAssistant(country);
  if (!assistant?.assistant || data.status !== 'active') return null;
  return (
    <Button
      tone="secondary"
      title={`Ask ${assistant.assistant.name} about this listing`}
      icon={<Sparkles size={18} color={theme.primary} />}
      onPress={() => router.push({ pathname: '/assistant', params: { country, listing: data.id, title: data.title } })}
    />
  );
}

const styles = StyleSheet.create({
  column: { padding: Spacing.three, gap: Spacing.three, width: '100%', maxWidth: MaxContentWidth, alignSelf: 'center' },
});

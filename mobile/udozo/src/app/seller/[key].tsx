import { badgeLabels, type ShopPublicScores, type ShopSellerProfile } from '@shared/classifieds';
import { useQuery } from '@tanstack/react-query';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { ArrowLeft, BadgeCheck, MessageCircle, Pencil, PhoneCall } from 'lucide-react-native';
import { useMemo } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ListingResults, useListings } from '@/components/listing-results';
import { BannerChip, bannerStyles, BannerTitle, FloatingBar, PageBanner, RoundButton, useLightStatusBar } from '@/components/page-banner';
import { useSellerContact } from '@/components/seller-contact';
import { ThemedText } from '@/components/themed-text';
import { Avatar, Failed, Loading } from '@/components/ui';
import { Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { api } from '@/lib/api';
import { openLink } from '@/lib/navigate';

/**
 * A seller's page: a full-bleed banner from the top of the screen (their cover with a dark fade, else a gradient in the
 * theme's colours) with their photo, name (once on the page), username, since when and badges at its foot; then their
 * figures, reviews and Anjio's view, then their listings. Back, Chat and Call float over it in dark circles, so they stay
 * in reach as the page scrolls. An old username still held answers with where the page is now; their listings are
 * searched by the current one.
 */
export default function SellerScreen() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const { key } = useLocalSearchParams<{ key: string }>();
  const seller = useQuery({ queryKey: ['seller', key], enabled: Boolean(key), queryFn: () => api<ShopSellerProfile>(`/v1/classifieds/sellers/${encodeURIComponent(key)}`) });
  const data = seller.data;
  const params = useMemo(() => (data ? { country: data.country, seller: data.username || data.handle } : null), [data]);
  // The same query the grid below reads, so the listing chooser has their photos and prices without asking again.
  const listings = useListings(params);
  const cards = useMemo(() => listings.data?.pages.flatMap(page => page.data) ?? [], [listings.data]);
  const contact = useSellerContact(data, cards);

  useLightStatusBar();

  return (
    <View style={{ flex: 1, backgroundColor: theme.background }}>
      <Stack.Screen options={{ headerShown: false }} />
      <ListingResults
        params={params}
        header={
          seller.isError ? (
            <View style={{ paddingTop: insets.top + 56 }}>
              <Failed error={seller.error} retry={() => void seller.refetch()} />
            </View>
          ) : data ? (
            <View style={{ gap: Spacing.three, paddingBottom: Spacing.three }}>
              <Banner data={data} top={insets.top} />
              <View style={[styles.figures, { borderColor: theme.line }]}>
                <Figure value={data.active_listings} label="For sale" />
                <Figure value={data.sold_listings} label="Sold" />
                <Figure value={data.response_rate === null ? '–' : `${data.response_rate}%`} label="Replies" />
              </View>
              {data.reviews && data.reviews.positive_pct !== null ? (
                <ThemedText type="small">{`${data.reviews.positive_pct}% positive from ${data.reviews.counted.toLocaleString('en-GB')} reviews`}</ThemedText>
              ) : null}
              {data.scores ? <AnjioView scores={data.scores} /> : null}
            </View>
          ) : (
            <View style={{ paddingTop: insets.top + 56 }}>
              <Loading />
            </View>
          )
        }
        empty={{ title: 'Nothing for sale right now' }}
      />
      <FloatingBar
        top={insets.top}
        left={
          <RoundButton label="Back" onPress={() => router.back()}>
            <ArrowLeft size={22} color="#ffffff" />
          </RoundButton>
        }
        right={
          <>
            {contact.chat ? (
              <RoundButton label="Chat with seller" onPress={contact.chat}>
                <MessageCircle size={21} color="#ffffff" />
              </RoundButton>
            ) : null}
            {contact.call ? (
              <RoundButton label="Call seller" onPress={contact.call}>
                <PhoneCall size={20} color="#ffffff" />
              </RoundButton>
            ) : null}
            {contact.own ? (
              <Pressable accessibilityRole="button" accessibilityLabel="Edit profile" onPress={() => openLink('/account/profile')} style={bannerStyles.pill}>
                <Pencil size={16} color="#ffffff" />
                <ThemedText type="smallBold" style={{ color: '#ffffff' }}>Edit profile</ThemedText>
              </Pressable>
            ) : null}
          </>
        }
      />
      {contact.ui}
    </View>
  );
}

/** The top of the page, edge to edge under the status bar: the cover or the theme's gradient, the seller at its foot. */
function Banner({ data, top }: { data: ShopSellerProfile; top: number }) {
  const since = new Date(data.member_since).toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });
  return (
    <PageBanner testID="seller-banner" top={top} image={data.banner_url}>
      <View style={bannerStyles.who}>
        <View style={styles.ring}>
          <Avatar name={data.name} url={data.avatar_url} size={72} />
        </View>
        <View style={{ flex: 1, gap: 2 }}>
          <BannerTitle>{data.name}</BannerTitle>
          {data.username ? <ThemedText type="smallBold" style={bannerStyles.light}>@{data.username}</ThemedText> : null}
        </View>
      </View>
      <View style={bannerStyles.chips}>
        <BannerChip>{`On Udozo since ${since}`}</BannerChip>
        {data.badges.map(badge => (
          <BannerChip key={badge} icon={<BadgeCheck size={13} color="#ffffff" />}>
            {badgeLabels[badge]}
          </BannerChip>
        ))}
      </View>
    </PageBanner>
  );
}

/** Anjio's view, in words only (never a number), as udozo.com shows it. */
function AnjioView({ scores }: { scores: ShopPublicScores }) {
  const theme = useTheme();
  const lines = scores.new_seller
    ? ['New seller: not enough to rate yet.']
    : [scores.band_label, scores.response, scores.attention, ...scores.highlights.map(item => item.words)].filter((line): line is string => Boolean(line));
  if (!lines.length && !scores.summary) return null;
  return (
    <View style={[styles.anjio, { backgroundColor: theme.backgroundElement }]}>
      <ThemedText type="smallBold">Anjio&apos;s view</ThemedText>
      {lines.map(line => (
        <ThemedText key={line} type="small">
          {line}
        </ThemedText>
      ))}
      {scores.summary ? <ThemedText type="small" themeColor="textSecondary">{scores.summary.text}</ThemedText> : null}
    </View>
  );
}

function Figure({ value, label }: { value: number | string; label: string }) {
  return (
    <View style={styles.figure} accessible accessibilityLabel={`${label}: ${value}`}>
      <ThemedText type="heading">{typeof value === 'number' ? value.toLocaleString('en-GB') : value}</ThemedText>
      <ThemedText type="caption">{label}</ThemedText>
    </View>
  );
}

const styles = StyleSheet.create({
  ring: { borderWidth: 3, borderColor: '#ffffff', borderRadius: 999 },
  figures: { flexDirection: 'row', borderWidth: 1, borderRadius: Radius.medium, paddingVertical: Spacing.three },
  figure: { flex: 1, alignItems: 'center' },
  anjio: { borderRadius: Radius.medium, padding: Spacing.three, gap: 4 },
});

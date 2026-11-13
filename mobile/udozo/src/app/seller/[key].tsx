import { badgeLabels, type ShopPublicScores, type ShopSellerProfile } from '@shared/classifieds';
import { useQuery } from '@tanstack/react-query';
import { Image } from 'expo-image';
import { router, Stack, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { setStatusBarStyle } from 'expo-status-bar';
import { ArrowLeft, BadgeCheck, MessageCircle, Pencil, PhoneCall } from 'lucide-react-native';
import { useCallback, useMemo, type ReactNode } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Defs, LinearGradient, Rect, Stop } from 'react-native-svg';

import { ListingResults, useListings } from '@/components/listing-results';
import { useSellerContact } from '@/components/seller-contact';
import { ThemedText } from '@/components/themed-text';
import { Avatar, Failed, Loading } from '@/components/ui';
import { Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { api } from '@/lib/api';
import { openLink } from '@/lib/navigate';

/** The banner's height below the status bar: the cover, the seller's photo, name and chips at its foot. */
const bannerHeight = 236;

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

  // White status bar text over the banner while this page shows, the phone's own again on leaving.
  useFocusEffect(
    useCallback(() => {
      setStatusBarStyle('light');
      return () => setStatusBarStyle('auto');
    }, []),
  );

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
      <View pointerEvents="box-none" style={[styles.topBar, { top: insets.top + Spacing.one }]}>
        <Round label="Back" onPress={() => router.back()}>
          <ArrowLeft size={22} color="#ffffff" />
        </Round>
        <View style={styles.actions}>
          {contact.chat ? (
            <Round label="Chat with seller" onPress={contact.chat}>
              <MessageCircle size={21} color="#ffffff" />
            </Round>
          ) : null}
          {contact.call ? (
            <Round label="Call seller" onPress={contact.call}>
              <PhoneCall size={20} color="#ffffff" />
            </Round>
          ) : null}
          {contact.own ? (
            <Pressable accessibilityRole="button" accessibilityLabel="Edit profile" onPress={() => openLink('/account/profile')} style={styles.edit}>
              <Pencil size={16} color="#ffffff" />
              <ThemedText type="smallBold" style={{ color: '#ffffff' }}>Edit profile</ThemedText>
            </Pressable>
          ) : null}
        </View>
      </View>
      {contact.ui}
    </View>
  );
}

/** The top of the page, edge to edge under the status bar: the cover or the theme's gradient, the seller at its foot. */
function Banner({ data, top }: { data: ShopSellerProfile; top: number }) {
  const theme = useTheme();
  const since = new Date(data.member_since).toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });
  return (
    <View style={[styles.banner, { height: top + bannerHeight, backgroundColor: theme.primary }]}>
      {data.banner_url ? (
        <>
          <Image source={{ uri: data.banner_url }} style={StyleSheet.absoluteFill} contentFit="cover" accessibilityIgnoresInvertColors />
          <Fade id="cover" stops={[['rgba(0,0,0,0.35)', 0], ['rgba(0,0,0,0)', 0.3], ['rgba(0,0,0,0.15)', 0.5], ['rgba(0,0,0,0.75)', 1]]} />
        </>
      ) : (
        <>
          <Fade id="theme" diagonal stops={[[theme.accent, 0], [theme.primary, 0.55], [shade(theme.primary, 0.55), 1]]} />
          <Fade id="foot" stops={[['rgba(0,0,0,0)', 0.5], ['rgba(0,0,0,0.3)', 1]]} />
        </>
      )}
      <View style={styles.who}>
        <View style={styles.ring}>
          <Avatar name={data.name} url={data.avatar_url} size={72} />
        </View>
        <View style={{ flex: 1, gap: 2 }}>
          <ThemedText type="title" accessibilityRole="header" numberOfLines={2} style={styles.name}>
            {data.name}
          </ThemedText>
          {data.username ? <ThemedText type="smallBold" style={styles.light}>@{data.username}</ThemedText> : null}
        </View>
      </View>
      <View style={styles.chips}>
        <Chip>{`On Udozo since ${since}`}</Chip>
        {data.badges.map(badge => (
          <Chip key={badge} icon={<BadgeCheck size={13} color="#ffffff" />}>
            {badgeLabels[badge]}
          </Chip>
        ))}
      </View>
    </View>
  );
}

/** A gradient over the whole banner: top to bottom, or corner to corner. */
function Fade({ id, stops, diagonal }: { id: string; stops: [string, number][]; diagonal?: boolean }) {
  return (
    <Svg style={StyleSheet.absoluteFill} width="100%" height="100%" preserveAspectRatio="none" pointerEvents="none">
      <Defs>
        <LinearGradient id={id} x1="0" y1="0" x2={diagonal ? '1' : '0'} y2="1">
          {stops.map(([color, offset]) => (
            <Stop key={offset} offset={offset} stopColor={color} />
          ))}
        </LinearGradient>
      </Defs>
      <Rect x="0" y="0" width="100%" height="100%" fill={`url(#${id})`} />
    </Svg>
  );
}

/** A `#rrggbb` colour darkened towards black by `amount` (0 to 1); anything else unchanged. */
function shade(hex: string, amount: number) {
  const match = /^#([0-9a-f]{6})$/i.exec(hex);
  if (!match) return hex;
  const value = parseInt(match[1], 16);
  const part = (shift: number) => Math.round(((value >> shift) & 255) * (1 - amount)).toString(16).padStart(2, '0');
  return `#${part(16)}${part(8)}${part(0)}`;
}

function Chip({ children, icon }: { children: string; icon?: ReactNode }) {
  return (
    <View style={styles.chip}>
      {icon}
      <ThemedText type="caption" style={styles.light}>{children}</ThemedText>
    </View>
  );
}

/** A white icon in a translucent dark circle, 44 points: readable over the banner and over the listings alike. */
function Round({ label, onPress, children }: { label: string; onPress: () => void; children: ReactNode }) {
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={onPress} style={styles.round}>
      {children}
    </Pressable>
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
  // The list has side padding: the banner reaches past it to the screen's edges.
  banner: { marginHorizontal: -Spacing.three, overflow: 'hidden', justifyContent: 'flex-end', paddingHorizontal: Spacing.three, paddingBottom: Spacing.three, gap: Spacing.two },
  who: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three },
  ring: { borderWidth: 3, borderColor: '#ffffff', borderRadius: 999 },
  name: { color: '#ffffff', textShadowColor: 'rgba(0,0,0,0.35)', textShadowRadius: 6, textShadowOffset: { width: 0, height: 1 } },
  light: { color: '#ffffff' },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.one + 2 },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 4, borderRadius: Radius.round, paddingHorizontal: Spacing.two + 2, paddingVertical: 4, backgroundColor: 'rgba(255,255,255,0.2)' },
  topBar: { position: 'absolute', left: Spacing.two, right: Spacing.two, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  actions: { flexDirection: 'row', gap: Spacing.two },
  round: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(0,0,0,0.38)' },
  edit: { flexDirection: 'row', alignItems: 'center', gap: Spacing.one + 2, minHeight: 44, borderRadius: 22, paddingHorizontal: Spacing.three, backgroundColor: 'rgba(0,0,0,0.38)' },
  figures: { flexDirection: 'row', borderWidth: 1, borderRadius: Radius.medium, paddingVertical: Spacing.three },
  figure: { flex: 1, alignItems: 'center' },
  anjio: { borderRadius: Radius.medium, padding: Spacing.three, gap: 4 },
});

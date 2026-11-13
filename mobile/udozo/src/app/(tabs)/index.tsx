import type { ShopHeroSlide } from '@shared/classifieds';
import type { ClassifiedHome } from '@shared/home';
import { useQuery } from '@tanstack/react-query';
import { Image } from 'expo-image';
import { router, useLocalSearchParams } from 'expo-router';
import { Bell, ChevronDown, Search, Sparkles } from 'lucide-react-native';
import { useEffect, useMemo, useState } from 'react';
import { Modal, Pressable, RefreshControl, ScrollView, StyleSheet, TextInput, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { HeroReel } from '@/components/hero-reel';
import { HomeRows } from '@/components/home-blocks';
import { inter, ThemedText } from '@/components/themed-text';
import { Button, Empty, Failed, Loading } from '@/components/ui';
import { WhatsappButton } from '@/components/whatsapp-button';
import { MaxContentWidth, Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useAccount } from '@/lib/account';
import { api } from '@/lib/api';
import { useShopAssistant } from '@/lib/assistant';
import { shownSlides } from '@/lib/hero';
import { useMarket } from '@/lib/market';

/**
 * Home: Udozo's mark, the market (chosen once when signed out; the account's own when signed in), the bell, the search
 * box and Ask Anjio (where the market's assistant answers), then the market's home page as its admins laid it out.
 *
 * Where the market has hero reel columns (`GET /v1/classifieds/hero-slides`), Home opens with udozo.com's reel: from
 * the very top of the screen, under the status bar, on the page's own background so it blends with what follows, the
 * header then the reel, with the search box just beneath it; a strip of the background stays behind the status bar as
 * the page scrolls. The reel then takes the place of the page's own hero. Without columns,
 * Home is as before. Where Udozo is on WhatsApp in the market, WhatsApp's mark beside the bell pulls up what Udozo does there (`WhatsappButton`).
 */
export default function HomeScreen() {
  const theme = useTheme();
  const { country, markets, fixed, choose } = useMarket();
  // A link to another market's home (`udozo.com/gh`) opens it, unless the account's own market is fixed.
  const asked = useLocalSearchParams<{ country?: string }>().country?.toUpperCase();
  useEffect(() => {
    if (asked && !fixed && asked !== country && markets.some(market => market.country === asked)) void choose(asked);
  }, [asked, fixed, country, markets, choose]);
  const assistant = useShopAssistant(country);
  const home = useQuery({ queryKey: ['home', country], enabled: Boolean(country), queryFn: () => api<ClassifiedHome>(`/v1/classifieds/home?page=${country}`) });
  const hero = useQuery({ queryKey: ['hero', country], enabled: Boolean(country), staleTime: 60_000, queryFn: () => api<{ data: ShopHeroSlide[] }>(`/v1/classifieds/hero-slides?page=${country}`) });
  const slides = useMemo(() => shownSlides(hero.data?.data), [hero.data]);
  const reel = slides.length > 0;
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const rows = home.data?.rows ?? (home.data ? [{ id: 'all', hidden: false, title: '', subtitle: '', viewAll: null, view_all_href: null, background: 'none' as const, image: null, width: 'contained' as const, spacing: 'normal' as const, blocks: home.data.sections }] : []);
  return (
    <View style={{ flex: 1, backgroundColor: theme.background, paddingTop: reel ? 0 : insets.top }}>
      {reel ? null : <Header />}
      <ScrollView
        contentContainerStyle={{ paddingBottom: Spacing.six }}
        refreshControl={
          <RefreshControl
            refreshing={home.isRefetching}
            onRefresh={() => {
              void home.refetch();
              void hero.refetch();
            }}
            tintColor={theme.primary}
            progressViewOffset={reel ? insets.top : 0}
          />
        }>
        {reel ? (
          <View testID="home-band" style={{ backgroundColor: theme.background, paddingTop: insets.top, paddingBottom: 6 }}>
            <Header overReel />
            <HeroReel slides={slides} height={width < 600 ? 300 : 420} />
          </View>
        ) : null}
        <View style={styles.content}>
          <SearchRow country={country} assistantName={assistant?.assistant?.name ?? null} />
          {!country && !markets.length ? (
            <Loading />
          ) : home.isPending ? (
            <Loading />
          ) : home.isError ? (
            <Failed error={home.error} retry={() => home.refetch()} />
          ) : rows.length ? (
            <HomeRows rows={rows} withoutHero={reel} auctions={markets.find(market => market.country === country)?.auctions ? country : null} />
          ) : (
            <Empty title="Nothing for sale here yet" body="Be the first to sell on Udozo in your market." />
          )}
        </View>
      </ScrollView>
      {reel ? <View pointerEvents="none" style={[styles.statusStrip, { height: insets.top, backgroundColor: theme.background }]} /> : null}
    </View>
  );
}

/**
 * The search box, and on its right Ask (where the market's assistant answers), which opens Ask Anjio with whatever is
 * typed. Searching opens the Search tab with the words.
 */
function SearchRow({ country, assistantName }: { country: string | null; assistantName: string | null }) {
  const theme = useTheme();
  const [typed, setTyped] = useState('');
  const words = typed.trim();
  const search = () => router.push(words ? { pathname: '/search', params: { q: words } } : '/search');
  const ask = () => router.push({ pathname: '/assistant', params: { country: country!, ...(words ? { question: words } : {}) } });
  // The assistant's name when it is short, else Ask: the box keeps most of the row.
  const label = assistantName && assistantName.length <= 8 ? assistantName : 'Ask';
  return (
    <View style={styles.searchRow}>
      <View style={[styles.search, { borderColor: theme.line, backgroundColor: theme.backgroundElement }]}>
        <Search size={18} color={theme.textSecondary} />
        <TextInput
          accessibilityLabel="Search Udozo"
          placeholder="What are you looking for?"
          placeholderTextColor={theme.textSecondary}
          value={typed}
          onChangeText={setTyped}
          onSubmitEditing={search}
          returnKeyType="search"
          style={[styles.searchInput, { color: theme.text }]}
        />
      </View>
      {assistantName && country ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={words ? `Ask ${assistantName}: ${words}` : `Ask ${assistantName}`}
          onPress={ask}
          style={({ pressed }) => [styles.ask, { backgroundColor: theme.primary, opacity: pressed ? 0.85 : 1 }]}>
          <Sparkles size={18} color="#fff" />
          <ThemedText type="smallBold" numberOfLines={1} style={{ color: '#fff' }}>
            {label}
          </ThemedText>
        </Pressable>
      ) : null}
    </View>
  );
}

/** The header, in the theme's colours; above the reel (`overReel`) without its bottom line, so the reel follows on. */
function Header({ overReel }: { overReel?: boolean }) {
  const theme = useTheme();
  const { customer } = useAccount();
  const { country, markets, fixed, choose } = useMarket();
  const [picking, setPicking] = useState(false);
  const unread = useQuery({
    queryKey: ['notices', 'unread'],
    enabled: Boolean(customer),
    queryFn: () => api<{ count: number }>('/v1/store/account/notifications/unread-count'),
    refetchInterval: 60_000,
  });
  const market = markets.find(item => item.country === country);
  const count = unread.data?.count ?? 0;
  const ink = theme.text;
  return (
    <View style={[styles.header, overReel ? styles.bandHeader : { borderColor: theme.line }]}>
      <Image source={require('@/assets/images/mark.png')} style={styles.mark} accessibilityLabel="Udozo" />
      <ThemedText style={{ fontFamily: inter.extrabold, fontSize: 20, color: theme.primary }}>Udozo</ThemedText>
      <View style={{ flex: 1 }} />
      {market ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={fixed ? `Your market: ${market.name}` : `Market: ${market.name}. Change`}
          disabled={fixed}
          onPress={() => setPicking(true)}
          style={styles.market}>
          <ThemedText type="smallBold">
            {market.name}
          </ThemedText>
          {fixed ? null : <ChevronDown size={16} color={ink} />}
        </Pressable>
      ) : null}
      <WhatsappButton country={country} />
      {customer ? (
        <Pressable accessibilityRole="button" accessibilityLabel={count ? `Notifications, ${count} unread` : 'Notifications'} onPress={() => router.push('/notifications')} style={styles.bell}>
          <Bell size={22} color={ink} />
          {count ? <View style={[styles.dot, { backgroundColor: theme.danger }]} /> : null}
        </Pressable>
      ) : null}
      <Modal visible={picking} transparent animationType="slide" onRequestClose={() => setPicking(false)}>
        <Pressable style={styles.backdrop} accessibilityLabel="Close" onPress={() => setPicking(false)} />
        <View style={[styles.sheet, { backgroundColor: theme.background }]}>
          <ThemedText type="heading">Where are you shopping?</ThemedText>
          {markets.map(item => (
            <Button
              key={item.country}
              tone={item.country === country ? 'primary' : 'secondary'}
              title={`${item.name} · ${item.listings.toLocaleString('en-GB')} for sale`}
              onPress={async () => {
                await choose(item.country);
                setPicking(false);
              }}
            />
          ))}
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  content: { paddingTop: Spacing.three, gap: Spacing.four, width: '100%', maxWidth: MaxContentWidth, alignSelf: 'center' },
  header: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two, paddingHorizontal: Spacing.three, paddingVertical: Spacing.two, borderBottomWidth: StyleSheet.hairlineWidth },
  bandHeader: { borderBottomWidth: 0 },
  statusStrip: { position: 'absolute', top: 0, left: 0, right: 0 },
  mark: { width: 28, height: 28 },
  market: { minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: Spacing.two },
  bell: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  dot: { position: 'absolute', top: 10, right: 10, width: 9, height: 9, borderRadius: 5 },
  searchRow: { marginHorizontal: Spacing.three, flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  search: { flex: 1, minHeight: 48, borderWidth: 1, borderRadius: Radius.medium, flexDirection: 'row', alignItems: 'center', gap: Spacing.two, paddingLeft: Spacing.three },
  searchInput: { flex: 1, minHeight: 46, fontFamily: inter.regular, fontSize: 16, paddingRight: Spacing.three },
  ask: { minHeight: 48, minWidth: 48, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingHorizontal: Spacing.three, borderRadius: Radius.medium },
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.35)' },
  sheet: { padding: Spacing.four, gap: Spacing.two, borderTopLeftRadius: Radius.large, borderTopRightRadius: Radius.large },
});

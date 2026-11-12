import type { ClassifiedHome } from '@shared/home';
import { useQuery } from '@tanstack/react-query';
import { Image } from 'expo-image';
import { router } from 'expo-router';
import { Bell, ChevronDown, Search } from 'lucide-react-native';
import { useState } from 'react';
import { Modal, Pressable, RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { HomeRows } from '@/components/home-blocks';
import { inter, ThemedText } from '@/components/themed-text';
import { Button, Empty, Failed, Loading } from '@/components/ui';
import { MaxContentWidth, Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useAccount } from '@/lib/account';
import { api } from '@/lib/api';
import { useMarket } from '@/lib/market';

/**
 * Home: Udozo's mark, the market (chosen once when signed out; the account's own when signed in), the bell, the search
 * box, then the market's home page as its admins laid it out.
 */
export default function HomeScreen() {
  const theme = useTheme();
  const { country, markets } = useMarket();
  const home = useQuery({ queryKey: ['home', country], enabled: Boolean(country), queryFn: () => api<ClassifiedHome>(`/v1/classifieds/home?page=${country}`) });
  const rows = home.data?.rows ?? (home.data ? [{ id: 'all', hidden: false, title: '', subtitle: '', viewAll: null, view_all_href: null, background: 'none' as const, image: null, width: 'contained' as const, spacing: 'normal' as const, blocks: home.data.sections }] : []);
  return (
    <SafeAreaView edges={['top']} style={{ flex: 1, backgroundColor: theme.background }}>
      <Header />
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={home.isRefetching} onRefresh={() => void home.refetch()} tintColor={theme.primary} />}>
        <Pressable
          accessibilityRole="search"
          accessibilityLabel="Search Udozo"
          onPress={() => router.push('/search')}
          style={[styles.search, { borderColor: theme.line, backgroundColor: theme.backgroundElement }]}>
          <Search size={18} color={theme.textSecondary} />
          <ThemedText themeColor="textSecondary">What are you looking for?</ThemedText>
        </Pressable>
        {!country && !markets.length ? (
          <Loading />
        ) : home.isPending ? (
          <Loading />
        ) : home.isError ? (
          <Failed error={home.error} retry={() => home.refetch()} />
        ) : rows.length ? (
          <HomeRows rows={rows} />
        ) : (
          <Empty title="Nothing for sale here yet" body="Be the first to sell on Udozo in your market." />
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

function Header() {
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
  return (
    <View style={[styles.header, { borderColor: theme.line }]}>
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
          <ThemedText type="smallBold">{market.name}</ThemedText>
          {fixed ? null : <ChevronDown size={16} color={theme.text} />}
        </Pressable>
      ) : null}
      {customer ? (
        <Pressable accessibilityRole="button" accessibilityLabel={count ? `Notifications, ${count} unread` : 'Notifications'} onPress={() => router.push('/notifications')} style={styles.bell}>
          <Bell size={22} color={theme.text} />
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
  content: { paddingTop: Spacing.three, paddingBottom: Spacing.six, gap: Spacing.four, width: '100%', maxWidth: MaxContentWidth, alignSelf: 'center' },
  header: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two, paddingHorizontal: Spacing.three, paddingVertical: Spacing.two, borderBottomWidth: StyleSheet.hairlineWidth },
  mark: { width: 28, height: 28 },
  market: { minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: Spacing.two },
  bell: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  dot: { position: 'absolute', top: 10, right: 10, width: 9, height: 9, borderRadius: 5 },
  search: { marginHorizontal: Spacing.three, minHeight: 48, borderWidth: 1, borderRadius: Radius.medium, flexDirection: 'row', alignItems: 'center', gap: Spacing.two, paddingHorizontal: Spacing.three },
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.35)' },
  sheet: { padding: Spacing.four, gap: Spacing.two, borderTopLeftRadius: Radius.large, borderTopRightRadius: Radius.large },
});

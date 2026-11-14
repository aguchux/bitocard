import type { ShopTopCategory } from '@shared/classifieds';
import { useQuery } from '@tanstack/react-query';
import { Image } from 'expo-image';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { ArrowLeft, LayoutGrid, Megaphone, Plus, Search } from 'lucide-react-native';
import { useMemo } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ListingResults, useListings } from '@/components/listing-results';
import { bannerStyles, BannerTitle, FloatingBar, PageBanner, RoundButton, useLightStatusBar } from '@/components/page-banner';
import { ThemedText } from '@/components/themed-text';
import { Chip, Loading } from '@/components/ui';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useWantedOpen } from '@/hooks/use-wanted';
import { useAccount } from '@/lib/account';
import { api } from '@/lib/api';
import { useMarket } from '@/lib/market';

/**
 * A category, opening like a seller's page: a full-bleed banner (its top category's, else the theme's gradient) with its
 * spotlight image (a top category's) or icon on a white circle, its name and how many are for sale at its foot; Back on
 * the left and Post an ad, Search and Request an ad on the right; then its subcategories to narrow to, then its listings.
 */
export default function CategoryScreen() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const { slug, country: given } = useLocalSearchParams<{ slug: string; country?: string }>();
  const market = useMarket();
  const { customer } = useAccount();
  const country = (given ?? market.country ?? '').toUpperCase();
  const tree = useQuery({ queryKey: ['categories', country], enabled: Boolean(country), queryFn: () => api<{ data: ShopTopCategory[] }>(`/v1/classifieds/categories?country=${country}`), staleTime: 10 * 60_000 });
  const top = tree.data?.data.find(item => item.slug === slug || item.children.some(child => child.slug === slug));
  const current = top?.slug === slug ? top : top?.children.find(child => child.slug === slug);
  const params = useMemo(() => (country && slug ? { country, category: slug } : null), [country, slug]);
  // The same query the grid below reads, so the count costs nothing more.
  const listings = useListings(params);
  const total = listings.data?.pages[0]?.total;
  const wanted = useWantedOpen(country);
  useLightStatusBar();

  // Posting and asking need an account; searching never does.
  const signedIn = (go: () => void) => () => (customer ? go() : router.push('/signin'));
  const post = signedIn(() => router.push({ pathname: '/post/[id]', params: { id: 'new', category: slug } }));
  const search = () => router.push({ pathname: '/search', params: { country, category: slug } });
  const request = signedIn(() => router.push({ pathname: '/wanted/new', params: { category: slug } }));
  // A top category's own spotlight image; a subcategory shows its icon, as udozo.com's category hero does.
  const spotlight = current && current === top ? top.spotlight_url : null;

  return (
    <View style={{ flex: 1, backgroundColor: theme.background }}>
      <Stack.Screen options={{ headerShown: false }} />
      <ListingResults
        params={params}
        header={
          current && top ? (
            <View style={{ gap: Spacing.three, paddingBottom: Spacing.three }}>
              <PageBanner testID="category-banner" top={insets.top} image={top.banner_url}>
                <View style={bannerStyles.who}>
                  <View testID="category-circle" style={styles.circle}>
                    {spotlight ? (
                      <Image testID="category-spotlight" source={{ uri: spotlight }} style={styles.spotlight} contentFit="contain" accessibilityIgnoresInvertColors />
                    ) : (
                      <LayoutGrid size={30} color={theme.primary} />
                    )}
                  </View>
                  <View style={{ flex: 1, gap: 2 }}>
                    <BannerTitle>{current.name}</BannerTitle>
                    {total !== undefined ? <ThemedText type="smallBold" style={bannerStyles.light}>{`${total.toLocaleString('en-GB')} for sale`}</ThemedText> : null}
                  </View>
                </View>
              </PageBanner>
              {top.children.length ? (
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: Spacing.two }}>
                  <Chip label={`All ${top.name}`} selected={slug === top.slug} onPress={() => router.setParams({ slug: top.slug })} />
                  {top.children.map(child => (
                    <Chip key={child.slug} label={child.name} selected={slug === child.slug} onPress={() => router.setParams({ slug: child.slug })} />
                  ))}
                </ScrollView>
              ) : null}
            </View>
          ) : (
            <View style={{ paddingTop: insets.top + 56 }}>{tree.isPending ? <Loading /> : null}</View>
          )
        }
        empty={{ title: 'Nothing for sale here yet', body: 'Be the first to sell in this category.' }}
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
            <RoundButton label="Post an ad" onPress={post}>
              <Plus size={22} color="#ffffff" />
            </RoundButton>
            <RoundButton label="Search" onPress={search}>
              <Search size={20} color="#ffffff" />
            </RoundButton>
            {wanted ? (
              <RoundButton label="Request an ad" onPress={request}>
                <Megaphone size={20} color="#ffffff" />
              </RoundButton>
            ) : null}
          </>
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  circle: { width: 72, height: 72, borderRadius: 36, borderWidth: 3, borderColor: '#ffffff', backgroundColor: '#ffffff', overflow: 'hidden', alignItems: 'center', justifyContent: 'center' },
  spotlight: { width: 60, height: 60 },
});

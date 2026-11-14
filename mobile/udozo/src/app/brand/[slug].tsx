import { brandInitials, type ShopBrandPage } from '@shared/classifieds';
import { useQuery } from '@tanstack/react-query';
import { Image } from 'expo-image';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { ArrowLeft, Megaphone, Plus, Search } from 'lucide-react-native';
import { StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ListingResults } from '@/components/listing-results';
import { BannerChip, bannerStyles, BannerTitle, FloatingBar, PageBanner, readable, RoundButton, shade, useLightStatusBar } from '@/components/page-banner';
import { inter, ThemedText } from '@/components/themed-text';
import { Failed, Loading } from '@/components/ui';
import { Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useWantedOpen } from '@/hooks/use-wanted';
import { useAccount } from '@/lib/account';
import { api } from '@/lib/api';
import { useMarket } from '@/lib/market';

/**
 * A brand in the market, opening like a seller's page: a full-bleed banner (its own, else a gradient in the brand's
 * colour, darkened so white words read) with its logo, name, what is for sale under it and the market at its foot; Back
 * on the left and Post an ad, Search and Request an ad on the right; then its listings.
 */
export default function BrandScreen() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const { slug, country: given } = useLocalSearchParams<{ slug: string; country?: string }>();
  const market = useMarket();
  const { customer } = useAccount();
  const country = (given ?? market.country ?? '').toUpperCase();
  const brand = useQuery({ queryKey: ['brand', slug, country], enabled: Boolean(country && slug), queryFn: () => api<ShopBrandPage>(`/v1/classifieds/brands/${encodeURIComponent(slug)}?country=${country}`) });
  const wanted = useWantedOpen(country);
  const data = brand.data;
  useLightStatusBar();

  const marketName = market.markets.find(item => item.country === country)?.name ?? country;
  // Posting and asking need an account; searching never does.
  const signedIn = (go: () => void) => () => (customer ? go() : router.push('/signin'));
  const post = signedIn(() => {
    // The category only when the brand sells in exactly one; else the seller chooses.
    const only = data?.categories.length === 1 ? data.categories[0].slug : undefined;
    router.push({ pathname: '/post/[id]', params: { id: 'new', ...(only ? { category: only } : {}), ...(data ? { brand: data.name } : {}) } });
  });
  const search = () => router.push({ pathname: '/search', params: { country, brand: slug, ...(data ? { brand_name: data.name } : {}) } });
  const request = signedIn(() => router.push({ pathname: '/wanted/new', params: data ? { words: data.name } : {} }));
  const base = readable(data?.color ?? theme.primary);

  return (
    <View style={{ flex: 1, backgroundColor: theme.background }}>
      <Stack.Screen options={{ headerShown: false }} />
      <ListingResults
        params={country && slug ? { country, brand: slug } : null}
        header={
          brand.isError ? (
            <View style={{ paddingTop: insets.top + 56 }}>
              <Failed error={brand.error} retry={() => void brand.refetch()} />
            </View>
          ) : data ? (
            <View style={{ paddingBottom: Spacing.three }}>
              <PageBanner testID="brand-banner" top={insets.top} image={data.banner_url} tint={{ from: base, to: shade(base, 0.25) }}>
                <View style={bannerStyles.who}>
                  {/* A logo is drawn in the brand's own colour, so it sits on white; initials sit on that colour. */}
                  <View testID="brand-logo" style={[styles.logo, { backgroundColor: data.logo_url ? '#fff' : (data.color ?? theme.primary) }]}>
                    {data.logo_url ? (
                      <Image source={{ uri: data.logo_url }} style={styles.logoImage} contentFit="contain" accessibilityLabel={`${data.name} logo`} />
                    ) : (
                      <ThemedText style={{ color: '#fff', fontFamily: inter.extrabold, fontSize: 22 }}>{brandInitials(data.name)}</ThemedText>
                    )}
                  </View>
                  <View style={{ flex: 1, gap: 2 }}>
                    <BannerTitle>{data.name}</BannerTitle>
                    <ThemedText type="smallBold" style={bannerStyles.light}>
                      {`${data.listings.toLocaleString('en-GB')} for sale from ${data.sellers.toLocaleString('en-GB')} sellers`}
                    </ThemedText>
                  </View>
                </View>
                <View style={bannerStyles.chips}>
                  <BannerChip>{marketName}</BannerChip>
                </View>
              </PageBanner>
            </View>
          ) : (
            <View style={{ paddingTop: insets.top + 56 }}>
              <Loading />
            </View>
          )
        }
        empty={{ title: 'Nothing for sale under this brand yet' }}
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
  logo: { width: 72, height: 72, borderRadius: Radius.medium, borderWidth: 3, borderColor: '#ffffff', overflow: 'hidden', alignItems: 'center', justifyContent: 'center' },
  logoImage: { width: 54, height: 54 },
});

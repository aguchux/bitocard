import { brandInitials, type ShopBrandPage } from '@shared/classifieds';
import { useQuery } from '@tanstack/react-query';
import { Image } from 'expo-image';
import { Stack, useLocalSearchParams } from 'expo-router';
import { StyleSheet, View } from 'react-native';

import { ListingResults } from '@/components/listing-results';
import { inter, ThemedText } from '@/components/themed-text';
import { Failed } from '@/components/ui';
import { Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { api } from '@/lib/api';
import { useMarket } from '@/lib/market';

/** A brand in the market: its logo (else initials on its colour), what is for sale under it, then its listings. */
export default function BrandScreen() {
  const theme = useTheme();
  const { slug, country: given } = useLocalSearchParams<{ slug: string; country?: string }>();
  const market = useMarket();
  const country = (given ?? market.country ?? '').toUpperCase();
  const brand = useQuery({ queryKey: ['brand', slug, country], enabled: Boolean(country && slug), queryFn: () => api<ShopBrandPage>(`/v1/classifieds/brands/${encodeURIComponent(slug)}?country=${country}`) });
  const data = brand.data;
  return (
    <>
      <Stack.Screen options={{ title: data?.name ?? '' }} />
      <ListingResults
        params={country && slug ? { country, brand: slug } : null}
        header={
          brand.isError ? (
            <Failed error={brand.error} retry={() => void brand.refetch()} />
          ) : data ? (
            <View style={styles.head}>
              <View style={[styles.logo, { backgroundColor: data.color ?? theme.primary }]}>
                {data.logo_url ? (
                  <Image source={{ uri: data.logo_url }} style={StyleSheet.absoluteFill} contentFit="contain" accessibilityLabel={`${data.name} logo`} />
                ) : (
                  <ThemedText style={{ color: '#fff', fontFamily: inter.extrabold }}>{brandInitials(data.name)}</ThemedText>
                )}
              </View>
              <View style={{ flex: 1 }}>
                <ThemedText type="subtitle" accessibilityRole="header">
                  {data.name}
                </ThemedText>
                <ThemedText type="small" themeColor="textSecondary">
                  {`${data.listings.toLocaleString('en-GB')} for sale from ${data.sellers.toLocaleString('en-GB')} sellers`}
                </ThemedText>
              </View>
            </View>
          ) : undefined
        }
        empty={{ title: 'Nothing for sale under this brand yet' }}
      />
    </>
  );
}

const styles = StyleSheet.create({
  head: { flexDirection: 'row', gap: Spacing.three, alignItems: 'center', paddingVertical: Spacing.three },
  logo: { width: 64, height: 64, borderRadius: Radius.medium, overflow: 'hidden', alignItems: 'center', justifyContent: 'center', backgroundColor: '#fff' },
});

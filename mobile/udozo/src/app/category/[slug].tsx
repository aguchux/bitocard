import type { ShopTopCategory } from '@shared/classifieds';
import { useQuery } from '@tanstack/react-query';
import { Image } from 'expo-image';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { ScrollView, StyleSheet, View } from 'react-native';

import { ListingResults } from '@/components/listing-results';
import { ThemedText } from '@/components/themed-text';
import { Chip } from '@/components/ui';
import { Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { api } from '@/lib/api';
import { useMarket } from '@/lib/market';

/** A category: its banner (a top category's), its subcategories to narrow to, then its listings. */
export default function CategoryScreen() {
  const theme = useTheme();
  const { slug, country: given } = useLocalSearchParams<{ slug: string; country?: string }>();
  const market = useMarket();
  const country = (given ?? market.country ?? '').toUpperCase();
  const tree = useQuery({ queryKey: ['categories', country], enabled: Boolean(country), queryFn: () => api<{ data: ShopTopCategory[] }>(`/v1/classifieds/categories?country=${country}`), staleTime: 10 * 60_000 });
  const top = tree.data?.data.find(item => item.slug === slug || item.children.some(child => child.slug === slug));
  const current = top?.slug === slug ? top : top?.children.find(child => child.slug === slug);
  return (
    <>
      <Stack.Screen options={{ title: current?.name ?? '' }} />
      <ListingResults
        params={country && slug ? { country, category: slug } : null}
        header={
          <View style={{ gap: Spacing.three, paddingTop: Spacing.three }}>
            {top?.banner_url ? <Image source={{ uri: top.banner_url }} style={[styles.banner, { backgroundColor: theme.backgroundElement }]} contentFit="cover" accessibilityIgnoresInvertColors /> : null}
            <ThemedText type="subtitle" accessibilityRole="header">
              {current?.name ?? ''}
            </ThemedText>
            {top && top.children.length ? (
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: Spacing.two }}>
                <Chip label={`All ${top.name}`} selected={slug === top.slug} onPress={() => router.setParams({ slug: top.slug })} />
                {top.children.map(child => (
                  <Chip key={child.slug} label={child.name} selected={slug === child.slug} onPress={() => router.setParams({ slug: child.slug })} />
                ))}
              </ScrollView>
            ) : null}
          </View>
        }
        empty={{ title: 'Nothing for sale here yet', body: 'Be the first to sell in this category.' }}
      />
    </>
  );
}

const styles = StyleSheet.create({ banner: { width: '100%', aspectRatio: 4, borderRadius: Radius.medium } });

import { badgeLabels, type ShopPublicScores, type ShopSellerProfile } from '@shared/classifieds';
import { useQuery } from '@tanstack/react-query';
import { Image } from 'expo-image';
import { Stack, useLocalSearchParams } from 'expo-router';
import { BadgeCheck } from 'lucide-react-native';
import { StyleSheet, View } from 'react-native';

import { ListingResults } from '@/components/listing-results';
import { ThemedText } from '@/components/themed-text';
import { Avatar, Failed } from '@/components/ui';
import { Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { api } from '@/lib/api';

/**
 * A seller's page: cover, photo and name, badges, how long they have sold and how they answer, then their listings.
 * An old username still held answers with where the page is now; their listings are searched by the current one.
 */
export default function SellerScreen() {
  const theme = useTheme();
  const { key } = useLocalSearchParams<{ key: string }>();
  const seller = useQuery({ queryKey: ['seller', key], enabled: Boolean(key), queryFn: () => api<ShopSellerProfile>(`/v1/classifieds/sellers/${encodeURIComponent(key)}`) });
  const data = seller.data;
  const since = data ? new Date(data.member_since).toLocaleDateString('en-GB', { month: 'long', year: 'numeric' }) : '';
  return (
    <>
      <Stack.Screen options={{ title: data?.name ?? '' }} />
      <ListingResults
        params={data ? { country: data.country, seller: data.username || data.handle } : null}
        header={
          seller.isError ? (
            <Failed error={seller.error} retry={() => void seller.refetch()} />
          ) : data ? (
            <View style={{ gap: Spacing.three, paddingBottom: Spacing.three }}>
              <View style={[styles.cover, { backgroundColor: theme.primary }]}>
                {data.banner_url ? <Image source={{ uri: data.banner_url }} style={StyleSheet.absoluteFill} contentFit="cover" accessibilityIgnoresInvertColors /> : null}
              </View>
              <View style={styles.row}>
                <Avatar name={data.name} url={data.avatar_url} size={64} />
                <View style={{ flex: 1 }}>
                  <ThemedText type="subtitle" accessibilityRole="header">
                    {data.name}
                  </ThemedText>
                  {data.username ? <ThemedText type="small" themeColor="textSecondary">@{data.username}</ThemedText> : null}
                  <ThemedText type="small" themeColor="textSecondary">{`On Udozo since ${since}`}</ThemedText>
                </View>
              </View>
              {data.badges.length ? (
                <View style={styles.badges}>
                  {data.badges.map(badge => (
                    <View key={badge} style={[styles.badge, { borderColor: theme.line }]}>
                      <BadgeCheck size={14} color={theme.success} />
                      <ThemedText type="caption">{badgeLabels[badge]}</ThemedText>
                    </View>
                  ))}
                </View>
              ) : null}
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
          ) : undefined
        }
        empty={{ title: 'Nothing for sale right now' }}
      />
    </>
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
  cover: { width: '100%', aspectRatio: 4, borderRadius: Radius.medium, overflow: 'hidden', marginTop: Spacing.three },
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three },
  badges: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two },
  badge: { flexDirection: 'row', alignItems: 'center', gap: 4, borderWidth: 1, borderRadius: Radius.round, paddingHorizontal: Spacing.two, paddingVertical: 4 },
  figures: { flexDirection: 'row', borderWidth: 1, borderRadius: Radius.medium, paddingVertical: Spacing.three },
  figure: { flex: 1, alignItems: 'center' },
  anjio: { borderRadius: Radius.medium, padding: Spacing.three, gap: 4 },
});

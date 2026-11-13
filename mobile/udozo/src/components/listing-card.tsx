import { conditionLabels, shopPriceText, type ShopListingCard } from '@shared/classifieds';
import { Image } from 'expo-image';
import { router } from 'expo-router';
import { MapPin } from 'lucide-react-native';
import { Pressable, StyleSheet, View } from 'react-native';

import { inter, ThemedText } from '@/components/themed-text';
import { Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { photoUrl } from '@/lib/navigate';

type Card = Omit<ShopListingCard, 'price'> & { price?: ShopListingCard['price']; sponsored?: true; was_price?: number | null };

/**
 * A listing as a card: its photo, price (never across countries), title and area; Sponsored ones say so in words. It
 * sizes to its content: a rail gives it a `width`, and only a grid's row lets it `fill` its column (flex there alone:
 * in a sideways list flex stretched each card down past the screen).
 */
export function ListingCard({ listing, width, fill }: { listing: Card; width?: number; fill?: boolean }) {
  const theme = useTheme();
  const price = listing.price ? shopPriceText(listing.price) : null;
  const sold = listing.in_stock === false;
  const label = [listing.title, price, listing.area.name, listing.sponsored ? 'Ad' : null, sold ? 'Out of stock' : null].filter(Boolean).join(', ');
  return (
    <Pressable
      accessibilityRole="link"
      accessibilityLabel={label}
      onPress={() => router.push({ pathname: '/listing/[ref]', params: { ref: String(listing.ref), country: listing.country } })}
      style={({ pressed }) => [styles.card, fill ? styles.fill : { width }, { borderColor: theme.line, backgroundColor: theme.background, opacity: pressed ? 0.9 : 1 }]}>
      <View style={[styles.photo, { backgroundColor: theme.backgroundElement }]}>
        {listing.cover ? <Image source={{ uri: photoUrl(listing.cover.url, 480)! }} style={StyleSheet.absoluteFill} contentFit="cover" transition={150} accessibilityIgnoresInvertColors /> : null}
        {listing.sponsored ? (
          <View style={[styles.badge, { backgroundColor: theme.text }]}>
            <ThemedText type="caption" style={{ color: theme.background, fontFamily: inter.bold }}>Ad</ThemedText>
          </View>
        ) : null}
        {sold ? (
          <View style={[styles.badge, { backgroundColor: theme.danger }]}>
            <ThemedText type="caption" style={{ color: '#fff', fontFamily: inter.bold }}>Out of stock</ThemedText>
          </View>
        ) : null}
      </View>
      <View style={styles.body}>
        {price ? <ThemedText type="price" numberOfLines={1}>{price}</ThemedText> : null}
        <ThemedText type="small" numberOfLines={2}>{listing.title}</ThemedText>
        <View style={styles.row}>
          <MapPin size={12} color={theme.textSecondary} />
          <ThemedText type="caption" numberOfLines={1} style={{ flex: 1 }}>
            {listing.area.name}
            {listing.condition ? ` · ${conditionLabels[listing.condition]}` : ''}
          </ThemedText>
        </View>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: { borderWidth: 1, borderRadius: Radius.medium, overflow: 'hidden' },
  fill: { flex: 1 },
  photo: { aspectRatio: 1, width: '100%' },
  badge: { position: 'absolute', top: Spacing.two, left: Spacing.two, borderRadius: Radius.small, paddingHorizontal: 6, paddingVertical: 2 },
  body: { padding: Spacing.two, gap: 2 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 4 },
});

import { badgeLabels, reviewRatingLabels, reviewSourceLabels, type ShopListingPage, type ShopReview } from '@shared/classifieds';
import { BadgeCheck, ChevronRight, ThumbsDown, ThumbsUp } from 'lucide-react-native';
import { Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Avatar, Button, Card } from '@/components/ui';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { openSeller } from '@/lib/navigate';

/**
 * The seller: their photo (with a green dot while they are on Udozo), name, since when, badges, replies and reviews, and
 * their page, which the photo and name open too.
 */
export function SellerCard({ data, online }: { data: ShopListingPage; online: boolean }) {
  const theme = useTheme();
  const seller = data.seller;
  const key = seller.username || seller.handle;
  const since = new Date(seller.member_since).toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });
  const open = () => openSeller(seller);
  return (
    <Card>
      <Pressable
        testID="seller-card-head"
        accessibilityRole={key ? 'link' : undefined}
        accessibilityLabel={key ? `${seller.name}. Open their seller page` : undefined}
        disabled={!key}
        onPress={open}
        style={({ pressed }) => [styles.inline, { opacity: pressed ? 0.8 : 1 }]}>
        <View>
          <Avatar name={seller.name} url={seller.avatar_url} size={48} />
          {online ? <View style={[styles.online, { backgroundColor: theme.success, borderColor: theme.background }]} accessibilityLabel="On Udozo now" /> : null}
        </View>
        <View style={{ flex: 1 }}>
          <ThemedText type="heading">{seller.name}</ThemedText>
          <ThemedText type="caption">{`On Udozo since ${since} · ${seller.active_listings} for sale`}</ThemedText>
        </View>
        {key ? <ChevronRight size={18} color={theme.textSecondary} /> : null}
      </Pressable>
      {seller.badges.length ? (
        <View style={[styles.inline, { flexWrap: 'wrap' }]}>
          {seller.badges.map(badge => (
            <View key={badge} style={styles.badge}>
              <BadgeCheck size={14} color={theme.success} />
              <ThemedText type="caption">{badgeLabels[badge]}</ThemedText>
            </View>
          ))}
        </View>
      ) : null}
      {seller.response_rate !== null ? <ThemedText type="small">{`Replies to ${seller.response_rate}% of chats`}</ThemedText> : null}
      {seller.reviews && seller.reviews.positive_pct !== null ? <ThemedText type="small">{`${seller.reviews.positive_pct}% positive reviews (${seller.reviews.counted})`}</ThemedText> : null}
      {key ? <Button tone="secondary" title={`See all ${seller.active_listings} of their listings`} accessibilityLabel={`Seller ${seller.name}. See their page`} icon={<ChevronRight size={18} color={theme.text} />} onPress={open} /> : null}
    </Card>
  );
}

/** The latest reviews of this item (same brand and model) from this seller, where reviews are open. */
export function ProductReviews({ reviews }: { reviews: ShopReview[] }) {
  const theme = useTheme();
  if (!reviews.length) return null;
  return (
    <Card>
      <ThemedText type="heading" accessibilityRole="header">Reviews of this item</ThemedText>
      {reviews.map(review => (
        <View key={review.id} style={[styles.review, { borderColor: theme.line }]}>
          <View style={styles.inline}>
            {review.rating === 'negative' ? <ThumbsDown size={16} color={theme.danger} /> : <ThumbsUp size={16} color={review.rating === 'positive' ? theme.success : theme.textSecondary} />}
            <ThemedText type="smallBold" style={{ flex: 1 }}>{`${reviewRatingLabels[review.rating]} · ${review.reviewer.name}`}</ThemedText>
          </View>
          {review.body ? <ThemedText type="small">{review.body}</ThemedText> : null}
          <ThemedText type="caption">{[review.product.label, reviewSourceLabels[review.source], monthText(review.month)].filter(Boolean).join(' · ')}</ThemedText>
        </View>
      ))}
    </Card>
  );
}

const monthText = (month: string) => {
  const date = new Date(`${month}-01T00:00:00Z`);
  return Number.isNaN(date.getTime()) ? null : date.toLocaleDateString('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' });
};

const styles = StyleSheet.create({
  inline: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  badge: { flexDirection: 'row', alignItems: 'center', gap: Spacing.one },
  online: { position: 'absolute', right: 0, bottom: 0, width: 14, height: 14, borderRadius: 7, borderWidth: 2 },
  review: { gap: Spacing.one, paddingTop: Spacing.two, borderTopWidth: StyleSheet.hairlineWidth },
});

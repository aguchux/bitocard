import { conditionLabels, postedAgo, shopPriceText, type ShopListingPage } from '@shared/classifieds';
import { router } from 'expo-router';
import { ChevronRight, LayoutGrid, MapPin, PackageCheck, PackageX, Tag } from 'lucide-react-native';
import type { ReactNode } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { inter, ThemedText } from '@/components/themed-text';
import { Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { placeSearch, stockLine } from '@/lib/listing-page';

/**
 * What a buyer reads first: the price (and whether it is negotiable), the title and the stock line, then chips opening
 * their own screens: the condition, the place (a search there), the category and the brand.
 */
export function ListingSummary({ data, country }: { data: ShopListingPage; country: string }) {
  const theme = useTheme();
  const stock = stockLine(data);
  const place = placeSearch(data, country);
  return (
    <View style={{ gap: Spacing.two }}>
      <View style={{ gap: Spacing.one }}>
        <ThemedText style={{ fontFamily: inter.extrabold, fontSize: 24 }}>{shopPriceText(data.price)}</ThemedText>
        {data.price.kind === 'negotiable' ? <ThemedText type="small" themeColor="textSecondary">Negotiable</ThemedText> : null}
        <ThemedText type="heading" accessibilityRole="header">
          {data.title}
        </ThemedText>
        {data.status === 'sold' ? (
          <ThemedText type="smallBold" style={{ color: theme.danger }}>Sold</ThemedText>
        ) : stock ? (
          <View style={styles.inline}>
            {stock.out ? <PackageX size={16} color={theme.danger} /> : <PackageCheck size={16} color={theme.success} />}
            <ThemedText type="smallBold" style={{ color: stock.out ? theme.danger : theme.success }}>{stock.text}</ThemedText>
          </View>
        ) : null}
      </View>
      <View style={styles.chips}>
        {data.condition ? <SummaryChip label={conditionLabels[data.condition]} icon={<Tag size={14} color={theme.textSecondary} />} /> : null}
        <SummaryChip
          label={place.place}
          hint="See listings near there"
          icon={<MapPin size={14} color={theme.textSecondary} />}
          onPress={() => router.push({ pathname: '/search', params: place })}
        />
        <SummaryChip
          label={data.category.name}
          hint="Open the category"
          icon={<LayoutGrid size={14} color={theme.textSecondary} />}
          onPress={() => router.push({ pathname: '/category/[slug]', params: { slug: data.category.slug, country } })}
        />
        {data.brand ? (
          <SummaryChip label={data.brand.name} hint="Open the brand's page" onPress={() => router.push({ pathname: '/brand/[slug]', params: { slug: data.brand!.slug, country } })} />
        ) : null}
      </View>
      <ThemedText type="caption">{[postedAgo(data.published_at), data.sku ? `Ad ${data.sku}` : null].filter(Boolean).join(' · ')}</ThemedText>
    </View>
  );
}

/** A chip: a link to its own screen when it has one, else just the words. */
function SummaryChip({ label, hint, icon, onPress }: { label: string; hint?: string; icon?: ReactNode; onPress?: () => void }) {
  const theme = useTheme();
  const body = (
    <>
      {icon}
      <ThemedText type="smallBold" numberOfLines={1} style={{ flexShrink: 1 }}>
        {label}
      </ThemedText>
      {onPress ? <ChevronRight size={14} color={theme.textSecondary} /> : null}
    </>
  );
  const style = [styles.chip, { borderColor: theme.line, backgroundColor: theme.backgroundElement }];
  return onPress ? (
    <Pressable accessibilityRole="link" accessibilityLabel={label} accessibilityHint={hint} onPress={onPress} style={({ pressed }) => [...style, { opacity: pressed ? 0.8 : 1 }]}>
      {body}
    </Pressable>
  ) : (
    <View style={style}>{body}</View>
  );
}

const styles = StyleSheet.create({
  inline: { flexDirection: 'row', alignItems: 'center', gap: Spacing.one },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two },
  chip: { flexDirection: 'row', alignItems: 'center', gap: Spacing.one, minHeight: 36, maxWidth: '100%', paddingHorizontal: Spacing.three, borderRadius: Radius.round, borderWidth: 1 },
});

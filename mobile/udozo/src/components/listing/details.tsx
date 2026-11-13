import { deliveryLabels, descriptionBlocks, featureValueText, shopMoney, type ShopListingPage, type ShopSafePayQuote } from '@shared/classifieds';
import { useQuery } from '@tanstack/react-query';
import { ShieldCheck, Truck } from 'lucide-react-native';
import { StyleSheet, View } from 'react-native';

import { inter, ThemedText } from '@/components/themed-text';
import { Card } from '@/components/ui';
import { Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { api } from '@/lib/api';

/** Key details: the listing's features two to a row, each its name over its value. */
export function KeyDetails({ data }: { data: ShopListingPage }) {
  const theme = useTheme();
  if (!data.features.length) return null;
  return (
    <Card>
      <ThemedText type="heading" accessibilityRole="header">Key details</ThemedText>
      <View style={styles.grid}>
        {data.features.map(feature => (
          <View key={feature.key} style={[styles.feature, { backgroundColor: theme.backgroundElement }]}>
            <ThemedText type="caption" numberOfLines={1}>{feature.name}</ThemedText>
            <ThemedText type="smallBold">{featureValueText(feature)}</ThemedText>
          </View>
        ))}
      </View>
    </Card>
  );
}

/** What the seller wrote, in its limited Markdown: paragraphs with bold and italics, and lists. */
export function Description({ text }: { text: string }) {
  return (
    <Card>
      <ThemedText type="heading" accessibilityRole="header">Description</ThemedText>
      <View style={{ gap: Spacing.two }}>
        {descriptionBlocks(text).map((block, index) =>
          block.kind === 'p' ? (
            <ThemedText key={index}>
              {block.spans.map((span, at) => (
                <ThemedText key={at} style={[span.bold && { fontFamily: inter.bold }, span.italic && { fontStyle: 'italic' }]}>
                  {span.text}
                </ThemedText>
              ))}
            </ThemedText>
          ) : (
            <View key={index} style={{ gap: 2 }}>
              {block.items.map((item, at) => (
                <ThemedText key={at}>
                  {block.kind === 'ul' ? '• ' : `${at + 1}. `}
                  {item.map(span => span.text).join('')}
                </ThemedText>
              ))}
            </View>
          ),
        )}
      </View>
    </Card>
  );
}

/**
 * Delivery and pickup: how it reaches the buyer, with the seller's charges within their state and nationwide (read from
 * the UdozoPay quote once the buyer is signed in, where UdozoPay is open) and the states its Udozo Connect shipping reaches.
 */
export function Delivery({ data, quoteFor }: { data: ShopListingPage; quoteFor: boolean }) {
  const theme = useTheme();
  const quote = useQuery({
    queryKey: ['safe-pay', data.id, null],
    enabled: quoteFor && data.delivery !== 'none',
    retry: false,
    queryFn: () => api<ShopSafePayQuote>(`/v1/classifieds/listings/${data.id}/safe-pay`),
  });
  const charges = quote.data?.delivery;
  const currency = data.price.currency;
  const charge = (minor: number) => (minor === 0 ? 'Free' : shopMoney(minor, currency));
  const states = data.connect?.states ?? [];
  return (
    <Card>
      <View style={styles.inline}>
        <Truck size={18} color={theme.primary} />
        <ThemedText type="heading" accessibilityRole="header">Delivery and pickup</ThemedText>
      </View>
      <ThemedText type="smallBold">{deliveryLabels[data.delivery]}</ThemedText>
      <ThemedText type="small" themeColor="textSecondary">
        {data.delivery === 'none' ? `Meet the seller in ${data.area.name}, ${data.area.state.name} to collect it.` : `From ${data.area.name}, ${data.area.state.name}. You can also meet the seller to collect it.`}
      </ThemedText>
      {charges ? (
        <View style={{ gap: 2 }}>
          <Row label={`Within ${data.area.state.name}`} value={charge(charges.within_state)} />
          {charges.nationwide !== null ? <Row label="Elsewhere in the country" value={charge(charges.nationwide)} /> : null}
        </View>
      ) : null}
      {states.length ? (
        <View style={{ gap: 2 }}>
          <ThemedText type="smallBold">Ships to a Udozo Connect Centre</ThemedText>
          {states.map(state => (
            <Row key={state.id} label={`${state.name} (${state.centres} ${state.centres === 1 ? 'centre' : 'centres'})`} value={charge(state.shipping)} />
          ))}
        </View>
      ) : null}
    </Card>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.row}>
      <ThemedText type="small" themeColor="textSecondary" style={{ flex: 1 }}>{label}</ThemedText>
      <ThemedText type="smallBold">{value}</ThemedText>
    </View>
  );
}

/** UdozoPay's promise, where the market has it: the money is held until the buyer has the item. */
export function UdozoPayNote() {
  const theme = useTheme();
  return (
    <Card style={{ backgroundColor: theme.backgroundElement }}>
      <View style={styles.inline}>
        <ShieldCheck size={18} color={theme.success} />
        <ThemedText type="heading" accessibilityRole="header">Protected by UdozoPay</ThemedText>
      </View>
      <ThemedText type="small">Pay with UdozoPay and Udozo holds your money until you have the item. If it does not come or is not as described, you can open a dispute.</ThemedText>
    </Card>
  );
}

/** The checks to make before paying: the category's own, then Udozo's. */
export function BeforeYouPay({ checks }: { checks: string[] }) {
  const theme = useTheme();
  return (
    <Card style={{ backgroundColor: theme.backgroundElement }}>
      <View style={styles.inline}>
        <ShieldCheck size={18} color={theme.success} />
        <ThemedText type="heading" accessibilityRole="header">Before you pay</ThemedText>
      </View>
      {checks.map(item => (
        <ThemedText key={item} type="small">{`• ${item}`}</ThemedText>
      ))}
      <ThemedText type="small" themeColor="textSecondary">
        Meet in a public place, check the item, and never pay before you have seen it. Keep chats and payments on Udozo.
      </ThemedText>
    </Card>
  );
}

const styles = StyleSheet.create({
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two },
  feature: { flexBasis: '47%', flexGrow: 1, padding: Spacing.two, borderRadius: Radius.small, gap: 2 },
  inline: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  row: { flexDirection: 'row', gap: Spacing.three, paddingVertical: 2 },
});

import { useQuery } from '@tanstack/react-query';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { BrandTile } from '@/components/brand-tile';
import { Button, Card, Chip, Field, inter, Line, Notice, Page, T, useTheme } from '@/components/ui';
import { useAccount } from '@/lib/account';
import { api } from '@/lib/api';
import { priceAt, valuesOf } from '@/lib/gift-cards';
import { formatMoney } from '@/lib/money';
import type { StoreProductDetail, StoreRate } from '@/lib/types';

/**
 * Buy a gift card: its rate today (per unit of the card's currency), a value, how many (up to 10) and where the codes
 * are also emailed; Continue confirms and pays as any order. Codes then show on the order, hidden until revealed.
 */
export default function GiftCardScreen() {
  const theme = useTheme();
  const { key } = useLocalSearchParams<{ key: string }>();
  const { customer } = useAccount();
  const country = customer?.country ?? 'NG';
  const currency = customer?.currency ?? 'NGN';
  const detail = useQuery({ queryKey: ['product', key], queryFn: () => api<StoreProductDetail>(`/v1/store/products/${encodeURIComponent(key)}?currency=${currency}`) });
  const rate = useQuery({ queryKey: ['rate', key, country], queryFn: () => api<StoreRate>(`/v1/store/products/${encodeURIComponent(key)}/rate?country=${country}`) });
  const [face, setFace] = useState<number | null>(null);
  const [quantity, setQuantity] = useState(1);
  const [email, setEmail] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const product = detail.data;
  const values = product ? valuesOf(product, rate.data) : [];
  const chosen = face ?? values[0] ?? null;
  const each = product && chosen !== null ? priceAt(rate.data, chosen, product.face_currency) : null;
  const sendTo = email ?? customer?.email ?? '';

  const proceed = () => {
    setError(null);
    if (!product || chosen === null) return setError('Choose a value.');
    if (!/^\S+@\S+\.\S+$/.test(sendTo.trim())) return setError('Enter the email the codes go to.');
    router.push({ pathname: '/pay', params: { product: product.id, face: String(chosen), quantity: String(quantity), email: sendTo.trim(), name: `${product.name} ${formatMoney(chosen, product.face_currency, { cents: false })}${quantity > 1 ? ` × ${quantity}` : ''}` } });
  };

  if (!product) {
    return <Page>{detail.isError ? <Notice tone="bad">This gift card could not be loaded.</Notice> : <T muted>Loading…</T>}</Page>;
  }

  return (
    <Page>
      <Stack.Screen options={{ title: product.brand.name }} />
      {/* Navy, not the brand's colour: white text must read on it whatever the brand (a yellow one would not). */}
      <View style={[styles.hero, { backgroundColor: theme.navy }]}>
        <BrandTile brand={product.brand} logo={product.logo_url} size={56} />
        <T kind="heading" color="#ffffff">
          {product.name}
        </T>
        {chosen !== null ? (
          <T kind="title" color="#ffffff">
            {formatMoney(chosen, product.face_currency, { cents: false })}
          </T>
        ) : null}
      </View>
      {rate.data && rate.data.rate !== null ? (
        <T muted>
          Rate today{' '}
          <T style={{ fontFamily: inter.bold }}>
            {formatMoney(rate.data.rate, rate.data.currency)} per {rate.data.face_currency === 'USD' ? '$1' : `1 ${rate.data.face_currency}`}
          </T>
        </T>
      ) : null}

      <View style={{ gap: 8 }} accessibilityRole="radiogroup" accessibilityLabel="Card value">
        <T kind="label">Card value</T>
        {values.length === 0 ? <Notice>This card has no values on sale right now.</Notice> : null}
        <View style={styles.wrap}>
          {values.map(value => (
            <Chip key={value} label={formatMoney(value, product.face_currency, { cents: false })} selected={value === chosen} onPress={() => setFace(value)} />
          ))}
        </View>
      </View>

      <View style={styles.qty}>
        <T kind="label" style={{ flex: 1 }}>
          How many
        </T>
        <Stepper label="One fewer" text="−" onPress={() => setQuantity(value => Math.max(1, value - 1))} />
        <T kind="heading" accessibilityLiveRegion="polite" style={{ minWidth: 28, textAlign: 'center' }}>
          {quantity}
        </T>
        <Stepper label="One more" text="+" onPress={() => setQuantity(value => Math.min(10, value + 1))} />
      </View>

      <Field label="Also email the codes to" value={sendTo} onChangeText={setEmail} autoCapitalize="none" keyboardType="email-address" autoComplete="email" />

      {each !== null && rate.data && rate.data.rate !== null ? (
        <Card>
          <Line label="About" value={formatMoney(each * quantity, rate.data.currency)} strong />
          <T kind="small" muted>
            The exact price is shown before you pay.
          </T>
        </Card>
      ) : null}
      {error ? <Notice tone="bad">{error}</Notice> : null}
      <Button label="Continue" onPress={proceed} disabled={values.length === 0} />
    </Page>
  );
}

function Stepper({ label, text, onPress }: { label: string; text: string; onPress: () => void }) {
  const theme = useTheme();
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={onPress} style={[styles.step, { borderColor: theme.field, backgroundColor: theme.card }]}>
      <T kind="heading">{text}</T>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  hero: { borderRadius: 20, padding: 20, gap: 12 },
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  qty: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  step: { width: 44, height: 44, borderRadius: 12, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
});

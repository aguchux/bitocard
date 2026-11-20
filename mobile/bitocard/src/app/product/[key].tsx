import { useQuery } from '@tanstack/react-query';
import { Redirect, router, Stack, useLocalSearchParams, type Href } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { BrandTile } from '@/components/brand-tile';
import { Button, Card, Chip, Field, Notice, Page, Segmented, T } from '@/components/ui';
import { useAccount } from '@/lib/account';
import { api, ApiError } from '@/lib/api';
import { productRoute } from '@/lib/links';
import { formatMoney } from '@/lib/money';
import { categoryLabels, emailsCodes, faceValueOf, recipientField, takesQuantity } from '@/lib/products';
import type { StoreProductDetail } from '@/lib/types';

/**
 * Buy one product: electricity and other bills (the meter or account number, checked with the provider before paying),
 * pay-TV (the smartcard, and renewing the current package or changing to this one), software licences and VPN access
 * (several at a time, codes also emailed). Continue opens Confirm payment, which quotes first.
 */
export default function ProductScreen() {
  const { key } = useLocalSearchParams<{ key: string }>();
  const { customer } = useAccount();
  const currency = customer?.currency;
  const product = useQuery({
    queryKey: ['product', key, currency],
    queryFn: () => api<StoreProductDetail & { redeem_instructions?: string | null }>(`/v1/store/products/${encodeURIComponent(key)}${currency ? `?currency=${currency}` : ''}`),
  });
  const [chosen, setChosen] = useState<number | null>(null);
  const [amount, setAmount] = useState('');
  const [quantity, setQuantity] = useState(1);
  const [recipient, setRecipient] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [renew, setRenew] = useState<'change' | 'renew'>('change');
  const [error, setError] = useState<string | null>(null);

  if (product.isPending) {
    return (
      <Page>
        <T muted>Loading…</T>
      </Page>
    );
  }
  if (product.isError) {
    return (
      <Page>
        <Notice tone="bad">{product.error instanceof ApiError ? product.error.message : 'This product could not be loaded. Check your connection.'}</Notice>
        <Button kind="secondary" label="Try again" onPress={() => void product.refetch()} />
      </Page>
    );
  }
  const detail = product.data;
  // Gift cards and top-ups have their own screens.
  const own = productRoute(detail);
  if (own.pathname !== '/product/[key]') return <Redirect href={own as Href} />;

  const field = recipientField(detail.recipient_type);
  const values = detail.denominations ? [...detail.denominations].sort((a, b) => a - b) : [];
  const value = values.length === 1 ? values[0]! : chosen;
  const payTv = detail.category === 'pay_tv';

  const proceed = () => {
    setError(null);
    const face = faceValueOf(detail, value, amount);
    if ('problem' in face) return setError(face.problem);
    const number = recipient.replace(/\s/g, '');
    if (field && number.length < 4) return setError(`Enter the ${field.label.toLowerCase()}.`);
    if (emailsCodes(detail.category) && email.trim() && !/^\S+@\S+\.\S+$/.test(email.trim())) return setError('Enter a valid email, or leave it empty.');
    const params: Record<string, string> = { product: detail.id, face: String(face.value), name: detail.name };
    if (field?.kind === 'phone') params.phone = number;
    if (field?.kind === 'account') {
      params.account = number;
      if (phone.trim()) params.phone = phone.trim();
    }
    if (payTv) params.transaction = renew;
    if (takesQuantity(detail.category) && quantity > 1) params.quantity = String(quantity);
    if (emailsCodes(detail.category) && email.trim()) params.email = email.trim();
    router.push({ pathname: '/pay', params });
  };

  return (
    <Page>
      <Stack.Screen options={{ title: categoryLabels[detail.category] ?? 'Buy' }} />
      <View style={styles.head}>
        <BrandTile brand={detail.brand} logo={detail.logo_url} size={56} />
        <View style={{ flex: 1 }}>
          <T kind="heading">{detail.name}</T>
          <T kind="small" muted>
            {detail.brand.name}
          </T>
        </View>
      </View>

      {payTv ? (
        <Segmented
          label="Renew or change"
          value={renew}
          onChange={setRenew}
          options={[
            { key: 'change', label: 'Change to this package' },
            { key: 'renew', label: 'Renew current package' },
          ]}
        />
      ) : null}

      {field ? <Field label={field.label} value={recipient} onChangeText={setRecipient} keyboardType={field.kind === 'phone' ? 'phone-pad' : 'number-pad'} hint={field.hint} autoComplete={field.kind === 'phone' ? 'tel' : 'off'} /> : null}
      {field?.kind === 'account' ? <Field label="Your mobile number (optional)" value={phone} onChangeText={setPhone} keyboardType="phone-pad" autoComplete="tel" hint="Some providers text the receipt or token to it." /> : null}

      {values.length > 1 ? (
        <View style={{ gap: 8 }} accessibilityRole="radiogroup" accessibilityLabel="Value">
          <T kind="label">Value</T>
          <View style={styles.wrap}>
            {values.map(item => (
              <Chip key={item} label={formatMoney(item, detail.face_currency, { cents: false })} selected={item === value} onPress={() => setChosen(item)} />
            ))}
          </View>
        </View>
      ) : values.length === 1 ? (
        <Card>
          <T kind="label">Price</T>
          <T kind="heading">{formatMoney(values[0]!, detail.face_currency, { cents: false })}</T>
        </Card>
      ) : detail.range ? (
        <Field
          label={`Amount (${detail.face_currency})`}
          value={amount}
          onChangeText={setAmount}
          keyboardType="decimal-pad"
          hint={`From ${formatMoney(detail.range.min, detail.face_currency, { cents: false })} to ${formatMoney(detail.range.max, detail.face_currency, { cents: false })}`}
        />
      ) : null}

      {takesQuantity(detail.category) ? (
        <View style={{ gap: 8 }} accessibilityRole="radiogroup" accessibilityLabel="How many">
          <T kind="label">How many</T>
          <View style={styles.wrap}>
            {[1, 2, 3, 5, 10].map(count => (
              <Chip key={count} label={String(count)} selected={count === quantity} onPress={() => setQuantity(count)} />
            ))}
          </View>
        </View>
      ) : null}

      {emailsCodes(detail.category) ? <Field label="Send the codes to (optional)" value={email} onChangeText={setEmail} keyboardType="email-address" autoCapitalize="none" autoComplete="email" hint="Leave empty to use your account email. They are also kept in your orders." /> : null}

      {detail.redeem_instructions ? (
        <T kind="small" muted>
          {detail.redeem_instructions}
        </T>
      ) : null}
      {error ? <Notice tone="bad">{error}</Notice> : null}
      <Button label="Continue" onPress={proceed} />
      <T kind="small" muted>
        You see the exact price, and who it goes to, before you pay.
      </T>
    </Page>
  );
}

const styles = StyleSheet.create({
  head: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
});

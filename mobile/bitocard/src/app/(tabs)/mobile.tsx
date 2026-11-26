import { useQuery } from '@tanstack/react-query';
import { router, useLocalSearchParams } from 'expo-router';
import { useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { Button, Chip, Field, Notice, Page, Segmented, T, useTheme } from '@/components/ui';
import { useAccount } from '@/lib/account';
import { api } from '@/lib/api';
import { formatMoney, toMinor } from '@/lib/money';
import { cataloguePath } from '@/lib/products';
import type { NetworkDetection, Page as List, StoreProduct, StoreProductDetail } from '@/lib/types';

type Kind = 'airtime' | 'data';

/** Whole-unit amounts offered as chips for airtime, kept to what the network's product takes. */
const presets = [100, 200, 500, 1000, 2000, 5000];

/**
 * Buy airtime or data for any number in the customer's own country: the network from the number (the API's lookup,
 * else chosen), then an amount (airtime) or a plan (data), then Continue to confirm and pay from the wallet.
 */
export default function MobileTab() {
  const theme = useTheme();
  const params = useLocalSearchParams<{ kind?: string }>();
  const { customer } = useAccount();
  const country = customer?.country ?? 'NG';
  const currency = customer?.currency ?? 'NGN';
  // The kind follows Home's tile (`?kind=`) until the customer switches it here, then theirs for that tile.
  const asked: Kind = params.kind === 'data' ? 'data' : 'airtime';
  const [picked, setPicked] = useState<{ asked: Kind; kind: Kind } | null>(null);
  const kind = picked && picked.asked === asked ? picked.kind : asked;
  const setKind = (next: Kind) => setPicked({ asked, kind: next });
  const [phone, setPhone] = useState('');
  const [chosenBrand, setBrand] = useState<string | null>(null);
  const [amount, setAmount] = useState('');
  const [plan, setPlan] = useState<{ id: string; value: number; name: string } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const products = useQuery({
    queryKey: ['products', kind, country, currency],
    queryFn: () => api<List<StoreProduct>>(cataloguePath(kind, country, currency)),
  });
  const brands = useMemo(() => {
    const seen = new Map<string, string>();
    for (const product of products.data?.data ?? []) if (product.country === country && !seen.has(product.brand.slug)) seen.set(product.brand.slug, product.brand.name);
    return [...seen].map(([slug, name]) => ({ slug, name }));
  }, [products.data, country]);

  // The network from the number, once it looks complete (the API's lookup, else a prefix guess; never forced).
  const digits = phone.replace(/\D/g, '');
  const detect = useQuery({
    queryKey: ['network-detect', digits, kind, country],
    enabled: digits.length >= 10,
    queryFn: () => api<NetworkDetection>(`/v1/store/network-detect?phone=${encodeURIComponent(phone)}&country=${country}&category=${kind}&currency=${currency}`),
    staleTime: 10 * 60_000,
  });
  const detected = detect.data?.detected && detect.data.brand && brands.some(item => item.slug === detect.data!.brand) ? detect.data.brand : null;
  // The customer's own choice wins; else the network the number belongs to.
  const brand = chosenBrand ?? detected;

  const forBrand = (products.data?.data ?? []).filter(product => product.brand.slug === brand && product.country === country);
  const airtime = kind === 'airtime' ? forBrand[0] : undefined;
  const detail = useQuery({
    queryKey: ['product', airtime?.key],
    enabled: Boolean(airtime),
    queryFn: () => api<StoreProductDetail>(`/v1/store/products/${encodeURIComponent(airtime!.key)}?currency=${currency}`),
  });
  const faceCurrency = airtime?.face_currency ?? currency;
  const range = detail.data?.range;
  const amountChips = detail.data?.denominations ?? presets.map(unit => unit * 100).filter(value => !range || (value >= range.min && value <= range.max));

  const switchKind = (next: Kind) => {
    setKind(next);
    setPlan(null);
    setAmount('');
    setError(null);
  };

  const proceed = () => {
    setError(null);
    if (digits.length < 10) return setError('Enter the mobile number to top up.');
    if (!brand) return setError('Choose the network.');
    let productId: string;
    let faceValue: number;
    let name: string;
    if (kind === 'airtime') {
      if (!airtime) return setError('This network has no airtime on sale right now.');
      const value = toMinor(amount, faceCurrency);
      if (!value) return setError('Enter an amount.');
      if (range && (value < range.min || value > range.max)) return setError(`Enter between ${formatMoney(range.min, faceCurrency, { cents: false })} and ${formatMoney(range.max, faceCurrency, { cents: false })}.`);
      productId = airtime.id;
      faceValue = value;
      name = `${airtime.brand.name} airtime`;
    } else {
      if (!plan) return setError('Choose a data plan.');
      productId = plan.id;
      faceValue = plan.value;
      name = plan.name;
    }
    router.push({ pathname: '/pay', params: { product: productId, face: String(faceValue), phone: phone.trim(), name } });
  };

  return (
    <Page header={false}>
      <T kind="title" accessibilityRole="header">
        {kind === 'airtime' ? 'Buy airtime' : 'Buy data'}
      </T>
      <Segmented
        label="Airtime or data"
        value={kind}
        onChange={switchKind}
        options={[
          { key: 'airtime', label: 'Airtime' },
          { key: 'data', label: 'Data' },
        ]}
      />
      <Field label="Mobile number" value={phone} onChangeText={setPhone} keyboardType="phone-pad" autoComplete="tel" textContentType="telephoneNumber" placeholder="0806 000 0000" />
      {detected && brand === detected ? <T kind="small" color={theme.good}>Looks like a {brands.find(item => item.slug === brand)?.name} number</T> : null}

      <View style={{ gap: 8 }} accessibilityRole="radiogroup" accessibilityLabel="Network">
        <T kind="label">Network</T>
        {products.isPending ? <T muted>Loading…</T> : null}
        {products.isError ? <Notice tone="bad">The networks could not be loaded. Check your connection.</Notice> : null}
        {products.data && brands.length === 0 ? <Notice>Nothing to buy here yet in your country.</Notice> : null}
        <View style={styles.wrap}>
          {brands.map(item => (
            <Chip
              key={item.slug}
              label={item.name}
              ring
              selected={item.slug === brand}
              onPress={() => {
                setBrand(item.slug);
                setPlan(null);
              }}
            />
          ))}
        </View>
      </View>

      {kind === 'airtime' && brand ? (
        <View style={{ gap: 8 }} accessibilityRole="radiogroup" accessibilityLabel="Amount">
          <T kind="label">Amount</T>
          <View style={styles.wrap}>
            {amountChips.map(value => {
              const text = String(value / 100);
              return <Chip key={value} label={formatMoney(value, faceCurrency, { cents: false })} selected={toMinor(amount, faceCurrency) === value} onPress={() => setAmount(text)} />;
            })}
          </View>
          <Field label={`Or type an amount (${faceCurrency})`} value={amount} onChangeText={setAmount} keyboardType="decimal-pad" hint={range ? `${formatMoney(range.min, faceCurrency, { cents: false })} to ${formatMoney(range.max, faceCurrency, { cents: false })}` : undefined} />
        </View>
      ) : null}

      {kind === 'data' && brand ? (
        <View style={{ gap: 8 }} accessibilityRole="radiogroup" accessibilityLabel="Data plan">
          <T kind="label">Plan</T>
          {forBrand.length === 0 ? <Notice>This network has no data plans on sale right now.</Notice> : null}
          {forBrand.map(product => {
            const value = product.from;
            const on = plan?.id === product.id;
            return (
              <Chip key={product.id} ring selected={on} label={`${product.name} · ${formatMoney(value, product.face_currency, { cents: false })}`} onPress={() => setPlan({ id: product.id, value, name: product.name })} />
            );
          })}
        </View>
      ) : null}

      {error ? <Notice tone="bad">{error}</Notice> : null}
      <Button label="Continue" onPress={proceed} />
      <Button kind="secondary" label="Sell or buy unused airtime" onPress={() => router.push('/airtime')} />
    </Page>
  );
}

const styles = StyleSheet.create({
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
});

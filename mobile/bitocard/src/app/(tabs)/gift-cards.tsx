import { useQuery } from '@tanstack/react-query';
import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { BrandTile } from '@/components/brand-tile';
import { Card, Field, inter, Notice, Page, Segmented, T, useTheme } from '@/components/ui';
import { useAccount } from '@/lib/account';
import { api } from '@/lib/api';
import { saleStatusOf } from '@/lib/gift-cards';
import { formatMoney } from '@/lib/money';
import type { GiftCardSale, Page as List, StoreProduct } from '@/lib/types';

/**
 * Gift cards: Buy (the cards on sale, by brand) or Sell (the same cards; each opens what BitoCard pays for it, where it
 * buys that card), with the customer's own sales above in Sell.
 */
export default function GiftCardsTab() {
  const theme = useTheme();
  const { customer } = useAccount();
  const country = customer?.country ?? 'NG';
  const currency = customer?.currency ?? 'NGN';
  // Buy or Sell follows Home's tile (`?mode=`) until the customer switches it here.
  const params = useLocalSearchParams<{ mode?: string }>();
  const asked = params.mode === 'sell' ? 'sell' : 'buy';
  const [picked, setPicked] = useState<{ asked: string; mode: 'buy' | 'sell' } | null>(null);
  const mode = picked && picked.asked === asked ? picked.mode : asked;
  const setMode = (next: 'buy' | 'sell') => setPicked({ asked, mode: next });
  const [words, setWords] = useState('');
  const products = useQuery({
    queryKey: ['products', 'gift_cards', country, currency],
    queryFn: () => api<List<StoreProduct>>(`/v1/store/products?category=gift_cards&market=${country}&currency=${currency}&limit=100&sort=popular`),
  });
  const sales = useQuery({ queryKey: ['gift-card-sales'], enabled: mode === 'sell', queryFn: () => api<{ data: GiftCardSale[] }>('/v1/store/gift-card-sales') });
  const query = words.trim().toLowerCase();
  const shown = (products.data?.data ?? []).filter(product => !query || product.name.toLowerCase().includes(query) || product.brand.name.toLowerCase().includes(query));

  return (
    <Page header={false}>
      <T kind="title" accessibilityRole="header">
        Gift cards
      </T>
      <Segmented
        label="Buy or sell"
        value={mode}
        onChange={setMode}
        options={[
          { key: 'buy', label: 'Buy' },
          { key: 'sell', label: 'Sell' },
        ]}
      />
      <Field label="Find a gift card" value={words} onChangeText={setWords} placeholder="Amazon, Apple, Steam…" autoCorrect={false} />
      <T kind="small" muted>
        {mode === 'buy' ? 'Codes are delivered in the app and by email, usually in seconds.' : 'Sell an unused card for money in your wallet. Paid once the card is checked and accepted.'}
      </T>

      {mode === 'sell' && sales.data?.data.length ? (
        <View style={{ gap: 8 }}>
          <T kind="heading">Your sales</T>
          {sales.data.data.slice(0, 5).map(sale => {
            const status = saleStatusOf(sale.status);
            return (
              <Pressable key={sale.id} accessibilityRole="button" onPress={() => router.push({ pathname: '/sale/[id]', params: { id: sale.id } })}>
                <Card style={{ flexDirection: 'row', alignItems: 'center' }}>
                  <View style={{ flex: 1, gap: 2 }}>
                    <T style={{ fontFamily: inter.semibold }}>{sale.card.name}</T>
                    <T kind="small" color={{ good: theme.good, warn: theme.warn, bad: theme.bad }[status.tone]}>
                      {status.label}
                    </T>
                  </View>
                  <T style={{ fontFamily: inter.bold }}>{formatMoney(sale.paid ?? sale.quoted, sale.currency)}</T>
                </Card>
              </Pressable>
            );
          })}
        </View>
      ) : null}

      {products.isPending ? <T muted>Loading…</T> : null}
      {products.isError ? <Notice tone="bad">The gift cards could not be loaded. Check your connection.</Notice> : null}
      {products.data && shown.length === 0 ? <T muted>No gift card matches.</T> : null}
      <View style={styles.grid}>
        {shown.map(product => (
          <Pressable
            key={product.id}
            accessibilityRole="button"
            accessibilityLabel={`${product.name}${mode === 'sell' ? ', sell' : ''}`}
            onPress={() => router.push(mode === 'buy' ? { pathname: '/gift-card/[key]', params: { key: product.key } } : { pathname: '/sell/[key]', params: { key: product.key } })}
            style={[styles.card, { backgroundColor: theme.card, borderColor: theme.line }]}>
            <BrandTile brand={product.brand} logo={product.logo_url} size={52} />
            <T style={{ fontFamily: inter.semibold }} numberOfLines={2}>
              {product.name}
            </T>
            <T kind="small" muted>
              {mode === 'buy' ? `From ${formatMoney(product.from, product.face_currency, { cents: false })}` : 'See what we pay'}
            </T>
          </Pressable>
        ))}
      </View>
    </Page>
  );
}

const styles = StyleSheet.create({
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  card: { width: '47%', flexGrow: 1, borderRadius: 18, borderWidth: 1, padding: 14, gap: 8 },
});

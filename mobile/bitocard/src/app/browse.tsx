import { useQuery } from '@tanstack/react-query';
import { Redirect, router, Stack, useLocalSearchParams, type Href } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { BrandTile } from '@/components/brand-tile';
import { Card, Field, Notice, Page, Segmented, T } from '@/components/ui';
import { useAccount } from '@/lib/account';
import { api, ApiError } from '@/lib/api';
import { categoryRoute, productRoute } from '@/lib/links';
import { formatMoney } from '@/lib/money';
import { categoryLabels } from '@/lib/products';
import type { Page as List, StoreProduct } from '@/lib/types';

/** bitocard.com's menu groups that hold more than one category the app lists here (Bills: electricity and pay-TV). */
const groups: Record<string, string[]> = { bills: ['bills', 'pay_tv'] };

/**
 * What is on sale in a category (or the Bills group) in the customer's market, by brand, with a filter: electricity
 * and other bills, pay-TV, software, VPN. Gift cards and top-ups have their own tabs.
 */
export default function BrowseScreen() {
  const params = useLocalSearchParams<{ category?: string }>();
  const { customer } = useAccount();
  const country = customer?.country ?? 'NG';
  const asked = params.category ?? 'bills';
  const choices = groups[asked] ?? [asked];
  const [chosen, setChosen] = useState(choices[0]!);
  const category = choices.includes(chosen) ? chosen : choices[0]!;
  const [filter, setFilter] = useState('');
  const own = categoryRoute(category);
  const products = useQuery({
    queryKey: ['products', category, country, customer?.currency],
    enabled: own.pathname === '/browse',
    queryFn: () => api<List<StoreProduct>>(`/v1/store/products?category=${category}&market=${country}${customer?.currency ? `&currency=${customer.currency}` : ''}&limit=100&sort=popular`),
  });
  // Gift cards, airtime and data open their tabs.
  if (own.pathname !== '/browse') return <Redirect href={own as Href} />;

  const words = filter.trim().toLowerCase();
  const shown = (products.data?.data ?? []).filter(product => !words || product.name.toLowerCase().includes(words) || product.brand.name.toLowerCase().includes(words));
  return (
    <Page>
      <Stack.Screen options={{ title: choices.length > 1 ? 'Pay bills' : (categoryLabels[category] ?? 'Products') }} />
      {choices.length > 1 ? <Segmented label="What to pay" value={category} onChange={setChosen} options={choices.map(key => ({ key, label: key === 'bills' ? 'Electricity and bills' : (categoryLabels[key] ?? key) }))} /> : null}
      <Field label="Find" value={filter} onChangeText={setFilter} placeholder={category === 'pay_tv' ? 'DStv, GOtv…' : category === 'bills' ? 'Your electricity company…' : 'Search'} autoCorrect={false} />
      {products.isPending ? <T muted>Loading…</T> : null}
      {products.isError ? <Notice tone="bad">{products.error instanceof ApiError ? products.error.message : 'These could not be loaded. Check your connection.'}</Notice> : null}
      {products.data && shown.length === 0 ? <Notice>{words ? 'Nothing matches.' : 'Nothing on sale here in your country yet.'}</Notice> : null}
      {shown.map(product => (
        <Pressable key={product.id} accessibilityRole="button" accessibilityLabel={product.name} onPress={() => router.push(productRoute(product) as Href)}>
          <Card style={styles.row}>
            <BrandTile brand={product.brand} logo={product.logo_url} size={44} />
            <View style={{ flex: 1 }}>
              <T kind="label">{product.name}</T>
              <T kind="small" muted>
                {product.denomination_type === 'range' ? 'Any amount from ' : ''}
                {formatMoney(product.from, product.face_currency, { cents: false })}
                {product.denomination_type === 'fixed' && product.to > product.from ? ` to ${formatMoney(product.to, product.face_currency, { cents: false })}` : ''}
              </T>
            </View>
          </Card>
        </Pressable>
      ))}
    </Page>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 12 },
});

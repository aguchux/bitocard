import { useQuery } from '@tanstack/react-query';
import { router, useLocalSearchParams, type Href } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { BrandTile } from '@/components/brand-tile';
import { Card, Field, Notice, Page, T } from '@/components/ui';
import { useAccount } from '@/lib/account';
import { api, ApiError } from '@/lib/api';
import { productRoute } from '@/lib/links';
import { formatMoney } from '@/lib/money';
import type { StoreSearch } from '@/lib/types';

/**
 * Search everything on sale in the customer's market (`GET /v1/store/search`), as they type. Gift cards and top-ups
 * open their screens; anything else (bills, pay-TV, software, VPN) the product screen.
 */
export default function SearchScreen() {
  const params = useLocalSearchParams<{ q?: string }>();
  const { customer } = useAccount();
  const country = customer?.country ?? 'NG';
  const [text, setText] = useState(params.q ?? '');
  const [words, setWords] = useState(text.trim());
  useEffect(() => {
    const wait = setTimeout(() => setWords(text.trim()), 300);
    return () => clearTimeout(wait);
  }, [text]);

  const results = useQuery({
    queryKey: ['search', words, country],
    enabled: words.length >= 2,
    queryFn: () => api<StoreSearch>(`/v1/store/search?q=${encodeURIComponent(words)}&market=${country}`),
    placeholderData: previous => previous,
  });
  const products = words.length >= 2 ? (results.data?.products ?? []) : [];

  return (
    <Page>
      <Field label="Search" value={text} onChangeText={setText} placeholder="Amazon, MTN data, Steam…" autoFocus returnKeyType="search" autoCorrect={false} />
      {results.isError ? <Notice tone="bad">{results.error instanceof ApiError ? results.error.message : 'Search is not answering. Try again.'}</Notice> : null}
      {words.length >= 2 && results.data && products.length === 0 ? <T muted>Nothing matches “{words}”.</T> : null}
      {products.map(product => {
        const to = productRoute(product);
        return (
          <Pressable
            key={product.id}
            accessibilityRole="button"
            accessibilityLabel={product.name}
            onPress={() => router.push(to as Href)}>
            <Card style={styles.row}>
              <BrandTile brand={product.brand} logo={product.logo_url} size={44} />
              <View style={{ flex: 1 }}>
                <T kind="label">{product.name}</T>
                <T kind="small" muted>
                  From {formatMoney(product.from, product.face_currency, { cents: false })}
                </T>
              </View>
            </Card>
          </Pressable>
        );
      })}
    </Page>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 12 },
});
